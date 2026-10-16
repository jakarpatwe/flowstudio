import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isManagerRole, useAuth } from '../lib/auth';
import { downloadCsv, parseCsv } from '../lib/csv';
import { errorText } from '../lib/errors';
import { fmtDate, fmtDateTime, fmtTime } from '../lib/format';
import { loadWallet } from '../lib/queries';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Profile, Role } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { useToast } from '../ui/Toast';
import { MemberPicker } from './MemberPicker';

type RiskRow = { member_id: string; display_name: string; phone: string | null; credits: number; last_visit: string | null; next_expiry: string };
type ImportRow = { id: string; external_ref: string | null; display_name: string; phone: string | null; credits: number; vip: boolean; expires_at: string; claimed_by: string | null; claimed_at: string | null };

export function Members() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'search';
  const [selected, setSelected] = useState<Profile | null>(null);
  const setView = (v: string) => setParams({ view: v }, { replace: true });

  return (
    <div className="stack-l">
      <div className="a-head"><div><h1>สมาชิก</h1></div></div>
      <div className="seg" role="group">
        <button aria-pressed={view === 'search'} onClick={() => setView('search')}>ค้นหา</button>
        <button aria-pressed={view === 'risk'} onClick={() => setView('risk')}>เสี่ยงหาย</button>
        <button aria-pressed={view === 'import'} onClick={() => setView('import')}>ย้ายจากระบบเดิม</button>
      </div>
      {view === 'search' && (
        <div className="cols-side" style={{ gridTemplateColumns: '320px minmax(0,1fr)' }}>
          <MemberPicker onPick={setSelected} />
          {selected ? <MemberDetail key={selected.id} member={selected} /> : <div className="panel muted">เลือกสมาชิกเพื่อดูเครดิต การจอง และปรับเครดิต</div>}
        </div>
      )}
      {view === 'risk' && <AtRisk />}
      {view === 'import' && <Imports />}
    </div>
  );
}

