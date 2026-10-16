-- Studio Booking v0.1.0 — reports (staff only). Dates are branch-local (Asia/Bangkok by default).

create or replace function public._range(p_branch_id uuid, p_from date, p_to date, out r_from timestamptz, out r_to timestamptz)
language sql stable security definer set search_path = public as $$
  select (p_from::timestamp at time zone b.timezone), ((p_to + 1)::timestamp at time zone b.timezone)
  from branches b where b.id = p_branch_id
$$;

create or replace function public.report_summary(p_branch_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz; res jsonb;
begin
  perform public._require_staff();
  select r_from, r_to into f, t from public._range(p_branch_id, p_from, p_to);

  with s as (
    select id, starts_at from sessions where branch_id = p_branch_id and status = 'scheduled' and starts_at >= f and starts_at < t
  ), bk as (
    select b.* from bookings b join s on s.id = b.session_id
  ), cap as (
    select sum(public.session_capacity(id)) c from s
  ), sales_r as (
    select * from sales where branch_id = p_branch_id and status = 'paid' and paid_at >= f and paid_at < t
  ), wl as (
    select w.* from waitlist w join s on s.id = w.session_id
  )
  select jsonb_build_object(
    'sales', jsonb_build_object(
      'total', coalesce((select sum(total) from sales_r), 0),
      'count', (select count(*) from sales_r),
      'by_method', coalesce((select jsonb_object_agg(payment_method, amt) from (select payment_method, sum(total) amt from sales_r group by 1) x), '{}'),
      'packages', coalesce((select sum(si.line_total) from sale_items si join sales_r on sales_r.id = si.sale_id where si.package_id is not null), 0),
      'products', coalesce((select sum(si.line_total) from sale_items si join sales_r on sales_r.id = si.sale_id where si.product_id is not null), 0),
      'pending_online', (select count(*) from sales where branch_id = p_branch_id and status = 'pending')
    ),
    'sessions', (select count(*) from s),
    'capacity', coalesce((select c from cap), 0),
    'bookings', jsonb_build_object(
      'active', (select count(*) from bk where status in ('booked', 'checked_in')),
      'checked_in', (select count(*) from bk where status = 'checked_in'),
      'cancelled', (select count(*) from bk where status = 'cancelled'),
      'late_cancel', (select count(*) from bk where status = 'late_cancel'),
      'no_show', (select count(*) from bk where status = 'no_show')
    ),
    'fill_rate', case when coalesce((select c from cap), 0) = 0 then 0
      else round((select count(*) from bk where status in ('booked', 'checked_in', 'no_show'))::numeric / (select c from cap) * 100, 1) end,
    'waitlist', jsonb_build_object(
      'joined', (select count(*) from wl),
      'promoted', (select count(*) from wl where status = 'promoted'),
      -- people who wanted a class and never got in: demand you could still sell
      'unserved', (select count(*) from wl where status in ('waiting', 'expired') and exists (select 1 from s where s.id = wl.session_id and s.starts_at < now()))
    ),
    'credits', jsonb_build_object(
      'outstanding', coalesce((select sum(credits_remaining) from credit_lots where branch_id = p_branch_id and expires_at > now()), 0),
      'outstanding_value', coalesce((select round(sum(cl.credits_remaining * (p.price / nullif(p.credits, 0))), 0)
          from credit_lots cl join packages p on p.id = cl.package_id
          where cl.branch_id = p_branch_id and cl.expires_at > now()), 0),
      'expiring_30d', coalesce((select sum(credits_remaining) from credit_lots where branch_id = p_branch_id
          and expires_at > now() and expires_at < now() + interval '30 days'), 0)
    ),
    'members', jsonb_build_object(
      'new', (select count(*) from profiles where branch_id = p_branch_id and role = 'member' and created_at >= f and created_at < t),
      'at_risk', (select count(*) from public.report_at_risk(p_branch_id, 14))
    ),
    'trial', (
      select jsonb_build_object('trials', count(*), 'converted', count(*) filter (where converted))
      from (
        select cl.member_id, exists (
          select 1 from credit_lots c2 join packages p2 on p2.id = c2.package_id
          where c2.member_id = cl.member_id and p2.kind in ('credit', 'vip') and c2.created_at > cl.created_at
        ) converted
        from credit_lots cl join packages p on p.id = cl.package_id
        where p.kind = 'trial' and cl.branch_id = p_branch_id and cl.created_at >= f and cl.created_at < t
      ) x
    )
  ) into res;
  return res;
end $$;

-- Members with credit left who have not come in for N days.
create or replace function public.report_at_risk(p_branch_id uuid, p_days int default 14)
returns table (member_id uuid, display_name text, phone text, credits int, last_visit timestamptz, next_expiry timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.phone,
    sum(cl.credits_remaining)::int,
    (select max(s.starts_at) from bookings b join sessions s on s.id = b.session_id
       where b.member_id = p.id and b.status in ('checked_in', 'booked') and s.starts_at < now()),
    min(cl.expires_at)
  from profiles p join credit_lots cl on cl.member_id = p.id and cl.credits_remaining > 0 and cl.expires_at > now()
  where public.is_staff() and p.branch_id = p_branch_id
    and not exists (select 1 from bookings b join sessions s on s.id = b.session_id
       where b.member_id = p.id and b.status in ('booked', 'checked_in')
         and s.starts_at > now() - make_interval(days => p_days))
  group by p.id
  order by min(cl.expires_at)
$$;

-- Fill by weekday × hour: where to add, move or drop classes.
create or replace function public.report_fill_heatmap(p_branch_id uuid, p_from date, p_to date)
returns table (weekday int, hour int, sessions int, capacity int, booked int, waitlisted int)
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz; tz text;
begin
  perform public._require_staff();
  select r_from, r_to into f, t from public._range(p_branch_id, p_from, p_to);
  select timezone into tz from branches where id = p_branch_id;
  return query
    select extract(dow from s.starts_at at time zone tz)::int, extract(hour from s.starts_at at time zone tz)::int,
      count(*)::int, sum(public.session_capacity(s.id))::int,
      sum((select count(*) from bookings b where b.session_id = s.id and b.status in ('booked', 'checked_in', 'no_show')))::int,
      sum((select count(*) from waitlist w where w.session_id = s.id))::int
    from sessions s
    where s.branch_id = p_branch_id and s.status = 'scheduled' and s.starts_at >= f and s.starts_at < t
    group by 1, 2 order by 1, 2;
end $$;

-- Which spots get picked: for re-planning the room or pricing front-row spots.
create or replace function public.report_spot_heatmap(p_layout_id uuid, p_from date, p_to date)
returns table (spot_id uuid, label text, x int, y int, bookings int, first_pick int)
language plpgsql stable security definer set search_path = public as $$
declare br uuid; f timestamptz; t timestamptz;
begin
  perform public._require_staff();
  select r.branch_id into br from layouts l join rooms r on r.id = l.room_id where l.id = p_layout_id;
  select r_from, r_to into f, t from public._range(br, p_from, p_to);
  return query
    select ls.id, ls.label, ls.x, ls.y,
      count(b.id)::int,
      -- how often this spot was the first one taken in its session
      count(b.id) filter (where b.created_at = (select min(b2.created_at) from bookings b2 where b2.session_id = b.session_id and b2.spot_id is not null))::int
    from layout_spots ls
    left join bookings b on b.spot_id = ls.id and b.status in ('booked', 'checked_in', 'no_show', 'late_cancel')
      and exists (select 1 from sessions s where s.id = b.session_id and s.starts_at >= f and s.starts_at < t)
    where ls.layout_id = p_layout_id and ls.x >= 0
    group by ls.id order by ls.y, ls.x;
end $$;

-- One row per session, for export.
create or replace function public.report_sessions(p_branch_id uuid, p_from date, p_to date)
returns table (session_id uuid, starts_at timestamptz, class_name text, room text, instructor text, capacity int,
  booked int, checked_in int, cancelled int, late_cancel int, no_show int, waitlisted int, unserved int, credits_used int)
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz;
begin
  perform public._require_staff();
  select r_from, r_to into f, t from public._range(p_branch_id, p_from, p_to);
  return query
    select s.id, s.starts_at, ct.name, r.name, i.name, public.session_capacity(s.id),
      count(b.id) filter (where b.status in ('booked', 'checked_in', 'no_show'))::int,
      count(b.id) filter (where b.status = 'checked_in')::int,
      count(b.id) filter (where b.status = 'cancelled')::int,
      count(b.id) filter (where b.status = 'late_cancel')::int,
      count(b.id) filter (where b.status = 'no_show')::int,
      (select count(*) from waitlist w where w.session_id = s.id)::int,
      (select count(*) from waitlist w where w.session_id = s.id and w.status in ('waiting', 'expired'))::int,
      coalesce(sum(b.credits_used) filter (where b.status in ('booked', 'checked_in', 'no_show', 'late_cancel')), 0)::int
    from sessions s
    join class_types ct on ct.id = s.class_type_id
    join rooms r on r.id = s.room_id
    left join instructors i on i.id = s.instructor_id
    left join bookings b on b.session_id = s.id
    where s.branch_id = p_branch_id and s.status = 'scheduled' and s.starts_at >= f and s.starts_at < t
    group by s.id, ct.name, r.name, i.name
    order by s.starts_at;
end $$;

-- One row per sale line, for export and accounting.
create or replace function public.report_sales(p_branch_id uuid, p_from date, p_to date)
returns table (receipt_no bigint, paid_at timestamptz, channel text, status text, payment_method text, member text,
  item text, qty int, line_total numeric, sale_discount numeric, sale_total numeric, staff text)
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz;
begin
  perform public._require_staff();
  select r_from, r_to into f, t from public._range(p_branch_id, p_from, p_to);
  return query
    select sa.receipt_no, sa.paid_at, sa.channel, sa.status::text, sa.payment_method::text, m.display_name,
      si.name, si.qty, si.line_total, sa.discount, sa.total, st.display_name
    from sales sa
    join sale_items si on si.sale_id = sa.id
    left join profiles m on m.id = sa.member_id
    left join profiles st on st.id = sa.staff_id
    where sa.branch_id = p_branch_id and sa.status in ('paid', 'void') and coalesce(sa.paid_at, sa.created_at) >= f and coalesce(sa.paid_at, sa.created_at) < t
    order by sa.receipt_no;
end $$;

-- Per instructor: how full their classes are and how many people come back.
create or replace function public.report_instructors(p_branch_id uuid, p_from date, p_to date)
returns table (instructor_id uuid, name text, sessions int, fill_rate numeric, attendees int, returning_rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz;
begin
  perform public._require_staff();
  select r_from, r_to into f, t from public._range(p_branch_id, p_from, p_to);
  return query
    with ss as (
      select s.* from sessions s where s.branch_id = p_branch_id and s.status = 'scheduled' and s.starts_at >= f and s.starts_at < t and s.instructor_id is not null
    ), att as (
      select ss.instructor_id, b.member_id from ss join bookings b on b.session_id = ss.id and b.status in ('checked_in', 'booked', 'no_show')
    )
    select i.id, i.name,
      (select count(*) from ss where ss.instructor_id = i.id)::int,
      round(coalesce((select count(*) from att where att.instructor_id = i.id)::numeric
        / nullif((select sum(public.session_capacity(ss.id)) from ss where ss.instructor_id = i.id), 0) * 100, 0), 1),
      (select count(distinct member_id) from att where att.instructor_id = i.id)::int,
      round(coalesce((select count(*) from (select member_id from att where att.instructor_id = i.id group by member_id having count(*) > 1) x)::numeric
        / nullif((select count(distinct member_id) from att where att.instructor_id = i.id), 0) * 100, 0), 1)
    from instructors i where i.branch_id = p_branch_id
    order by 4 desc nulls last;
end $$;
