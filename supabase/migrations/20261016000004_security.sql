-- Studio Booking v0.1.0 — row level security
-- Members read the catalogue and their own records. Staff read everything in the studio.
-- Credits, bookings and sales change only through the functions in 0002 (no direct writes).

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.layouts enable row level security;
alter table public.layout_spots enable row level security;
alter table public.instructors enable row level security;
alter table public.class_types enable row level security;
alter table public.sessions enable row level security;
alter table public.session_disabled_spots enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.packages enable row level security;
alter table public.credit_lots enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_credit_usages enable row level security;
alter table public.waitlist enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.products enable row level security;
alter table public.shifts enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.promotions enable row level security;
alter table public.audit_log enable row level security;
alter table public.member_imports enable row level security;

-- Catalogue: everyone signed in can read; managers edit.
do $$
declare t text;
begin
  foreach t in array array['branches','rooms','layouts','layout_spots','instructors','class_types','packages','products','schedule_templates'] loop
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s manage" on public.%1$I for all to authenticated using (public.is_manager()) with check (public.is_manager())', t);
  end loop;
end $$;

-- Sessions: everyone reads; staff create/edit through functions, but may also edit notes directly.
create policy "sessions read" on public.sessions for select to authenticated using (true);
create policy "sessions staff update" on public.sessions for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "disabled spots read" on public.session_disabled_spots for select to authenticated using (true);

-- Promotions: members see what is live and meant for them.
create policy "promotions read" on public.promotions for select to authenticated using (
  public.is_staff() or (
    active and starts_at <= now() and (ends_at is null or ends_at > now())
    and (audience_tag is null or exists (select 1 from public.profiles p where p.id = auth.uid() and promotions.audience_tag = any (p.tags)))
  ));
create policy "promotions manage" on public.promotions for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Profiles
create policy "profiles self read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_instructor_or_staff());
create policy "profiles staff update" on public.profiles for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- Only owners change roles.
create or replace function public._guard_role_change() returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and public.my_role() <> 'owner' and auth.uid() is not null then
    raise exception 'not_allowed';
  end if;
  return new;
end $$;
create trigger profiles_role_guard before update on public.profiles for each row execute function public._guard_role_change();

-- Member-owned records: read own, staff read all. No direct writes.
create policy "lots read" on public.credit_lots for select to authenticated using (member_id = auth.uid() or public.is_staff());
create policy "ledger read" on public.credit_ledger for select to authenticated using (member_id = auth.uid() or public.is_staff());
create policy "bookings read" on public.bookings for select to authenticated using (member_id = auth.uid() or public.is_instructor_or_staff());
create policy "usages read" on public.booking_credit_usages for select to authenticated using (public.is_staff());
create policy "waitlist read" on public.waitlist for select to authenticated using (member_id = auth.uid() or public.is_instructor_or_staff());
create policy "sales read" on public.sales for select to authenticated using (member_id = auth.uid() or public.is_staff());
create policy "sale items read" on public.sale_items for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id and (s.member_id = auth.uid() or public.is_staff())));

-- Staff-only
create policy "shifts read" on public.shifts for select to authenticated using (public.is_staff());
create policy "audit read" on public.audit_log for select to authenticated using (public.is_manager());
create policy "imports read" on public.member_imports for select to authenticated using (public.is_staff());
create policy "imports manage" on public.member_imports for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Internal helpers are not callable from the app.
revoke execute on function public._book(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._consume_credits(uuid, int, boolean, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public._refund_booking_credits(uuid, text) from public, anon, authenticated;
revoke execute on function public._promote_waitlist(uuid) from public, anon, authenticated;
revoke execute on function public._grant_package(uuid, uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public._first_free_spot(uuid) from public, anon, authenticated;
revoke execute on function public._audit(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._check_turnover(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Live spot maps. Members cannot see other people's bookings, so screens listen to this
-- anonymous "something changed in session X" table instead and then refetch the spot map.
create table public.session_pulse (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  changed_at timestamptz not null default now()
);
alter table public.session_pulse enable row level security;
create policy "pulse read" on public.session_pulse for select to authenticated using (true);

create or replace function public._pulse() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(new.session_id, old.session_id);
begin
  insert into session_pulse (session_id, changed_at) values (sid, now())
    on conflict (session_id) do update set changed_at = now();
  return null;
end $$;
create trigger bookings_pulse after insert or update or delete on public.bookings for each row execute function public._pulse();
create trigger disabled_spots_pulse after insert or delete on public.session_disabled_spots for each row execute function public._pulse();
revoke execute on function public._pulse() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.session_pulse, public.sales;
  end if;
end $$;
