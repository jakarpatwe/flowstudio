import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { fmtDateTime, fmtDay, fmtTime } from '../lib/format';
import { loadAvailability, loadWallet, SESSION_SELECT } from '../lib/queries';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Booking, SessionRow, SpotView } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Sheet } from '../ui/Sheet';
import { SpotLegend, SpotMap, type MapSpot } from '../ui/SpotMap';
import { useToast } from '../ui/Toast';

export function SessionPage() {
  const { id = '' } = useParams();
  const { profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [selected, setSelected] = useState<MapSpot | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data, error, loading, reload } = useLoad(async () => {
    const { data: s, error: e } = await supabase.from('sessions').select(SESSION_SELECT).eq('id', id).maybeSingle();
    if (e) throw new Error(e.message);
    if (!s) throw new Error('session_not_found');
    const session = s as SessionRow;
    const start = new Date(session.starts_at);
    const [spots, avail, mine, wallet] = await Promise.all([
      session.layout_id ? rpc<SpotView[]>('get_session_spots', { p_session_id: id }) : Promise.resolve([] as SpotView[]),
      loadAvailability(start, new Date(start.getTime() + 1000), session.branch_id),
      rows<Booking>(supabase.from('bookings').select('*').eq('session_id', id).eq('member_id', profile!.id).in('status', ['booked', 'checked_in'])),
      loadWallet(),
    ]);
    return { session, spots, avail: avail.get(id) ?? null, booking: mine[0] ?? null, wallet };
  }, [id, profile?.id]);

  // Someone else books or cancels → refresh the map. Members only get an anonymous "changed" ping.
  useEffect(() => {
    const ch = supabase.channel(`pulse-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_pulse', filter: `session_id=eq.${id}` }, () => { void reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A spot you picked that someone else just took is no longer selectable.
  useEffect(() => {
    if (selected && data && !data.spots.find((s) => s.spot_id === selected.id && s.state === 'free')) setSelected(null);
  }, [data, selected]);

  if (error) return <div className="panel empty"><p>{error}</p><Link className="btn" to="/schedule">กลับไปตารางคลาส</Link></div>;
  if (loading || !data) return <div className="stack"><div className="skeleton" style={{ minHeight: 120 }} /><div className="skeleton" style={{ minHeight: 320 }} /></div>;

  const { session: s, spots, avail, booking, wallet } = data;
  const ct = s.class_types;
  const now = new Date();
  const started = new Date(s.starts_at) <= now;
  const opensAt = new Date(new Date(s.starts_at).getTime() - ct.booking_window_days * 86400000);
  const notOpen = opensAt > now;
  const full = avail ? avail.booked >= avail.capacity : false;
  const usable = ct.requires_vip ? wallet.vip : wallet.total;
  const enough = usable >= ct.credit_cost;
  const cutoff = new Date(new Date(s.starts_at).getTime() - ct.cancel_cutoff_hours * 3600000);
  const freeCancel = now <= cutoff;
  const mySpot = spots.find((x) => x.state === 'mine');

  const mapSpots: MapSpot[] = spots.map((x) => ({ id: x.spot_id, label: x.label, x: x.x, y: x.y, state: x.state }));

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setSelected(null);
      await reload();
    } catch (e) {
      toast(errorText(e), 'error');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const book = () => act(() => rpc('book_session', { p_session_id: s.id, p_spot_id: selected?.id ?? null }),
    selected ? `จองตำแหน่ง ${selected.label} แล้ว` : 'จองแล้ว');
  const move = () => act(() => rpc('move_booking_spot', { p_booking_id: booking!.id, p_spot_id: selected!.id }), `ย้ายไปตำแหน่ง ${selected!.label} แล้ว`);
  const join = () => act(() => rpc('join_waitlist', { p_session_id: s.id }), 'เข้าคิวรอแล้ว มีที่ว่างเมื่อไหร่ ระบบจองให้อัตโนมัติ');
  const leave = () => act(() => rpc('leave_waitlist', { p_session_id: s.id }), 'ออกจากคิวรอแล้ว');
  const cancel = async () => {
    setConfirmCancel(false);
    setBusy(true);
    try {
      const r = await rpc<{ refunded: boolean; credits: number }>('cancel_booking', { p_booking_id: booking!.id });
      toast(r.refunded ? `ยกเลิกแล้ว คืน ${r.credits} เครดิต` : 'ยกเลิกแล้ว (ไม่คืนเครดิต เพราะเลยเวลายกเลิกฟรี)');
      nav('/bookings');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // What the bottom bar offers depends on where the member stands with this class.
  let dock: JSX.Element | null = null;
  if (booking) {
    dock = selected ? (
      <>
        <div className="dock-spot num">{selected.label}</div>
        <div className="grow faint">ย้ายจากตำแหน่ง {mySpot?.label}</div>
        <button className="btn btn-you" disabled={busy} onClick={move}>ย้ายไปตำแหน่งนี้</button>
      </>
    ) : (
      <>
        {mySpot && <div className="dock-spot num">{mySpot.label}</div>}
        <div className="grow">
          <b>{booking.status === 'checked_in' ? 'เช็คอินแล้ว' : 'คุณจองคลาสนี้แล้ว'}</b>
          {!started && s.layout_id && <div className="faint">แตะตำแหน่งว่างเพื่อย้าย</div>}
        </div>
        {!started && booking.status === 'booked' && (
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmCancel(true)}>ยกเลิก</button>
        )}
      </>
    );
  } else if (started) {
    dock = <div className="grow muted">คลาสนี้เริ่มแล้ว</div>;
  } else if (notOpen) {
    dock = <div className="grow muted">เปิดให้จอง {fmtDateTime(opensAt.toISOString())}</div>;
  } else if (!enough) {
    dock = (
      <>
        <div className="grow"><b>เครดิตไม่พอ</b><div className="faint">คลาสนี้ใช้ {ct.credit_cost}{ct.requires_vip ? ' เครดิต VIP' : ' เครดิต'} · คุณมี {usable}</div></div>
        <Link className="btn btn-primary" to="/packages">ซื้อแพ็กเกจ</Link>
      </>
    );
  } else if (full) {
    dock = avail?.on_waitlist ? (
      <><div className="grow"><b>คุณอยู่ในคิวรอ</b><div className="faint">มีที่ว่างเมื่อไหร่ ระบบจองให้และแจ้งทันที</div></div>
        <button className="btn" disabled={busy} onClick={leave}>ออกจากคิว</button></>
    ) : (
      <><div className="grow"><b>คลาสเต็ม</b><div className="faint">{avail?.waiting ? `มีคนรอ ${avail.waiting} คน` : 'ยังไม่มีคนรอ'}</div></div>
        <button className="btn btn-primary" disabled={busy} onClick={join}>เข้าคิวรอ</button></>
    );
  } else if (s.layout_id) {
    dock = selected ? (
      <>
        <div className="dock-spot num">{selected.label}</div>
        <div className="grow faint">{ct.credit_cost} เครดิต · เหลือหลังจอง {usable - ct.credit_cost}</div>
        <button className="btn btn-you" disabled={busy} onClick={book}>จองตำแหน่งนี้</button>
      </>
    ) : (
      <>
        <div className="grow"><b>เลือกตำแหน่งบนผัง</b><div className="faint">หรือให้ระบบเลือกให้</div></div>
        <button className="btn" disabled={busy} onClick={book}>เลือกให้ฉัน</button>
      </>
    );
  } else {
    dock = (
      <>
        <div className="grow"><b>{ct.credit_cost} {ct.requires_vip ? 'เครดิต VIP' : 'เครดิต'}</b><div className="faint">คงเหลือหลังจอง {usable - ct.credit_cost}</div></div>
        <button className="btn btn-primary" disabled={busy} onClick={book}>จองคลาสนี้</button>
      </>
    );
  }

  const canPick = !started && !notOpen && (booking ? booking.status === 'booked' : enough && !full);

  return (
    <div className="stack-l with-dock">
      <div className="session-head" style={{ ['--c' as string]: ct.color }}>
        <span className="bar" />
        <span className="faint">{fmtDay(s.starts_at)}</span>
        <div className="when num">{fmtTime(s.starts_at)}<span className="faint" style={{ fontSize: 16, fontWeight: 400 }}> – {fmtTime(s.ends_at)}</span></div>
        <h1>{ct.name}</h1>
        <p className="muted">{s.instructors?.name ?? 'ยังไม่ระบุครู'} · {s.rooms.name}{avail ? ` · ว่าง ${Math.max(0, avail.capacity - avail.booked)} จาก ${avail.capacity}` : ''}</p>
        {booking?.needs_new_spot && <p className="chip chip-warn" style={{ justifySelf: 'start' }}>ผังห้องเปลี่ยน ตรวจตำแหน่งของคุณอีกครั้ง</p>}
      </div>

      {s.layout_id && s.layouts && (
        <div className="stack">
          <SpotMap
            cols={s.layouts.cols} rows={s.layouts.rows} fixtures={s.layouts.fixtures ?? []} equipment={s.layouts.equipment}
            spots={mapSpots} selectedId={selected?.id}
            onPick={canPick ? (sp) => setSelected(sp.state === 'mine' || sp.id === selected?.id ? null : sp) : undefined}
            pickable={(sp) => sp.state === 'free' || (!!selected && sp.state === 'mine')}
          />
          <SpotLegend />
        </div>
      )}

      {ct.description && <p className="muted">{ct.description}</p>}
      <p className="faint">
        ยกเลิกฟรีถึง {fmtDateTime(cutoff.toISOString())} หลังจากนั้นยกเลิกได้แต่ไม่คืนเครดิต
      </p>

      <div className="dock"><div className="dock-inner">{dock}</div></div>

      <Sheet open={confirmCancel} onClose={() => setConfirmCancel(false)} title="ยกเลิกการจอง">
        <p>{ct.name} {fmtDateTime(s.starts_at)}{mySpot ? ` ตำแหน่ง ${mySpot.label}` : ''}</p>
        <p className={freeCancel ? 'chip chip-ok' : 'chip chip-warn'} style={{ justifySelf: 'start' }}>
          {freeCancel ? `ได้เครดิตคืน ${booking?.credits_used ?? ct.credit_cost} เครดิต` : 'เลยเวลายกเลิกฟรีแล้ว เครดิตไม่คืน'}
        </p>
        <div className="row">
          <button className="btn grow" onClick={() => setConfirmCancel(false)}>เก็บการจองไว้</button>
          <button className="btn btn-danger grow" disabled={busy} onClick={cancel}>ยกเลิกการจอง</button>
        </div>
      </Sheet>
    </div>
  );
}
