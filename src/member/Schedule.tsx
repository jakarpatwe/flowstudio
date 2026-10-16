import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { addDays, dayStart, fmtTime, localDate, weekdayShort } from '../lib/format';
import { loadAvailability, loadSessions } from '../lib/queries';
import { useLoad } from '../lib/useLoad';

const DAYS = 14;

export function Schedule() {
  const { branch } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = localDate();
  const day = params.get('day') ?? today;
  const classFilter = params.get('class');

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);

  const { data, loading, error } = useLoad(async () => {
    const from = dayStart(day);
    const to = dayStart(addDays(day, 1));
    const [sessions, avail] = await Promise.all([loadSessions(from, to, branch?.id), loadAvailability(from, to, branch?.id)]);
    return { sessions, avail };
  }, [day, branch?.id]);

  const classes = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    data?.sessions.forEach((s) => m.set(s.class_type_id, { id: s.class_type_id, name: s.class_types.name, color: s.class_types.color }));
    return [...m.values()];
  }, [data]);

  const list = (data?.sessions ?? []).filter((s) => !classFilter || s.class_type_id === classFilter);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };

  return (
    <div className="stack">
      <h1>ตารางคลาส</h1>

      <div className="days" role="group" aria-label="เลือกวัน">
        {days.map((d) => {
          const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
          return (
            <button key={d} className="day" aria-pressed={d === day} onClick={() => set('day', d)}>
              <small>{d === today ? 'วันนี้' : weekdayShort[wd]}</small>
              <b className="num">{Number(d.slice(8))}</b>
            </button>
          );
        })}
      </div>

      {classes.length > 1 && (
        <div className="filters" role="group" aria-label="กรองตามคลาส">
          <button className="filter" aria-pressed={!classFilter} onClick={() => set('class', null)}>ทั้งหมด</button>
          {classes.map((c) => (
            <button key={c.id} className="filter" aria-pressed={classFilter === c.id} onClick={() => set('class', c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {loading && !data ? (
        <div className="stack"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
      ) : list.length === 0 ? (
        <div className="panel empty">
          <p>วันนี้ไม่มีคลาส{classFilter ? 'นี้' : ''}</p>
          <button className="btn" onClick={() => set('day', addDays(day, 1))}>ดูวันถัดไป</button>
        </div>
      ) : (
        <ul className="timetable">
          {list.map((s) => {
            const a = data!.avail.get(s.id);
            const left = a ? a.capacity - a.booked : 0;
            const full = a ? left <= 0 : false;
            const past = new Date(s.starts_at) <= new Date();
            const pct = a && a.capacity ? Math.min(100, (a.booked / a.capacity) * 100) : 0;
            return (
              <li key={s.id}>
                <Link to={`/session/${s.id}`} className={`slot${past ? ' slot-past' : ''}`} style={{ ['--c' as string]: s.class_types.color }}>
                  <div className="t num">{fmtTime(s.starts_at)}<small>ถึง {fmtTime(s.ends_at)}</small></div>
                  <div className="grow">
                    <div className="name">{s.class_types.name}</div>
                    <div className="meta">{s.instructors?.name ?? 'ยังไม่ระบุครู'} · {s.rooms.name}</div>
                  </div>
                  <div className="left">
                    {a?.my_booking_id ? (
                      <span className="chip chip-you">{a.my_spot_label ? `ตำแหน่ง ${a.my_spot_label}` : 'จองแล้ว'}</span>
                    ) : a?.on_waitlist ? (
                      <span className="chip chip-warn">อยู่ในคิวรอ</span>
                    ) : full ? (
                      <><b>เต็ม</b><span className="faint">{a!.waiting ? `รอ ${a!.waiting} คน` : 'เข้าคิวรอได้'}</span></>
                    ) : (
                      <><b className="num">{left}</b><span className="faint">ที่ว่าง</span></>
                    )}
                  </div>
                  <span className="fill" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
