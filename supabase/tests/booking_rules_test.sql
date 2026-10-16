-- Behaviour tests for the booking, credit and POS rules. Run on a fresh database after
-- local_shim.sql + migrations + seed.sql. Every check raises an error if it fails.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- People
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'owner@test', '{"name":"เจ้าของ"}'),
  ('11111111-0000-0000-0000-000000000002', 'staff@test', '{"name":"พนักงาน"}'),
  ('11111111-0000-0000-0000-00000000000a', 'a@test', '{"name":"สมาชิก A"}'),
  ('11111111-0000-0000-0000-00000000000b', 'b@test', '{"name":"สมาชิก B"}'),
  ('11111111-0000-0000-0000-00000000000c', 'c@test', '{"name":"สมาชิก C"}');
update public.profiles set role = 'owner' where id = '11111111-0000-0000-0000-000000000001';
update public.profiles set role = 'staff' where id = '11111111-0000-0000-0000-000000000002';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
end $$;
create or replace function pg_temp.expect_error(sql text, code text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected error % but call succeeded: %', code, sql;
exception when others then
  if sqlerrm <> code then raise exception 'expected % got % for %', code, sqlerrm, sql; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

\echo '1. profiles created by trigger'
do $$ begin
  if (select count(*) from public.profiles) <> 5 then raise exception 'profiles missing'; end if;
end $$;

set role authenticated;

\echo '2. staff generates the week and opens a shift'
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
do $$ declare r jsonb; begin
  r := public.generate_sessions('00000000-0000-0000-0000-0000000000b1', current_date + 1, current_date + 7);
  if (r ->> 'created')::int < 50 then raise exception 'too few sessions: %', r; end if;
  -- running it again creates nothing new
  r := public.generate_sessions('00000000-0000-0000-0000-0000000000b1', current_date + 1, current_date + 7);
  if (r ->> 'created')::int <> 0 then raise exception 'duplicate generation: %', r; end if;
end $$;
select public.open_shift(1000);
select pg_temp.expect_error($q$select public.open_shift(0)$q$, 'shift_already_open');

\echo '3. counter sales grant credits; trial only once'
do $$ declare pk10 uuid; trial uuid; vip uuid; s public.sales; begin
  select id into pk10 from public.packages where name = '10 เครดิต';
  select id into trial from public.packages where kind = 'trial';
  select id into vip from public.packages where kind = 'vip';
  s := public.pos_checkout('11111111-0000-0000-0000-00000000000a', jsonb_build_array(jsonb_build_object('package_id', pk10)), 'cash');
  if s.total <> 4900 then raise exception 'wrong total %', s.total; end if;
  perform public.pos_checkout('11111111-0000-0000-0000-00000000000b', jsonb_build_array(jsonb_build_object('package_id', trial)), 'promptpay');
  perform public.pos_checkout('11111111-0000-0000-0000-00000000000c', jsonb_build_array(jsonb_build_object('package_id', pk10), jsonb_build_object('package_id', vip)), 'card');
  if (public.member_wallet('11111111-0000-0000-0000-00000000000a') ->> 'total')::int <> 10 then raise exception 'A wallet wrong'; end if;
  if (public.member_wallet('11111111-0000-0000-0000-00000000000c') ->> 'vip')::int <> 30 then raise exception 'C vip wallet wrong'; end if;
end $$;
select pg_temp.expect_error(format($q$select public.pos_checkout('11111111-0000-0000-0000-00000000000b', '[{"package_id":"%s"}]', 'cash')$q$,
  (select id from public.packages where kind = 'trial')), 'package_once_per_member');
-- products reduce stock
do $$ declare sock uuid; st int; begin
  select id, stock into sock, st from public.products where name = 'ถุงเท้ากันลื่น';
  perform public.pos_checkout(null, jsonb_build_array(jsonb_build_object('product_id', sock, 'qty', 2)), 'cash');
  if (select stock from public.products where id = sock) <> st - 2 then raise exception 'stock not reduced'; end if;
end $$;

-- A small test class tomorrow at 06:00 in room 2 (Reformer, capacity 2)
reset role;
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
set role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
insert into t select 'small', (public.create_session('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c1', null, ((current_date + 1)::timestamp at time zone 'Asia/Bangkok') + interval '4 hours', 50, 2)).id;
insert into t select 'tramp', id from public.sessions where class_type_id = '00000000-0000-0000-0000-0000000000e1'
  and starts_at > now() + interval '1 day' and capacity is null order by starts_at limit 1;
insert into t select 'reformer', id from public.sessions where class_type_id = '00000000-0000-0000-0000-0000000000e3'
  and starts_at > now() + interval '1 day' order by starts_at limit 1;
insert into t select 'vip', id from public.sessions where class_type_id = '00000000-0000-0000-0000-0000000000e4'
  and starts_at > now() + interval '1 day' order by starts_at limit 1;
insert into t select 'spot1', id from public.layout_spots where layout_id = '00000000-0000-0000-0000-0000000000c1' and label = '1';

\echo '4. room clashes and turnover are blocked'
select pg_temp.expect_error($q$select public.create_session('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1',null,null,
  ((current_date + 1)::timestamp at time zone 'Asia/Bangkok') + interval '4 hours 20 minutes', 50, null)$q$, 'room_busy');
select pg_temp.expect_error($q$select public.create_session('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1',null,null,
  ((current_date + 1)::timestamp at time zone 'Asia/Bangkok') + interval '4 hours 55 minutes', 50, null)$q$, 'room_turnover_conflict');

\echo '5. spots: one person per spot, members never see who'
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');
select public.book_session((select v from t where k = 'tramp'), (select v from t where k = 'spot1'));
select pg_temp.expect_error(format($q$select public.book_session('%s', '%s')$q$, (select v from t where k = 'tramp'), (select v from t where k = 'spot1')), 'already_booked');
select pg_temp.as_user('11111111-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($q$select public.book_session('%s', '%s')$q$, (select v from t where k = 'tramp'), (select v from t where k = 'spot1')), 'spot_taken');
do $$ begin
  if (select state from public.get_session_spots((select v from t where k = 'tramp')) where label = '1') <> 'taken' then raise exception 'B should see taken'; end if;
end $$;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');
do $$ begin
  if (select state from public.get_session_spots((select v from t where k = 'tramp')) where label = '1') <> 'mine' then raise exception 'A should see mine'; end if;
  if (public.member_wallet() ->> 'total')::int <> 9 then raise exception 'A should have 9 left'; end if;
  -- RLS: A sees only own bookings and lots
  if exists (select 1 from public.bookings where member_id <> auth.uid()) then raise exception 'A sees others bookings'; end if;
  if exists (select 1 from public.credit_lots where member_id <> auth.uid()) then raise exception 'A sees others lots'; end if;
end $$;
select pg_temp.expect_error($q$insert into public.bookings (session_id, member_id) select id, auth.uid() from public.sessions limit 1$q$,
  'new row violates row-level security policy for table "bookings"');
select pg_temp.expect_error($q$select public.pos_checkout(null, '[]', 'cash')$q$, 'not_allowed');
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
select pg_temp.expect_error($q$update public.profiles set role = 'owner' where id = auth.uid()$q$, 'not_allowed');
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');

\echo '6. moving to another free spot'
do $$ declare b uuid; s2 uuid; begin
  select id into b from public.bookings where member_id = auth.uid() and session_id = (select v from t where k = 'tramp');
  select id into s2 from public.layout_spots where layout_id = '00000000-0000-0000-0000-0000000000c1' and label = '7';
  perform public.move_booking_spot(b, s2);
  if (select state from public.get_session_spots((select v from t where k = 'tramp')) where label = '1') <> 'free' then raise exception 'old spot not freed'; end if;
end $$;

\echo '7. full class → waitlist → early cancel refunds and promotes'
select public.book_session((select v from t where k = 'small'));
select pg_temp.as_user('11111111-0000-0000-0000-00000000000b');
select public.book_session((select v from t where k = 'small'));
select pg_temp.as_user('11111111-0000-0000-0000-00000000000c');
select pg_temp.expect_error(format($q$select public.book_session('%s')$q$, (select v from t where k = 'small')), 'session_full');
select public.join_waitlist((select v from t where k = 'small'));
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');
do $$ declare r jsonb; b uuid; begin
  select id into b from public.bookings where member_id = auth.uid() and session_id = (select v from t where k = 'small');
  r := public.cancel_booking(b);
  if not (r ->> 'refunded')::boolean then raise exception 'should refund: %', r; end if;
  if (public.member_wallet() ->> 'total')::int <> 9 then raise exception 'A credit not back'; end if;
end $$;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000c');
do $$ begin
  if not exists (select 1 from public.bookings where member_id = auth.uid() and session_id = (select v from t where k = 'small') and status = 'booked') then
    raise exception 'C was not promoted';
  end if;
  if (select status from public.waitlist where member_id = auth.uid() and session_id = (select v from t where k = 'small')) <> 'promoted' then
    raise exception 'waitlist not marked promoted';
  end if;
  -- C pays with normal credits before VIP credits
  if (public.member_wallet() ->> 'vip')::int <> 30 then raise exception 'VIP credits used for general class'; end if;
end $$;

\echo '8. late cancel keeps the credit'
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
insert into t select 'soon', (public.create_session('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000c3', null, now() + interval '3 hours', 50, null)).id;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');
do $$ declare r jsonb; b public.bookings; begin
  b := public.book_session((select v from t where k = 'soon'));
  if (public.member_wallet() ->> 'total')::int <> 7 then raise exception 'reformer should cost 2'; end if;
  r := public.cancel_booking(b.id);
  if (r ->> 'refunded')::boolean then raise exception 'late cancel refunded'; end if;
  if (select status from public.bookings where id = b.id) <> 'late_cancel' then raise exception 'status not late_cancel'; end if;
end $$;

\echo '9. VIP class needs VIP credits'
select pg_temp.expect_error(format($q$select public.book_session('%s')$q$, (select v from t where k = 'vip')), 'insufficient_credits');
select pg_temp.as_user('11111111-0000-0000-0000-00000000000c');
do $$ begin
  perform public.book_session((select v from t where k = 'vip'));
  if (public.member_wallet() ->> 'vip')::int <> 27 then raise exception 'VIP should cost 3 VIP credits'; end if;
end $$;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($q$select public.book_session('%s')$q$, (select v from t where k = 'vip')), 'session_full');

\echo '10. booking window'
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
insert into t select 'far', (public.create_session('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c1', null, now() + interval '20 days', 50, null)).id;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($q$select public.book_session('%s')$q$, (select v from t where k = 'far')), 'booking_not_open');

