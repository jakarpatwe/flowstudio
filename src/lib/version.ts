/** App version (semantic versioning: MAJOR.MINOR.PATCH).
 *  MAJOR = big change that alters how the studio works, MINOR = new feature, PATCH = fix or small tweak.
 *  On every change: bump APP_VERSION, add a newest-first entry below, and mirror it in CHANGELOG.md
 *  and package.json "version". */
export const APP_VERSION = '0.2.0';

export type ChangeKind = 'major' | 'minor' | 'patch';

export interface ChangeEntry {
  version: string;
  /** When the change was made, Bangkok time (ISO with +07:00). */
  at: string;
  kind: ChangeKind;
  items: string[];
}

/** Newest first. Wording is for the studio owner, in Thai. */
export const CHANGELOG: ChangeEntry[] = [
  {
    version: '0.2.0',
    at: '2026-10-16T14:30:00+07:00',
    kind: 'minor',
    items: [
      'เปลี่ยนหน้าตาเป็นแบรนด์ FLOW Movement Studio: โลโก้ สีดำ-ขาว และสีเขียวอมฟ้า',
      'ใส่โลโก้ที่หน้าเข้าสู่ระบบ แถบเมนูหลังร้าน และไอคอนบนแท็บเบราว์เซอร์',
      'แสดงเลขเวอร์ชันที่หน้าเข้าสู่ระบบ หน้าโปรไฟล์ และหลังร้าน',
      'เพิ่มหน้าบันทึกการเปลี่ยนแปลงในหลังร้าน ดูได้เฉพาะเจ้าของและผู้จัดการ และต้องใส่รหัสผ่านก่อน',
    ],
  },
  {
    version: '0.1.1',
    at: '2026-10-16T11:50:00+07:00',
    kind: 'patch',
    items: ['อัปเดตระบบเข้าสู่ระบบผ่าน LINE (LIFF 2.31.1) เพื่อปิดช่องโหว่ด้านความปลอดภัย'],
  },
  {
    version: '0.1.0',
    at: '2026-10-16T10:30:00+07:00',
    kind: 'minor',
    items: ['เปิดใช้ระบบจองคลาสครั้งแรก: ตารางคลาส จองตำแหน่งบนผังห้อง เครดิต คิวรอ แพ็กเกจ POS และรายงาน'],
  },
];
