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
import { AdminLayout, Gate } from './admin/AdminLayout';
import { Users } from './admin/Users';
import { BranchSettings } from './admin/BranchSettings';
import { Dashboard } from './admin/Dashboard';
import { Timetable } from './admin/Timetable';
import { SessionAdmin } from './admin/SessionAdmin';
import { LayoutEditor } from './admin/LayoutEditor';
import { Catalog } from './admin/Catalog';
import { Members } from './admin/Members';
import { Pos } from './admin/Pos';
import { Reports } from './admin/Reports';
import { Changelog } from './admin/Changelog';

function Setup() {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="logo-hero"><Logo size={120} /></div>
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
        <div className="logo-hero"><Logo size={120} /></div>
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
        <Route index element={<Gate section="today"><Dashboard /></Gate>} />
        <Route path="timetable" element={<Gate section="timetable"><Timetable /></Gate>} />
        <Route path="sessions/:id" element={<Gate section="timetable"><SessionAdmin /></Gate>} />
        <Route path="layouts" element={<Gate section="layouts"><LayoutEditor /></Gate>} />
        <Route path="catalog" element={<Gate section="catalog"><Catalog /></Gate>} />
        <Route path="members" element={<Gate section="members"><Members /></Gate>} />
        <Route path="pos" element={<Gate section="pos"><Pos /></Gate>} />
        <Route path="reports" element={<Gate section="reports"><Reports /></Gate>} />
        <Route path="changelog" element={<Gate section="changelog"><Changelog /></Gate>} />
        <Route path="users" element={<Gate section="users"><Users /></Gate>} />
        <Route path="branch" element={<Gate section="branch"><BranchSettings /></Gate>} />
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
