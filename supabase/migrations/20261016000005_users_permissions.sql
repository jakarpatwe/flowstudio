-- Studio Booking v0.3.0 — staff accounts, per-section permissions, user management
-- Staff sign in with a username. Their auth email is "<username>@flowstudio.local" (never mailed).
-- A role sets the most a person can do; permissions switch admin sections on or off within that.

alter table public.profiles
  add column if not exists username text unique,
  add column if not exists permissions text[],          -- null = the role's default sections
  add column if not exists active boolean not null default true;

-- ---------------------------------------------------------------------------
-- Sections of the admin. Keep in sync with src/lib/permissions.ts.
-- ---------------------------------------------------------------------------
create or replace function public.role_sections(r public.app_role, p_max boolean default false)
returns text[] language sql immutable as $$
  select case
    when r = 'owner' then array['today','pos','timetable','members','reports','layouts','catalog','branch','users','changelog']
    when r = 'manager' and p_max then array['today','pos','timetable','members','reports','layouts','catalog','branch','users','changelog']
    when r = 'manager' then array['today','pos','timetable','members','reports','layouts','catalog','branch','changelog']
    when r = 'staff' and p_max then array['today','pos','timetable','members','reports']
    when r = 'staff' then array['today','pos','timetable','members']
    else '{}'::text[]
  end
$$;

-- Disabled accounts count as plain members everywhere.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid() and active), 'member'::app_role)
$$;

create or replace function public.my_sections() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.role = 'owner' then public.role_sections('owner')
                else coalesce(p.permissions, public.role_sections(p.role)) end
    from profiles p where p.id = auth.uid() and p.active
  ), '{}'::text[])
$$;

create or replace function public.has_section(p_section text) returns boolean
language sql stable as $$
  select p_section = any (public.my_sections())
$$;

-- Role, permissions and active flag change only through the admin functions below (or by the owner).
create or replace function public._guard_role_change() returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.permissions is distinct from old.permissions
      or new.active is distinct from old.active or new.username is distinct from old.username)
     and auth.uid() is not null
     and coalesce(current_setting('app.user_admin', true), '') <> 'on'
     and public.my_role() <> 'owner' then
    raise exception 'not_allowed';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Creating a sign-in account directly (no email is sent). Internal: not callable from the app.
-- ---------------------------------------------------------------------------
create or replace function public._create_staff_user(
  p_username text, p_display_name text, p_password text, p_role public.app_role, p_permissions text[]
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  uname text := lower(trim(p_username));
  mail text := lower(trim(p_username)) || '@flowstudio.local';
  uid uuid := gen_random_uuid();
begin
  if uname !~ '^[a-z0-9._-]{3,30}$' then raise exception 'username_invalid'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  if exists (select 1 from profiles where username = uname) or exists (select 1 from auth.users where email = mail) then
    raise exception 'username_taken';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('name', coalesce(nullif(trim(p_display_name), ''), uname)),
          now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true), 'email', now(), now(), now());

  -- handle_new_user() made the profile; now give it the staff details.
  perform set_config('app.user_admin', 'on', true);
  update profiles set username = uname, role = p_role,
         permissions = case when p_permissions is null then null
                            else array(select unnest(p_permissions) intersect select unnest(public.role_sections(p_role, true))) end,
         display_name = coalesce(nullif(trim(p_display_name), ''), uname)
    where id = uid;
  perform set_config('app.user_admin', 'off', true);
  return uid;
end $$;
revoke execute on function public._create_staff_user(text, text, text, public.app_role, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- User management for people with the "users" section.
-- ---------------------------------------------------------------------------
create or replace function public._require_users_admin() returns void language plpgsql stable as $$
begin
  if not public.has_section('users') then raise exception 'not_allowed'; end if;
end $$;

create or replace function public.admin_list_users()
returns table (id uuid, username text, email text, display_name text, role public.app_role, permissions text[],
               sections text[], active boolean, last_sign_in_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_users_admin();
  return query
    select p.id, p.username, u.email::text, p.display_name, p.role, p.permissions,
           case when p.role = 'owner' then public.role_sections('owner') else coalesce(p.permissions, public.role_sections(p.role)) end,
           p.active, u.last_sign_in_at, p.created_at
    from profiles p join auth.users u on u.id = p.id
    where p.role <> 'member'
    order by array_position(array['owner','manager','staff','instructor','member']::text[], p.role::text), lower(p.display_name);
end $$;

create or replace function public._check_can_assign(p_target public.app_role) returns void language plpgsql stable as $$
begin
  if p_target = 'owner' and public.my_role() <> 'owner' then raise exception 'not_allowed'; end if;
end $$;

create or replace function public.admin_create_user(
  p_username text, p_display_name text, p_password text, p_role public.app_role, p_permissions text[] default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  perform public._require_users_admin();
  perform public._check_can_assign(p_role);
  uid := public._create_staff_user(p_username, p_display_name, p_password, p_role, p_permissions);
  perform public._audit('create_user', 'profile', uid, jsonb_build_object('username', lower(trim(p_username)), 'role', p_role));
  return uid;
end $$;

create or replace function public.admin_update_user(
  p_id uuid, p_display_name text, p_role public.app_role, p_permissions text[], p_active boolean
) returns void language plpgsql security definer set search_path = public as $$
declare t profiles;
begin
  perform public._require_users_admin();
  select * into t from profiles where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if t.role = 'owner' and public.my_role() <> 'owner' then raise exception 'not_allowed'; end if;
  perform public._check_can_assign(p_role);
  if p_id = auth.uid() and (p_role is distinct from t.role or not p_active
      or not ('users' = any (coalesce(p_permissions, public.role_sections(p_role))) or p_role = 'owner')) then
    raise exception 'cannot_change_self';
  end if;

  perform set_config('app.user_admin', 'on', true);
  update profiles set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    role = p_role,
    permissions = case when p_permissions is null then null
                       else array(select unnest(p_permissions) intersect select unnest(public.role_sections(p_role, true))) end,
    active = p_active
  where id = p_id;
  perform set_config('app.user_admin', 'off', true);

  -- A disabled account cannot sign in at all.
  update auth.users set banned_until = case when p_active then null else 'infinity'::timestamptz end where id = p_id;
  perform public._audit('update_user', 'profile', p_id, jsonb_build_object('role', p_role, 'permissions', p_permissions, 'active', p_active));
end $$;

create or replace function public.admin_set_password(p_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare t profiles;
begin
  perform public._require_users_admin();
  select * into t from profiles where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if t.role = 'owner' and public.my_role() <> 'owner' then raise exception 'not_allowed'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_id;
  perform public._audit('set_password', 'profile', p_id, null);
end $$;

-- ---------------------------------------------------------------------------
-- Branch details, for people with the "branch" section.
-- ---------------------------------------------------------------------------
create or replace function public.update_branch(p_id uuid, p_name text, p_address text, p_promptpay_id text)
returns public.branches language plpgsql security definer set search_path = public as $$
declare b branches;
begin
  if not public.has_section('branch') then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'name_required'; end if;
  update branches set name = trim(p_name), address = nullif(trim(coalesce(p_address, '')), ''),
         promptpay_id = nullif(regexp_replace(coalesce(p_promptpay_id, ''), '[^0-9]', '', 'g'), '')
    where id = p_id returning * into b;
  if not found then raise exception 'not_found'; end if;
  perform public._audit('update_branch', 'branch', p_id, jsonb_build_object('name', b.name));
  return b;
end $$;
