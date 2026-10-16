import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { fmtMoney, weekdayShort } from '../lib/format';
import { rows, supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';

type Opt = { value: string; label: string };
type Field = {
  key: string; label: string;
  type: 'text' | 'textarea' | 'number' | 'bool' | 'color' | 'select' | 'datetime' | 'time';
  options?: Opt[] | ((ref: Refs) => Opt[]); required?: boolean; hint?: string; list?: boolean;
  show?: (v: unknown, row: Rec, ref: Refs) => string;
};
type Rec = Record<string, unknown> & { id?: string };
type Refs = { rooms: Rec[]; layouts: Rec[]; classes: Rec[]; instructors: Rec[]; packages: Rec[] };

const nameOf = (list: Rec[], id: unknown) => String(list.find((r) => r.id === id)?.name ?? '–');
const opts = (list: Rec[], extra?: Opt) => [...(extra ? [extra] : []), ...list.map((r) => ({ value: String(r.id), label: String(r.name) }))];

const sections: { id: string; title: string; table: string; order: string; fields: Field[]; defaults: Rec; hint: string }[] = [
  {
    id: 'classes', title: 'ประเภทคลาส', table: 'class_types', order: 'sort_order', hint: 'เพิ่มคลาสใหม่ได้ทันที กำหนดเครดิต ห้อง และผังเริ่มต้น',
    defaults: { color: '#0B7F8F', duration_minutes: 50, credit_cost: 1, booking_window_days: 7, cancel_cutoff_hours: 12, active: true, requires_vip: false, sort_order: 10 },
    fields: [
      { key: 'name', label: 'ชื่อคลาส', type: 'text', required: true, list: true },
      { key: 'description', label: 'คำอธิบาย', type: 'textarea' },
      { key: 'color', label: 'สี', type: 'color', list: true, show: (v) => String(v) },
      { key: 'credit_cost', label: 'เครดิตต่อครั้ง', type: 'number', required: true, list: true },
      { key: 'duration_minutes', label: 'ความยาว (นาที)', type: 'number', list: true },
      { key: 'default_room_id', label: 'ห้องเริ่มต้น', type: 'select', options: (r) => opts(r.rooms, { value: '', label: 'ไม่ระบุ' }), list: true, show: (v, _, r) => nameOf(r.rooms, v) },
      { key: 'default_layout_id', label: 'ผังเริ่มต้น', type: 'select', options: (r) => opts(r.layouts, { value: '', label: 'ไม่ใช้ผัง' }), show: (v, _, r) => nameOf(r.layouts, v) },
      { key: 'requires_vip', label: 'ใช้เครดิต VIP เท่านั้น', type: 'bool', list: true },
      { key: 'booking_window_days', label: 'เปิดจองล่วงหน้า (วัน)', type: 'number' },
      { key: 'cancel_cutoff_hours', label: 'ยกเลิกฟรีก่อนคลาส (ชม.)', type: 'number' },
      { key: 'sort_order', label: 'ลำดับแสดง', type: 'number' },
      { key: 'active', label: 'เปิดใช้', type: 'bool', list: true },
    ],
  },
  {
    id: 'templates', title: 'ตารางประจำสัปดาห์', table: 'schedule_templates', order: 'weekday', hint: 'ใช้กับปุ่ม "สร้างจากตารางประจำ" ในหน้าตารางคลาส',
    defaults: { weekday: 1, start_time: '10:00', active: true },
    fields: [
      { key: 'weekday', label: 'วัน', type: 'select', options: weekdayShort.map((d, i) => ({ value: String(i), label: d })), list: true, show: (v) => weekdayShort[Number(v)] },
      { key: 'start_time', label: 'เวลาเริ่ม', type: 'time', required: true, list: true, show: (v) => String(v).slice(0, 5) },
      { key: 'class_type_id', label: 'คลาส', type: 'select', options: (r) => opts(r.classes), required: true, list: true, show: (v, _, r) => nameOf(r.classes, v) },
      { key: 'room_id', label: 'ห้อง', type: 'select', options: (r) => opts(r.rooms), required: true, list: true, show: (v, _, r) => nameOf(r.rooms, v) },
      { key: 'layout_id', label: 'ผัง', type: 'select', options: (r) => opts(r.layouts, { value: '', label: 'ไม่ใช้ผัง' }), list: true, show: (v, _, r) => nameOf(r.layouts, v) },
      { key: 'instructor_id', label: 'ครู', type: 'select', options: (r) => opts(r.instructors, { value: '', label: 'ไม่ระบุ' }), list: true, show: (v, _, r) => nameOf(r.instructors, v) },
      { key: 'duration_minutes', label: 'ความยาว (เว้นว่าง = ตามคลาส)', type: 'number' },
      { key: 'capacity', label: 'จำกัดคน (เว้นว่าง = ตามผัง)', type: 'number' },
      { key: 'active', label: 'เปิดใช้', type: 'bool', list: true },
    ],
  },
  {
    id: 'packages', title: 'แพ็กเกจ', table: 'packages', order: 'sort_order', hint: 'เครดิตทุกแพ็กเข้ากระเป๋าเดียว แพ็กประเภท VIP ให้เครดิต VIP',
    defaults: { kind: 'credit', credits: 10, validity_days: 60, price: 0, sell_online: true, once_per_member: false, active: true, sort_order: 10 },
    fields: [
      { key: 'name', label: 'ชื่อ', type: 'text', required: true, list: true },
      { key: 'description', label: 'คำอธิบาย', type: 'textarea' },
      { key: 'kind', label: 'ประเภท', type: 'select', options: [{ value: 'credit', label: 'เครดิต' }, { value: 'vip', label: 'VIP' }, { value: 'dropin', label: 'Drop-in' }, { value: 'trial', label: 'ทดลอง' }], list: true },
      { key: 'credits', label: 'เครดิต', type: 'number', required: true, list: true },
      { key: 'validity_days', label: 'อายุ (วัน)', type: 'number', required: true, list: true },
      { key: 'price', label: 'ราคา (บาท)', type: 'number', required: true, list: true, show: (v) => fmtMoney(Number(v)) },
      { key: 'sell_online', label: 'ขายในแอป', type: 'bool', list: true },
      { key: 'once_per_member', label: 'ซื้อได้คนละครั้ง', type: 'bool' },
      { key: 'sort_order', label: 'ลำดับแสดง', type: 'number' },
      { key: 'active', label: 'เปิดขาย', type: 'bool', list: true },
    ],
  },
  {
    id: 'promotions', title: 'โปรโมชั่น', table: 'promotions', order: 'sort_order', hint: 'กลุ่มเป้าหมายตรงกับแท็กของสมาชิก เช่น vip, ใกล้หมดอายุ',
    defaults: { active: true, sort_order: 10, discount_percent: 10 },
    fields: [
      { key: 'title', label: 'หัวข้อ', type: 'text', required: true, list: true },
      { key: 'body', label: 'รายละเอียด', type: 'textarea' },
      { key: 'package_id', label: 'ใช้กับแพ็กเกจ', type: 'select', options: (r) => opts(r.packages, { value: '', label: 'ทุกแพ็กเกจ' }), list: true, show: (v, _, r) => (v ? nameOf(r.packages, v) : 'ทุกแพ็กเกจ') },
      { key: 'discount_percent', label: 'ส่วนลด %', type: 'number', list: true },
      { key: 'code', label: 'โค้ด', type: 'text', list: true },
      { key: 'audience_tag', label: 'เฉพาะแท็ก', type: 'text' },
      { key: 'max_uses', label: 'จำกัดจำนวนครั้ง', type: 'number' },
      { key: 'starts_at', label: 'เริ่ม', type: 'datetime' },
      { key: 'ends_at', label: 'สิ้นสุด', type: 'datetime' },
      { key: 'active', label: 'เปิดใช้', type: 'bool', list: true },
    ],
  },
  {
    id: 'products', title: 'สินค้า', table: 'products', order: 'name', hint: 'สต็อกเว้นว่างถ้าไม่นับจำนวน',
    defaults: { price: 0, active: true },
    fields: [
      { key: 'name', label: 'ชื่อ', type: 'text', required: true, list: true },
      { key: 'price', label: 'ราคา', type: 'number', required: true, list: true, show: (v) => fmtMoney(Number(v)) },
      { key: 'stock', label: 'สต็อก', type: 'number', list: true, show: (v) => (v === null ? 'ไม่นับ' : String(v)) },
      { key: 'active', label: 'เปิดขาย', type: 'bool', list: true },
    ],
  },
  {
    id: 'instructors', title: 'ครู', table: 'instructors', order: 'name', hint: '',
    defaults: { active: true },
    fields: [
      { key: 'name', label: 'ชื่อ', type: 'text', required: true, list: true },
      { key: 'bio', label: 'แนะนำตัว', type: 'textarea', list: true },
      { key: 'photo_url', label: 'ลิงก์รูป', type: 'text' },
      { key: 'active', label: 'สอนอยู่', type: 'bool', list: true },
    ],
  },
  {
    id: 'rooms', title: 'ห้อง', table: 'rooms', order: 'sort_order', hint: 'เวลาเปลี่ยนอุปกรณ์ = นาทีที่ต้องเว้นระหว่างคลาสในห้องนี้',
    defaults: { kind: 'group', turnover_minutes: 10, active: true, sort_order: 10 },
    fields: [
      { key: 'name', label: 'ชื่อห้อง', type: 'text', required: true, list: true },
      { key: 'kind', label: 'ประเภท', type: 'select', options: [{ value: 'group', label: 'กลุ่ม' }, { value: 'vip', label: 'VIP' }], list: true },
      { key: 'turnover_minutes', label: 'เวลาเปลี่ยนอุปกรณ์ (นาที)', type: 'number', list: true },
      { key: 'sort_order', label: 'ลำดับ', type: 'number' },
      { key: 'active', label: 'เปิดใช้', type: 'bool', list: true },
    ],
  },
];

export function Catalog() {
  const [tab, setTab] = useState(sections[0].id);
  const sec = sections.find((s) => s.id === tab)!;
  return (
    <div className="stack-l">
      <div className="a-head"><div><h1>ตั้งค่าคลาสและแพ็กเกจ</h1><p>{sec.hint}</p></div></div>
      <div className="seg" role="group" aria-label="หมวด" style={{ flexWrap: 'wrap' }}>
        {sections.map((s) => <button key={s.id} aria-pressed={s.id === tab} onClick={() => setTab(s.id)}>{s.title}</button>)}
      </div>
      <TableEditor key={sec.id} {...sec} />
    </div>
  );
}

function TableEditor({ title, table, order, fields, defaults }: (typeof sections)[number]) {
  const { branch } = useAuth();
  const toast = useToast();
  const [edit, setEdit] = useState<Rec | null>(null);

  const { data, reload } = useLoad(async () => {
    const [list, rooms, layouts, classes, instructors, packages] = await Promise.all([
      rows<Rec>(supabase.from(table).select('*').order(order)),
      rows<Rec>(supabase.from('rooms').select('id, name').order('sort_order')),
      rows<Rec>(supabase.from('layouts').select('id, name').order('name')),
      rows<Rec>(supabase.from('class_types').select('id, name').order('sort_order')),
      rows<Rec>(supabase.from('instructors').select('id, name').order('name')),
      rows<Rec>(supabase.from('packages').select('id, name').order('sort_order')),
    ]);
    return { list, refs: { rooms, layouts, classes, instructors, packages } as Refs };
  }, [table]);

  async function save() {
    if (!edit) return;
    const rec: Rec = {};
    for (const f of fields) {
      let v = edit[f.key];
      if (v === '' || v === undefined) v = null;
      if (f.type === 'number' && v !== null) v = Number(v);
      if (f.type === 'datetime' && v) v = new Date(String(v)).toISOString();
      if (f.key === 'code' && typeof v === 'string') v = v.toUpperCase();
      if (f.required && (v === null || v === undefined)) { toast(`กรอก ${f.label}`, 'error'); return; }
      // new rows: let the database fill defaults; starts_at can never be emptied
      if (v === null && (!edit.id || f.key === 'starts_at')) continue;
      rec[f.key] = v;
    }
    rec.branch_id = edit.branch_id ?? branch?.id;
    const q = edit.id ? supabase.from(table).update(rec).eq('id', edit.id) : supabase.from(table).insert(rec);
    const { error } = await q;
    if (error) { toast(errorText(error.message), 'error'); return; }
    toast('บันทึกแล้ว');
    setEdit(null);
    void reload();
  }

  const listFields = fields.filter((f) => f.list);
  const refs = data?.refs;
  const display = (f: Field, r: Rec) => {
    const v = r[f.key];
    if (f.show && refs) return f.show(v, r, refs);
    if (f.type === 'bool') return v ? 'ใช่' : '–';
    if (f.type === 'select' && Array.isArray(f.options)) return f.options.find((o) => o.value === String(v))?.label ?? String(v ?? '–');
    return v === null || v === undefined || v === '' ? '–' : String(v);
  };

  const toLocalInput = (v: unknown) => (v ? new Date(String(v)).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16) : '');

  return (
    <section className="stack">
      <div className="row-between">
        <h2>{title}</h2>
        <button className="btn btn-primary btn-s" onClick={() => setEdit({ ...defaults })}>เพิ่ม{title}</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>{listFields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
          <tbody>
            {data?.list.map((r) => (
              <tr key={String(r.id)} className="clickable" onClick={() => setEdit({ ...r })}>
                {listFields.map((f) => (
                  <td key={f.key}>
                    {f.type === 'color'
                      ? <span className="row"><i style={{ width: 14, height: 14, borderRadius: 4, background: String(r[f.key]), display: 'inline-block' }} />{String(r[f.key])}</span>
                      : display(f, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `แก้ไข${title}` : `เพิ่ม${title}`}>
        {edit && refs && (
          <div className="stack">
            {fields.map((f) => {
              const v = edit[f.key];
              const set = (nv: unknown) => setEdit({ ...edit, [f.key]: nv });
              const options = typeof f.options === 'function' ? f.options(refs) : f.options ?? [];
              if (f.type === 'bool') return (
                <label key={f.key} className="check"><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} /><span>{f.label}</span></label>
              );
              return (
                <label key={f.key} className="field"><span>{f.label}</span>
                  {f.type === 'textarea' ? <textarea className="textarea" value={String(v ?? '')} onChange={(e) => set(e.target.value)} />
                    : f.type === 'select' ? (
                      <select className="select" value={v === null || v === undefined ? '' : String(v)} onChange={(e) => set(e.target.value)}>
                        {!options.some((o) => o.value === '') && <option value="">เลือก</option>}
                        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : f.type === 'datetime' ? <input className="input" type="datetime-local" value={toLocalInput(v)} onChange={(e) => set(e.target.value ? `${e.target.value}:00+07:00` : '')} />
                    : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : f.type === 'time' ? 'time' : 'text'}
                        value={v === null || v === undefined ? '' : f.type === 'time' ? String(v).slice(0, 5) : String(v)} onChange={(e) => set(e.target.value)} />}
                </label>
              );
            })}
            <button className="btn btn-primary" onClick={save}>บันทึก</button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
