import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { promptPayPayload } from '../lib/promptpay';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Package, Promotion, Sale } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Qr } from '../ui/Qr';
import { Sheet } from '../ui/Sheet';

type PendingSale = Sale & { sale_items: { name: string }[] };

export function Packages() {
  const { profile, branch } = useAuth();
  const [buying, setBuying] = useState<Package | null>(null);
  const [code, setCode] = useState('');
  const [order, setOrder] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, reload } = useLoad(async () => {
    const [packages, promos, pending] = await Promise.all([
      rows<Package>(supabase.from('packages').select('*').eq('active', true).eq('sell_online', true).order('sort_order')),
      rows<Promotion>(supabase.from('promotions').select('*').order('sort_order')),
      rows<PendingSale>(supabase.from('sales').select('*, sale_items(name)').eq('member_id', profile!.id).eq('status', 'pending')
        .order('created_at', { ascending: false })),
    ]);
    return { packages, promos, pending };
  }, [profile?.id]);

  const open = (p: Package, promoCode = '') => { setBuying(p); setCode(promoCode); setOrder(null); setErr(null); };
  const close = () => { setBuying(null); setOrder(null); void reload(); };

  async function createOrder() {
    if (!buying) return;
    setBusy(true); setErr(null);
    try {
      const s = await rpc<Sale>('create_online_order', { p_package_id: buying.id, p_promo_code: code || null });
      setOrder(s);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const perCredit = (p: Package) => (p.credits ? Math.round(p.price / p.credits) : 0);

  return (
    <div className="stack-l">
      <h1>แพ็กเกจและโปรโมชั่น</h1>

      {data?.promos.map((pr) => {
        const pkg = data.packages.find((p) => p.id === pr.package_id);
        return (
          <section key={pr.id} className="promo-strip">
            <strong>{pr.title}</strong>
            {pr.body && <span className="muted">{pr.body}</span>}
            {pr.ends_at && <span className="faint">ถึง {fmtDateTime(pr.ends_at)}</span>}
            {pkg && <button className="btn btn-you btn-s" style={{ justifySelf: 'start', marginTop: 6 }} onClick={() => open(pkg, pr.code ?? '')}>ใช้โปรนี้</button>}
          </section>
        );
      })}

      {data && data.pending.length > 0 && (
        <section className="panel stack">
          <h2>รอยืนยันการชำระ</h2>
          {data.pending.map((s) => (
            <div key={s.id} className="row-between">
              <div>
                <b>{s.sale_items.map((i) => i.name).join(', ')}</b>
                <div className="faint">{fmtMoney(s.total)} · สั่งเมื่อ {fmtDateTime(s.created_at)}</div>
              </div>
              <button className="btn btn-s" onClick={() => setOrder(s)}>ดู QR</button>
            </div>
          ))}
          <p className="faint">พนักงานตรวจยอดโอนแล้วเครดิตจะเข้าบัญชีอัตโนมัติ</p>
        </section>
      )}

      <section className="panel">
        {!data ? <div className="skeleton" /> : data.packages.map((p) => (
          <div key={p.id} className={`pkg${p.kind === 'vip' ? ' pkg-vip' : ''}`}>
            <div>
              <div className="name"><b>{p.name}</b></div>
              <div className="credits">{p.credits} เครดิต · ใช้ได้ {p.validity_days} วัน{p.credits > 1 ? ` · ${fmtMoney(perCredit(p))}/เครดิต` : ''}</div>
              {p.description && <div className="faint">{p.description}</div>}
            </div>
            <div className="stack" style={{ gap: 6, justifyItems: 'end' }}>
              <div className="price num">{fmtMoney(p.price)}</div>
              <button className="btn btn-s btn-primary" onClick={() => open(p)}>ซื้อ</button>
            </div>
          </div>
        ))}
      </section>

      <Sheet open={!!buying && !order} onClose={close} title={buying?.name ?? ''}>
        {buying && (
          <>
            <div className="row-between"><span className="muted">{buying.credits} เครดิต · ใช้ได้ {buying.validity_days} วัน</span><b className="num">{fmtMoney(buying.price)}</b></div>
            <label className="field"><span>โค้ดส่วนลด (ถ้ามี)</span>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
            </label>
            {err && <p className="error-text" role="alert">{err}</p>}
            <button className="btn btn-primary btn-block" disabled={busy} onClick={createOrder}>ชำระด้วย PromptPay</button>
            <p className="faint center">หรือซื้อที่เคาน์เตอร์ด้วยเงินสด/บัตร</p>
          </>
        )}
      </Sheet>

      <Sheet open={!!order} onClose={close} title="สแกนเพื่อชำระ">
        {order && (
          <div className="pay-box">
            {order.discount > 0 && <span className="chip chip-you">ส่วนลด {fmtMoney(order.discount)}</span>}
            <div className="pay-amount num">{fmtMoney(order.total)}</div>
            {branch?.promptpay_id ? (
              <Qr value={promptPayPayload(branch.promptpay_id, Number(order.total))} size={220} label="QR PromptPay" />
            ) : (
              <p className="muted">สตูดิโอยังไม่ได้ตั้งค่าบัญชี PromptPay ชำระที่เคาน์เตอร์ได้เลย</p>
            )}
            <p className="muted">โอนแล้วพนักงานจะยืนยัน เครดิตเข้าบัญชีทันทีหลังยืนยัน</p>
            <p className="faint">เลขที่คำสั่งซื้อ {order.receipt_no}</p>
            <button className="btn btn-block" onClick={close}>เสร็จแล้ว</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
