import { NavLink, Outlet } from 'react-router-dom';
import { isManagerRole, useAuth } from '../lib/auth';
import { Logo } from '../ui/Logo';

const roleText = { member: 'สมาชิก', instructor: 'ครู', staff: 'พนักงาน', manager: 'ผู้จัดการ', owner: 'เจ้าของ' };

export function AdminLayout() {
  const { profile, branch } = useAuth();
  const links = [
    { to: '/admin', label: 'วันนี้', end: true },
    { to: '/admin/pos', label: 'ขายหน้าเคาน์เตอร์' },
    { to: '/admin/timetable', label: 'ตารางคลาส' },
    { to: '/admin/members', label: 'สมาชิก' },
    { to: '/admin/reports', label: 'รายงาน' },
    ...(isManagerRole(profile) ? [
      { to: '/admin/layouts', label: 'ผังห้อง' },
      { to: '/admin/catalog', label: 'ตั้งค่าคลาสและแพ็กเกจ' },
    ] : []),
  ];
  return (
    <div className="a-shell">
      <aside className="a-side">
        <div className="brand">
          <Logo size={36} />
          <span>FLOW<small>{branch?.name ?? 'สตูดิโอ'}</small></span>
        </div>
        {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
        <div className="who">
          <div style={{ color: '#fff' }}>{profile?.display_name}</div>
          <div>{profile ? roleText[profile.role] : ''}</div>
          <a href="/" style={{ padding: 0, marginTop: 8, display: 'inline-block' }}>ไปหน้าสมาชิก</a>
        </div>
      </aside>
      <main className="a-main"><Outlet /></main>
    </div>
  );
}
