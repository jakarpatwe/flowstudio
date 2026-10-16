import type { Profile, Role } from './types';

/** Admin sections. Keep in sync with public.role_sections() in the 0005 migration. */
export type Section =
  | 'today' | 'pos' | 'timetable' | 'members' | 'reports'
  | 'layouts' | 'catalog' | 'branch' | 'users' | 'changelog';

export const SECTIONS: { id: Section; label: string; managerOnly?: boolean }[] = [
  { id: 'today', label: 'วันนี้ / เช็คอิน' },
  { id: 'pos', label: 'ขายหน้าเคาน์เตอร์' },
  { id: 'timetable', label: 'ตารางคลาส' },
  { id: 'members', label: 'สมาชิก' },
  { id: 'reports', label: 'รายงาน' },
  { id: 'layouts', label: 'ผังห้อง', managerOnly: true },
  { id: 'catalog', label: 'ตั้งค่าคลาสและแพ็กเกจ', managerOnly: true },
  { id: 'branch', label: 'ตั้งค่าสาขา', managerOnly: true },
  { id: 'users', label: 'จัดการผู้ใช้และสิทธิ์', managerOnly: true },
  { id: 'changelog', label: 'บันทึกการเปลี่ยนแปลง', managerOnly: true },
];

const ALL = SECTIONS.map((s) => s.id);

/** What a role gets when no custom permissions are set. */
export function roleDefaults(role: Role): Section[] {
  if (role === 'owner') return ALL;
  if (role === 'manager') return ALL.filter((s) => s !== 'users');
  if (role === 'staff') return ['today', 'pos', 'timetable', 'members'];
  return [];
}

/** The most a role can be given. */
export function roleMax(role: Role): Section[] {
  if (role === 'owner' || role === 'manager') return ALL;
  if (role === 'staff') return ['today', 'pos', 'timetable', 'members', 'reports'];
  return [];
}

export function sectionsOf(p: Profile | null): Section[] {
  if (!p || p.active === false) return [];
  if (p.role === 'owner') return ALL;
  return (p.permissions as Section[] | null) ?? roleDefaults(p.role);
}

export const can = (p: Profile | null, s: Section) => sectionsOf(p).includes(s);

/** Staff sign in with a username; it maps to this never-mailed address. */
export const STAFF_EMAIL_DOMAIN = 'flowstudio.local';
export const loginEmail = (input: string) => {
  const v = input.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${STAFF_EMAIL_DOMAIN}`;
};
