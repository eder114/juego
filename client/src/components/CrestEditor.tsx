import clsx from 'clsx';
import type { Crest } from '../types';
import { TeamCrest } from './sport';

const SHAPES: { value: NonNullable<Crest['shape']>; label: string }[] = [
  { value: 'shield', label: 'Escudo' },
  { value: 'classic', label: 'Clásico' },
  { value: 'round', label: 'Redondo' },
  { value: 'diamond', label: 'Rombo' },
];
const PATTERNS: { value: NonNullable<Crest['pattern']>; label: string }[] = [
  { value: 'plain', label: 'Liso' },
  { value: 'stripes', label: 'Rayas' },
  { value: 'hoops', label: 'Aros' },
  { value: 'sash', label: 'Banda' },
  { value: 'half', label: 'Mitades' },
  { value: 'chevron', label: 'Galón' },
];
const COLORS = ['#16a34a', '#dc2626', '#2563eb', '#7c3aed', '#f59e0b', '#0891b2', '#db2777', '#0f172a', '#f8fafc', '#facc15', '#15803d', '#9f1239'];

export function CrestEditor({ value, onChange, teamName }: { value: Crest; onChange: (c: Crest) => void; teamName: string }) {
  const set = (patch: Partial<Crest>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      <div className="grid shrink-0 place-items-center rounded-2xl border border-white/[0.06] bg-ink-900/60 p-5">
        <TeamCrest crest={value} name={teamName} size={120} />
      </div>
      <div className="flex-1 space-y-3">
        <div>
          <p className="label mb-1.5">Forma</p>
          <div className="flex flex-wrap gap-1.5">
            {SHAPES.map((s) => (
              <button type="button" key={s.value} onClick={() => set({ shape: s.value })} className={clsx('rounded-lg px-2.5 py-1 text-xs font-semibold', value.shape === s.value ? 'bg-pitch-500 text-ink-950' : 'bg-white/[0.06] text-slate-300')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label mb-1.5">Diseño</p>
          <div className="flex flex-wrap gap-1.5">
            {PATTERNS.map((p) => (
              <button type="button" key={p.value} onClick={() => set({ pattern: p.value })} className={clsx('rounded-lg px-2.5 py-1 text-xs font-semibold', value.pattern === p.value ? 'bg-pitch-500 text-ink-950' : 'bg-white/[0.06] text-slate-300')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {(['primary', 'secondary'] as const).map((key) => (
          <div key={key}>
            <p className="label mb-1.5">{key === 'primary' ? 'Color principal' : 'Color secundario'}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORS.map((c) => (
                <button type="button" key={c} onClick={() => set({ [key]: c })} aria-label={c} className={clsx('size-7 rounded-full ring-2 ring-offset-2 ring-offset-ink-800', value[key] === c ? 'ring-pitch-400' : 'ring-transparent')} style={{ background: c }} />
              ))}
              <input type="color" value={value[key] ?? '#16a34a'} onChange={(e) => set({ [key]: e.target.value })} className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label="Color personalizado" />
            </div>
          </div>
        ))}
        <div>
          <p className="label mb-1.5">Iniciales</p>
          <input className="input w-24 uppercase" maxLength={3} value={value.initials ?? ''} onChange={(e) => set({ initials: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="FC" />
        </div>
      </div>
    </div>
  );
}

export const DEFAULT_CREST: Crest = { shape: 'shield', pattern: 'stripes', primary: '#16a34a', secondary: '#0f172a', initials: '' };
