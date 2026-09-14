import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Minus, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import type { ClubLite, Crest, Movement, Player, PlayerStatus, Position } from '../types';
import { DIFFICULTY_STYLE, POSITION_SHORT, POSITION_STYLE, STATUS_META, initials, signedMoney } from '../lib/format';

export function ClubCrest({ club, size = 24, className }: { club: Pick<ClubLite, 'crestUrl' | 'shortName' | 'primaryColor' | 'name'> | null | undefined; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!club) return null;
  if (club.crestUrl && !failed) {
    return (
      <img
        src={club.crestUrl}
        alt={club.name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={clsx('shrink-0 object-contain', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={clsx('grid shrink-0 place-items-center rounded-full font-display font-bold text-white', className)}
      style={{ width: size, height: size, background: club.primaryColor, fontSize: size * 0.34 }}
      title={club.name}
    >
      {club.shortName}
    </span>
  );
}

export function PlayerPhoto({ player, size = 56, className, rounded = 'rounded-2xl' }: { player: Pick<Player, 'photoUrl' | 'displayName'> & { club?: Pick<ClubLite, 'primaryColor' | 'secondaryColor'> }; size?: number; className?: string; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  const color = player.club?.primaryColor ?? '#22c55e';
  return (
    <div
      className={clsx('relative shrink-0 overflow-hidden', rounded, className)}
      style={{ width: size, height: size, background: `linear-gradient(160deg, ${color}55 0%, ${color}15 55%, rgb(10 16 27) 100%)` }}
    >
      {player.photoUrl && !failed ? (
        <img src={player.photoUrl} alt={player.displayName} loading="lazy" onError={() => setFailed(true)} className="absolute inset-x-0 bottom-0 mx-auto h-[112%] w-auto max-w-none object-contain object-bottom" />
      ) : (
        <span className="grid size-full place-items-center font-display font-bold text-white/80" style={{ fontSize: size * 0.36 }}>
          {initials(player.displayName)}
        </span>
      )}
    </div>
  );
}

export function PositionBadge({ position, className }: { position: Position; className?: string }) {
  return <span className={clsx('inline-flex h-5 items-center rounded-md px-1.5 font-display text-[12px] font-bold tracking-wider ring-1 ring-inset', POSITION_STYLE[position], className)}>{POSITION_SHORT[position]}</span>;
}

export function StatusBadge({ status, chance, compact }: { status: PlayerStatus; chance?: number | null; compact?: boolean }) {
  const meta = STATUS_META[status];
  if (compact) return <span className={clsx('inline-block size-2 rounded-full', meta.dot)} title={meta.label} />;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', meta.chip)}>
      <span className={clsx('size-1.5 rounded-full', meta.dot)} />
      {meta.label}
      {status === 'DOUBTFUL' && chance != null ? ` ${chance}%` : ''}
    </span>
  );
}

export function PriceChange({ value, className }: { value: number; className?: string }) {
  if (value === 0) return <span className={clsx('inline-flex items-center gap-0.5 text-xs text-slate-500', className)}>= £0.0M</span>;
  const up = value > 0;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums', up ? 'text-pitch-400' : 'text-red-400', className)}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {signedMoney(value)}
    </span>
  );
}

export function MovementIndicator({ movement, delta }: { movement: Movement; delta?: number | null }) {
  if (movement === 'up')
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-bold text-pitch-400" title="Subió posiciones">
        <ArrowUp className="size-3.5" />
        {delta ? Math.abs(delta) : ''}
      </span>
    );
  if (movement === 'down')
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-bold text-red-400" title="Bajó posiciones">
        <ArrowDown className="size-3.5" />
        {delta ? Math.abs(delta) : ''}
      </span>
    );
  if (movement === 'new')
    return (
      <span className="inline-flex items-center text-sky-400" title="Nuevo">
        <Sparkles className="size-3.5" />
      </span>
    );
  return (
    <span className="inline-flex items-center text-slate-500" title="Se mantuvo">
      <Minus className="size-3.5" />
    </span>
  );
}

export function DifficultyPill({ value, children }: { value: number | null; children: React.ReactNode }) {
  return <span className={clsx('inline-flex h-6 min-w-10 items-center justify-center rounded-md px-1.5 text-[11px] font-bold', DIFFICULTY_STYLE[value ?? 3])}>{children}</span>;
}

export function Avatar({ name, url, size = 36, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt={name} onError={() => setFailed(true)} className={clsx('shrink-0 rounded-full object-cover ring-2 ring-white/10', className)} style={{ width: size, height: size }} />;
  return (
    <span className={clsx('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-pitch-500 to-emerald-800 font-bold text-white ring-2 ring-white/10', className)} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

const SHAPES: Record<NonNullable<Crest['shape']>, string> = {
  shield: 'M50 4 L92 16 V52 C92 78 72 92 50 100 C28 92 8 78 8 52 V16 Z',
  classic: 'M10 6 H90 V50 C90 76 72 92 50 100 C28 92 10 76 10 50 Z',
  round: 'M50 4 A46 46 0 1 1 49.99 4 Z',
  diamond: 'M50 2 L96 50 L50 98 L4 50 Z',
};

/** Escudo personalizado del equipo Fantasy (SVG generado a partir de la configuración). */
export function TeamCrest({ crest, size = 40, name, className }: { crest: Crest | null | undefined; size?: number; name?: string; className?: string }) {
  const id = useId().replace(/:/g, '');
  const c = { shape: 'shield', pattern: 'plain', primary: '#16a34a', secondary: '#0f172a', ...crest } as Required<Crest>;
  const text = (c.initials || (name ? initials(name) : 'FC')).slice(0, 3);
  const path = SHAPES[c.shape] ?? SHAPES.shield;
  return (
    <svg viewBox="0 0 100 104" width={size} height={size} className={clsx('shrink-0 drop-shadow', className)} role="img" aria-label={name ?? 'Escudo'}>
      <defs>
        <clipPath id={`clip-${id}`}>
          <path d={path} />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${id})`}>
        <rect width="100" height="104" fill={c.primary} />
        {c.pattern === 'stripes' && [15, 45, 75].map((x) => <rect key={x} x={x} width="13" height="104" fill={c.secondary} />)}
        {c.pattern === 'hoops' && [18, 48, 78].map((y) => <rect key={y} y={y} width="100" height="13" fill={c.secondary} />)}
        {c.pattern === 'sash' && <path d="M-10 20 L20 -10 L110 80 L80 110 Z" fill={c.secondary} />}
        {c.pattern === 'half' && <rect x="50" width="50" height="104" fill={c.secondary} />}
        {c.pattern === 'chevron' && <path d="M0 30 L50 60 L100 30 V50 L50 80 L0 50 Z" fill={c.secondary} />}
        <rect width="100" height="104" fill="url(#none)" />
      </g>
      <path d={path} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
      <text x="50" y="62" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="800" fontSize={text.length > 2 ? 28 : 34} fill="#fff" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" paintOrder="stroke">
        {text}
      </text>
    </svg>
  );
}
