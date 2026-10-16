import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { addDays, dayStart, fmtDay, fmtTime, localDate } from '../lib/format';
import { loadAvailability, loadSessions } from '../lib/queries';
import { rows, rpc, supabase } from '../lib/supabase';
import type { ClassType, Instructor, Layout, Room, Session } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

/** Monday of the week containing ymd. */
function mondayOf(ymd: string) {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

export function Timetable() {
  const { branch } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const today = localDate();
  const [week, setWeek] = useState(mondayOf(today));
  const [creating, setCreating] = useState<string | null>(null);

  const catalog = useLoad(async () => {
    const [classes, rooms, layouts, instructors] = await Promise.all([
      rows<ClassType>(supabase.from('class_types').select('*').eq('active', true).order('sort_order')),
      rows<Room>(supabase.from('rooms').select('*').eq('active', true).order('sort_order')),
      rows<Layout>(supabase.from('layouts').select('*').eq('active', true).order('name')),
      rows<Instructor>(supabase.from('instructors').select('*').eq('active', true).order('name')),
    ]);
    return { classes, rooms, layouts, instructors };
  }, []);

  const { data, reload } = useLoad(async () => {
    const from = dayStart(week), to = dayStart(addDays(week, 7));
    const [sessions, avail] = await Promise.all([loadSessions(from, to, branch?.id), loadAvailability(from, to, branch?.id)]);
    return { sessions, avail };
  }, [week, branch?.id]);

  async function generate() {
    try {
      const r = await rpc<{ created: number; skipped: number }>('generate_sessions', { p_branch_id: branch!.id, p_from: week, p_to: addDays(week, 6) });
      toast(`สร้าง ${r.created} รอบจากตารางประจำสัปดาห์${r.skipped ? ` (ข้าม ${r.skipped} รอบที่มีอยู่แล้วหรือชนกัน)` : ''}`);
      void reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  return (
    <div className="stack-l">
      <div className="a-head">
        <div><h1>ตารางคลาส</h1><p>{fmtDay(dayStart(week))} – {fmtDay(dayStart(addDays(week, 6)))}</p></div>
        <div className="row wrap">
          <button className="btn btn-s" onClick={() => setWeek(addDays(week, -7))}>สัปดาห์ก่อน</button>
          <button className="btn btn-s" onClick={() => setWeek(mondayOf(today))}>สัปดาห์นี้</button>
          <button className="btn btn-s" onClick={() => setWeek(addDays(week, 7))}>สัปดาห์หน้า</button>
          <button className="btn btn-s" onClick={generate}>สร้างจากตารางประจำ</button>
          <button className="btn btn-s btn-primary" onClick={() => setCreating(week >= today ? week : today)}>เพิ่มรอบคลาส</button>
        </div>
      </div>

      <div className="week">
        {days.map((d) => {
          const list = (data?.sessions ?? []).filter((s) => localDate(new Date(s.starts_at)) === d);
          return (
            <div key={d} className="week-day">
              <h3 className={d === today ? 'today' : ''}>{fmtDay(dayStart(d))}</h3>
              {list.map((s) => {
                const a = data!.avail.get(s.id);
                return (
                  <button key={s.id} className="wk-item" style={{ ['--c' as string]: s.class_types.color }} onClick={() => nav(`/admin/sessions/${s.id}`)}>
                    <span className="num">{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
                    <b>{s.class_types.name}</b>
                    <span className="faint">{s.rooms.name}{s.instructors ? ` · ${s.instructors.name}` : ''}</span>
                    <span className="faint num">{a ? `${a.booked}/${a.capacity}` : ''}{a?.waiting ? ` · รอ ${a.waiting}` : ''}</span>
                  </button>
                );
              })}
              <button className="btn btn-quiet btn-s" onClick={() => setCreating(d)}>+ เพิ่ม</button>
            </div>
          );
        })}
      </div>

      {catalog.data && (
        <CreateSession
          date={creating} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); void reload(); }}
          {...catalog.data}
        />
      )}
    </div>
  );
}

function CreateSession({ date, onClose, onCreated, classes, rooms, layouts, instructors }: {
  date: string | null; onClose: () => void; onCreated: () => void;
  classes: ClassType[]; rooms: Room[]; layouts: Layout[]; instructors: Instructor[];
}) {
  const toast = useToast();
  const [classId, setClassId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [layoutId, setLayoutId] = useState('');
  const [instructorId, setInstructorId] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);

  const ct = classes.find((c) => c.id === classId);
  const roomLayouts = layouts.filter((l) => l.room_id === roomId);

  function pickClass(id: string) {
    setClassId(id);
    const c = classes.find((x) => x.id === id);
    if (c?.default_room_id) setRoomId(c.default_room_id);
    setLayoutId(c?.default_layout_id ?? '');
    setDuration(String(c?.duration_minutes ?? ''));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await rpc<Session>('create_session', {
        p_class_type_id: classId, p_room_id: roomId, p_layout_id: layoutId || null, p_instructor_id: instructorId || null,
        p_starts_at: new Date(`${day || date}T${time}:00+07:00`).toISOString(),
        p_duration_minutes: duration ? Number(duration) : null, p_capacity: capacity ? Number(capacity) : null,
      });
      toast(`เพิ่ม ${ct?.name} ${fmtDay(s.starts_at)} ${fmtTime(s.starts_at)} แล้ว`);
      onCreated();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!date} onClose={onClose} title="เพิ่มรอบคลาส">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>คลาส</span>
          <select className="select" value={classId} onChange={(e) => pickClass(e.target.value)} required>
            <option value="">เลือกคลาส</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="form-grid">
          <label className="field"><span>วันที่</span><input className="input" type="date" value={day || date || ''} onChange={(e) => setDay(e.target.value)} required /></label>
          <label className="field"><span>เวลาเริ่ม</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
          <label className="field"><span>ความยาว (นาที)</span><input className="input" type="number" min={10} value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        </div>
        <div className="form-grid">
          <label className="field"><span>ห้อง</span>
            <select className="select" value={roomId} onChange={(e) => { setRoomId(e.target.value); setLayoutId(''); }} required>
              <option value="">เลือกห้อง</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="field"><span>ผังอุปกรณ์</span>
            <select className="select" value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              <option value="">ไม่ใช้ผัง (จองเป็นคน)</option>
              {roomLayouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="field"><span>ครู</span>
            <select className="select" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
              <option value="">ยังไม่ระบุ</option>
              {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className="field"><span>จำกัดจำนวนคน</span>
            <input className="input" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder={layoutId ? 'ตามจำนวนเครื่อง' : '1'} />
          </label>
        </div>
        <button className="btn btn-primary" disabled={busy}>เพิ่มรอบคลาส</button>
      </form>
    </Sheet>
  );
}
