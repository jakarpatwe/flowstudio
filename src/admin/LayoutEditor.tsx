import { useEffect, useState } from 'react';
import { errorText } from '../lib/errors';
import { rows, rpc, supabase } from '../lib/supabase';
import type { Fixture, Layout, LayoutSpot, Room } from '../lib/types';
import { useLoad } from '../lib/useLoad';
import { SpotMap } from '../ui/SpotMap';
import { useToast } from '../ui/Toast';

type Cell =
  | { kind: 'spot'; id?: string; label: string; active: boolean }
  | { kind: Fixture['type'] };
type Tool = 'spot' | Fixture['type'] | 'erase' | 'toggle';

const tools: { id: Tool; label: string }[] = [
  { id: 'spot', label: 'วางเครื่อง' },
  { id: 'mirror', label: 'กระจก' },
  { id: 'instructor', label: 'ครู' },
  { id: 'door', label: 'ประตู' },
  { id: 'speaker', label: 'ลำโพง' },
  { id: 'toggle', label: 'พักใช้เครื่อง' },
  { id: 'erase', label: 'ลบ' },
];
const fixtureShort: Record<Fixture['type'], string> = { mirror: 'กระจก', door: 'ประตู', instructor: 'ครู', speaker: 'ลำโพง' };

export function LayoutEditor() {
  const toast = useToast();
  const [roomId, setRoomId] = useState('');
  const [layoutId, setLayoutId] = useState('');

  const { data, reload } = useLoad(async () => {
    const [rooms, layouts] = await Promise.all([
      rows<Room>(supabase.from('rooms').select('*').order('sort_order')),
      rows<Layout>(supabase.from('layouts').select('*').order('name')),
    ]);
    return { rooms, layouts };
  }, []);

  useEffect(() => { if (data && !roomId && data.rooms[0]) setRoomId(data.rooms[0].id); }, [data, roomId]);
  const roomLayouts = (data?.layouts ?? []).filter((l) => l.room_id === roomId);
  useEffect(() => {
    if (roomLayouts.length && !roomLayouts.find((l) => l.id === layoutId)) setLayoutId(roomLayouts[0].id);
    if (!roomLayouts.length) setLayoutId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, data]);

  async function addLayout() {
    const name = window.prompt('ชื่อผังใหม่ เช่น "บอร์ด 24 ตัว"');
    if (!name) return;
    const equipment = window.prompt('อุปกรณ์ (trampoline, step board, reformer, mat ...)', 'trampoline') || 'equipment';
    const { data: l, error } = await supabase.from('layouts').insert({ room_id: roomId, name, equipment, cols: 8, rows: 6, fixtures: [] }).select().single();
    if (error) { toast(errorText(error.message), 'error'); return; }
    await reload();
    setLayoutId((l as Layout).id);
  }

  return (
    <div className="stack-l">
      <div className="a-head">
        <div><h1>ผังห้อง</h1><p>ห้องหนึ่งมีได้หลายผัง แต่ละรอบคลาสเลือกผังที่ใช้ เปลี่ยนผังแล้วรอบใหม่ใช้ทันที</p></div>
      </div>
      <div className="row wrap">
        <div className="seg" role="group" aria-label="ห้อง">
          {data?.rooms.map((r) => <button key={r.id} aria-pressed={r.id === roomId} onClick={() => setRoomId(r.id)}>{r.name}</button>)}
        </div>
        <select className="select" style={{ width: 'auto' }} value={layoutId} onChange={(e) => setLayoutId(e.target.value)} aria-label="ผัง">
          {roomLayouts.length === 0 && <option value="">ยังไม่มีผัง</option>}
          {roomLayouts.map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? '' : ' (ปิดใช้)'}</option>)}
        </select>
        <button className="btn btn-s" onClick={addLayout} disabled={!roomId}>เพิ่มผังใหม่</button>
      </div>
      {layoutId && data && <Editor key={layoutId} layout={data.layouts.find((l) => l.id === layoutId)!} onSaved={reload} />}
    </div>
  );
}