\echo '11. layout change keeps spots by label'
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
do $$ declare r jsonb; begin
  r := public.change_session_layout((select v from t where k = 'tramp'), '00000000-0000-0000-0000-0000000000c2');
  if (r ->> 'kept')::int + (r ->> 'flagged')::int <> 1 then raise exception 'layout remap wrong %', r; end if;
  if exists (select 1 from public.bookings where session_id = (select v from t where k = 'tramp') and status = 'booked' and spot_id is null) then
    raise exception 'booking lost its spot';
  end if;
end $$;

\echo '12. disabling a spot for one session lowers capacity'
do $$ declare sp uuid; c1 int; begin
  c1 := public.session_capacity((select v from t where k = 'reformer'));
  select id into sp from public.layout_spots where layout_id = '00000000-0000-0000-0000-0000000000c3' and label = 'R10';
  perform public.set_session_spot_disabled((select v from t where k = 'reformer'), sp, true);
  if public.session_capacity((select v from t where k = 'reformer')) <> c1 - 1 then raise exception 'capacity not reduced'; end if;
end $$;

\echo '13. online order with promo, confirmed by staff'
select pg_temp.as_user('11111111-0000-0000-0000-00000000000b');
insert into t select 'order', (public.create_online_order((select id from public.packages where name = '25 เครดิต'), 'jump10')).id;
do $$ begin
  if (select total from public.sales where id = (select v from t where k = 'order')) <> 9810 then raise exception 'promo total wrong'; end if;
