import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { addDays, dayStart, fmtMoney, fmtTime, localDate } from '../lib/format';
import { loadAvailability, loadSessions } from '../lib/queries';
import { rpc } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { useToast } from '../ui/Toast';

export interface Summary {
  sales: { total: number; count: number; by_method: Record<string, number>; packages: number; products: number; pending_online: number };
  sessions: number; capacity: number; fill_rate: number;
  bookings: { active: number; checked_in: number; cancelled: number; late_cancel: number; no_show: number };
  waitlist: { joined: number; promoted: number; unserved: number };
  credits: { outstanding: number; outstanding_value: number; expiring_30d: number };
  members: { new: number; at_risk: number };
  trial: { trials: number; converted: number };
}

export function Dashboard() {
  const { branch } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const today = localDate();
  const [code, setCode] = useState('');

  const { data, reload } = useLoad(async () => {
    const from = dayStart(today), to = dayStart(addDays(today, 2));
    const [summary, sessions, avail] = await Promise.all([
      rpc<Summary>('report_summary', { p_branch_id: branch!.id, p_from: today, p_to: today }),
      loadSessions(from, to, branch!.id),
      loadAvailability(from, to, branch!.id),
    ]);
    return { summary, sessions, avail };
  }, [branch?.id, today]);

  async function checkIn(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await rpc<{ name: string; booking: string | null; class?: string; spot?: string | null; starts_at?: string }>('check_in_by_code', { p_code: code });
      toast(r.booking ? `เช็คอิน ${r.name} · ${r.class} ${fmtTime(r.starts_at!)}${r.spot ? ` ตำแหน่ง ${r.spot}` : ''}` : `${r.name} ไม่มีคลาสที่จองไว้ในช่วงนี้`, r.booking ? 'ok' : 'error');
      setCode('');
      void reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const s = data?.summary;
  const todays = (data?.sessions ?? []).filter((x) => localDate(new Date(x.starts_at)) === today);
  const tomorrowQuiet = (data?.sessions ?? []).filter((x) => {
    const a = data!.avail.get(x.id);
    return localDate(new Date(x.starts_at)) !== today && a && a.capacity > 1 && a.booked / a.capacity < 0.5;
  });

  return (
    <div className="stack-l">
      <div className="a-head">
        <div><h1>วันนี้</h1><p>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'full', timeZone: 'Asia/Bangkok' }).format(new Date())}</p></div>
        <form className="row" onSubmit={checkIn}>
          <input className="input" style={{ width: 240 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="สแกน QR หรือพิมพ์รหัสเช็คอิน" aria-label="รหัสเช็คอิน" autoFocus />
          <button className="btn btn-primary" disabled={!code.trim()}>เช็คอิน</button>
        </form>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="k">ยอดขายวันนี้</span><span className="v">{s ? fmtMoney(s.sales.total) : '–'}</span><span className="d">{s?.sales.count ?? 0} บิล</span></div>
        <div className="kpi"><span className="k">ความเต็มห้อง</span><span className="v">{s ? `${s.fill_rate}%` : '–'}</span><span className="d">{s?.bookings.active ?? 0} จอง จาก {s?.capacity ?? 0} ที่</span></div>
        <div className="kpi"><span className="k">เช็คอินแล้ว</span><span className="v">{s?.bookings.checked_in ?? '–'}</span><span className="d">ไม่มา {s?.bookings.no_show ?? 0} · ยกเลิกช้า {s?.bookings.late_cancel ?? 0}</span></div>
        <Link to="/admin/pos" className="kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="k">รอยืนยันโอน</span><span className="v" style={{ color: s?.sales.pending_online ? 'var(--pulse)' : undefined }}>{s?.sales.pending_online ?? '–'}</span><span className="d">คำสั่งซื้อออนไลน์</span>
        </Link>
        <Link to="/admin/members?view=risk" className="kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="k">สมาชิกเสี่ยงหาย</span><span className="v">{s?.members.at_risk ?? '–'}</span><span className="d">มีเครดิตแต่ไม่มา 14 วัน</span>
        </Link>
      </div>

      <div className="cols-side">
        <section className="stack">
          <h2>คลาสวันนี้</h2>
          {todays.length === 0 ? <div className="panel empty"><p>วันนี้ไม่มีคลาส</p><Link className="btn" to="/admin/timetable">ไปที่ตารางคลาส</Link></div> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>เวลา</th><th>คลาส</th><th>ห้อง</th><th>ครู</th><th className="n">จอง</th><th className="n">รอ</th></tr></thead>
                <tbody>
                  {todays.map((x) => {
                    const a = data!.avail.get(x.id);
                    return (
                      <tr key={x.id} className="clickable" onClick={() => nav(`/admin/sessions/${x.id}`)}>
                        <td className="num">{fmtTime(x.starts_at)}</td>
                        <td><Link to={`/admin/sessions/${x.id}`}>{x.class_types.name}</Link></td>
                        <td>{x.rooms.name}</td>
                        <td>{x.instructors?.name ?? '–'}</td>
                        <td className="n">{a ? `${a.booked}/${a.capacity}` : '–'}</td>
                        <td className="n">{a?.waiting || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel stack">
          <h2>พรุ่งนี้ยังว่างเกินครึ่ง</h2>
          {tomorrowQuiet.length === 0 ? <p className="muted">ทุกคลาสพรุ่งนี้จองเกินครึ่งแล้ว</p> : tomorrowQuiet.map((x) => {
            const a = data!.avail.get(x.id)!;
            return (
              <div key={x.id} className="row-between">
                <Link to={`/admin/sessions/${x.id}`}>{fmtTime(x.starts_at)} {x.class_types.name}</Link>
                <span className="faint num">{a.booked}/{a.capacity}</span>
              </div>
            );
          })}
          {tomorrowQuiet.length > 0 && <p className="faint">ลองส่งโปรหรือแจ้งสมาชิกที่เคยเรียนคลาสนี้</p>}
        </section>
      </div>
    </div>
  );
}
