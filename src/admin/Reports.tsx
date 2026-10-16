import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { downloadCsv } from '../lib/csv';
import { errorText } from '../lib/errors';
import { addDays, fmtMoney, localDate, weekdayShort } from '../lib/format';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Layout } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { SpotMap } from '../ui/SpotMap';
import { useToast } from '../ui/Toast';
import type { Summary } from './Dashboard';

type HeatRow = { weekday: number; hour: number; sessions: number; capacity: number; booked: number; waitlisted: number };
type SpotHeat = { spot_id: string; label: string; x: number; y: number; bookings: number; first_pick: number };
type InstructorRow = { instructor_id: string; name: string; sessions: number; fill_rate: number | null; attendees: number; returning_rate: number | null };

const presets = [
  { id: '7', label: '7 วัน', from: () => addDays(localDate(), -6), to: () => localDate() },
  { id: '30', label: '30 วัน', from: () => addDays(localDate(), -29), to: () => localDate() },
  { id: 'month', label: 'เดือนนี้', from: () => `${localDate().slice(0, 8)}01`, to: () => localDate() },
  { id: 'next7', label: '7 วันข้างหน้า', from: () => localDate(), to: () => addDays(localDate(), 6) },
];

export function Reports() {
  const { branch } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(presets[1].from());
  const [to, setTo] = useState(presets[1].to());
  const [layoutId, setLayoutId] = useState('');
  const args = { p_branch_id: branch?.id, p_from: from, p_to: to };

  const { data, error } = useLoad(async () => {
    const [summary, heat, instructors, layouts] = await Promise.all([
      rpc<Summary>('report_summary', args),
      rpc<HeatRow[]>('report_fill_heatmap', args),
      rpc<InstructorRow[]>('report_instructors', args),
      rows<Layout>(supabase.from('layouts').select('*').eq('active', true).order('name')),
    ]);
    return { summary, heat, instructors, layouts };
  }, [branch?.id, from, to]);

  const layout = data?.layouts.find((l) => l.id === (layoutId || data.layouts[0]?.id));
  const spots = useLoad(async () => (layout ? rpc<SpotHeat[]>('report_spot_heatmap', { p_layout_id: layout.id, p_from: from, p_to: to }) : []), [layout?.id, from, to]);

  async function exportReport(kind: 'sessions' | 'sales') {
    try {
      const r = await rpc<Record<string, unknown>[]>(`report_${kind}`, args);
      if (!r.length) { toast('ไม่มีข้อมูลในช่วงนี้', 'error'); return; }
      downloadCsv(`${kind}-${from}-to-${to}.csv`, r);
    } catch (e) { toast(errorText(e), 'error'); }
  }

  const s = data?.summary;
  const hours = [...new Set((data?.heat ?? []).map((h) => h.hour))].sort((a, b) => a - b);
  const cell = (wd: number, h: number) => data?.heat.find((x) => x.weekday === wd && x.hour === h);
  const maxPick = Math.max(1, ...(spots.data ?? []).map((x) => x.bookings));

  return (
    <div className="stack-l">
      <div className="a-head">
        <div><h1>รายงาน</h1><p>ทุกตารางส่งออกเป็น CSV เปิดใน Excel ได้</p></div>
        <div className="row wrap">
          <div className="seg">{presets.map((p) => <button key={p.id} aria-pressed={from === p.from() && to === p.to()} onClick={() => { setFrom(p.from()); setTo(p.to()); }}>{p.label}</button>)}</div>
          <input className="input" type="date" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="ตั้งแต่" />
          <input className="input" type="date" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึง" />
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}

      {s && (
        <div className="kpis">
          <div className="kpi"><span className="k">ยอดขาย</span><span className="v">{fmtMoney(s.sales.total)}</span><span className="d">แพ็กเกจ {fmtMoney(s.sales.packages)} · สินค้า {fmtMoney(s.sales.products)}</span></div>
          <div className="kpi"><span className="k">ความเต็มห้องเฉลี่ย</span><span className="v">{s.fill_rate}%</span><span className="d">{s.sessions} รอบ · {s.capacity} ที่</span></div>
          <div className="kpi"><span className="k">การจอง</span><span className="v">{s.bookings.active + s.bookings.no_show}</span><span className="d">เช็คอิน {s.bookings.checked_in} · ไม่มา {s.bookings.no_show}</span></div>
          <div className="kpi"><span className="k">ยกเลิก</span><span className="v">{s.bookings.cancelled + s.bookings.late_cancel}</span><span className="d">ทันเวลา {s.bookings.cancelled} · ช้า {s.bookings.late_cancel}</span></div>
          <div className="kpi"><span className="k">Waitlist</span><span className="v">{s.waitlist.joined}</span><span className="d">ได้เข้าเรียน {s.waitlist.promoted} · หลุด {s.waitlist.unserved}</span></div>
          <div className="kpi"><span className="k">เครดิตค้างในระบบ</span><span className="v">{s.credits.outstanding}</span><span className="d">มูลค่า {fmtMoney(s.credits.outstanding_value)} · หมดใน 30 วัน {s.credits.expiring_30d}</span></div>
          <div className="kpi"><span className="k">ทดลอง → ซื้อต่อ</span><span className="v">{s.trial.trials ? `${Math.round((s.trial.converted / s.trial.trials) * 100)}%` : '–'}</span><span className="d">{s.trial.converted} จาก {s.trial.trials} คน</span></div>
          <div className="kpi"><span className="k">สมาชิกใหม่</span><span className="v">{s.members.new}</span><span className="d">เสี่ยงหาย {s.members.at_risk} คน</span></div>
        </div>
      )}

      <div className="row wrap">
        <button className="btn btn-s" onClick={() => exportReport('sessions')}>ส่งออกการจองรายรอบ (CSV)</button>
        <button className="btn btn-s" onClick={() => exportReport('sales')}>ส่งออกการขายรายบิล (CSV)</button>
        <button className="btn btn-s" disabled={!data?.instructors.length} onClick={() => downloadCsv(`instructors-${from}-to-${to}.csv`, data!.instructors)}>ส่งออกรายงานครู (CSV)</button>
      </div>

      <section className="panel stack">
        <div><h2>ความเต็มตามวันและเวลา</h2><p className="faint">เข้มคือเต็ม ตัวเลขคือ % ที่จอง ช่องที่มีคนรอแปลว่าเปิดรอบเพิ่มแล้วขายได้</p></div>
        {hours.length === 0 ? <p className="muted">ไม่มีคลาสในช่วงนี้</p> : (
          <div style={{ overflowX: 'auto' }}>
            <div className="heat" style={{ ['--hours' as string]: hours.length, minWidth: hours.length * 30 + 40 }}>
              <div className="heat-row"><span />{hours.map((h) => <span key={h} className="faint center">{String(h).padStart(2, '0')}</span>)}</div>
              {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                <div key={wd} className="heat-row">
                  <b>{weekdayShort[wd]}</b>
                  {hours.map((h) => {
                    const c = cell(wd, h);
                    if (!c || !c.capacity) return <span key={h} className="heat-cell none" />;
                    const v = c.booked / c.capacity;
                    return (
                      <span key={h} className={`heat-cell${v > 0.6 ? ' hot' : ''}`} style={{ ['--v' as string]: v }}
                        title={`${weekdayShort[wd]} ${h}:00 · ${c.sessions} รอบ · จอง ${c.booked}/${c.capacity}${c.waitlisted ? ` · รอ ${c.waitlisted}` : ''}`}>
                        {Math.round(v * 100)}{c.waitlisted ? '+' : ''}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="cols-2">
        <section className="panel stack">
          <div className="row-between">
            <div><h2>ตำแหน่งยอดนิยม</h2><p className="faint">ยิ่งชมพูยิ่งถูกจองบ่อย ใช้จัดผังหรือตั้งราคาตำแหน่งพิเศษ</p></div>
            <select className="select" style={{ width: 'auto' }} value={layout?.id ?? ''} onChange={(e) => setLayoutId(e.target.value)} aria-label="ผัง">
              {data?.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {layout && spots.data && (
            <SpotMap cols={layout.cols} rows={layout.rows} fixtures={layout.fixtures ?? []} equipment={layout.equipment} showHeat
              spots={spots.data.map((x) => ({ id: x.spot_id, label: x.label, x: x.x, y: x.y, heat: x.bookings / maxPick }))} />
          )}
          {spots.data && spots.data.length > 0 && (
            <p className="faint">ถูกเลือกเป็นที่แรกบ่อยสุด: {[...spots.data].sort((a, b) => b.first_pick - a.first_pick).slice(0, 3).filter((x) => x.first_pick).map((x) => `${x.label} (${x.first_pick})`).join(', ') || '–'}</p>
          )}
        </section>
        <section className="stack">
          <h2>ครู</h2>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>ครู</th><th className="n">รอบ</th><th className="n">เต็ม %</th><th className="n">คน</th><th className="n">กลับมาซ้ำ %</th></tr></thead>
              <tbody>
                {data?.instructors.map((i) => (
                  <tr key={i.instructor_id}><td>{i.name}</td><td className="n">{i.sessions}</td><td className="n">{i.fill_rate ?? '–'}</td><td className="n">{i.attendees}</td><td className="n">{i.returning_rate ?? '–'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
