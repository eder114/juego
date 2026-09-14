import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { StandingRow } from '../types';
import { Avatar, MovementIndicator, TeamCrest } from './sport';

export function StandingsTable({ rows, pointsLabel = 'Total', showLast = true, action }: { rows: StandingRow[]; pointsLabel?: string; showLast?: boolean; action?: (row: StandingRow) => React.ReactNode }) {
  return (
    <div>
      <div className="hidden grid-cols-[56px_28px_minmax(0,2fr)_minmax(0,1.3fr)_80px_80px_auto] gap-3 border-b border-white/[0.06] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 md:grid">
        <span>Pos</span>
        <span />
        <span>Equipo</span>
        <span>Mánager</span>
        <span className="text-right">{showLast ? 'Últ. J.' : ''}</span>
        <span className="text-right">{pointsLabel}</span>
        <span />
      </div>
      <div className="divide-y divide-white/[0.05]">
        {rows.map((r) => (
          <div key={r.teamId} className={clsx('relative flex items-center gap-3 px-4 py-3 md:grid md:grid-cols-[56px_28px_minmax(0,2fr)_minmax(0,1.3fr)_80px_80px_auto]', r.isMe && 'bg-pitch-500/[0.08]')}>
            {r.isMe && <span className="absolute inset-y-0 left-0 w-1 bg-pitch-500" />}
            <span className="flex w-12 items-center gap-1.5">
              <span className={clsx('w-7 text-center font-display text-xl font-bold tabular-nums', r.rank === 1 ? 'text-gold' : r.rank <= 3 ? 'text-white' : 'text-slate-400')}>{r.rank}</span>
              <MovementIndicator movement={r.movement} delta={r.previousRank !== null ? r.previousRank - r.rank : null} />
            </span>
            <TeamCrest crest={r.crest} name={r.teamName} size={30} />
            <Link to={`/managers/${r.teamId}`} className="min-w-0 flex-1 md:flex-none">
              <p className="truncate font-semibold text-white hover:text-pitch-300">{r.teamName}</p>
              <p className="truncate text-xs text-slate-400 md:hidden">{r.managerName}</p>
            </Link>
            <span className="hidden min-w-0 items-center gap-2 md:flex">
              <Avatar name={r.managerName} url={r.avatarUrl} size={24} />
              <span className="truncate text-sm text-slate-300">{r.managerName}</span>
            </span>
            <span className="hidden text-right text-sm tabular-nums text-slate-300 md:block">{showLast ? r.lastPoints : ''}</span>
            <span className="text-right">
              <span className="stat-number text-2xl">{r.points}</span>
              {showLast && <span className="block text-[10px] text-slate-500 md:hidden">+{r.lastPoints} últ.</span>}
            </span>
            <span className="flex justify-end">{action?.(r)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
