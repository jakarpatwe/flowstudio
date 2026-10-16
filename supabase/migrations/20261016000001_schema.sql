-- Studio Booking v0.1.0 — schema
-- Rooms → layouts (spot maps) → class types → sessions. One shared credit wallet per member.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('member', 'instructor', 'staff', 'manager', 'owner');
create type public.room_kind as enum ('group', 'vip');
create type public.session_status as enum ('scheduled', 'cancelled');
create type public.booking_status as enum ('booked', 'checked_in', 'cancelled', 'late_cancel', 'no_show');
create type public.waitlist_status as enum ('waiting', 'promoted', 'left', 'expired');
create type public.package_kind as enum ('credit', 'vip', 'dropin', 'trial');
create type public.payment_method as enum ('cash', 'promptpay', 'card', 'transfer', 'free');
create type public.sale_status as enum ('pending', 'paid', 'void');
create type public.lot_source as enum ('purchase', 'adjust', 'import', 'refund');

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  timezone text not null default 'Asia/Bangkok',
  promptpay_id text,               -- phone or tax id used to build PromptPay QR
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  branch_id uuid references public.branches (id),
  role public.app_role not null default 'member',
  display_name text not null default '',
  phone text,
  birthday date,
  emergency_contact text,
  line_user_id text unique,
  avatar_url text,
  pdpa_consent_at timestamptz,
  tags text[] not null default '{}',
  staff_note text,
  checkin_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now()
);
create index profiles_phone_idx on public.profiles (phone);
create index profiles_name_idx on public.profiles (lower(display_name));

-- ---------------------------------------------------------------------------
-- Rooms, layouts and spots
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null,
  kind public.room_kind not null default 'group',
  turnover_minutes int not null default 0 check (turnover_minutes >= 0),  -- gap needed to swap equipment
  sort_order int not null default 0,
  active boolean not null default true
);

-- A layout is one arrangement of one kind of equipment in one room.
-- fixtures: [{ "type": "mirror"|"door"|"instructor"|"speaker", "x": int, "y": int, "w": int, "h": int }]
create table public.layouts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  equipment text not null,          -- e.g. trampoline, step board, reformer
  cols int not null default 8 check (cols between 1 and 30),
  rows int not null default 6 check (rows between 1 and 30),
  fixtures jsonb not null default '[]',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.layout_spots (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.layouts (id) on delete cascade,
  label text not null,
  x int not null,
  y int not null,
  active boolean not null default true,    -- false = out of service everywhere
  unique (layout_id, label),
  unique (layout_id, x, y)
);

-- ---------------------------------------------------------------------------
-- People who teach
-- ---------------------------------------------------------------------------
create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  name text not null,
  bio text,
  photo_url text,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Class types and sessions
