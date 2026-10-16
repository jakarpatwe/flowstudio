import type { ReactNode } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { can, sectionsOf, type Section } from '../lib/permissions';
import { Logo } from '../ui/Logo';
import { APP_VERSION } from '../lib/version';

const roleText = { member: 'สมาชิก', instructor: 'ครู', staff: 'พนักงาน', manager: 'ผู้จัดการ', owner: 'เจ้าของ' };

const LINKS: { to: string; label: string; section: Section; end?: boolean }[] = [
  { to: '/admin', label: 'วันนี้', section: 'today', end: true },
  { to: '/admin/pos', label: 'ขายหน้าเคาน์เตอร์', section: 'pos' },
  { to: '/admin/timetable', label: 'ตารางคลาส', section: 'timetable' },
  { to: '/admin/members', label: 'สมาชิก', section: 'members' },
  { to: '/admin/reports', label: 'รายงาน', section: 'reports' },
  { to: '/admin/layouts', label: 'ผังห้อง', section: 'layouts' },
  { to: '/admin/catalog', label: 'ตั้งค่าคลาสและแพ็กเกจ', section: 'catalog' },
  { to: '/admin/branch', label: 'ตั้งค่าสาขา', section: 'branch' },
  { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', section: 'users' },
];

/** Shows an admin page only to people who have its section. */
export function Gate({ section, children }: { section: Section; children: ReactNode }) {
  const { profile } = useAuth();
  if (can(profile, section)) return <>{children}</>;
  // "วันนี้" is the landing page; send people without it to their first allowed page.
  const first = LINKS.find((l) => sectionsOf(profile).includes(l.section));
  if (section === 'today' && first) return <Navigate to={first.to} replace />;
  return <div className="empty"><p>บัญชีนี้ไม่มีสิทธิ์เปิดหน้านี้ ติดต่อผู้ดูแลระบบ</p></div>;
}

export function AdminLayout() {
  const { profile, branch } = useAuth();
  const links = LINKS.filter((l) => can(profile, l.section));
  return (
    <div className="a-shell">
      <aside className="a-side">
        <div className="brand">
          <Logo size={56} inverse />
          <span>{branch?.name ?? 'สตูดิโอ'}</span>
        </div>
        {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
        <div className="who">
          <div style={{ color: '#fff' }}>{profile?.display_name}</div>
          <div>{profile ? roleText[profile.role] : ''}{profile?.username ? ` · ${profile.username}` : ''}</div>
          <a href="/" style={{ padding: 0, marginTop: 8, display: 'inline-block' }}>ไปหน้าสมาชิก</a>
          {can(profile, 'changelog')
            ? <NavLink to="/admin/changelog" className="version">เวอร์ชัน {APP_VERSION}</NavLink>
            : <div className="version">เวอร์ชัน {APP_VERSION}</div>}
        </div>
      </aside>
      <main className="a-main"><Outlet /></main>
    </div>
  );
}
