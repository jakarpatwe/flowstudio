import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorText } from '../lib/errors';
import { fmtDateTime, fmtTime } from '../lib/format';
import { loadAvailability, SESSION_SELECT } from '../lib/queries';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Booking, BookingStatus, Instructor, Layout, SessionRow, SpotView } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Sheet } from '../ui/Sheet';
import { SpotMap } from '../ui/SpotMap';
import { useToast } from '../ui/Toast';
import { MemberPicker } from './MemberPicker';

type RosterRow = Booking & { profiles: { display_name: string; phone: string | null; tags: string[] }; layout_spots: { label: string } | null };
type WaitRow = { id: string; status: string; created_at: string; profiles: { display_name: string; phone: string | null } };

const statusText: Record<BookingStatus, [string, string]> = {
  booked: ['จองแล้ว', 'chip-bounce'], checked_in: ['เช็คอินแล้ว', 'chip-ok'], cancelled: ['ยกเลิก', ''],
  late_cancel: ['ยกเลิกช้า', 'chip-warn'], no_show: ['ไม่มา', 'chip-bad'],
};

export function SessionAdmin() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [spotMode, setSpotMode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const { data, reload, error } = useLoad(async () => {
    const { data: s, error: e } = await supabase.from('sessions').select(SESSION_SELECT).eq('id', id).single();
    if (e) throw new Error(e.message);
    const session = s as SessionRow;
    const start = new Date(session.starts_at);
    const [spots, roster, waits, layouts, instructors, avail] = await Promise.all([
      session.layout_id ? rpc<SpotView[]>('get_session_spots', { p_session_id: id }) : Promise.resolve([] as SpotView[]),
      rows<RosterRow>(supabase.from('bookings').select('*, profiles!bookings_member_id_fkey(display_name, phone, tags), layout_spots(label)').eq('session_id', id).order('created_at')),
      rows<WaitRow>(supabase.from('waitlist').select('id, status, created_at, profiles(display_name, phone)').eq('session_id', id).eq('status', 'waiting').order('created_at')),
      rows<Layout>(supabase.from('layouts').select('*').eq('room_id', session.room_id).eq('active', true)),
      rows<Instructor>(supabase.from('instructors').select('*').eq('active', true).order('name')),
      loadAvailability(start, new Date(start.getTime() + 1000), session.branch_id),
    ]);
    return { session, spots, roster, waits, layouts, instructors, avail: avail.get(id) ?? null };
  }, [id]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast(ok); await reload(); } catch (e) { toast(errorText(e), 'error'); }
  }

  if (error) return <div className="panel empty"><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ minHeight: 300 }} />;
  const { session: s, spots, roster, waits, layouts, instructors, avail } = data;
  const active = roster.filter((r) => r.status === 'booked' || r.status === 'checked_in');
  const others = roster.filter((r) => !active.includes(r));
  const started = new Date(s.starts_at) <= new Date();
  const nameBySpot = new Map(active.filter((r) => r.spot_id).map((r) => [r.spot_id!, r.profiles.display_name]));

  return (
    <div className="stack-l">
      <div className="a-head">
        <div>
          <Link to="/admin/timetable" className="faint">ตารางคลาส</Link>
          <h1>{s.class_types.name} · {fmtDateTime(s.starts_at)}–{fmtTime(s.ends_at)}</h1>
          <p>{s.rooms.name} · {s.instructors?.name ?? 'ยังไม่ระบุครู'} · จอง {avail?.booked ?? 0}/{avail?.capacity ?? 0}{waits.length ? ` · รอ ${waits.length}` : ''}{s.status === 'cancelled' ? ' · ยกเลิกแล้ว' : ''}</p>
        </div>
        {s.status === 'scheduled' && (
          <div className="row wrap">
            <button className="btn btn-s" onClick={() => setEditing(true)}>แก้ไขรอบ</button>
            {started && <button className="btn btn-s" onClick={() => act(() => rpc('mark_no_shows', { p_session_id: s.id }), 'บันทึกคนที่ไม่มาแล้ว')}>บันทึกคนที่ไม่มา</button>}
            <button className="btn btn-s btn-danger" onClick={() => setCancelling(true)}>ยกเลิกคลาส</button>
          </div>
        )}
      </div>

      <div className="cols-2">
        <section className="stack">
          <div className="row-between">
            <h2>รายชื่อ ({active.length})</h2>
            {s.status === 'scheduled' && <span className="faint">จองแทนสมาชิก</span>}
          </div>
          {s.status === 'scheduled' && (
            <MemberPicker placeholder="ค้นหาสมาชิกเพื่อจองแทน" onPick={(p) => act(() => rpc('book_session', { p_session_id: s.id, p_member_id: p.id }), `จองให้ ${p.display_name} แล้ว`)} />
          )}
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>ตำแหน่ง</th><th>สมาชิก</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {active.length === 0 && <tr><td colSpan={4} className="faint">ยังไม่มีคนจอง</td></tr>}
                {active.map((r) => (
                  <tr key={r.id}>
                    <td className="num"><b>{r.layout_spots?.label ?? '–'}</b>{r.needs_new_spot && <span className="chip chip-warn" style={{ marginLeft: 6 }}>ตรวจตำแหน่ง</span>}</td>
                    <td>{r.profiles.display_name}<div className="faint">{r.profiles.phone ?? ''}{r.profiles.tags.length ? ` · ${r.profiles.tags.join(', ')}` : ''}</div></td>
                    <td><span className={`chip ${statusText[r.status][1]}`}>{statusText[r.status][0]}</span></td>
                    <td className="n">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {r.status === 'booked' && <button className="btn btn-s" onClick={() => act(() => rpc('check_in_booking', { p_booking_id: r.id }), `เช็คอิน ${r.profiles.display_name} แล้ว`)}>เช็คอิน</button>}
                        {r.status === 'booked' && (
                          <button className="btn btn-s btn-danger" onClick={() => act(async () => {
                            const refund = window.confirm(`ยกเลิกการจองของ ${r.profiles.display_name}\n\nกด OK = คืนเครดิตให้ (ข้ามกฎยกเลิกช้า)\nกด Cancel = ใช้กฎปกติ`);
                            await rpc('cancel_booking', { p_booking_id: r.id, p_force_refund: refund });
                          }, 'ยกเลิกการจองแล้ว')}>ยกเลิก</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {waits.length > 0 && (
            <div className="panel-tight stack">
              <h3>คิวรอ</h3>
              {waits.map((w, i) => <div key={w.id} className="row-between"><span>{i + 1}. {w.profiles.display_name}</span><span className="faint">{fmtDateTime(w.created_at)}</span></div>)}
              <p className="faint">ระบบจองให้คนแรกในคิวที่มีเครดิตพอ เมื่อมีที่ว่าง (หยุดเลื่อนคิว 2 ชม. ก่อนคลาส)</p>
            </div>
          )}

          {others.length > 0 && (
            <details>
              <summary className="muted">ยกเลิก / ไม่มา ({others.length})</summary>
              <div className="stack" style={{ marginTop: 8 }}>
                {others.map((r) => (
                  <div key={r.id} className="row-between">
                    <span>{r.profiles.display_name}</span>
                    <span className="row">
                      <span className={`chip ${statusText[r.status][1]}`}>{statusText[r.status][0]}</span>
                      {r.status === 'no_show' && <button className="btn btn-s" onClick={() => act(() => rpc('check_in_booking', { p_booking_id: r.id }), 'แก้เป็นเช็คอินแล้ว')}>มาแล้ว</button>}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        <section className="stack">
          {s.layouts ? (
            <>
              <div className="row-between">
                <h2>{s.layouts.name}</h2>
                <div className="row">
                  {layouts.length > 1 && s.status === 'scheduled' && (
                    <select className="select" style={{ minHeight: 34, width: 'auto' }} value={s.layout_id ?? ''} aria-label="เปลี่ยนผัง"
                      onChange={(e) => act(async () => {
                        const r = await rpc<{ kept: number; flagged: number }>('change_session_layout', { p_session_id: s.id, p_layout_id: e.target.value });
                        if (r.flagged) toast(`${r.flagged} คนต้องเลือกตำแหน่งใหม่ ระบบแจ้งในแอปแล้ว`, 'error');
                      }, 'เปลี่ยนผังแล้ว')}>
                      {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  )}
                  {s.status === 'scheduled' && (
                    <button className="btn btn-s" aria-pressed={spotMode} onClick={() => setSpotMode(!spotMode)}>
                      {spotMode ? 'เสร็จแล้ว' : 'เปิด/ปิดเครื่อง'}
                    </button>
                  )}
                </div>
              </div>
              {spotMode && <p className="faint">แตะเครื่องที่ว่างเพื่อปิดเฉพาะรอบนี้ (เช่น เครื่องเสีย) แตะอีกครั้งเพื่อเปิด</p>}
              <SpotMap
                cols={s.layouts.cols} rows={s.layouts.rows} fixtures={s.layouts.fixtures ?? []} equipment={s.layouts.equipment}
                spots={spots.map((x) => ({ id: x.spot_id, label: x.label, x: x.x, y: x.y, state: x.state === 'mine' ? 'taken' : x.state }))}
                onPick={spotMode ? (sp) => act(() => rpc('set_session_spot_disabled', { p_session_id: s.id, p_spot_id: sp.id, p_disabled: sp.state !== 'off' }),
                  sp.state === 'off' ? `เปิดเครื่อง ${sp.label} แล้ว` : `ปิดเครื่อง ${sp.label} สำหรับรอบนี้แล้ว`) : undefined}
                pickable={(sp) => sp.state === 'free' || sp.state === 'off'}
              />
              {!spotMode && nameBySpot.size > 0 && (
                <p className="faint">{[...nameBySpot.entries()].map(([sid, n]) => `${spots.find((x) => x.spot_id === sid)?.label}: ${n}`).join(' · ')}</p>
              )}
            </>
          ) : <div className="panel muted">คลาสนี้ไม่ใช้ผังตำแหน่ง จองเป็นจำนวนคน</div>}
        </section>
      </div>

      <EditSession open={editing} onClose={() => setEditing(false)} session={s} instructors={instructors} onSaved={() => { setEditing(false); void reload(); }} />

      <Sheet open={cancelling} onClose={() => setCancelling(false)} title="ยกเลิกคลาสนี้">
        <p>ทุกคนที่จองไว้ ({active.length} คน) ได้เครดิตคืนเต็มจำนวน และคิวรอถูกปิด</p>
        <label className="field"><span>เหตุผล (สมาชิกเห็นข้อความนี้)</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ครูไม่สบาย" /></label>
        <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => { setCancelling(false); void act(() => rpc('cancel_session', { p_session_id: s.id, p_reason: reason }), 'ยกเลิกคลาสและคืนเครดิตแล้ว'); }}>ยกเลิกคลาสและคืนเครดิต</button>
      </Sheet>
    </div>
  );
}

function EditSession({ open, onClose, session, instructors, onSaved }: {
  open: boolean; onClose: () => void; session: SessionRow; instructors: Instructor[]; onSaved: () => void;
}) {
  const toast = useToast();
  const start = new Date(session.starts_at);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(start);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
  const [day, setDay] = useState(ymd);
  const [time, setTime] = useState(hm);
  const [duration, setDuration] = useState(String(Math.round((new Date(session.ends_at).getTime() - start.getTime()) / 60000)));
  const [instructorId, setInstructorId] = useState(session.instructor_id ?? '');
  const [capacity, setCapacity] = useState(session.capacity?.toString() ?? '');
  const [note, setNote] = useState(session.note ?? '');

  async function save() {
    try {
      await rpc('update_session', {
        p_session_id: session.id, p_instructor_id: instructorId || null,
        p_starts_at: new Date(`${day}T${time}:00+07:00`).toISOString(), p_duration_minutes: Number(duration),
        p_capacity: capacity ? Number(capacity) : null, p_note: note || null,
      });
      toast('บันทึกแล้ว');
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="แก้ไขรอบคลาส">
      <div className="form-grid">
        <label className="field"><span>วันที่</span><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="field"><span>เวลาเริ่ม</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="field"><span>ความยาว (นาที)</span><input className="input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        <label className="field"><span>จำกัดจำนวนคน</span><input className="input" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="ตามจำนวนเครื่อง" /></label>
      </div>
      <label className="field"><span>ครู</span>
        <select className="select" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
          <option value="">ยังไม่ระบุ</option>
          {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <label className="field"><span>หมายเหตุ</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="btn btn-primary" onClick={save}>บันทึก</button>
    </Sheet>
  );
}
