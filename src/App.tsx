import { Logo } from './ui/Logo';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isStaffRole, useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import { SignIn } from './member/SignIn';
import { MemberLayout } from './member/MemberLayout';
import { Home } from './member/Home';
import { Schedule } from './member/Schedule';
import { SessionPage } from './member/SessionPage';
import { MyBookings } from './member/MyBookings';
import { Packages } from './member/Packages';
import { ProfilePage } from './member/ProfilePage';
import { AdminLayout } from './admin/AdminLayout';
import { Dashboard } from './admin/Dashboard';
import { Timetable } from './admin/Timetable';
import { SessionAdmin } from './admin/SessionAdmin';
import { LayoutEditor } from './admin/LayoutEditor';
import { Catalog } from './admin/Catalog';
import { Members } from './admin/Members';
import { Pos } from './admin/Pos';
import { Reports } from './admin/Reports';

function Setup() {
  return (
    <div className="gate">
      <div className="gate-card">
        <Logo />
        <h1>ยังไม่ได้เชื่อมฐานข้อมูล</h1>
        <p className="muted">
          คัดลอกไฟล์ <code>.env.example</code> เป็น <code>.env</code> แล้วใส่ <code>VITE_SUPABASE_URL</code> และ{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> จาก Supabase จากนั้นเริ่มแอปใหม่
        </p>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="gate" aria-busy="true">
      <div className="gate-card" style={{ justifyItems: 'center' }}>
        <Logo />
        <p className="muted">กำลังเปิด…</p>
      </div>
    </div>
  );
}

export function App() {
  const { ready, session, profile, lineSigningIn } = useAuth();
  const location = useLocation();

  if (!configured) return <Setup />;
  if (!ready || lineSigningIn) return <Loading />;
  if (!session) return <SignIn />;
  if (!profile) return <Loading />;

  const admin = location.pathname.startsWith('/admin');
  if (admin && !isStaffRole(profile)) return <Navigate to="/" replace />;

  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="sessions/:id" element={<SessionAdmin />} />
        <Route path="layouts" element={<LayoutEditor />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="members" element={<Members />} />
        <Route path="pos" element={<Pos />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route element={<MemberLayout />}>
        <Route index element={<Home />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="session/:id" element={<SessionPage />} />
        <Route path="bookings" element={<MyBookings />} />
        <Route path="packages" element={<Packages />} />
        <Route path="me" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