end $$;
select pg_temp.expect_error(format($q$select public.confirm_sale('%s')$q$, (select v from t where k = 'order')), 'not_allowed');
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
select public.confirm_sale((select v from t where k = 'order'));
do $$ begin
  if (public.member_wallet('11111111-0000-0000-0000-00000000000b') ->> 'total')::int <> 5 - 1 + 25 then
    raise exception 'B wallet after order wrong: %', public.member_wallet('11111111-0000-0000-0000-00000000000b');
  end if;
end $$;

\echo '14. void: staff cannot, manager cannot void used credits'
select pg_temp.expect_error(format($q$select public.void_sale('%s', 'test')$q$, (select v from t where k = 'order')), 'not_allowed');
select pg_temp.as_user('11111111-0000-0000-0000-000000000001');
select pg_temp.expect_error(format($q$select public.void_sale('%s', 'test')$q$,
  (select sale_id from public.credit_lots where member_id = '11111111-0000-0000-0000-00000000000a' limit 1)), 'credits_already_used');
select public.void_sale((select v from t where k = 'order'), 'ลูกค้าขอคืน');
do $$ begin
  if (public.member_wallet('11111111-0000-0000-0000-00000000000b') ->> 'total')::int <> 4 then raise exception 'void did not remove credits'; end if;
end $$;

\echo '15. manager adjusts and freezes credits'
do $$ declare w jsonb; begin
  w := public.adjust_credits('11111111-0000-0000-0000-00000000000a', 2, 'ชดเชยคลาสยกเลิก');
  if (w ->> 'total')::int <> 9 then raise exception 'adjust + failed %', w; end if;
  w := public.adjust_credits('11111111-0000-0000-0000-00000000000a', -1, 'แก้ยอด');
  if (w ->> 'total')::int <> 8 then raise exception 'adjust - failed %', w; end if;
  perform public.freeze_credits('11111111-0000-0000-0000-00000000000a', 14, 'ไปต่างประเทศ');