function Editor({ layout, onSaved }: { layout: Layout; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(layout.name);
  const [equipment, setEquipment] = useState(layout.equipment);
  const [cols, setCols] = useState(layout.cols);
  const [rowsN, setRowsN] = useState(layout.rows);
  const [cells, setCells] = useState<Map<string, Cell>>(new Map());
  const [tool, setTool] = useState<Tool>('spot');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const spots = await rows<LayoutSpot>(supabase.from('layout_spots').select('*').eq('layout_id', layout.id).gte('x', 0));
      const m = new Map<string, Cell>();
      (layout.fixtures ?? []).forEach((f) => {
        for (let dx = 0; dx < (f.w || 1); dx++) for (let dy = 0; dy < (f.h || 1); dy++) m.set(`${f.x + dx},${f.y + dy}`, { kind: f.type });
      });
      spots.forEach((s) => m.set(`${s.x},${s.y}`, { kind: 'spot', id: s.id, label: s.label, active: s.active }));
      setCells(m);
      setLoaded(true);
    })();
  }, [layout]);

  const spotCount = [...cells.values()].filter((c) => c.kind === 'spot' && c.active).length;

  function nextLabel(m: Map<string, Cell>) {
    const used = new Set([...m.values()].filter((c): c is Extract<Cell, { kind: 'spot' }> => c.kind === 'spot').map((c) => c.label));
    let n = 1;
    while (used.has(String(n))) n++;
    return String(n);
  }

  function apply(x: number, y: number) {
    const key = `${x},${y}`;
    const m = new Map(cells);
    const cur = m.get(key);
    if (tool === 'erase') m.delete(key);
    else if (tool === 'toggle') { if (cur?.kind === 'spot') m.set(key, { ...cur, active: !cur.active }); }
    else if (tool === 'spot') {
      if (cur?.kind === 'spot') {
        const label = window.prompt('หมายเลขเครื่อง', cur.label);
        if (label && label.trim()) {
          if ([...m.entries()].some(([k, c]) => k !== key && c.kind === 'spot' && c.label === label.trim())) { toast('หมายเลขนี้ใช้แล้ว', 'error'); return; }
          m.set(key, { ...cur, label: label.trim() });
        }
      } else m.set(key, { kind: 'spot', label: nextLabel(m), active: true });
    } else m.set(key, { kind: tool });
    setCells(m);
  }

  /** Numbers every machine in reading order: front row first, left to right. */
  function renumber() {
    const prefix = window.prompt('ตัวอักษรนำหน้า (เว้นว่างได้) เช่น R → R1, R2', '') ?? '';
    const m = new Map(cells);
    const spots = [...m.entries()].filter(([, c]) => c.kind === 'spot')
      .map(([k, c]) => ({ k, c, x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    spots.forEach((s, i) => m.set(s.k, { ...(s.c as Extract<Cell, { kind: 'spot' }>), label: `${prefix}${i + 1}` }));
    setCells(m);
  }

  async function save() {
    const fixtures: Fixture[] = [];
    const spots: { id?: string; label: string; x: number; y: number; active: boolean }[] = [];
    cells.forEach((c, k) => {
      const [x, y] = k.split(',').map(Number);
      if (x >= cols || y >= rowsN) return;
      if (c.kind === 'spot') spots.push({ id: c.id, label: c.label, x, y, active: c.active });
      else fixtures.push({ type: c.kind, x, y, w: 1, h: 1 });
    });
    setBusy(true);
    try {
      await rpc('save_layout', { p_layout_id: layout.id, p_name: name, p_equipment: equipment, p_cols: cols, p_rows: rowsN, p_fixtures: fixtures, p_spots: spots });
      toast(`บันทึกผังแล้ว ${spots.filter((s) => s.active).length} เครื่อง`);
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    const { error } = await supabase.from('layouts').update({ active: !layout.active }).eq('id', layout.id);
    if (error) toast(errorText(error.message), 'error'); else { toast(layout.active ? 'ปิดใช้ผังนี้แล้ว' : 'เปิดใช้ผังนี้แล้ว'); onSaved(); }
  }

  const grid: JSX.Element[] = [];
  for (let y = 0; y < rowsN; y++) for (let x = 0; x < cols; x++) {
    const c = cells.get(`${x},${y}`);
    const cls = !c ? 'cell' : c.kind === 'spot' ? `cell cell-spot${c.active ? '' : ' inactive'}` : `cell cell-${c.kind}`;
    const text = !c ? '' : c.kind === 'spot' ? c.label : fixtureShort[c.kind];
    grid.push(<button key={`${x},${y}`} className={cls} style={{ gridColumn: x + 1, gridRow: y + 1 }} onClick={() => apply(x, y)} aria-label={`แถว ${y + 1} คอลัมน์ ${x + 1} ${text}`}>{text}</button>);
  }

  const preview = [...cells.entries()].filter(([, c]) => c.kind === 'spot').map(([k, c]) => {
    const [x, y] = k.split(',').map(Number);
    const sc = c as Extract<Cell, { kind: 'spot' }>;
    return { id: k, label: sc.label, x, y, state: sc.active ? 'free' as const : 'off' as const };
  }).filter((s) => s.x < cols && s.y < rowsN);
  const previewFixtures: Fixture[] = [...cells.entries()].filter(([, c]) => c.kind !== 'spot').map(([k, c]) => {
    const [x, y] = k.split(',').map(Number);
    return { type: c.kind as Fixture['type'], x, y, w: 1, h: 1 };
  }).filter((f) => f.x < cols && f.y < rowsN);

  if (!loaded) return <div className="skeleton" style={{ minHeight: 300 }} />;

  return (
    <div className="cols-2">
      <section className="stack">
        <div className="form-grid">
          <label className="field"><span>ชื่อผัง</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>อุปกรณ์</span><input className="input" value={equipment} onChange={(e) => setEquipment(e.target.value)} /></label>
          <label className="field"><span>คอลัมน์</span><input className="input" type="number" min={1} max={30} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(30, Number(e.target.value))))} /></label>
          <label className="field"><span>แถว</span><input className="input" type="number" min={1} max={30} value={rowsN} onChange={(e) => setRowsN(Math.max(1, Math.min(30, Number(e.target.value))))} /></label>
        </div>
        <div className="editor-tools" role="group" aria-label="เครื่องมือ">
          {tools.map((t) => <button key={t.id} className={`btn btn-s${tool === t.id ? ' btn-primary' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>{t.label}</button>)}
          <button className="btn btn-s" onClick={renumber}>เรียงหมายเลขใหม่</button>
        </div>
        <p className="faint">แตะช่องเพื่อวาง แตะเครื่องที่วางแล้วด้วย "วางเครื่อง" เพื่อเปลี่ยนหมายเลข · ใช้งานได้ {spotCount} เครื่อง</p>
        <div style={{ overflowX: 'auto' }}>
          <div className="editor-grid" style={{ ['--cols' as string]: cols, ['--rows' as string]: rowsN }}>{grid}</div>
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={save}>บันทึกผัง</button>
          <button className="btn" onClick={toggleActive}>{layout.active ? 'ปิดใช้ผังนี้' : 'เปิดใช้ผังนี้'}</button>
        </div>
        <p className="faint">ลบเครื่องที่มีคนจองไว้ในรอบที่ยังไม่ถึง: ระบบเก็บการจองไว้และแจ้งให้สมาชิกเลือกตำแหน่งใหม่</p>
      </section>
      <section className="stack">
        <h2>สมาชิกจะเห็นแบบนี้</h2>
        <SpotMap cols={cols} rows={rowsN} fixtures={previewFixtures} spots={preview} equipment={equipment} />
      </section>
    </div>
  );
}
