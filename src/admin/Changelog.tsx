import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { APP_VERSION, CHANGELOG, type ChangeKind } from '../lib/version';

const kindText: Record<ChangeKind, string> = { major: 'เปลี่ยนใหญ่', minor: 'ฟีเจอร์ใหม่', patch: 'แก้ไข' };
const kindChip: Record<ChangeKind, string> = { major: 'chip chip-bad', minor: 'chip chip-bounce', patch: 'chip' };

/** Stays unlocked until the page is reloaded, so moving around the admin doesn't ask again. */
let unlocked = false;

/** Change log ("changelog" section). People re-enter their own password before it opens. */
export function Changelog() {
  const { session } = useAuth();
  const [open, setOpen] = useState(unlocked);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = session?.user.email;

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setError('รหัสผ่านไม่ถูกต้อง'); return; }
    unlocked = true;
    setPassword('');
    setOpen(true);
  }

  if (!open) {
    return (
      <div className="stack-l" style={{ maxWidth: 420 }}>
        <div className="a-head"><div><h1>บันทึกการเปลี่ยนแปลง</h1><p>ใส่รหัสผ่านของคุณอีกครั้งเพื่อเปิดดู</p></div></div>
        {email ? (
          <form className="panel stack" onSubmit={unlock}>
            <label className="field"><span>รหัสผ่านของ {email}</span>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required autoComplete="current-password" autoFocus />
            </label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="btn btn-primary" disabled={busy || !password}>เปิดบันทึกการเปลี่ยนแปลง</button>
          </form>
        ) : (
          <p className="muted">บัญชีนี้เข้าสู่ระบบผ่าน LINE จึงไม่มีรหัสผ่าน ให้เข้าหลังร้านด้วยบัญชีอีเมลแทน</p>
        )}
      </div>
    );
  }

  return (
    <div className="stack-l" style={{ maxWidth: 720 }}>
      <div className="a-head">
        <div><h1>บันทึกการเปลี่ยนแปลง</h1><p>เวอร์ชันปัจจุบัน {APP_VERSION} · ใหม่สุดอยู่บน</p></div>
      </div>
      {CHANGELOG.map((c) => (
        <section key={c.version} className="panel stack">
          <div className="row-between wrap">
            <div className="row">
              <h2 className="num">{c.version}</h2>
              <span className={kindChip[c.kind]}>{kindText[c.kind]}</span>
              {c.version === APP_VERSION && <span className="chip chip-ok">ใช้อยู่ตอนนี้</span>}
            </div>
            <span className="faint">{fmtDateTime(c.at)}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {c.items.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      ))}
      <p className="faint">
        เลขเวอร์ชันแบบ MAJOR.MINOR.PATCH: ตัวแรกขยับเมื่อเปลี่ยนใหญ่ ตัวกลางเมื่อเพิ่มฟีเจอร์ ตัวท้ายเมื่อแก้ไขหรือปรับเล็กน้อย
      </p>
    </div>
  );
}
