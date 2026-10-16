/** App version (semantic versioning: MAJOR.MINOR.PATCH).
 *  MAJOR = big change that alters how the studio works, MINOR = new feature, PATCH = fix or small tweak.
 *  On every change: bump APP_VERSION, add a newest-first entry below, and mirror it in CHANGELOG.md
 *  and package.json "version". */
export const APP_VERSION = '0.3.1';

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
    version: '0.3.1',
    at: '2026-10-16T14:35:00+07:00',
    kind: 'patch',
    items: ['ขยายโลโก้ FLOW ให้ใหญ่และเด่นขึ้น: หน้าเข้าสู่ระบบมีโลโก้ใหญ่พร้อมคำว่า FLOW MOVEMENT STUDIO, หัวหน้าสมาชิกมีโลโก้, แถบเมนูหลังร้านใช้โลโก้พื้นขาวขนาดใหญ่'],
  },
  {
    version: '0.3.0',
    at: '2026-10-16T14:16:00+07:00',
    kind: 'minor',
    items: [
      'เพิ่มหน้า "ผู้ใช้และสิทธิ์" ในหลังร้าน: สร้างบัญชีพนักงานด้วยชื่อผู้ใช้ ตั้งรหัสผ่าน เปลี่ยนบทบาท และระงับบัญชีได้',
      'กำหนดได้ว่าแต่ละคนเข้าส่วนไหนของหลังร้าน (วันนี้ ขายหน้าเคาน์เตอร์ ตารางคลาส สมาชิก รายงาน ผังห้อง ตั้งค่า ฯลฯ)',
      'เข้าสู่ระบบด้วยชื่อผู้ใช้ได้ (เช่น happy) นอกจากอีเมล',
      'เพิ่มหน้า "ตั้งค่าสาขา" แก้ชื่อสาขา ที่อยู่ และเบอร์ PromptPay ได้',
      'มีชุดข้อมูลจำลองสำหรับทดสอบ: สมาชิก 30 คน ยอดขาย คลาสย้อนหลัง 3 วันถึงล่วงหน้า 5 วัน การจอง เช็คอิน คิวรอ',
    ],
  },
  {
    version: '0.2.1',
    at: '2026-10-16T14:02:00+07:00',
    kind: 'patch',
    items: ['เปลี่ยนพื้นสีดำเป็นสีเขียวอมฟ้าของแบรนด์: แถบเมนูหลังร้าน การ์ดเครดิต วันที่เลือก โลโก้ และแถบแจ้งเตือน'],
  },
  {
    version: '0.2.0',
    at: '2026-10-16T13:58:00+07:00',
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
