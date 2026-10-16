import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { isStaffRole, useAuth } from '../lib/auth';
import { Logo } from '../ui/Logo';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const tabs = [
  { to: '/', label: 'หน้าแรก', d: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5' },
  { to: '/schedule', label: 'ตารางคลาส', d: 'M4 6h16M4 12h16M4 18h10M8 3v6M16 3v6' },
  { to: '/bookings', label: 'การจอง', d: 'M6 3h12v18l-6-4-6 4V3Z' },
  { to: '/packages', label: 'แพ็กเกจ', d: 'M4 8h16v12H4zM4 8l2-4h12l2 4M12 8v12' },
];

export function MemberLayout() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const initial = (profile?.display_name || '?').trim().charAt(0);
  return (
    <div className="m-shell">
      <header className="m-top">
        <div className="row">
          <a href="/" className="m-brand" aria-label="FLOW Movement Studio หน้าแรก"><Logo size={40} /></a>
          {isStaffRole(profile) && <a className="btn btn-s" href="/admin">หลังร้าน</a>}
        </div>
        <button className="avatar" onClick={() => nav('/me')} aria-label="โปรไฟล์ของฉัน">
          {profile?.avatar_url ? <img className="avatar" src={profile.avatar_url} alt="" /> : initial}
        </button>
      </header>
      <main className="m-body">
        <Outlet />
      </main>
      <nav className="m-nav" aria-label="เมนูหลัก">
        <ul>
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.to === '/'}>
                <Icon d={t.d} />
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
