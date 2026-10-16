-- Studio Booking v0.1.0 — business logic
-- All writes that touch credits, spots or money go through these functions so the rules hold
-- no matter which screen calls them. Errors are raised with stable codes in the message
-- (e.g. 'session_full') that the app translates for people.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'member'::app_role)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('staff', 'manager', 'owner')
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('manager', 'owner')
$$;

create or replace function public.is_instructor_or_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('instructor', 'staff', 'manager', 'owner')
$$;

create or replace function public._require_staff() returns void
language plpgsql stable as $$
begin
  if not public.is_staff() then raise exception 'not_allowed'; end if;
end $$;

create or replace function public._require_manager() returns void
language plpgsql stable as $$
begin
  if not public.is_manager() then raise exception 'not_allowed'; end if;
end $$;

create or replace function public._audit(p_action text, p_entity text, p_id uuid, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, entity, entity_id, detail) values (auth.uid(), p_action, p_entity, p_id, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- New users get a profile. LINE sign-in passes name / picture / line_user_id in metadata.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, line_user_id, avatar_url, branch_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'line_user_id',
    new.raw_user_meta_data ->> 'picture',
    (select id from branches order by created_at limit 1)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members edit only these fields of their own profile.
create or replace function public.update_my_profile(
  p_display_name text, p_phone text, p_birthday date, p_emergency_contact text, p_pdpa_consent boolean
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare r profiles;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update profiles set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    phone = nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), ''),
    birthday = p_birthday,
    emergency_contact = nullif(trim(coalesce(p_emergency_contact, '')), ''),
    pdpa_consent_at = case when p_pdpa_consent then coalesce(pdpa_consent_at, now()) else null end
  where id = auth.uid()
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Capacity and spots
-- ---------------------------------------------------------------------------
create or replace function public.session_capacity(p_session_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    s.capacity,
    case when s.layout_id is null then 1 else (
      select count(*)::int from layout_spots ls
      where ls.layout_id = s.layout_id and ls.active
        and not exists (select 1 from session_disabled_spots d where d.session_id = s.id and d.spot_id = ls.id)
    ) end)
  from sessions s where s.id = p_session_id
$$;

create or replace function public.session_booked_count(p_session_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from bookings where session_id = p_session_id and status in ('booked', 'checked_in')
$$;

-- Availability for a date range, safe for members (counts only, no names).
create or replace function public.session_availability(p_from timestamptz, p_to timestamptz, p_branch_id uuid default null)
returns table (session_id uuid, capacity int, booked int, waiting int, my_booking_id uuid, my_spot_label text, on_waitlist boolean)
language sql stable security definer set search_path = public as $$
  select s.id,
         public.session_capacity(s.id),
         public.session_booked_count(s.id),
         (select count(*)::int from waitlist w where w.session_id = s.id and w.status = 'waiting'),
         b.id,
         ls.label,
         exists (select 1 from waitlist w where w.session_id = s.id and w.member_id = auth.uid() and w.status = 'waiting')
  from sessions s
  left join bookings b on b.session_id = s.id and b.member_id = auth.uid() and b.status in ('booked', 'checked_in')
  left join layout_spots ls on ls.id = b.spot_id
  where s.starts_at >= p_from and s.starts_at < p_to and s.status = 'scheduled'
    and (p_branch_id is null or s.branch_id = p_branch_id)
$$;

-- Spot map for one session: free / taken / mine / off. Never reveals who took a spot.
create or replace function public.get_session_spots(p_session_id uuid)
returns table (spot_id uuid, label text, x int, y int, state text)
language sql stable security definer set search_path = public as $$
  select ls.id, ls.label, ls.x, ls.y,
    case
      when not ls.active or d.spot_id is not null then 'off'
      when b.member_id = auth.uid() then 'mine'
      when b.id is not null then 'taken'
      else 'free'
    end
  from sessions s
  join layout_spots ls on ls.layout_id = s.layout_id
  left join session_disabled_spots d on d.session_id = s.id and d.spot_id = ls.id
  left join bookings b on b.session_id = s.id and b.spot_id = ls.id and b.status in ('booked', 'checked_in')
  where s.id = p_session_id and ls.x >= 0
  order by ls.y, ls.x
$$;

create or replace function public._first_free_spot(p_session_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select ls.id from sessions s
  join layout_spots ls on ls.layout_id = s.layout_id and ls.active
  where s.id = p_session_id
    and not exists (select 1 from session_disabled_spots d where d.session_id = s.id and d.spot_id = ls.id)
    and not exists (select 1 from bookings b where b.session_id = s.id and b.spot_id = ls.id and b.status in ('booked', 'checked_in'))
  order by ls.y, ls.x
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Wallet
-- ---------------------------------------------------------------------------
create or replace function public.member_wallet(p_member_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m uuid := coalesce(p_member_id, auth.uid());
begin
  if m <> auth.uid() and not public.is_staff() then raise exception 'not_allowed'; end if;
  return (
    select jsonb_build_object(
      'total', coalesce(sum(credits_remaining) filter (where expires_at > now()), 0),
      'vip', coalesce(sum(credits_remaining) filter (where expires_at > now() and vip), 0),
      'next_expiry', min(expires_at) filter (where expires_at > now() and credits_remaining > 0),
      'lots', coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'vip', vip, 'source', source, 'total', credits_total, 'remaining', credits_remaining,
          'expires_at', expires_at, 'created_at', created_at) order by expires_at)
        filter (where expires_at > now() and credits_remaining > 0), '[]'::jsonb))
    from credit_lots where member_id = m
  );
