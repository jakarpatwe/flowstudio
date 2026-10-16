import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { fmtDate, fmtDateTime } from '../lib/format';
import { loadWallet } from '../lib/queries';
import { rows, rpc, supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { Qr } from '../ui/Qr';
import { useToast } from '../ui/Toast';

const reasonText: Record<string, string> = {
  purchase: 'ซื้อแพ็กเกจ', booking: 'จองคลาส', refund: 'คืนจากการยกเลิก', session_cancelled: 'คลาสถูกยกเลิก',
  adjust: 'ปรับโดยสตูดิโอ', import: 'ยอดยกมาจากระบบเดิม', void: 'ยกเลิกบิล',
};

export function ProfilePage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [birthday, setBirthday] = useState(profile?.birthday ?? '');
  const [emergency, setEmergency] = useState(profile?.emergency_contact ?? '');
  const [consent, setConsent] = useState(!!profile?.pdpa_consent_at);
  const [busy, setBusy] = useState(false);

  const { data } = useLoad(async () => {
    const [wallet, ledger] = await Promise.all([
      loadWallet(),
      rows<{ id: number; delta: number; reason: string; created_at: string; note: string | null }>(
        supabase.from('credit_ledger').select('id, delta, reason, created_at, note').eq('member_id', profile!.id)
          .order('created_at', { ascending: false }).limit(50)),
    ]);
    return { wallet, ledger };
  }, [profile?.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('update_my_profile', {
        p_display_name: name, p_phone: phone, p_birthday: birthday || null, p_emergency_contact: emergency, p_pdpa_consent: consent,
      });
      await refreshProfile();
      toast('บันทึกข้อมูลแล้ว');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-l">
      <h1>โปรไฟล์ของฉัน</h1>

      <section className="panel row" style={{ gap: 18 }}>
        <Qr value={profile!.checkin_code} size={120} label="QR สำหรับเช็คอิน" />
        <div className="stack" style={{ gap: 4 }}>
          <b>QR เช็คอิน</b>
          <span className="muted">ให้พนักงานสแกนตอนมาถึง</span>
          <span className="faint num">รหัส {profile!.checkin_code}</span>
        </div>
      </section>

      <form className="panel stack" onSubmit={save}>
        <label className="field"><span>ชื่อ</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>เบอร์โทร</span><input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span>วันเกิด</span><input className="input" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></label>
        <label className="field"><span>ผู้ติดต่อกรณีฉุกเฉิน</span><input className="input" value={emergency} onChange={(e) => setEmergency(e.target.value)} placeholder="ชื่อและเบอร์" /></label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>ยินยอมให้สตูดิโอเก็บและใช้ข้อมูลนี้เพื่อการจองคลาสและติดต่อกลับ ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล</span>
        </label>
        <button className="btn btn-primary" disabled={busy}>บันทึกข้อมูล</button>
      </form>

      {data && (
        <section className="panel stack">
          <h2>เครดิต</h2>
          {data.wallet.lots.length === 0 ? <p className="muted">ยังไม่มีเครดิตที่ใช้ได้</p> : data.wallet.lots.map((l) => (
            <div key={l.id} className="row-between">
              <span>{l.remaining} จาก {l.total} เครดิต{l.vip ? ' · VIP' : ''}</span>
              <span className="faint">หมดอายุ {fmtDate(l.expires_at)}</span>
            </div>
          ))}
          <hr className="divider" />
          <h3>ความเคลื่อนไหว</h3>
          {data.ledger.map((r) => (
            <div key={r.id} className="row-between">
              <div>
                <div>{reasonText[r.reason] ?? r.reason}</div>
                <div className="faint">{fmtDateTime(r.created_at)}{r.note ? ` · ${r.note}` : ''}</div>
              </div>
              <b className="num" style={{ color: r.delta > 0 ? 'var(--ok)' : 'var(--ink)' }}>{r.delta > 0 ? `+${r.delta}` : r.delta}</b>
            </div>
          ))}
        </section>
      )}

      <button className="btn btn-quiet" onClick={() => void signOut()}>ออกจากระบบ</button>
    </div>
  );
}
