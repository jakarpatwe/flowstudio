# Studio Booking — v0.1.0

ระบบจองคลาสสำหรับสตูดิโอ (แทรมโพลีน, บอร์ด, Reformer Pilates, VIP 1:1)
สมาชิกใช้ผ่าน LINE ส่วนพนักงานใช้หลังร้านบนเว็บ (`/admin`) ข้อมูลทั้งหมดอยู่บน Supabase และ deploy เว็บบน Netlify

## v0.1.0 ทำอะไรได้

**สมาชิก (มือถือ / LINE)**
- ดูตารางคลาสล่วงหน้า 14 วัน กรองตามคลาส เห็นที่ว่างแบบเรียลไทม์
- เลือกตำแหน่งบนผังห้องจริง (กระจก ครู ประตู) หรือให้ระบบเลือกให้ · ย้ายตำแหน่งได้ก่อนคลาส
- เครดิตกลางกระเป๋าเดียว ใช้ได้ทุกคลาส · VIP 1:1 ใช้เครดิต VIP เท่านั้น ส่วนเครดิต VIP ใช้คลาสทั่วไปได้
- คิวรอ: มีที่ว่างเมื่อไหร่ระบบจองให้อัตโนมัติ (หยุดเลื่อนคิว 2 ชม. ก่อนคลาส)
- ยกเลิกเอง: ก่อนเวลาที่ตั้งไว้คืนเครดิต หลังจากนั้นไม่คืน (late cancel)
- ซื้อแพ็กเกจในแอป ใส่โค้ดส่วนลด จ่ายด้วย PromptPay QR (พนักงานยืนยันยอดแล้วเครดิตเข้าทันที)
- QR เช็คอิน, ประวัติเครดิต, ข้อมูลส่วนตัว + ความยินยอม PDPA

**หลังร้าน (`/admin`)**
- วันนี้: ยอดขาย ความเต็มห้อง คนที่ยังไม่เช็คอิน คลาสพรุ่งนี้ที่ยังว่างเกินครึ่ง · ช่องสแกน QR เช็คอิน
- ตารางคลาสรายสัปดาห์ · สร้างรอบจากตารางประจำ · เพิ่ม/แก้/ยกเลิกรอบ (ยกเลิกแล้วคืนเครดิตทุกคน)
- รายชื่อในคลาส: เช็คอิน, ไม่มา, จองแทน, ยกเลิกพร้อมเลือกคืนเครดิต, ปิดเครื่องเฉพาะรอบ, เปลี่ยนผังของรอบ
- ตัวแก้ผังห้อง: วางเครื่อง กระจก ครู ประตู เรียงหมายเลขอัตโนมัติ เห็นตัวอย่างแบบที่สมาชิกเห็น
- ห้องเดียวมีหลายผัง (เช่น ห้อง 1 = แทรมโพลีน 20 ตัว หรือบอร์ด 24 ตัว) · กันจองห้องซ้อนและเว้นเวลาเปลี่ยนอุปกรณ์
- POS: เปิด/ปิดกะ, ขายแพ็กเกจ + สินค้า, ส่วนลด, หลายวิธีชำระ, ยืนยันคำสั่งซื้อออนไลน์, ยกเลิกบิล (ผู้จัดการ)
- สมาชิก: ค้นหา, เครดิตแยกล็อต, ปรับเครดิตพร้อมเหตุผล, Freeze, แท็ก, สิทธิ์ผู้ใช้
- ย้ายจาก Gymmo: นำเข้า CSV แล้วจับคู่ยอดเครดิตเมื่อสมาชิกเข้าระบบครั้งแรก
- รายงาน: ยอดขาย, ความเต็ม, การจอง/ยกเลิก/no-show, waitlist (รวมคนที่หลุด), เครดิตค้างในระบบพร้อมมูลค่า,
  ทดลอง→ซื้อต่อ, heatmap วัน×เวลา, heatmap ตำแหน่งยอดนิยม, รายงานครู, สมาชิกเสี่ยงหาย · ส่งออก CSV ได้ทุกตาราง

กติกาทั้งหมด (เครดิต ตำแหน่ง คิวรอ เงิน) อยู่ในฟังก์ชันฐานข้อมูล ไม่ว่าจะเรียกจากหน้าไหนก็ได้ผลเหมือนกัน
และมีชุดทดสอบ 21 กรณีใน `supabase/tests/booking_rules_test.sql`

## เริ่มต้น

ต้องมี Node 20+, บัญชี Supabase, บัญชี Netlify และ (ตอนเปิดจริง) LINE Developers

### 1. ฐานข้อมูล Supabase

แพ็กเกจฟรีของ Supabase เปิดได้ 2 โปรเจกต์ต่อบัญชี ถ้าเต็มแล้วต้องพักโปรเจกต์เดิมหนึ่งตัว หรืออัปเกรดเป็น Pro

