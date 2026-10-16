import type { Fixture, SpotState } from '../lib/types';

export interface MapSpot { id: string; label: string; x: number; y: number; state?: SpotState; heat?: number }

const fixtureText: Record<Fixture['type'], string> = {
  mirror: 'กระจก', door: 'ประตู', instructor: 'ครู', speaker: 'ลำโพง',
};

/** Shape follows the equipment so the map reads like the real room. */
export function equipmentShape(equipment: string): 'round' | 'long' | 'board' {
  const e = equipment.toLowerCase();
  if (e.includes('reformer') || e.includes('pilates') || e.includes('bed')) return 'long';
  if (e.includes('board') || e.includes('step') || e.includes('บอร์ด')) return 'board';
  return 'round';
}

interface Props {
  cols: number;
  rows: number;
  fixtures: Fixture[];
  spots: MapSpot[];
  equipment: string;
  selectedId?: string | null;
  onPick?: (spot: MapSpot) => void;
  /** Which states can be tapped. Members: free (and mine to deselect). Admin: everything. */
  pickable?: (spot: MapSpot) => boolean;
  showHeat?: boolean;
}

export function SpotMap({ cols, rows, fixtures, spots, equipment, selectedId, onPick, pickable, showHeat }: Props) {
  const shape = equipmentShape(equipment);
  return (
    <div className="room" style={{ ['--cols' as string]: cols, ['--rows' as string]: rows }}>
      <div className="room-grid">
        {fixtures.map((f, i) => (
          <div
            key={`f${i}`}
            className={`fixture fixture-${f.type}`}
            style={{ gridColumn: `${f.x + 1} / span ${f.w || 1}`, gridRow: `${f.y + 1} / span ${f.h || 1}` }}
          >
            <span>{fixtureText[f.type]}</span>
          </div>
        ))}
        {spots.map((s) => {
          const can = onPick && (pickable ? pickable(s) : s.state === 'free' || s.state === 'mine');
          const selected = selectedId === s.id;
          const heat = showHeat ? Math.max(0, Math.min(1, s.heat ?? 0)) : undefined;
          const stateName = { free: 'ว่าง', taken: 'มีคนจองแล้ว', mine: 'ตำแหน่งของคุณ', off: 'ปิดใช้งาน' }[s.state ?? 'free'];
          return (
            <button
              key={s.id}
              type="button"
              className={`spot spot-${shape} spot-${s.state ?? 'free'}${selected ? ' spot-selected' : ''}${showHeat ? ' spot-heat' : ''}`}
              style={{ gridColumn: s.x + 1, gridRow: s.y + 1, ...(heat !== undefined ? { ['--heat' as string]: heat } : {}) }}
              disabled={!can}
              aria-pressed={selected}
              aria-label={`ตำแหน่ง ${s.label} ${stateName}`}
              onClick={() => can && onPick?.(s)}
            >
              <span className="spot-body" />
              <span className="spot-label">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SpotLegend() {
  return (
    <div className="legend" aria-hidden="true">
      <span><i className="lg lg-free" />ว่าง</span>
      <span><i className="lg lg-taken" />จองแล้ว</span>
      <span><i className="lg lg-mine" />ของคุณ</span>
      <span><i className="lg lg-off" />ปิด</span>
    </div>
  );
}