end $$;

-- Takes credits from the lots that expire first. General classes use normal credits first,
-- then VIP credits. VIP classes accept VIP credits only.
create or replace function public._consume_credits(
  p_member_id uuid, p_amount int, p_vip_only boolean, p_valid_at timestamptz, p_booking_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  need int := p_amount;
  lot record;
  take int;
begin
  if need <= 0 then return; end if;
  for lot in
    select * from credit_lots
    where member_id = p_member_id and credits_remaining > 0 and expires_at > p_valid_at
      and (frozen_until is null or frozen_until < now())
      and (not p_vip_only or vip)
    order by vip, expires_at, created_at
    for update
  loop
    take := least(need, lot.credits_remaining);
    update credit_lots set credits_remaining = credits_remaining - take where id = lot.id;
    if p_booking_id is not null then
      insert into booking_credit_usages (booking_id, lot_id, credits) values (p_booking_id, lot.id, take);
    end if;
    insert into credit_ledger (member_id, lot_id, delta, reason, booking_id, actor_id)
      values (p_member_id, lot.id, -take, p_reason, p_booking_id, auth.uid());
    need := need - take;
    exit when need = 0;
  end loop;
  if need > 0 then raise exception 'insufficient_credits'; end if;
end $$;

create or replace function public._refund_booking_credits(p_booking_id uuid, p_reason text default 'refund')
returns int language plpgsql security definer set search_path = public as $$
declare u record; total int := 0; m uuid;
begin
  select member_id into m from bookings where id = p_booking_id;
  for u in delete from booking_credit_usages where booking_id = p_booking_id returning * loop
    update credit_lots set credits_remaining = least(credits_total, credits_remaining + u.credits) where id = u.lot_id;
    insert into credit_ledger (member_id, lot_id, delta, reason, booking_id, actor_id)
      values (m, u.lot_id, u.credits, p_reason, p_booking_id, auth.uid());
    total := total + u.credits;
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------
-- Core booking without permission checks. Caller must hold the session row lock.
create or replace function public._book(p_session_id uuid, p_member_id uuid, p_spot_id uuid, p_actor uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  s sessions;
  ct class_types;
  spot uuid := p_spot_id;
  b bookings;
begin
  select * into s from sessions where id = p_session_id;
  select * into ct from class_types where id = s.class_type_id;

  if exists (select 1 from bookings where session_id = s.id and member_id = p_member_id and status in ('booked', 'checked_in')) then
    raise exception 'already_booked';
  end if;
  if public.session_booked_count(s.id) >= public.session_capacity(s.id) then
    raise exception 'session_full';
  end if;

  if s.layout_id is not null then
    if spot is null then
      spot := public._first_free_spot(s.id);
      if spot is null then raise exception 'session_full'; end if;
    else
      if not exists (select 1 from layout_spots where id = spot and layout_id = s.layout_id and active) then
        raise exception 'spot_unavailable';
      end if;
      if exists (select 1 from session_disabled_spots where session_id = s.id and spot_id = spot) then
        raise exception 'spot_unavailable';
      end if;
      if exists (select 1 from bookings where session_id = s.id and spot_id = spot and status in ('booked', 'checked_in')) then
        raise exception 'spot_taken';
      end if;
    end if;
  else
    spot := null;
  end if;

  insert into bookings (session_id, member_id, spot_id, credits_used, booked_by)
    values (s.id, p_member_id, spot, ct.credit_cost, p_actor)
    returning * into b;

  perform public._consume_credits(p_member_id, ct.credit_cost, ct.requires_vip, s.starts_at, b.id, 'booking');

  update waitlist set status = 'promoted', booking_id = b.id, resolved_at = now()
    where session_id = s.id and member_id = p_member_id and status = 'waiting';
  return b;
exception
  when unique_violation then
    raise exception 'spot_taken';
end $$;

create or replace function public.book_session(p_session_id uuid, p_spot_id uuid default null, p_member_id uuid default null)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m uuid := coalesce(p_member_id, auth.uid());
  s sessions;
  ct class_types;
  staff boolean := public.is_staff();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if m <> me and not staff then raise exception 'not_allowed'; end if;

  select * into s from sessions where id = p_session_id for update;
  if not found or s.status <> 'scheduled' then raise exception 'session_not_found'; end if;
  select * into ct from class_types where id = s.class_type_id;

  if not staff then
    if s.starts_at <= now() then raise exception 'session_started'; end if;
    if s.starts_at > now() + make_interval(days => ct.booking_window_days) then raise exception 'booking_not_open'; end if;
  elsif s.ends_at <= now() then
    raise exception 'session_started';
  end if;

  return public._book(s.id, m, p_spot_id, me);
end $$;

-- Move to another free spot in the same session.
create or replace function public.move_booking_spot(p_booking_id uuid, p_spot_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare b bookings; s sessions;
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found or b.status <> 'booked' then raise exception 'booking_not_found'; end if;
  if b.member_id <> auth.uid() and not public.is_staff() then raise exception 'not_allowed'; end if;
  select * into s from sessions where id = b.session_id for update;
  if s.starts_at <= now() and not public.is_staff() then raise exception 'session_started'; end if;
  if not exists (select 1 from layout_spots where id = p_spot_id and layout_id = s.layout_id and active)
     or exists (select 1 from session_disabled_spots where session_id = s.id and spot_id = p_spot_id) then
    raise exception 'spot_unavailable';
  end if;
  update bookings set spot_id = p_spot_id, needs_new_spot = false where id = b.id returning * into b;
  return b;
exception when unique_violation then raise exception 'spot_taken';
end $$;

-- Fills open places from the waitlist, first come first served. Members without enough credit
-- are skipped (they stay on the list). Stops 2 hours before class so nobody is surprised.
create or replace function public._promote_waitlist(p_session_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  s sessions;
  w record;
  promoted int := 0;
begin
  select * into s from sessions where id = p_session_id for update;
  if s.status <> 'scheduled' or s.starts_at < now() + interval '2 hours' then return 0; end if;
  for w in select * from waitlist where session_id = s.id and status = 'waiting' order by created_at loop
    exit when public.session_booked_count(s.id) >= public.session_capacity(s.id);
    begin
      perform public._book(s.id, w.member_id, null, null);
      promoted := promoted + 1;
    exception when others then
      if sqlerrm = 'already_booked' then
        update waitlist set status = 'left', resolved_at = now() where id = w.id;
      end if;
      -- insufficient credits etc.: keep waiting, try next person
    end;
  end loop;
  return promoted;
end $$;

create or replace function public.cancel_booking(p_booking_id uuid, p_force_refund boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings; s sessions; ct class_types;
  staff boolean := public.is_staff();
  refund boolean;
  refunded int := 0;
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found or b.status <> 'booked' then raise exception 'booking_not_found'; end if;
  if b.member_id <> auth.uid() and not staff then raise exception 'not_allowed'; end if;
  select * into s from sessions where id = b.session_id for update;
  select * into ct from class_types where id = s.class_type_id;
  if s.starts_at <= now() and not staff then raise exception 'session_started'; end if;

  refund := now() <= s.starts_at - make_interval(hours => ct.cancel_cutoff_hours) or (staff and p_force_refund);
  if refund then
    refunded := public._refund_booking_credits(b.id, 'refund');
  end if;
  update bookings set status = case when refund then 'cancelled' else 'late_cancel' end::booking_status,
    cancelled_at = now() where id = b.id;
  perform public._promote_waitlist(s.id);
  return jsonb_build_object('refunded', refund, 'credits', refunded);
end $$;

create or replace function public.join_waitlist(p_session_id uuid)
returns public.waitlist language plpgsql security definer set search_path = public as $$
declare s sessions; ct class_types; w waitlist; bal int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into s from sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' or s.starts_at <= now() then raise exception 'session_not_found'; end if;
  select * into ct from class_types where id = s.class_type_id;
  if s.starts_at > now() + make_interval(days => ct.booking_window_days) then raise exception 'booking_not_open'; end if;
  if public.session_booked_count(s.id) < public.session_capacity(s.id) then raise exception 'session_not_full'; end if;
  if exists (select 1 from bookings where session_id = s.id and member_id = auth.uid() and status in ('booked', 'checked_in')) then
    raise exception 'already_booked';
  end if;
  select coalesce(sum(credits_remaining), 0) into bal from credit_lots
    where member_id = auth.uid() and expires_at > s.starts_at and (not ct.requires_vip or vip);
  if bal < ct.credit_cost then raise exception 'insufficient_credits'; end if;
  insert into waitlist (session_id, member_id) values (s.id, auth.uid()) returning * into w;
  return w;
exception when unique_violation then raise exception 'already_waiting';
end $$;

create or replace function public.leave_waitlist(p_session_id uuid)
returns void language sql security definer set search_path = public as $$
  update waitlist set status = 'left', resolved_at = now()
  where session_id = p_session_id and member_id = auth.uid() and status = 'waiting';
$$;

-- ---------------------------------------------------------------------------
-- Front desk
-- ---------------------------------------------------------------------------
create or replace function public.check_in_booking(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  if not public.is_instructor_or_staff() then raise exception 'not_allowed'; end if;
  update bookings set status = 'checked_in', checked_in_at = now()
    where id = p_booking_id and status in ('booked', 'no_show') returning * into b;
  if not found then raise exception 'booking_not_found'; end if;
  return b;
end $$;

-- Scan the member's QR. Finds their booking in a class starting from 60 min ago to 3 h ahead.
create or replace function public.check_in_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p profiles; b bookings; s sessions; ct class_types;
begin
  if not public.is_instructor_or_staff() then raise exception 'not_allowed'; end if;
  select * into p from profiles where checkin_code = upper(trim(p_code));
  if not found then raise exception 'member_not_found'; end if;
  select b2.* into b from bookings b2 join sessions s2 on s2.id = b2.session_id
    where b2.member_id = p.id and b2.status in ('booked', 'checked_in')
      and s2.starts_at between now() - interval '60 minutes' and now() + interval '3 hours'
    order by s2.starts_at limit 1;
  if not found then
    return jsonb_build_object('member_id', p.id, 'name', p.display_name, 'booking', null);
  end if;
  if b.status = 'booked' then
    update bookings set status = 'checked_in', checked_in_at = now() where id = b.id returning * into b;
  end if;
  select * into s from sessions where id = b.session_id;
  select * into ct from class_types where id = s.class_type_id;
  return jsonb_build_object('member_id', p.id, 'name', p.display_name, 'booking', b.id,
    'class', ct.name, 'starts_at', s.starts_at,
    'spot', (select label from layout_spots where id = b.spot_id));
end $$;

create or replace function public.mark_no_shows(p_session_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_instructor_or_staff() then raise exception 'not_allowed'; end if;
  update bookings set status = 'no_show' where session_id = p_session_id and status = 'booked'
    and (select starts_at from sessions where id = p_session_id) < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Switch one spot off (or back on) for one session only.
create or replace function public.set_session_spot_disabled(p_session_id uuid, p_spot_id uuid, p_disabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_staff();
  if p_disabled then
    if exists (select 1 from bookings where session_id = p_session_id and spot_id = p_spot_id and status in ('booked', 'checked_in')) then
      raise exception 'spot_taken';
    end if;
    insert into session_disabled_spots values (p_session_id, p_spot_id) on conflict do nothing;
  else
    delete from session_disabled_spots where session_id = p_session_id and spot_id = p_spot_id;
    perform public._promote_waitlist(p_session_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Timetable
-- ---------------------------------------------------------------------------
create or replace function public._check_turnover(p_room_id uuid, p_starts timestamptz, p_ends timestamptz, p_ignore uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare gap int;
begin
  select turnover_minutes into gap from rooms where id = p_room_id;
  if exists (
    select 1 from sessions where room_id = p_room_id and status = 'scheduled' and id is distinct from p_ignore
      and tstzrange(starts_at, ends_at) && tstzrange(p_starts, p_ends)
  ) then
    raise exception 'room_busy';
  end if;
  if gap > 0 and exists (
    select 1 from sessions where room_id = p_room_id and status = 'scheduled' and id is distinct from p_ignore
      and tstzrange(starts_at - make_interval(mins => gap), ends_at + make_interval(mins => gap)) && tstzrange(p_starts, p_ends)
  ) then
    raise exception 'room_turnover_conflict';
  end if;
end $$;

create or replace function public.create_session(
  p_class_type_id uuid, p_room_id uuid, p_layout_id uuid, p_instructor_id uuid,
  p_starts_at timestamptz, p_duration_minutes int default null, p_capacity int default null, p_note text default null
) returns public.sessions language plpgsql security definer set search_path = public as $$
declare ct class_types; r rooms; s sessions; ends timestamptz;
begin
  perform public._require_staff();
  select * into ct from class_types where id = p_class_type_id;
  select * into r from rooms where id = p_room_id;
  if ct.id is null or r.id is null then raise exception 'not_found'; end if;
  if p_layout_id is not null and not exists (select 1 from layouts where id = p_layout_id and room_id = r.id) then
    raise exception 'layout_not_in_room';
  end if;
  ends := p_starts_at + make_interval(mins => coalesce(p_duration_minutes, ct.duration_minutes));
  perform public._check_turnover(r.id, p_starts_at, ends, null);
  insert into sessions (branch_id, class_type_id, room_id, layout_id, instructor_id, starts_at, ends_at, capacity, note)
    values (r.branch_id, ct.id, r.id, p_layout_id, p_instructor_id, p_starts_at, ends, p_capacity, p_note)
    returning * into s;
  return s;
exception
  when exclusion_violation then
    if sqlerrm like '%instructor%' then raise exception 'instructor_busy'; end if;
    raise exception 'room_busy';
end $$;

create or replace function public.update_session(
  p_session_id uuid, p_instructor_id uuid, p_starts_at timestamptz, p_duration_minutes int, p_capacity int, p_note text
) returns public.sessions language plpgsql security definer set search_path = public as $$
declare s sessions; ends timestamptz;
begin
  perform public._require_staff();
  select * into s from sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  ends := p_starts_at + make_interval(mins => p_duration_minutes);
  perform public._check_turnover(s.room_id, p_starts_at, ends, s.id);
  if p_capacity is not null and p_capacity < public.session_booked_count(s.id) then raise exception 'capacity_below_bookings'; end if;
  update sessions set instructor_id = p_instructor_id, starts_at = p_starts_at, ends_at = ends, capacity = p_capacity, note = p_note
    where id = s.id returning * into s;
  perform public._promote_waitlist(s.id);
  return s;
exception
  when exclusion_violation then
    if sqlerrm like '%instructor%' then raise exception 'instructor_busy'; end if;
    raise exception 'room_busy';
end $$;

-- Swap the layout of a session that already has bookings. Bookings keep the spot with the same
-- label; anyone whose spot no longer exists is flagged to pick again.
create or replace function public.change_session_layout(p_session_id uuid, p_layout_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s sessions; moved int := 0; flagged int := 0; b record; new_spot uuid;
begin
  perform public._require_staff();
  select * into s from sessions where id = p_session_id for update;
  if not exists (select 1 from layouts where id = p_layout_id and room_id = s.room_id) then raise exception 'layout_not_in_room'; end if;
  delete from session_disabled_spots where session_id = s.id;
  update sessions set layout_id = p_layout_id where id = s.id;
  -- free all spots first so labels can be reassigned without collisions
  create temp table _old on commit drop as
    select b2.id, ls.label from bookings b2 left join layout_spots ls on ls.id = b2.spot_id
    where b2.session_id = s.id and b2.status in ('booked', 'checked_in');
  update bookings set spot_id = null where id in (select id from _old);
  for b in select * from _old loop
    select id into new_spot from layout_spots where layout_id = p_layout_id and label = b.label and active;
    if new_spot is not null then
      update bookings set spot_id = new_spot, needs_new_spot = false where id = b.id;
      moved := moved + 1;
    else
      flagged := flagged + 1;
    end if;
  end loop;
  -- people without a matching label get the next free spot and a flag to review it
  for b in select id from _old o where not exists (select 1 from bookings x where x.id = o.id and x.spot_id is not null) loop
    new_spot := public._first_free_spot(s.id);
    update bookings set spot_id = new_spot, needs_new_spot = true where id = b.id;
  end loop;
  perform public._audit('change_layout', 'session', s.id, jsonb_build_object('layout', p_layout_id, 'kept', moved, 'flagged', flagged));
  return jsonb_build_object('kept', moved, 'flagged', flagged);
end $$;

create or replace function public.cancel_session(p_session_id uuid, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare b record; n int := 0;
begin
  perform public._require_staff();
  update sessions set status = 'cancelled', note = coalesce(p_reason, note) where id = p_session_id and status = 'scheduled';
  if not found then raise exception 'session_not_found'; end if;
  for b in select id from bookings where session_id = p_session_id and status = 'booked' loop
    perform public._refund_booking_credits(b.id, 'session_cancelled');
    update bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
    n := n + 1;
  end loop;
  update waitlist set status = 'expired', resolved_at = now() where session_id = p_session_id and status = 'waiting';
  perform public._audit('cancel_session', 'session', p_session_id, jsonb_build_object('reason', p_reason, 'refunded', n));
  return n;
end $$;

-- Creates sessions from the weekly timetable. Skips slots that already exist or clash.
create or replace function public.generate_sessions(p_branch_id uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; d date; starts timestamptz; tz text; created int := 0; skipped int := 0;
begin
  perform public._require_staff();
  select timezone into tz from branches where id = p_branch_id;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range_too_long'; end if;
  d := p_from;
  while d <= p_to loop
    for t in select * from schedule_templates where branch_id = p_branch_id and active and weekday = extract(dow from d)::int loop
      starts := (d + t.start_time) at time zone tz;
      if exists (select 1 from sessions where room_id = t.room_id and starts_at = starts and status = 'scheduled') then
        skipped := skipped + 1;
        continue;
      end if;
      begin
        perform public.create_session(t.class_type_id, t.room_id, t.layout_id, t.instructor_id, starts, t.duration_minutes, t.capacity, null);
        created := created + 1;
      exception when others then
        skipped := skipped + 1;
      end;
    end loop;
    d := d + 1;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

-- Saves a whole layout (grid size, fixtures, spots) in one go from the layout editor.
-- p_spots: [{ "id": uuid|null, "label": text, "x": int, "y": int, "active": bool }]
create or replace function public.save_layout(
  p_layout_id uuid, p_name text, p_equipment text, p_cols int, p_rows int, p_fixtures jsonb, p_spots jsonb
) returns public.layouts language plpgsql security definer set search_path = public as $$
declare l layouts; sp jsonb; keep uuid[] := '{}'; sid uuid;
begin
  perform public._require_manager();
  update layouts set name = p_name, equipment = p_equipment, cols = p_cols, rows = p_rows,
    fixtures = coalesce(p_fixtures, '[]'), updated_at = now()
    where id = p_layout_id returning * into l;
  if not found then raise exception 'not_found'; end if;

  -- park existing spots off-grid so positions/labels can be swapped freely
  update layout_spots set x = -1000 - x, y = -1000 - y, label = '__' || id::text where layout_id = l.id;

  for sp in select * from jsonb_array_elements(p_spots) loop
    sid := nullif(sp ->> 'id', '')::uuid;
    if sid is not null and exists (select 1 from layout_spots where id = sid and layout_id = l.id) then
      update layout_spots set label = sp ->> 'label', x = (sp ->> 'x')::int, y = (sp ->> 'y')::int,
        active = coalesce((sp ->> 'active')::boolean, true) where id = sid;
    else
      insert into layout_spots (layout_id, label, x, y, active)
        values (l.id, sp ->> 'label', (sp ->> 'x')::int, (sp ->> 'y')::int, coalesce((sp ->> 'active')::boolean, true))
        returning id into sid;
    end if;
    keep := keep || sid;
  end loop;

  -- removed spots: delete if never used, otherwise keep them hidden and inactive
  delete from layout_spots ls where ls.layout_id = l.id and not (ls.id = any (keep))
    and not exists (select 1 from bookings b where b.spot_id = ls.id);
  -- (they stay parked at negative coordinates, which every spot map ignores)
  update layout_spots ls set active = false where ls.layout_id = l.id and not (ls.id = any (keep));

  if exists (select 1 from bookings b join sessions s on s.id = b.session_id
             join layout_spots ls on ls.id = b.spot_id
             where ls.layout_id = l.id and not ls.active and s.starts_at > now() and b.status = 'booked') then
    update bookings b set needs_new_spot = true from layout_spots ls, sessions s
      where ls.id = b.spot_id and s.id = b.session_id and ls.layout_id = l.id and not ls.active and s.starts_at > now() and b.status = 'booked';
  end if;
  perform public._audit('save_layout', 'layout', l.id, jsonb_build_object('spots', jsonb_array_length(p_spots)));
  return l;
end $$;

-- ---------------------------------------------------------------------------
-- Sales, packages and credit lots
-- ---------------------------------------------------------------------------
create or replace function public._grant_package(p_sale_id uuid, p_member_id uuid, p_package_id uuid, p_qty int)
returns void language plpgsql security definer set search_path = public as $$
declare p packages; lot uuid; i int;
begin
  select * into p from packages where id = p_package_id;
  if p.once_per_member and exists (
    select 1 from credit_lots where member_id = p_member_id and package_id = p.id and sale_id is distinct from p_sale_id
  ) then
    raise exception 'package_once_per_member';
  end if;
  for i in 1 .. p_qty loop
    insert into credit_lots (member_id, branch_id, source, package_id, sale_id, vip, credits_total, credits_remaining, expires_at)
      values (p_member_id, p.branch_id, 'purchase', p.id, p_sale_id, p.kind = 'vip', p.credits, p.credits,
              date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok' + make_interval(days => p.validity_days + 1) - interval '1 second')
      returning id into lot;
    insert into credit_ledger (member_id, lot_id, delta, reason, sale_id, actor_id)
      values (p_member_id, lot, p.credits, 'purchase', p_sale_id, auth.uid());
  end loop;
end $$;

-- Percent discount from an active promo code, limited to its package and audience.
create or replace function public.check_promo(p_branch_id uuid, p_code text, p_package_id uuid, p_member_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr promotions; m uuid := coalesce(p_member_id, auth.uid());
begin
  select * into pr from promotions
    where branch_id = p_branch_id and upper(code) = upper(trim(p_code)) and active
      and starts_at <= now() and (ends_at is null or ends_at > now())
      and (max_uses is null or uses < max_uses);
  if not found then raise exception 'promo_invalid'; end if;
  if pr.package_id is not null and pr.package_id is distinct from p_package_id then raise exception 'promo_not_for_package'; end if;
  if pr.audience_tag is not null and not exists (select 1 from profiles where id = m and pr.audience_tag = any (tags)) then
    raise exception 'promo_not_for_member';
  end if;
  return jsonb_build_object('id', pr.id, 'title', pr.title, 'discount_percent', coalesce(pr.discount_percent, 0));
end $$;

-- Counter sale. p_items: [{ "package_id": uuid } or { "product_id": uuid }, "qty": int ]
create or replace function public.pos_checkout(
  p_member_id uuid, p_items jsonb, p_payment_method public.payment_method,
  p_discount numeric default 0, p_note text default null
) returns public.sales language plpgsql security definer set search_path = public as $$
declare
  me profiles; sale sales; it jsonb; pk packages; pr products; qty int; sub numeric := 0; sh uuid;
begin
  perform public._require_staff();
  select * into me from profiles where id = auth.uid();
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'cart_empty'; end if;
  select id into sh from shifts where staff_id = me.id and closed_at is null;
  if sh is null then raise exception 'shift_not_open'; end if;

  insert into sales (branch_id, member_id, staff_id, shift_id, channel, status, payment_method, paid_at, note)
    values (coalesce(me.branch_id, (select id from branches order by created_at limit 1)), p_member_id, me.id, sh, 'counter', 'paid', p_payment_method, now(), p_note)
    returning * into sale;

  for it in select * from jsonb_array_elements(p_items) loop
    qty := greatest(1, coalesce((it ->> 'qty')::int, 1));
    if it ? 'package_id' then
      if p_member_id is null then raise exception 'member_required'; end if;
      select * into pk from packages where id = (it ->> 'package_id')::uuid and active;
      if not found then raise exception 'not_found'; end if;
      insert into sale_items (sale_id, package_id, name, qty, unit_price, line_total)
        values (sale.id, pk.id, pk.name, qty, pk.price, pk.price * qty);
      sub := sub + pk.price * qty;
      perform public._grant_package(sale.id, p_member_id, pk.id, qty);
    else
      select * into pr from products where id = (it ->> 'product_id')::uuid and active for update;
      if not found then raise exception 'not_found'; end if;
      if pr.stock is not null and pr.stock < qty then raise exception 'out_of_stock'; end if;
      update products set stock = stock - qty where id = pr.id and stock is not null;
      insert into sale_items (sale_id, product_id, name, qty, unit_price, line_total)
        values (sale.id, pr.id, pr.name, qty, pr.price, pr.price * qty);
      sub := sub + pr.price * qty;
    end if;
  end loop;

  if p_discount < 0 or p_discount > sub then raise exception 'discount_invalid'; end if;
  update sales set subtotal = sub, discount = p_discount, total = sub - p_discount where id = sale.id returning * into sale;
  return sale;
end $$;

-- Member buys online: creates a pending PromptPay order. Staff confirm once money arrives.
create or replace function public.create_online_order(p_package_id uuid, p_promo_code text default null)
returns public.sales language plpgsql security definer set search_path = public as $$
declare pk packages; sale sales; promo jsonb; pct int := 0; disc numeric := 0;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into pk from packages where id = p_package_id and active and sell_online;
  if not found then raise exception 'not_found'; end if;
  if pk.once_per_member and exists (select 1 from credit_lots where member_id = auth.uid() and package_id = pk.id) then
    raise exception 'package_once_per_member';
  end if;
  if nullif(trim(coalesce(p_promo_code, '')), '') is not null then
    promo := public.check_promo(pk.branch_id, p_promo_code, pk.id, auth.uid());
    pct := (promo ->> 'discount_percent')::int;
    disc := round(pk.price * pct / 100.0, 0);
  end if;
  -- one open order per member per package at a time
  update sales set status = 'void', voided_at = now(), void_reason = 'replaced'
    where member_id = auth.uid() and status = 'pending' and channel = 'online'
      and exists (select 1 from sale_items si where si.sale_id = sales.id and si.package_id = pk.id);
  insert into sales (branch_id, member_id, channel, status, payment_method, subtotal, discount, total, promo_code)
    values (pk.branch_id, auth.uid(), 'online', 'pending', 'promptpay', pk.price, disc, pk.price - disc, nullif(upper(trim(coalesce(p_promo_code, ''))), ''))
    returning * into sale;
  insert into sale_items (sale_id, package_id, name, qty, unit_price, line_total)
    values (sale.id, pk.id, pk.name, 1, pk.price, pk.price);
  return sale;
end $$;

create or replace function public.confirm_sale(p_sale_id uuid, p_payment_method public.payment_method default 'promptpay')
returns public.sales language plpgsql security definer set search_path = public as $$
declare sale sales; it record; sh uuid;
begin
  perform public._require_staff();
  select * into sale from sales where id = p_sale_id for update;
  if not found or sale.status <> 'pending' then raise exception 'sale_not_pending'; end if;
  select id into sh from shifts where staff_id = auth.uid() and closed_at is null;
  for it in select * from sale_items where sale_id = sale.id and package_id is not null loop
    perform public._grant_package(sale.id, sale.member_id, it.package_id, it.qty);
  end loop;
  if sale.promo_code is not null then
    update promotions set uses = uses + 1 where branch_id = sale.branch_id and upper(code) = sale.promo_code;
  end if;
  update sales set status = 'paid', paid_at = now(), staff_id = auth.uid(), shift_id = sh, payment_method = p_payment_method
    where id = sale.id returning * into sale;
  return sale;
end $$;

-- Undo a paid sale. Only possible while none of its credits have been used.
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns public.sales language plpgsql security definer set search_path = public as $$
declare sale sales; it record; lot record;
begin
  perform public._require_manager();
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  select * into sale from sales where id = p_sale_id for update;
  if not found or sale.status = 'void' then raise exception 'sale_not_found'; end if;
  if sale.status = 'paid' then
    for lot in select * from credit_lots where sale_id = sale.id for update loop
      if lot.credits_remaining < lot.credits_total then raise exception 'credits_already_used'; end if;
      insert into credit_ledger (member_id, lot_id, delta, reason, sale_id, actor_id, note)
        values (lot.member_id, lot.id, -lot.credits_remaining, 'void', sale.id, auth.uid(), p_reason);
      update credit_lots set credits_remaining = 0, expires_at = now() where id = lot.id;
    end loop;
    for it in select * from sale_items where sale_id = sale.id and product_id is not null loop
      update products set stock = stock + it.qty where id = it.product_id and stock is not null;
    end loop;
  end if;
  update sales set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
    where id = sale.id returning * into sale;
  perform public._audit('void_sale', 'sale', sale.id, jsonb_build_object('reason', p_reason));
  return sale;
end $$;

create or replace function public.adjust_credits(
  p_member_id uuid, p_delta int, p_note text, p_vip boolean default false, p_validity_days int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lot uuid; b uuid;
begin
  perform public._require_manager();
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'reason_required'; end if;
  if p_delta = 0 then raise exception 'amount_required'; end if;
  select branch_id into b from profiles where id = p_member_id;
  if p_delta > 0 then
    insert into credit_lots (member_id, branch_id, source, vip, credits_total, credits_remaining, expires_at)
      values (p_member_id, coalesce(b, (select id from branches order by created_at limit 1)), 'adjust', p_vip, p_delta, p_delta, now() + make_interval(days => p_validity_days))
      returning id into lot;
    insert into credit_ledger (member_id, lot_id, delta, reason, actor_id, note) values (p_member_id, lot, p_delta, 'adjust', auth.uid(), p_note);
  else
    perform public._consume_credits(p_member_id, -p_delta, p_vip, now(), null, 'adjust');
    update credit_ledger set note = p_note where id = (select max(id) from credit_ledger where member_id = p_member_id);
  end if;
  perform public._audit('adjust_credits', 'profile', p_member_id, jsonb_build_object('delta', p_delta, 'note', p_note));
  return public.member_wallet(p_member_id);
end $$;

-- Freeze every active lot for N days (extends expiry by the same amount).
create or replace function public.freeze_credits(p_member_id uuid, p_days int, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._require_manager();
  if p_days not between 1 and 90 then raise exception 'days_invalid'; end if;
  update credit_lots set frozen_until = now() + make_interval(days => p_days),
    expires_at = expires_at + make_interval(days => p_days)
    where member_id = p_member_id and credits_remaining > 0 and expires_at > now();
  perform public._audit('freeze_credits', 'profile', p_member_id, jsonb_build_object('days', p_days, 'note', p_note));
  return public.member_wallet(p_member_id);
end $$;

create or replace function public.open_shift(p_opening_cash numeric)
returns public.shifts language plpgsql security definer set search_path = public as $$
declare sh shifts; b uuid;
begin
  perform public._require_staff();
  select branch_id into b from profiles where id = auth.uid();
  insert into shifts (branch_id, staff_id, opening_cash)
    values (coalesce(b, (select id from branches order by created_at limit 1)), auth.uid(), coalesce(p_opening_cash, 0))
    returning * into sh;
  return sh;
exception when unique_violation then raise exception 'shift_already_open';
end $$;

create or replace function public.close_shift(p_counted_cash numeric, p_note text default null)
returns public.shifts language plpgsql security definer set search_path = public as $$
declare sh shifts; cash numeric;
begin
  perform public._require_staff();
  select * into sh from shifts where staff_id = auth.uid() and closed_at is null for update;
  if not found then raise exception 'shift_not_open'; end if;
  select coalesce(sum(total), 0) into cash from sales where shift_id = sh.id and status = 'paid' and payment_method = 'cash';
  update shifts set closed_at = now(), counted_cash = p_counted_cash, expected_cash = sh.opening_cash + cash, note = p_note
    where id = sh.id returning * into sh;
  return sh;
end $$;

-- ---------------------------------------------------------------------------
-- Moving from another system: balances wait here until the member signs in and staff confirm.
-- ---------------------------------------------------------------------------
create table public.member_imports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  external_ref text,
  display_name text not null,
  phone text,
  credits int not null default 0 check (credits >= 0),
  vip boolean not null default false,
  expires_at timestamptz not null,
  note text,
  claimed_by uuid references public.profiles (id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index member_imports_phone_idx on public.member_imports (phone);

create or replace function public.claim_import(p_import_id uuid, p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i member_imports; lot uuid;
begin
  perform public._require_staff();
  select * into i from member_imports where id = p_import_id for update;
  if not found or i.claimed_by is not null then raise exception 'import_not_available'; end if;
  if i.credits > 0 then
    insert into credit_lots (member_id, branch_id, source, vip, credits_total, credits_remaining, expires_at)
      values (p_member_id, i.branch_id, 'import', i.vip, i.credits, i.credits, i.expires_at) returning id into lot;
    insert into credit_ledger (member_id, lot_id, delta, reason, actor_id, note)
      values (p_member_id, lot, i.credits, 'import', auth.uid(), coalesce(i.external_ref, i.display_name));
  end if;
  update member_imports set claimed_by = p_member_id, claimed_at = now() where id = i.id;
  update profiles set phone = coalesce(phone, i.phone) where id = p_member_id;
  return public.member_wallet(p_member_id);
end $$;