function MemberDetail({ member }: { member: Profile }) {
  const { profile: me } = useAuth();
  const toast = useToast();
  const manager = isManagerRole(me);
  const [tags, setTags] = useState(member.tags.join(', '));
  const [note, setNote] = useState(member.staff_note ?? '');
  const [role, setRole] = useState<Role>(member.role);
  const [delta, setDelta] = useState('');
  const [vip, setVip] = useState(false);
  const [reason, setReason] = useState('');

  const { data, reload } = useLoad(async () => {
    const [wallet, bookings, ledger] = await Promise.all([
      loadWallet(member.id),
      rows<{ id: string; status: string; sessions: { starts_at: string; class_types: { name: string } } }>(
        supabase.from('bookings').select('id, status, sessions(starts_at, class_types(name))').eq('member_id', member.id).order('created_at', { ascending: false }).limit(15)),
      rows<{ id: number; delta: number; reason: string; note: string | null; created_at: string }>(
        supabase.from('credit_ledger').select('id, delta, reason, note, created_at').eq('member_id', member.id).order('created_at', { ascending: false }).limit(20)),
    ]);
    return { wallet, bookings, ledger };
  }, [member.id]);

  async function saveInfo() {
    const patch: Record<string, unknown> = { tags: tags.split(',').map((t) => t.trim()).filter(Boolean), staff_note: note || null };
    if (me?.role === 'owner') patch.role = role;
    const { error } = await supabase.from('profiles').update(patch).eq('id', member.id);
    toast(error ? errorText(error.message) : 'บันทึกแล้ว', error ? 'error' : 'ok');
  }

  async function adjust() {
    try {
      await rpc('adjust_credits', { p_member_id: member.id, p_delta: Number(delta), p_note: reason, p_vip: vip });
      toast('ปรับเครดิตแล้ว'); setDelta(''); setReason(''); void reload();
    } catch (e) { toast(errorText(e), 'error'); }
  }

  async function freeze() {
    const days = Number(window.prompt('พักเครดิตกี่วัน (วันหมดอายุเลื่อนออกไปเท่ากัน)', '14'));
    if (!days) return;
    try { await rpc('freeze_credits', { p_member_id: member.id, p_days: days, p_note: 'freeze' }); toast(`พักเครดิต ${days} วันแล้ว`); void reload(); }
    catch (e) { toast(errorText(e), 'error'); }
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row-between">
          <div><h2>{member.display_name}</h2><p className="muted">{member.phone ?? 'ไม่มีเบอร์'} · รหัส {member.checkin_code} · สมัคร {fmtDate(member.created_at)}</p></div>
          <div className="center"><div style={{ fontSize: 34, fontWeight: 700 }} className="num">{data?.wallet.total ?? '–'}</div><div className="faint">เครดิต{data?.wallet.vip ? ` (VIP ${data.wallet.vip})` : ''}</div></div>
        </div>
        {!member.pdpa_consent_at && <span className="chip chip-warn" style={{ justifySelf: 'start' }}>ยังไม่ยินยอม PDPA</span>}
        <div className="form-grid">
          <label className="field"><span>แท็ก (คั่นด้วย ,)</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, trampoline" /></label>
          {me?.role === 'owner' && (
            <label className="field"><span>สิทธิ์</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">สมาชิก</option><option value="instructor">ครู</option><option value="staff">พนักงาน</option>
                <option value="manager">ผู้จัดการ</option><option value="owner">เจ้าของ</option>
              </select>
            </label>
          )}
        </div>
        <label className="field"><span>บันทึกของพนักงาน (สมาชิกไม่เห็น)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn btn-s" style={{ justifySelf: 'start' }} onClick={saveInfo}>บันทึกข้อมูล</button>
      </section>

      {manager && (
        <section className="panel stack">
          <h3>ปรับเครดิต</h3>
          <div className="form-grid">
            <label className="field"><span>จำนวน (+ เพิ่ม / − ลด)</span><input className="input" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} /></label>
            <label className="field"><span>เหตุผล (บันทึกในประวัติ)</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={vip} onChange={(e) => setVip(e.target.checked)} /><span>เป็นเครดิต VIP</span></label>
          <div className="row">
            <button className="btn btn-primary btn-s" disabled={!delta || !reason.trim()} onClick={adjust}>ปรับเครดิต</button>
            <button className="btn btn-s" onClick={freeze}>พักเครดิต (Freeze)</button>
          </div>
        </section>
      )}

      {data && (
        <div className="cols-2">
          <section className="panel stack">
            <h3>ล็อตเครดิต</h3>
            {data.wallet.lots.length === 0 && <p className="faint">ไม่มีเครดิตที่ใช้ได้</p>}
            {data.wallet.lots.map((l) => <div key={l.id} className="row-between"><span>{l.remaining}/{l.total}{l.vip ? ' VIP' : ''} · {l.source}</span><span className="faint">หมด {fmtDate(l.expires_at)}</span></div>)}
            <h3>การจองล่าสุด</h3>
            {data.bookings.map((b) => <div key={b.id} className="row-between"><span>{b.sessions.class_types.name} {fmtDate(b.sessions.starts_at)} {fmtTime(b.sessions.starts_at)}</span><span className="faint">{b.status}</span></div>)}
          </section>
          <section className="panel stack">
            <h3>ความเคลื่อนไหวเครดิต</h3>
            {data.ledger.map((r) => (
              <div key={r.id} className="row-between">
                <span>{r.reason}{r.note ? ` · ${r.note}` : ''}<div className="faint">{fmtDateTime(r.created_at)}</div></span>
                <b className="num">{r.delta > 0 ? `+${r.delta}` : r.delta}</b>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function AtRisk() {
  const { branch } = useAuth();
  const [days, setDays] = useState(14);
  const { data } = useLoad(() => rpc<RiskRow[]>('report_at_risk', { p_branch_id: branch!.id, p_days: days }), [branch?.id, days]);
  return (
    <section className="stack">
      <div className="row-between">
        <p className="muted">มีเครดิตเหลือแต่ไม่ได้จองหรือมาเรียนเลยใน {days} วัน เรียงตามเครดิตที่ใกล้หมดอายุก่อน</p>
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 21, 30, 45].map((d) => <option key={d} value={d}>{d} วัน</option>)}
          </select>
          <button className="btn btn-s" disabled={!data?.length} onClick={() => downloadCsv(`at-risk-${days}d.csv`, data ?? [])}>ส่งออก CSV</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>สมาชิก</th><th>เบอร์</th><th className="n">เครดิต</th><th>มาครั้งล่าสุด</th><th>เครดิตแรกหมดอายุ</th></tr></thead>
          <tbody>
            {data?.length === 0 && <tr><td colSpan={5} className="faint">ไม่มีสมาชิกในกลุ่มนี้</td></tr>}
            {data?.map((r) => (
              <tr key={r.member_id}><td>{r.display_name}</td><td>{r.phone ?? '–'}</td><td className="n">{r.credits}</td>
                <td>{r.last_visit ? fmtDate(r.last_visit) : 'ยังไม่เคยมา'}</td><td>{fmtDate(r.next_expiry)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Moving from Gymmo: paste the member list, then match each person when they first sign in. */
function Imports() {
  const { branch, profile } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [claiming, setClaiming] = useState<ImportRow | null>(null);
  const { data, reload } = useLoad(() => rows<ImportRow>(supabase.from('member_imports').select('*').order('created_at', { ascending: false })), []);

  async function upload() {
    const parsed = parseCsv(text);
    if (!parsed.length) { toast('ไม่พบข้อมูล ตรวจว่าแถวแรกเป็นหัวคอลัมน์', 'error'); return; }
    const recs = parsed.map((r) => ({
      branch_id: branch!.id, external_ref: r.ref || r.id || null, display_name: r.name || r.ชื่อ, phone: (r.phone || r.เบอร์ || '').replace(/\D/g, '') || null,
      credits: Number(r.credits || r.เครดิต || 0), vip: /^(1|y|yes|true|vip)$/i.test(r.vip || ''),
      expires_at: new Date(`${r.expires || r.หมดอายุ}T23:59:59+07:00`).toISOString(),
    }));
    if (recs.some((r) => !r.display_name || isNaN(Date.parse(r.expires_at)))) { toast('มีแถวที่ไม่มีชื่อหรือวันหมดอายุไม่ถูกต้อง (ใช้ YYYY-MM-DD)', 'error'); return; }
    const { error } = await supabase.from('member_imports').insert(recs);
    if (error) { toast(errorText(error.message), 'error'); return; }
    toast(`นำเข้า ${recs.length} รายการ`); setText(''); void reload();
  }

  async function claim(p: Profile) {
    try {
      await rpc('claim_import', { p_import_id: claiming!.id, p_member_id: p.id });
      toast(`โอนเครดิตของ ${claiming!.display_name} เข้าบัญชี ${p.display_name} แล้ว`);
      setClaiming(null); void reload();
    } catch (e) { toast(errorText(e), 'error'); }
  }

  const pending = (data ?? []).filter((r) => !r.claimed_by);
  return (
    <div className="cols-side">
      <section className="stack">
        <h2>รอจับคู่ ({pending.length})</h2>
        <p className="muted">เมื่อสมาชิกเข้าระบบผ่าน LINE ครั้งแรก ค้นหาชื่อหรือเบอร์ เทียบยอดกับหน้าจอระบบเดิม แล้วกดโอนเข้าบัญชี</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>ชื่อ</th><th>เบอร์</th><th className="n">เครดิต</th><th>หมดอายุ</th><th /></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className={claiming?.id === r.id ? 'sel' : ''}>
                  <td>{r.display_name}<div className="faint">{r.external_ref}</div></td><td>{r.phone ?? '–'}</td>
                  <td className="n">{r.credits}{r.vip ? ' VIP' : ''}</td><td>{fmtDate(r.expires_at)}</td>
                  <td className="n"><button className="btn btn-s" onClick={() => setClaiming(r)}>จับคู่</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {claiming && (
          <div className="panel stack">
            <b>โอนเครดิตของ {claiming.display_name} ({claiming.credits}) เข้าบัญชี</b>
            <MemberPicker onPick={claim} placeholder={claiming.phone ? `ลองค้นด้วยเบอร์ ${claiming.phone}` : 'ค้นหาสมาชิก'} />
          </div>
        )}
      </section>
      {isManagerRole(profile) && (
        <section className="panel stack">
          <h3>นำเข้ารายชื่อ (CSV)</h3>
          <p className="faint">หัวคอลัมน์: name, phone, credits, expires (YYYY-MM-DD), vip, ref</p>
          <textarea className="textarea" style={{ minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'name,phone,credits,expires,vip,ref\nสมใจ,0812345678,7,2026-12-31,,G-001'} />
          <button className="btn btn-primary" disabled={!text.trim()} onClick={upload}>นำเข้า</button>
        </section>
      )}
    </div>
  );
}
