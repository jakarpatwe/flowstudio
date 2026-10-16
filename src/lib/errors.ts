// Database functions raise short codes; people see these sentences instead.
const messages: Record<string, string> = {
  not_signed_in: 'กรุณาเข้าสู่ระบบก่อน',
  not_allowed: 'บัญชีนี้ทำรายการนี้ไม่ได้',
  session_not_found: 'ไม่พบคลาสนี้ หรือคลาสถูกยกเลิกแล้ว',
  session_started: 'คลาสเริ่มไปแล้ว',
  booking_not_open: 'ยังไม่เปิดให้จองคลาสนี้',
  session_full: 'คลาสเต็มแล้ว เข้าคิวรอได้',
  session_not_full: 'คลาสยังมีที่ว่าง จองได้เลย',
  already_booked: 'คุณจองคลาสนี้ไว้แล้ว',
  already_waiting: 'คุณอยู่ในคิวรอคลาสนี้แล้ว',
  spot_taken: 'ตำแหน่งนี้เพิ่งถูกจองไป เลือกตำแหน่งอื่นได้เลย',
  spot_unavailable: 'ตำแหน่งนี้ปิดใช้งานในรอบนี้',
  insufficient_credits: 'เครดิตไม่พอ ซื้อแพ็กเกจเพิ่มได้ที่หน้าแพ็กเกจ',
  booking_not_found: 'ไม่พบการจองนี้ หรือยกเลิกไปแล้ว',
  room_busy: 'ห้องนี้มีคลาสอื่นในเวลานี้แล้ว',
  room_turnover_conflict: 'ห้องนี้ต้องเว้นเวลาเปลี่ยนอุปกรณ์ระหว่างคลาส ลองเลื่อนเวลา',
  instructor_busy: 'ครูคนนี้สอนคลาสอื่นในเวลานี้',
  layout_not_in_room: 'ผังนี้ไม่ได้อยู่ในห้องที่เลือก',
  capacity_below_bookings: 'จำนวนที่น้อยกว่าคนที่จองไว้แล้ว',
  range_too_long: 'เลือกช่วงไม่เกิน 2 เดือน',
  package_once_per_member: 'แพ็กเกจนี้ซื้อได้คนละครั้ง',
  promo_invalid: 'โค้ดนี้ใช้ไม่ได้ หรือหมดอายุแล้ว',
  promo_not_for_package: 'โค้ดนี้ใช้กับแพ็กเกจอื่น',
  promo_not_for_member: 'โค้ดนี้สำหรับสมาชิกบางกลุ่ม',
  cart_empty: 'ยังไม่มีสินค้าในบิล',
  member_required: 'การขายแพ็กเกจต้องเลือกสมาชิก',
  out_of_stock: 'สินค้าในสต็อกไม่พอ',
  discount_invalid: 'ส่วนลดต้องไม่เกินยอดรวม',
  shift_not_open: 'เปิดกะก่อนเริ่มขาย',
  shift_already_open: 'คุณเปิดกะไว้แล้ว',
  sale_not_pending: 'รายการนี้ยืนยันไปแล้ว',
  sale_not_found: 'ไม่พบบิลนี้ หรือยกเลิกไปแล้ว',
  credits_already_used: 'ยกเลิกบิลไม่ได้ เพราะสมาชิกใช้เครดิตจากบิลนี้ไปแล้ว ใช้การปรับเครดิตแทน',
  reason_required: 'ระบุเหตุผลก่อน',
  amount_required: 'ระบุจำนวนเครดิต',
  days_invalid: 'จำนวนวันต้องอยู่ระหว่าง 1–90',
  member_not_found: 'ไม่พบสมาชิกจากโค้ดนี้',
  import_not_available: 'รายการนี้ถูกโอนเข้าบัญชีแล้ว',
  not_found: 'ไม่พบข้อมูล',
  username_invalid: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z ตัวเลข จุด ขีด ยาว 3–30 ตัว',
  username_taken: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว',
  password_too_short: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว',
  cannot_change_self: 'เปลี่ยนสิทธิ์ ระงับ หรือเอาสิทธิ์จัดการผู้ใช้ออกจากบัญชีตัวเองไม่ได้',
  name_required: 'ใส่ชื่อก่อน',
  line_token_invalid: 'เข้าสู่ระบบ LINE ไม่สำเร็จ ลองเปิดลิงก์ใหม่อีกครั้ง',
};

export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const code = raw.trim();
  if (messages[code]) return messages[code];
  if (/row-level security|permission denied/i.test(raw)) return messages.not_allowed;
  if (/fetch|network/i.test(raw)) return 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง';
  return raw;
}
