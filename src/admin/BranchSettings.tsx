import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { rpc } from '../lib/supabase';
import { useToast } from '../ui/Toast';

/** Name, address and PromptPay number of the current branch ("branch" section). */
export function BranchSettings() {
  const { branch, refreshProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [promptpay, setPromptpay] = useState(branch?.promptpay_id ?? '');
  const [busy, setBusy] = useState(false);

  if (!branch) return <div className="empty"><p>ยังไม่มีสาขาในระบบ</p></div>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('update_branch', { p_id: branch!.id, p_name: name, p_address: address, p_promptpay_id: promptpay });
      await refreshProfile();
      toast('บันทึกข้อมูลสาขาแล้ว');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="stack-l" style={{ maxWidth: 560 }}>
      <div className="a-head"><div><h1>ตั้งค่าสาขา</h1><p>ชื่อสาขาแสดงที่แถบเมนูหลังร้านและในหน้าของสมาชิก</p></div></div>
      <form className="panel stack" onSubmit={save}>
        <label className="field"><span>ชื่อสาขา</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="เช่น FLOW Central World" /></label>
        <label className="field"><span>ที่อยู่</span><textarea className="textarea" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="field"><span>เบอร์หรือเลขผู้เสียภาษีสำหรับ PromptPay (ใช้สร้าง QR รับเงิน)</span>
          <input className="input" inputMode="numeric" value={promptpay} onChange={(e) => setPromptpay(e.target.value)} placeholder="0812345678" />
        </label>
        <button className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={busy}>บันทึกข้อมูลสาขา</button>
      </form>
    </div>
  );
}
