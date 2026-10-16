import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { fmtDateTime } from '../lib/format';
import { roleDefaults, roleMax, SECTIONS, type Section } from '../lib/permissions';
import { rpc } from '../lib/supabase';
import type { Role } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

interface UserRow {
  id: string; username: string | null; email: string | null; display_name: string; role: Role;
  permissions: string[] | null; sections: string[]; active: boolean; last_sign_in_at: string | null; created_at: string;
}

const roleText: Record<Role, string> = { owner: 'เจ้าของ', manager: 'ผู้จัดการ', staff: 'พนักงาน', instructor: 'ครู', member: 'สมาชิก' };

/** Role picker: only owners can hand out "owner". */
function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  const { profile } = useAuth();
  const roles: Role[] = profile?.role === 'owner' ? ['staff', 'manager', 'owner', 'instructor', 'member'] : ['staff', 'manager', 'instructor', 'member'];
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Role)} disabled={disabled}>
      {roles.map((r) => <option key={r} value={r}>{roleText[r]}</option>)}
    </select>
  );
}

/** Checkbox per admin section. Sections the role can never have are greyed out. */
function SectionPicker({ role, value, onChange }: { role: Role; value: Section[]; onChange: (v: Section[]) => void }) {
  const max = roleMax(role);
  if (role === 'owner') return <p className="muted">เจ้าของเข้าได้ทุกส่วนเสมอ</p>;
  if (max.length === 0) return <p className="muted">บทบาทนี้ไม่ได้เข้าหลังร้าน</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {SECTIONS.map((s) => {
        const allowed = max.includes(s.id);
        return (
          <label key={s.id} className="check" style={{ opacity: allowed ? 1 : 0.45 }}>
            <input type="checkbox" disabled={!allowed} checked={allowed && value.includes(s.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
            <span>{s.label}{!allowed && <span className="faint"> · ต้องเป็นผู้จัดการขึ้นไป</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

function UserEditor({ user, onSaved }: { user: UserRow; onSaved: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.display_name);
  const [role, setRole] = useState<Role>(user.role);
  const [sections, setSections] = useState<Section[]>(user.sections as Section[]);
  const [active, setActive] = useState(user.active);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const self = user.id === profile?.id;
  const locked = user.role === 'owner' && profile?.role !== 'owner';

  function pickRole(r: Role) {
    setRole(r);
    setSections(roleDefaults(r));
  }

  async function save() {
    setBusy(true);
    try {
      await rpc('admin_update_user', {
        p_id: user.id, p_display_name: name, p_role: role,
        p_permissions: sections.filter((s) => roleMax(role).includes(s)), p_active: active,
      });
      toast('บันทึกสิทธิ์แล้ว');
      if (self) await refreshProfile();
      onSaved();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  }

  async function setNewPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('admin_set_password', { p_id: user.id, p_password: password });
      setPassword('');
      toast('ตั้งรหัสผ่านใหม่แล้ว');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }

  if (locked) return <section className="panel"><p className="muted">บัญชีเจ้าของแก้ได้โดยเจ้าของเท่านั้น</p></section>;

  return (
    <div className="stack">
      <section className="panel stack">
        <div>
          <h2>{user.display_name}</h2>
          <p className="faint">{user.username ? `ชื่อผู้ใช้ ${user.username}` : user.email}</p>
        </div>
        <label className="field"><span>ชื่อที่แสดง</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>บทบาท</span><RoleSelect value={role} onChange={pickRole} disabled={self} /></label>
        <div className="field"><span>ส่วนที่เข้าได้</span><SectionPicker role={role} value={sections} onChange={setSections} /></div>
        <label className="check">
          <input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} />
          <span>เปิดใช้งานบัญชีนี้ (เอาเครื่องหมายออกเพื่อระงับ บัญชีจะเข้าสู่ระบบไม่ได้)</span>
        </label>
        {self && <p className="faint">บัญชีของคุณเอง: เปลี่ยนบทบาทหรือระงับตัวเองไม่ได้</p>}
        <button className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={save}>บันทึกสิทธิ์</button>
      </section>
      <form className="panel stack" onSubmit={setNewPassword}>
        <h3>ตั้งรหัสผ่านใหม่</h3>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6}
          placeholder="อย่างน้อย 6 ตัว" autoComplete="new-password" />
        <button className="btn btn-s" style={{ justifySelf: 'start' }} disabled={busy || password.length < 6}>ตั้งรหัสผ่านนี้</button>
      </form>
    </div>
  );
}

function NewUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [sections, setSections] = useState<Section[]>(roleDefaults('staff'));
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const id = await rpc<string>('admin_create_user', {
        p_username: username, p_display_name: name, p_password: password, p_role: role,
        p_permissions: sections.filter((s) => roleMax(role).includes(s)),
      });
      toast(`สร้างบัญชี ${username.trim().toLowerCase()} แล้ว`);
      setUsername(''); setName(''); setPassword(''); setRole('staff'); setSections(roleDefaults('staff'));
      onCreated(id);
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="เพิ่มผู้ใช้">
      <form className="stack" onSubmit={create}>
        <label className="field"><span>ชื่อผู้ใช้ (ใช้ตอนเข้าสู่ระบบ)</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required pattern="[A-Za-z0-9._\-]{3,30}"
            placeholder="เช่น happy" autoCapitalize="none" spellCheck={false} />
        </label>
        <label className="field"><span>ชื่อที่แสดง</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น แฮปปี้" /></label>
        <label className="field"><span>รหัสผ่าน</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
        </label>
        <label className="field"><span>บทบาท</span><RoleSelect value={role} onChange={(r) => { setRole(r); setSections(roleDefaults(r)); }} /></label>
        <div className="field"><span>ส่วนที่เข้าได้</span><SectionPicker role={role} value={sections} onChange={setSections} /></div>
        <button className="btn btn-primary" disabled={busy}>สร้างบัญชี</button>
      </form>
    </Sheet>
  );
}

export function Users() {
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useLoad(() => rpc<UserRow[]>('admin_list_users'), []);
  const user = data?.find((u) => u.id === selected) ?? null;

  return (
    <div className="stack-l">
      <div className="a-head">
        <div><h1>ผู้ใช้และสิทธิ์</h1><p>บัญชีพนักงาน ผู้จัดการ และเจ้าของ กำหนดได้ว่าแต่ละคนเข้าส่วนไหนของหลังร้าน</p></div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>เพิ่มผู้ใช้</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="cols-side">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้ / อีเมล</th><th>บทบาท</th><th className="n">ส่วนที่เข้าได้</th><th>เข้าล่าสุด</th></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id} className={`clickable${u.id === selected ? ' sel' : ''}`} onClick={() => setSelected(u.id)}>
                  <td>{u.display_name}{!u.active && <> <span className="chip chip-bad">ระงับ</span></>}</td>
                  <td className="faint">{u.username ?? u.email}</td>
                  <td>{roleText[u.role]}</td>
                  <td className="n">{u.sections.length}</td>
                  <td className="faint">{u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : 'ยังไม่เคย'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {user ? <UserEditor key={user.id} user={user} onSaved={() => void reload()} />
          : <section className="panel"><p className="muted">เลือกผู้ใช้ทางซ้ายเพื่อแก้บทบาท สิทธิ์ หรือรหัสผ่าน</p></section>}
      </div>
      <NewUser open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setSelected(id); void reload(); }} />
    </div>
  );
}