```bash
npm install
npx supabase init            # ครั้งแรกเท่านั้น (เก็บโฟลเดอร์ migrations เดิมไว้)
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push         # รัน migrations ทั้ง 4 ไฟล์
```

หรือเปิด Supabase → SQL Editor แล้วรันไฟล์ใน `supabase/migrations/` ตามลำดับเลขไฟล์

ใส่ข้อมูลตัวอย่าง (ห้อง ผัง คลาส แพ็กเกจ ตารางประจำ) โดยรัน `supabase/seed.sql` ใน SQL Editor

### 2. รันเว็บในเครื่อง

```bash
cp .env.example .env          # ใส่ URL และ publishable key จาก Supabase → Project Settings → API
npm run dev
```

เปิด http://localhost:5173 → สร้างบัญชีด้วยอีเมล แล้วตั้งตัวเองเป็นเจ้าของใน SQL Editor:

```sql
update public.profiles set role = 'owner'
where id = (select id from auth.users where email = 'you@example.com');
```

จากนั้นไปที่ `/admin` → ตารางคลาส → **สร้างจากตารางประจำ** เพื่อสร้างรอบคลาสของสัปดาห์

ระหว่างพัฒนา ถ้าไม่อยากยืนยันอีเมล: Supabase → Authentication → Providers → Email → ปิด *Confirm email*

### 3. Deploy บน Netlify

- Netlify → Add new site → เชื่อม Git repo (หรือ `npx netlify deploy --prod` หลัง `npm run build`)
- Build command `npm run build`, publish `dist` (ตั้งไว้แล้วใน `netlify.toml`)
- Site settings → Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LIFF_ID`
- Supabase → Authentication → URL Configuration: ใส่โดเมน Netlify ใน Site URL และ Redirect URLs

### 4. เปิดใช้ LINE

1. LINE Developers → สร้าง **LINE Login channel** (ผูกกับ LINE OA ของสตูดิโอ)
2. แท็บ LIFF → Add: Endpoint URL = โดเมน Netlify, Size = Full, Scopes = `openid` + `profile`
3. ใส่ LIFF ID ใน `VITE_LIFF_ID` แล้ว deploy ใหม่
4. Deploy ฟังก์ชันแลกโทเคน LINE:
   ```bash
   npx supabase secrets set LINE_CHANNEL_ID=<channel id>
   npx supabase functions deploy line-auth --no-verify-jwt
   ```
5. LINE OA Manager → Rich menu → ลิงก์ไป `https://liff.line.me/<LIFF ID>`

สมาชิกกดเมนูใน LINE → เข้าระบบอัตโนมัติ ไม่ต้องสมัครหรือจำรหัสผ่าน
พนักงานเข้า `/admin` บนคอมพิวเตอร์ด้วยอีเมลได้ตามเดิม

### 5. ทดสอบกติกาฐานข้อมูล

ต้องมี PostgreSQL 15+ ในเครื่อง (ไฟล์ `tests/local_shim.sql` จำลองส่วน auth ของ Supabase)

```bash
npm run test:db               # สร้างฐานข้อมูลชั่วคราว sbtest, รัน migrations + seed + 21 กรณีทดสอบ
```

## โครงสร้าง

```
supabase/
  migrations/   0001 ตาราง · 0002 กติกาจอง/เครดิต/POS · 0003 รายงาน · 0004 สิทธิ์ (RLS) + realtime
  functions/line-auth/   แลก LINE ID token เป็น session ของ Supabase
  seed.sql      ข้อมูลตัวอย่าง 1 สาขา
  tests/        ชุดทดสอบกติกา
src/
  member/       หน้าของสมาชิก (มือถือ)
  admin/        หลังร้าน
  ui/SpotMap.tsx   ผังห้อง (ใช้ทั้งหน้าจอง ตัวแก้ผัง และ heatmap)
  lib/          Supabase, auth (LINE), ข้อความ error ภาษาไทย, PromptPay QR, CSV
```

## สิ่งที่ยังไม่อยู่ใน v0.1.0

- แจ้งเตือนผ่าน LINE Messaging API (จองสำเร็จ, ได้ที่จากคิวรอ, ใกล้หมดอายุ, สรุปรายวันถึงเจ้าของ)
- ชำระด้วยบัตรออนไลน์ (Omise / 2C2P) และตรวจยอด PromptPay อัตโนมัติ
- สแกน QR ด้วยกล้องในหน้าหลังร้าน (ตอนนี้ใช้เครื่องสแกนแบบคีย์บอร์ดหรือพิมพ์รหัส)
- ใบกำกับภาษีเต็มรูป, หลายสาขาเต็มรูปแบบ, แอปบน App Store / Play Store
