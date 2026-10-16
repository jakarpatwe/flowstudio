-- Demo data for trying the system: 30 members, credits, sales, classes from 3 days ago to 5 days ahead,
-- bookings with check-ins / no-shows / cancellations, two full classes with a waitlist, a pending online order.
-- Needs seed.sql and migration 0005. Run ONCE in the Supabase SQL Editor.
-- Demo members are tagged 'demo' and sign in as member01 … member30 (random passwords; set one in
-- หลังร้าน → ผู้ใช้และสิทธิ์ if you want to try the member screens).
-- The functions below run as the first manager/owner account, so every rule in 0002 still applies.

do $$
declare
  br uuid := (select id from public.branches order by created_at limit 1);
  admin uuid := (select id from public.profiles where role in ('manager', 'owner') and active order by role desc, created_at limit 1);
  today date := (now() at time zone 'Asia/Bangkok')::date;
  names text[] := array['มายด์','ปุ๊ก','แนน','ฝน','บีม','ต้น','แพรว','เจน','ออม','มิ้นท์','กิ๊ฟ','ปลา','เฟิร์น','โบว์','จูน',
                        'นุ่น','พลอย','ไอซ์','กาย','เก่ง','น้ำ','ฟ้า','ข้าว','แก้ม','หมิว','ดาว','เอิร์ธ','บอส','ปาล์ม','ตาล'];
  i int; m uuid; s record; target int; booked int; mem record; v_sale uuid; pk uuid; bk_rec record; full_ids uuid[] := '{}';
  pkg_trial uuid := (select id from public.packages where kind = 'trial' order by sort_order limit 1);
  pkg_10 uuid := (select id from public.packages where name = '10 เครดิต' limit 1);
  pkg_25 uuid := (select id from public.packages where name = '25 เครดิต' limit 1);
  pkg_vip uuid := (select id from public.packages where kind = 'vip' limit 1);
  pkg_drop uuid := (select id from public.packages where kind = 'dropin' limit 1);
  methods public.payment_method[] := array['cash','promptpay','card','transfer']::public.payment_method[];