end $$;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($q$select public.book_session('%s')$q$, (select v from t where k = 'reformer')), 'insufficient_credits');

\echo '16. check-in by QR code and no-shows'
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
do $$ declare r jsonb; code text; begin
  select checkin_code into code from public.profiles where id = '11111111-0000-0000-0000-00000000000c';
  r := public.check_in_by_code(lower(code));
  if r ->> 'name' <> 'สมาชิก C' then raise exception 'check in lookup wrong %', r; end if;
end $$;

\echo '17. moving members from the old system'
reset role;
insert into public.member_imports (branch_id, external_ref, display_name, phone, credits, expires_at)
  values ('00000000-0000-0000-0000-0000000000b1', 'GYMMO-001', 'สมาชิกเก่า', '0899999999', 7, now() + interval '40 days');
set role authenticated;
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
do $$ declare w jsonb; begin
  w := public.claim_import((select id from public.member_imports limit 1), '11111111-0000-0000-0000-00000000000b');
  if (w ->> 'total')::int <> 11 then raise exception 'import not credited %', w; end if;
end $$;
select pg_temp.expect_error(format($q$select public.claim_import('%s', '11111111-0000-0000-0000-00000000000c')$q$,
  (select id from public.member_imports limit 1)), 'import_not_available');

\echo '18. reports run'
do $$ declare r jsonb; begin
  r := public.report_summary('00000000-0000-0000-0000-0000000000b1', current_date - 1, current_date + 7);
  if (r -> 'sales' ->> 'total')::numeric <= 0 then raise exception 'no sales in report %', r; end if;
  if (r -> 'bookings' ->> 'late_cancel')::int <> 1 then raise exception 'late cancel not counted %', r; end if;
  perform * from public.report_fill_heatmap('00000000-0000-0000-0000-0000000000b1', current_date, current_date + 7);
  perform * from public.report_spot_heatmap('00000000-0000-0000-0000-0000000000c1', current_date, current_date + 7);
  perform * from public.report_sessions('00000000-0000-0000-0000-0000000000b1', current_date, current_date + 7);
  perform * from public.report_sales('00000000-0000-0000-0000-0000000000b1', current_date, current_date + 7);
  perform * from public.report_instructors('00000000-0000-0000-0000-0000000000b1', current_date, current_date + 7);
end $$;
select pg_temp.as_user('11111111-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$select public.report_summary('00000000-0000-0000-0000-0000000000b1', current_date, current_date)$q$, 'not_allowed');

\echo '19. cancelling a class refunds everyone'
select pg_temp.as_user('11111111-0000-0000-0000-000000000002');
do $$ declare n int; begin
  n := public.cancel_session((select v from t where k = 'vip'), 'ครูป่วย');
  if n <> 1 then raise exception 'expected 1 refund got %', n; end if;
  if (public.member_wallet('11111111-0000-0000-0000-00000000000c') ->> 'vip')::int <> 30 then raise exception 'VIP credits not refunded'; end if;
end $$;

\echo '20. shift close counts cash'
do $$ declare sh public.shifts; begin
  sh := public.close_shift(5940);
  if sh.expected_cash <> 1000 + 4900 + 300 then raise exception 'expected cash wrong %', sh.expected_cash; end if;
end $$;

\echo '21. layout editor save: move, rename, remove a booked spot'
select pg_temp.as_user('11111111-0000-0000-0000-000000000001');
do $$ declare spots jsonb; l uuid := '00000000-0000-0000-0000-0000000000c1'; before int; begin
  select count(*) into before from public.layout_spots where layout_id = l and active;
  -- drop spot "7" (A is booked on it in another session? not after the layout change) and shift every other spot one column right
  select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'x', x + 1, 'y', y)) into spots
    from public.layout_spots where layout_id = l and active and label <> '2';
  perform public.save_layout(l, 'แทรมโพลีน 19 ตัว', 'trampoline', 8, 6, '[]', spots);
  if (select count(*) from public.layout_spots where layout_id = l and active) <> before - 1 then raise exception 'spot not removed'; end if;
  if exists (select 1 from public.get_session_spots((select v from t where k = 'small')) where x < 0) then raise exception 'parked spot visible'; end if;
  if public.session_capacity((select v from t where k = 'far')) <> before - 1 then raise exception 'capacity not updated'; end if;
end $$;

\echo 'ALL TESTS PASSED'
