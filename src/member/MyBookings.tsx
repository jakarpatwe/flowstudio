import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtDay, fmtTime } from '../lib/format';
import { SESSION_SELECT } from '../lib/queries';
import { rows, supabase } from '../lib/supabase';
import type { Booking, BookingStatus, SessionRow } from '../lib/types';
import { useLoad } from '../lib/useLoad';

type Row = Booking & { sessions: SessionRow; layout_spots: { label: string } | null };
type Wait = { id: string; status: string; created_at: string; sessions: SessionRow };

const statusChip: Record<BookingStatus, [string, string]> = {
  booked: ['จองแล้ว', 'chip-bounce'],
  checked_in: ['เข้าคลาสแล้ว', 'chip-ok'],
  cancelled: ['ยกเลิก คืนเครดิต', ''],
  late_cancel: ['ยกเลิกช้า', 'chip-warn'],
  no_show: ['ไม่มาเรียน', 'chip-bad'],
};

export function MyBookings() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<'upcoming' | 'waitlist' | 'history'>('upcoming');

  const { data, loading } = useLoad(async () => {
    const [bookings, waits] = await Promise.all([
      rows<Row>(supabase.from('bookings').select(`*, layout_spots(label), sessions(${SESSION_SELECT})`)
        .eq('member_id', profile!.id).order('created_at', { ascending: false }).limit(200)),
      rows<Wait>(supabase.from('waitlist').select(`id, status, created_at, sessions(${SESSION_SELECT})`)
        .eq('member_id', profile!.id).eq('status', 'waiting')),
    ]);
    return { bookings, waits };
  }, [profile?.id]);

  const now = Date.now();
  const upcoming = (data?.bookings ?? [])
    .filter((b) => ['booked', 'checked_in'].includes(b.status) && new Date(b.sessions.ends_at).getTime() > now)
    .sort((a, b) => a.sessions.starts_at.localeCompare(b.sessions.starts_at));
  const history = (data?.bookings ?? [])
    .filter((b) => !upcoming.includes(b))
    .sort((a, b) => b.sessions.starts_at.localeCompare(a.sessions.starts_at));
  const waits = (data?.waits ?? []).filter((w) => new Date(w.sessions.starts_at).getTime() > now);

  const list = tab === 'upcoming' ? upcoming : tab === 'history' ? history : [];

  return (
    <div className="stack">
      <h1>การจองของฉัน</h1>
      <div className="seg" role="group" aria-label="ประเภท">
        <button aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>กำลังจะถึง {upcoming.length ? `(${upcoming.length})` : ''}</button>
        <button aria-pressed={tab === 'waitlist'} onClick={() => setTab('waitlist')}>คิวรอ {waits.length ? `(${waits.length})` : ''}</button>
        <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>ประวัติ</button>
      </div>

      {loading && !data ? <div className="skeleton" style={{ minHeight: 200 }} /> : (
        <div className="panel">
          {tab === 'waitlist' ? (
            waits.length === 0 ? <div className="empty"><p>ไม่ได้อยู่ในคิวรอคลาสไหน</p></div> : waits.map((w) => (
              <Link key={w.id} to={`/session/${w.sessions.id}`} className="booking-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <b>{w.sessions.class_types.name}</b>
                  <div className="faint">{fmtDay(w.sessions.starts_at)} {fmtTime(w.sessions.starts_at)} · {w.sessions.rooms.name}</div>
                </div>
                <span className="chip chip-warn">รอที่ว่าง</span>
              </Link>
            ))
          ) : list.length === 0 ? (
            <div className="empty">
              <p>{tab === 'upcoming' ? 'ยังไม่มีคลาสที่จองไว้' : 'ยังไม่มีประวัติ'}</p>
              {tab === 'upcoming' && <Link className="btn btn-primary" to="/schedule">ดูตารางคลาส</Link>}
            </div>
          ) : list.map((b) => {
            const [label, cls] = statusChip[b.status];
            return (
              <Link key={b.id} to={`/session/${b.session_id}`} className="booking-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <b>{b.sessions.class_types.name}</b>
                  <div className="faint">
                    {fmtDay(b.sessions.starts_at)} {fmtTime(b.sessions.starts_at)} · {b.sessions.rooms.name}
                    {b.layout_spots ? ` · ตำแหน่ง ${b.layout_spots.label}` : ''}
                  </div>
                </div>
                <span className={`chip ${cls}`}>{label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