begin
  if br is null then raise exception 'Run seed.sql first'; end if;
  if admin is null then raise exception 'Create a manager or owner account first'; end if;
  if exists (select 1 from public.profiles where 'demo' = any (tags)) then raise exception 'Demo data is already loaded'; end if;

  -- Class colours follow the FLOW brand (databases set up before v0.2.0 still have the old ones).
  update public.class_types set color = '#0B7F8F' where name = 'Trampoline' and color = '#3A55E8';
  update public.class_types set color = '#D9822B' where name = 'Step Board' and color = '#E5487B';
  update public.class_types set color = '#111214' where name = 'VIP Pilates 1:1' and color = '#1B1F3B';

  -- 1. Members ---------------------------------------------------------------------------------
  for i in 1 .. 30 loop
    m := public._create_staff_user('member' || lpad(i::text, 2, '0'), 'คุณ' || names[i],
                                   replace(gen_random_uuid()::text, '-', ''), 'member', null);
    update public.profiles set tags = array['demo'] || case when i <= 4 then array['vip'] else '{}'::text[] end,
           phone = '08' || lpad((10000000 + i * 7919)::text, 8, '0'),
           pdpa_consent_at = case when i % 7 = 0 then null else now() - make_interval(days => 20 - i % 15) end,
           created_at = now() - make_interval(days => 40 - i)
      where id = m;
  end loop;

  -- Act as the admin from here on (auth.uid() = admin).
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin::text, true);

  -- 2. Packages sold at the counter, spread over the last 12 days ------------------------------
  if not exists (select 1 from public.shifts where staff_id = admin and closed_at is null) then
    perform public.open_shift(2000);
  end if;
  i := 0;
  for mem in select id from public.profiles where 'demo' = any (tags) order by created_at loop
    i := i + 1;
    continue when i > 27;                                   -- three members have bought nothing yet
    pk := case when i <= 4 then pkg_vip when i <= 9 then pkg_trial when i <= 20 then pkg_10 when i <= 25 then pkg_25 else pkg_drop end;
    v_sale := (public.pos_checkout(mem.id, jsonb_build_array(jsonb_build_object('package_id', pk, 'qty', 1)),
                                    methods[1 + i % 4], 0, null)).id;
    update public.sales set created_at = now() - make_interval(days => 1 + i % 12, hours => i % 9), paid_at = null where id = v_sale;
    update public.sales set paid_at = created_at where id = v_sale;
    update public.credit_ledger set created_at = (select created_at from public.sales where id = v_sale) where sale_id = v_sale;
    -- Extra test credits so the timetable can fill up.
    perform public.adjust_credits(mem.id, 25, 'เครดิตทดสอบระบบ', false, 60);
    if i <= 4 then perform public.adjust_credits(mem.id, 12, 'เครดิต VIP ทดสอบระบบ', true, 60); end if;
  end loop;
  -- A few product-only sales (no member).
  for i in 1 .. 6 loop
    v_sale := (public.pos_checkout(null, jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products order by name offset i % 3 limit 1), 'qty', 1 + i % 3)),
      methods[1 + i % 2], 0, null)).id;
    update public.sales set created_at = now() - make_interval(days => i % 5, hours => i), paid_at = now() - make_interval(days => i % 5, hours => i) where id = v_sale;
  end loop;
  perform public.close_shift((select opening_cash from public.shifts where staff_id = admin and closed_at is null)
                             + coalesce((select sum(total) from public.sales where staff_id = admin and status = 'paid' and payment_method = 'cash'
                                         and shift_id = (select id from public.shifts where staff_id = admin and closed_at is null)), 0),
                             'กะทดสอบระบบ');

  -- 3. Classes from 3 days ago to 5 days ahead ------------------------------------------------
  perform public.generate_sessions(br, today - 3, today + 5);

  -- 4. Bookings -----------------------------------------------------------------------------
  for s in
    select se.id, se.starts_at, ct.requires_vip, ct.name, public.session_capacity(se.id) cap
    from public.sessions se join public.class_types ct on ct.id = se.class_type_id
    where se.status = 'scheduled' and se.starts_at >= (today - 3)::timestamp at time zone 'Asia/Bangkok'
      and se.starts_at < (today + 6)::timestamp at time zone 'Asia/Bangkok'
    order by se.starts_at
  loop
    target := case
      when s.requires_vip then case when random() < 0.6 then 1 else 0 end
      else greatest(1, round(s.cap * (0.3 + random() * 0.6))::int) end;
    booked := public.session_booked_count(s.id);
    for mem in
      select p.id from public.profiles p
      where 'demo' = any (p.tags) and (not s.requires_vip or 'vip' = any (p.tags))
      order by random()
    loop
      exit when booked >= target;
      begin
        if s.starts_at < now() then
          perform public._book(s.id, mem.id, null, admin);       -- past class: skip the time checks
        else
          perform public.book_session(s.id, null, mem.id);
        end if;
        booked := booked + 1;
      exception when others then null;                           -- not enough credits, etc.
      end;
    end loop;
  end loop;

  -- Past classes: most people came, some did not.
  update public.bookings b set
      status = case when random() < 0.85 then 'checked_in' else 'no_show' end::public.booking_status,
      created_at = se.starts_at - make_interval(hours => 6 + (random() * 60)::int)
    from public.sessions se
    where se.id = b.session_id and b.status = 'booked' and se.ends_at < now()
      and b.member_id in (select id from public.profiles where 'demo' = any (tags));
  update public.bookings b set checked_in_at = se.starts_at - interval '8 minutes'
    from public.sessions se where se.id = b.session_id and b.status = 'checked_in' and b.checked_in_at is null;

  -- Two upcoming classes fill up and get a waitlist.
  for s in
    select se.id, public.session_capacity(se.id) cap from public.sessions se join public.class_types ct on ct.id = se.class_type_id
    where se.status = 'scheduled' and not ct.requires_vip and se.starts_at > now() + interval '1 day'
      and se.starts_at < now() + interval '4 days'
    order by ct.name = 'Reformer Pilates' desc, se.starts_at limit 2
  loop
    for mem in select id from public.profiles where 'demo' = any (tags) order by random() loop
      exit when public.session_booked_count(s.id) >= s.cap;
      begin perform public.book_session(s.id, null, mem.id); exception when others then null; end;
    end loop;
    full_ids := full_ids || s.id;
  end loop;
  for mem in select id from public.profiles where 'demo' = any (tags) order by random() limit 6 loop
    perform set_config('request.jwt.claims', json_build_object('sub', mem.id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', mem.id::text, true);
    for i in 1 .. coalesce(array_length(full_ids, 1), 0) loop
      begin perform public.join_waitlist(full_ids[i]); exception when others then null; end;
    end loop;
  end loop;

  -- A member orders 10 credits online and waits for staff to confirm the PromptPay transfer.
  select id into m from public.profiles where 'demo' = any (tags) order by created_at desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform public.create_online_order(pkg_10, null);

  -- Back to the admin: a few cancellations (early = refunded, close to class = late cancel).
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin::text, true);
  for bk_rec in
    select bk.id from public.bookings bk join public.sessions se on se.id = bk.session_id
    where bk.status = 'booked' and se.starts_at > now() and not (se.id = any (full_ids))
    order by random() limit 8
  loop
    perform public.cancel_booking(bk_rec.id, false);
  end loop;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- What got created
select
  (select count(*) from public.profiles where 'demo' = any (tags)) as demo_members,
  (select count(*) from public.sessions where starts_at >= now() - interval '3 days') as sessions,
  (select count(*) from public.bookings) as bookings,
  (select count(*) from public.waitlist where status = 'waiting') as waiting,
  (select count(*) from public.sales) as sales;
