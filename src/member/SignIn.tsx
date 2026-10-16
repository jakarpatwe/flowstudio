import { Logo } from '../ui/Logo';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/version';
import { loginEmail } from '../lib/permissions';

/** Members normally arrive signed in through LINE. This screen covers staff on a computer,
 *  development without LIFF, and the rare LINE failure. */
export function SignIn() {
  const { usesLine, lineError } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'ชื่อผู้ใช้ อีเมล หรือรหัสผ่านไม่ถูกต้อง' : error.message);
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw error;
        if (!data.session) setNotice('สร้างบัญชีแล้ว เปิดอีเมลเพื่อยืนยันก่อนเข้าสู่ระบบ');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <Logo />
        <div className="stack" style={{ gap: 6 }}>
          <h1>{mode === 'in' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</h1>
          <p className="muted">
            {usesLine ? 'สมาชิกเปิดผ่าน LINE ของสตูดิโอได้เลย หน้านี้สำหรับพนักงาน' : 'ใช้อีเมลระหว่างทดสอบระบบ ก่อนเปิดใช้ LINE'}
          </p>
          {lineError && <p className="error-text">{errorText(lineError)}</p>}
        </div>
        {mode === 'up' && (
          <label className="field"><span>ชื่อที่ใช้ในสตูดิโอ</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="field"><span>{mode === 'in' ? 'ชื่อผู้ใช้หรืออีเมล' : 'อีเมล'}</span>
          <input className="input" type={mode === 'in' ? 'text' : 'email'} value={email} onChange={(e) => setEmail(e.target.value)} required
            autoComplete={mode === 'in' ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} />
        </label>
        <label className="field"><span>รหัสผ่าน</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        {notice && <p className="muted" role="status">{notice}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{mode === 'in' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'ยังไม่มีบัญชี สร้างบัญชีใหม่' : 'มีบัญชีแล้ว เข้าสู่ระบบ'}
        </button>
        <p className="faint center num">เวอร์ชัน {APP_VERSION}</p>
      </form>
    </div>
  );
}
