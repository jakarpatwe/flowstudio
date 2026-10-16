import { useEffect, useRef, useState } from 'react';
import { isManagerRole, useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Package, PaymentMethod, Product, Profile, Sale, Shift } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { MemberPicker } from './MemberPicker';

type Line = { key: string; kind: 'package' | 'product'; id: string; name: string; price: number; qty: number };
type SaleRow = Sale & { member: { display_name: string } | null; sale_items: { name: string; qty: number }[] };

const methods: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'เงินสด' }, { id: 'promptpay', label: 'PromptPay' }, { id: 'card', label: 'บัตร' }, { id: 'transfer', label: 'โอน' }, { id: 'free', label: 'ไม่คิดเงิน' },
];
const methodText = Object.fromEntries(methods.map((m) => [m.id, m.label])) as Record<PaymentMethod, string>;

export function Pos() {
  const { profile } = useAuth();
  const toast = useToast();
  const [member, setMember] = useState<Profile | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState('');

  const { data, reload } = useLoad(async () => {
    const [packages, products, shifts, pending, recent] = await Promise.all([
      rows<Package>(supabase.from('packages').select('*').eq('active', true).order('sort_order')),
      rows<Product>(supabase.from('products').select('*').eq('active', true).order('name')),
      rows<Shift>(supabase.from('shifts').select('*').eq('staff_id', profile!.id).is('closed_at', null)),
      rows<SaleRow>(supabase.from('sales').select('*, member:profiles!sales_member_id_fkey(display_name), sale_items(name, qty)').eq('status', 'pending').order('created_at')),
      rows<SaleRow>(supabase.from('sales').select('*, member:profiles!sales_member_id_fkey(display_name), sale_items(name, qty)').neq('status', 'pending')
        .order('created_at', { ascending: false }).limit(15)),
    ]);
    return { packages, products, shift: shifts[0] ?? null, pending, recent };
  }, [profile?.id]);

  // Pending online orders arrive while the counter is open.
  useLoadRealtime(reload);

  const add = (kind: Line['kind'], id: string, name: string, price: number) => {
    setCart((c) => {
      const key = `${kind}:${id}`;
      const ex = c.find((l) => l.key === key);
      return ex ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key, kind, id, name, price: Number(price), qty: 1 }];
    });
  };
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const disc = Number(discount || 0);
  const needsMember = cart.some((l) => l.kind === 'package');

  async function checkout() {
    setBusy(true);
    try {
      const sale = await rpc<Sale>('pos_checkout', {
        p_member_id: member?.id ?? null,
        p_items: cart.map((l) => (l.kind === 'package' ? { package_id: l.id, qty: l.qty } : { product_id: l.id, qty: l.qty })),
        p_payment_method: method, p_discount: disc,
      });
      toast(`ขายแล้ว บิล #${sale.receipt_no} ${fmtMoney(sale.total)}`);
      setCart([]); setDiscount(''); setMember(null); void reload();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast(ok); void reload(); } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!data) return <div className="skeleton" style={{ minHeight: 300 }} />;

  if (!data.shift) {
    return (
      <div className="stack-l">
        <div className="a-head"><div><h1>ขายหน้าเคาน์เตอร์</h1><p>เปิดกะก่อนเริ่มขาย ตอนปิดกะระบบสรุปเงินสดที่ควรมีให้</p></div></div>
        <form className="panel stack" style={{ maxWidth: 380 }} onSubmit={(e) => { e.preventDefault(); void run(() => rpc('open_shift', { p_opening_cash: Number(counted || 0) }), 'เปิดกะแล้ว'); setCounted(''); }}>
          <label className="field"><span>เงินทอนตั้งต้นในลิ้นชัก (บาท)</span><input className="input" type="number" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
          <button className="btn btn-primary">เปิดกะ</button>
        </form>
        <PendingOrders list={data.pending} onConfirm={(id, m) => run(() => rpc('confirm_sale', { p_sale_id: id, p_payment_method: m }), 'ยืนยันแล้ว เครดิตเข้าบัญชีสมาชิก')} />
      </div>
    );
  }

  return (
    <div className="stack-l">
      <div className="a-head">
        <div><h1>ขายหน้าเคาน์เตอร์</h1><p>เปิดกะ {fmtDateTime(data.shift.opened_at)} · เงินตั้งต้น {fmtMoney(data.shift.opening_cash)}</p></div>
        <button className="btn btn-s" onClick={() => setClosing(true)}>ปิดกะ</button>
      </div>

      <PendingOrders list={data.pending} onConfirm={(id, m) => run(() => rpc('confirm_sale', { p_sale_id: id, p_payment_method: m }), 'ยืนยันแล้ว เครดิตเข้าบัญชีสมาชิก')} />

      <div className="cols-side">
        <section className="stack">
          <h2>แพ็กเกจ</h2>
          <div className="form-grid">
            {data.packages.map((p) => (
              <button key={p.id} className="panel-tight" style={{ border: 0, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 2 }} onClick={() => add('package', p.id, p.name, p.price)}>
                <b>{p.name}</b><span className="faint">{p.credits} เครดิต · {p.validity_days} วัน{p.kind === 'vip' ? ' · VIP' : ''}</span><span className="num">{fmtMoney(p.price)}</span>
              </button>
            ))}
          </div>
          <h2>สินค้า</h2>
          <div className="form-grid">
            {data.products.map((p) => (
              <button key={p.id} className="panel-tight" style={{ border: 0, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 2 }} disabled={p.stock === 0} onClick={() => add('product', p.id, p.name, p.price)}>
                <b>{p.name}</b><span className="faint">{p.stock === null ? 'ไม่นับสต็อก' : `เหลือ ${p.stock}`}</span><span className="num">{fmtMoney(p.price)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel stack" aria-label="บิล">
          <h2>บิล</h2>
          {member ? (
            <div className="row-between"><span><b>{member.display_name}</b><div className="faint">{member.phone ?? member.checkin_code}</div></span><button className="btn btn-quiet btn-s" onClick={() => setMember(null)}>เปลี่ยน</button></div>
          ) : <MemberPicker onPick={setMember} placeholder={needsMember ? 'แพ็กเกจต้องเลือกสมาชิก' : 'สมาชิก (ไม่บังคับสำหรับสินค้า)'} />}
          <hr className="divider" />
          {cart.length === 0 ? <p className="faint">แตะแพ็กเกจหรือสินค้าเพื่อเพิ่ม</p> : cart.map((l) => (
            <div key={l.key} className="row-between">
              <span className="grow">{l.name}</span>
              <span className="row">
                <button className="btn btn-s" aria-label="ลด" onClick={() => setCart(cart.flatMap((x) => (x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}>−</button>
                <span className="num">{l.qty}</span>
                <button className="btn btn-s" aria-label="เพิ่ม" onClick={() => setCart(cart.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                <span className="num" style={{ minWidth: 80, textAlign: 'right' }}>{fmtMoney(l.price * l.qty)}</span>
              </span>
            </div>
          ))}
          <hr className="divider" />
          <label className="field"><span>ส่วนลด (บาท)</span><input className="input" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          <div className="row-between"><b>รวม</b><b className="num" style={{ fontSize: 26 }}>{fmtMoney(Math.max(0, subtotal - disc))}</b></div>
          <div className="seg" role="group" aria-label="วิธีชำระ" style={{ flexWrap: 'wrap' }}>
            {methods.map((m) => <button key={m.id} aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>{m.label}</button>)}
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !cart.length || (needsMember && !member) || disc > subtotal} onClick={checkout}>
            รับเงิน {fmtMoney(Math.max(0, subtotal - disc))}
          </button>
        </section>
      </div>

      <section className="stack">
        <h2>บิลล่าสุด</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>#</th><th>เวลา</th><th>สมาชิก</th><th>รายการ</th><th>ชำระ</th><th className="n">ยอด</th><th /></tr></thead>
            <tbody>
              {data.recent.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.receipt_no}</td><td>{fmtDateTime(s.created_at)}</td><td>{s.member?.display_name ?? '–'}</td>
                  <td>{s.sale_items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')}</td>
                  <td>{s.channel === 'online' ? 'ออนไลน์ · ' : ''}{methodText[s.payment_method]}</td>
                  <td className="n">{s.status === 'void' ? <s>{fmtMoney(s.total)}</s> : fmtMoney(s.total)}</td>
                  <td className="n">
                    {s.status === 'void' ? <span className="chip">ยกเลิก</span> : isManagerRole(profile) && (
                      <button className="btn btn-s btn-danger" onClick={() => {
                        const reason = window.prompt('เหตุผลที่ยกเลิกบิล');
                        if (reason) void run(() => rpc('void_sale', { p_sale_id: s.id, p_reason: reason }), 'ยกเลิกบิลแล้ว');
                      }}>ยกเลิกบิล</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Sheet open={closing} onClose={() => setClosing(false)} title="ปิดกะ">
        <label className="field"><span>นับเงินสดในลิ้นชักได้ (บาท)</span><input className="input" type="number" value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={counted === ''} onClick={async () => {
          try {
            const sh = await rpc<Shift>('close_shift', { p_counted_cash: Number(counted) });
            const diff = Number(sh.counted_cash) - Number(sh.expected_cash);
            toast(diff === 0 ? 'ปิดกะแล้ว เงินสดตรง' : `ปิดกะแล้ว เงินสด${diff > 0 ? 'เกิน' : 'ขาด'} ${fmtMoney(Math.abs(diff))} (ควรมี ${fmtMoney(sh.expected_cash)})`, diff === 0 ? 'ok' : 'error');
            setClosing(false); setCounted(''); void reload();
          } catch (e) { toast(errorText(e), 'error'); }
        }}>ปิดกะ</button>
      </Sheet>
    </div>
  );
}

function PendingOrders({ list, onConfirm }: { list: SaleRow[]; onConfirm: (id: string, m: PaymentMethod) => void }) {
  if (!list.length) return null;
  return (
    <section className="panel stack" style={{ boxShadow: 'inset 4px 0 0 var(--pulse)' }}>
      <h2>รอยืนยันโอน ({list.length})</h2>
      <p className="faint">ตรวจยอดเงินเข้าบัญชีก่อนกดยืนยัน เครดิตจะเข้าบัญชีสมาชิกทันที</p>
      {list.map((s) => (
        <div key={s.id} className="row-between wrap">
          <span><b>{s.member?.display_name}</b> · {s.sale_items.map((i) => i.name).join(', ')}<div className="faint">#{s.receipt_no} · {fmtDateTime(s.created_at)}{s.promo_code ? ` · โค้ด ${s.promo_code}` : ''}</div></span>
          <span className="row"><b className="num">{fmtMoney(s.total)}</b><button className="btn btn-s btn-primary" onClick={() => onConfirm(s.id, 'promptpay')}>ยืนยันว่าได้รับเงิน</button></span>
        </div>
      ))}
    </section>
  );
}

function useLoadRealtime(reload: () => Promise<void> | void) {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    const ch = supabase.channel('pos-sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => { void ref.current(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);
}