-- ---------------------------------------------------------------------------
create table public.class_types (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#3A55E8',
  default_room_id uuid references public.rooms (id) on delete set null,
  default_layout_id uuid references public.layouts (id) on delete set null,
  duration_minutes int not null default 50 check (duration_minutes > 0),
  credit_cost int not null default 1 check (credit_cost >= 0),
  requires_vip boolean not null default false,   -- only VIP credits can pay
  booking_window_days int not null default 7 check (booking_window_days > 0),
  cancel_cutoff_hours int not null default 12 check (cancel_cutoff_hours >= 0),
  active boolean not null default true,
  sort_order int not null default 0
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  class_type_id uuid not null references public.class_types (id),
  room_id uuid not null references public.rooms (id),
  layout_id uuid references public.layouts (id),        -- null = no spot map (VIP 1:1)
  instructor_id uuid references public.instructors (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int check (capacity is null or capacity >= 0),  -- null = number of usable spots in layout
  status public.session_status not null default 'scheduled',
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index sessions_starts_idx on public.sessions (branch_id, starts_at);

-- A room hosts one session at a time (turnover gap handled in create_session()).
alter table public.sessions add constraint sessions_room_no_overlap
  exclude using gist (room_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'scheduled');

-- An instructor teaches one session at a time.
alter table public.sessions add constraint sessions_instructor_no_overlap
  exclude using gist (instructor_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'scheduled' and instructor_id is not null);

-- Spots switched off for one session only (broken machine, fewer boards today).
create table public.session_disabled_spots (
  session_id uuid not null references public.sessions (id) on delete cascade,
  spot_id uuid not null references public.layout_spots (id) on delete cascade,
  primary key (session_id, spot_id)
);

-- Weekly timetable used to generate sessions.
create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  class_type_id uuid not null references public.class_types (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  layout_id uuid references public.layouts (id) on delete set null,
  instructor_id uuid references public.instructors (id) on delete set null,
  weekday int not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time time not null,
  duration_minutes int,
  capacity int,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Packages, credits, bookings
-- ---------------------------------------------------------------------------
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null,
  description text,
  kind public.package_kind not null default 'credit',
  credits int not null check (credits >= 0),
  validity_days int not null default 60 check (validity_days > 0),
  price numeric(10, 2) not null check (price >= 0),
  sell_online boolean not null default true,
  once_per_member boolean not null default false,   -- trial
  active boolean not null default true,
  sort_order int not null default 0
);

-- Credits live in lots so expiry and refunds are exact. Used oldest-expiring first.
create table public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.branches (id),
  source public.lot_source not null,
  package_id uuid references public.packages (id),
  sale_id uuid,
  vip boolean not null default false,
  credits_total int not null check (credits_total >= 0),
  credits_remaining int not null check (credits_remaining >= 0),
  expires_at timestamptz not null,
  frozen_until timestamptz,
  created_at timestamptz not null default now(),
  check (credits_remaining <= credits_total)
);
create index credit_lots_member_idx on public.credit_lots (member_id, expires_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  spot_id uuid references public.layout_spots (id),
  status public.booking_status not null default 'booked',
  credits_used int not null default 0,
  booked_by uuid references public.profiles (id),
  needs_new_spot boolean not null default false,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  checked_in_at timestamptz
);
create unique index bookings_one_per_member on public.bookings (session_id, member_id)
  where status in ('booked', 'checked_in');
create unique index bookings_one_per_spot on public.bookings (session_id, spot_id)
  where status in ('booked', 'checked_in') and spot_id is not null;
create index bookings_member_idx on public.bookings (member_id, created_at desc);

create table public.booking_credit_usages (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  lot_id uuid not null references public.credit_lots (id) on delete cascade,
  credits int not null check (credits > 0),
  primary key (booking_id, lot_id)
);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  status public.waitlist_status not null default 'waiting',
  booking_id uuid references public.bookings (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index waitlist_one_per_member on public.waitlist (session_id, member_id) where status = 'waiting';

-- Every credit movement, for audit and reports.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id) on delete cascade,
  lot_id uuid references public.credit_lots (id) on delete set null,
  delta int not null,
  reason text not null,          -- purchase | booking | refund | adjust | import | expire | void
  booking_id uuid references public.bookings (id) on delete set null,
  sale_id uuid,
  actor_id uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index credit_ledger_member_idx on public.credit_ledger (member_id, created_at desc);

-- ---------------------------------------------------------------------------
-- POS
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  stock int,                     -- null = not tracked
  active boolean not null default true
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  staff_id uuid not null references public.profiles (id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(10, 2) not null default 0,
  closed_at timestamptz,
  counted_cash numeric(10, 2),
  expected_cash numeric(10, 2),
  note text
);
create unique index shifts_one_open_per_staff on public.shifts (staff_id) where closed_at is null;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  receipt_no bigint generated always as identity,
  member_id uuid references public.profiles (id),
  staff_id uuid references public.profiles (id),
  shift_id uuid references public.shifts (id),
  channel text not null default 'counter',      -- counter | online
  status public.sale_status not null default 'paid',
  payment_method public.payment_method not null,
  subtotal numeric(10, 2) not null default 0,
  discount numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  promo_code text,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text
);
create index sales_branch_created_idx on public.sales (branch_id, created_at desc);
alter table public.credit_lots add constraint credit_lots_sale_fk foreign key (sale_id) references public.sales (id) on delete set null;
alter table public.credit_ledger add constraint credit_ledger_sale_fk foreign key (sale_id) references public.sales (id) on delete set null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  package_id uuid references public.packages (id),
  product_id uuid references public.products (id),
  name text not null,
  qty int not null default 1 check (qty > 0),
  unit_price numeric(10, 2) not null,
  line_total numeric(10, 2) not null,
  check ((package_id is null) <> (product_id is null))
);

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  title text not null,
  body text,
  image_url text,
  package_id uuid references public.packages (id) on delete set null,
  discount_percent int check (discount_percent between 0 and 100),
  code text,
  audience_tag text,             -- null = everyone; otherwise profile tag
  max_uses int,
  uses int not null default 0,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  sort_order int not null default 0
);
create unique index promotions_code_idx on public.promotions (branch_id, upper(code)) where code is not null;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
