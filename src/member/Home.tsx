import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDay, fmtTime, fromNow } from '../lib/format';
import { loadWallet, SESSION_SELECT } from '../lib/queries';
import { rows, supabase } from '../lib/supabase';
import type { Booking, ClassType, Promotion, SessionRow } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { Qr } from '../ui/Qr';

type NextBooking = Booking & { sessions: SessionRow; layout_spots: { label: string } | null };

export function Home() {
  const { profile, branch } = useAuth();

  const { data } = useLoad(async () => {
    const [wallet, next, promos, classes] = await Promise.all([
      loadWallet(),
      rows<NextBooking>(supabase.from('bookings')
        .select(`*, layout_spots(label), sessions!inner(${SESSION_SELECT})`)
        .eq('member_id', profile!.id).in('status', ['booked', 'checked_in'])
        .gte('sessions.ends_at', new Date().toISOString())
        .order('starts_at', { referencedTable: 'sessions' }).limit(5)),
      rows<Promotion>(supabase.from('promotions').select('*').order('sort_order').limit(1)),
      rows<ClassType>(supabase.from('class_types').select('*').eq('active', true).order('sort_order')),
    ]);
    next.sort((a, b) => a.sessions.starts_at.localeCompare(b.sessions.starts_at));
    return { wallet, next: next[0] ?? null, promo: promos[0] ?? null, classes };
  }, [profile?.id]);

  const firstName = (profile?.display_name || '').split(' ')[0];
  const next = data?.next;

  return (
    <div className="stack-l">
      <div className="stack" style={{ gap: 4 }}>
        <h1>สวัสดี {firstName}</h1>
        {branch && <p className="muted">{branch.name}</p>}
      </div>

      <section className="wallet" aria-label="เครดิตของฉัน">
        <div>
          <div className="big num">{data ? data.wallet.total : '–'}</div>
          <div className="label">เครดิตคงเหลือ</div>
        </div>
        {data && data.wallet.vip > 0 && (
          <div className="vip">
            <div style={{ fontSize: 22, fontWeight: 700 }} className="num">{data.wallet.vip}</div>
            <div className="label">ในนั้นเป็นเครดิต VIP</div>
          </div>
        )}
        <div className="label" style={{ gridColumn: '1 / -1' }}>
          {data?.wallet.next_expiry ? `ล็อตแรกหมดอายุ ${fmtDate(data.wallet.next_expiry)}` : 'ยังไม่มีเครดิต ซื้อแพ็กเกจได้ที่แท็บแพ็กเกจ'}
        </div>
      </section>

      {next ? (
        <section className="panel next-class" aria-label="คลาสถัดไป">
          <div className="stack" style={{ gap: 6 }}>
            <span className="faint">คลาสถัดไป · {fromNow(next.sessions.starts_at)}</span>
            <div className="when num">{fmtTime(next.sessions.starts_at)}</div>
            <div><b>{next.sessions.class_types.name}</b></div>
            <div className="muted" style={{ fontSize: 14 }}>
              {fmtDay(next.sessions.starts_at)} · {next.sessions.rooms.name}
              {next.layout_spots ? ` · ตำแหน่ง ${next.layout_spots.label}` : ''}
            </div>
            <Link to={`/session/${next.session_id}`} className="btn btn-s" style={{ justifySelf: 'start', marginTop: 4 }}>ดูรายละเอียด</Link>
          </div>
          <div className="center">
            <Qr value={profile!.checkin_code} size={112} label="QR สำหรับเช็คอิน" />
            <div className="faint" style={{ marginTop: 4 }}>ให้พนักงานสแกน</div>
          </div>
        </section>
      ) : (
        data && (
          <section className="panel empty">
            <p>ยังไม่มีคลาสที่จองไว้</p>
            <Link to="/schedule" className="btn btn-primary">ดูตารางคลาส</Link>
          </section>
        )
      )}

      {data?.promo && (
        <Link to="/packages" className="promo-strip">
          <strong>{data.promo.title}</strong>
          {data.promo.body && <span className="muted">{data.promo.body}</span>}
        </Link>
      )}

      {data && data.classes.length > 0 && (
        <section className="stack">
          <h2>เลือกคลาส</h2>
          <div className="class-tiles">
            {data.classes.map((c) => (
              <Link key={c.id} to={`/schedule?class=${c.id}`} className="class-tile" style={{ ['--c' as string]: c.color }}>
                <b>{c.name}</b>
                <small>{c.credit_cost} เครดิต · {c.duration_minutes} นาที{c.requires_vip ? ' · VIP' : ''}</small>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
