import { useEffect, useState } from 'react';
import { rows, supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

/** Search members by name, phone or check-in code. */
export function MemberPicker({ onPick, placeholder = 'ค้นหาชื่อ เบอร์โทร หรือรหัสเช็คอิน' }: { onPick: (p: Profile) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Profile[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setList([]); return; }
    const t = window.setTimeout(async () => {
      const safe = term.replace(/[%,()]/g, '');
      const res = await rows<Profile>(supabase.from('profiles').select('*')
        .or(`display_name.ilike.%${safe}%,phone.ilike.%${safe}%,checkin_code.eq.${safe.toUpperCase()}`)
        .order('display_name').limit(8)).catch(() => []);
      setList(res);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="ค้นหาสมาชิก" />
      {list.length > 0 && (
        <div className="panel-tight stack" style={{ gap: 2, padding: 6 }}>
          {list.map((p) => (
            <button key={p.id} className="btn btn-quiet" style={{ justifyContent: 'space-between' }} onClick={() => { onPick(p); setQ(''); setList([]); }}>
              <span>{p.display_name}</span><span className="faint">{p.phone ?? p.checkin_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
