import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { Fixture } from '../types';
import { FIXTURE_STATUS, timeOnly } from '../lib/format';
import { ClubCrest } from './sport';

export function FixtureRow({ fixture: f }: { fixture: Fixture }) {
  const played = f.status === 'FINISHED' || f.status === 'LIVE';
  return (
    <Link to={`/fixtures/${f.id}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-3 transition hover:bg-white/[0.03] sm:gap-4 sm:px-5">
      <span className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span className="truncate text-sm font-semibold text-white sm:text-base">
          <span className="sm:hidden">{f.homeClub.shortName}</span>
          <span className="hidden sm:inline">{f.homeClub.commonName ?? f.homeClub.name}</span>
        </span>
        <ClubCrest club={f.homeClub} size={30} />
      </span>
      <span className="flex w-24 flex-col items-center">
        {played ? (
          <span className={clsx('rounded-lg px-3 py-1 font-display text-2xl font-bold tabular-nums', f.status === 'LIVE' ? 'bg-pitch-500/15 text-pitch-300' : 'bg-white/[0.06] text-white')}>
            {f.homeScore ?? 0} – {f.awayScore ?? 0}
          </span>
        ) : (
          <span className="rounded-lg bg-white/[0.04] px-3 py-1 font-display text-xl font-bold text-slate-200">{timeOnly(f.kickoff)}</span>
        )}
        <span className={clsx('mt-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider', f.status === 'LIVE' ? 'text-pitch-400' : f.status === 'POSTPONED' ? 'text-amber-400' : 'text-slate-500')}>
          {f.status === 'LIVE' && <span className="size-1.5 animate-pulse rounded-full bg-pitch-400" />}
          {FIXTURE_STATUS[f.status]}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <ClubCrest club={f.awayClub} size={30} />
        <span className="truncate text-sm font-semibold text-white sm:text-base">
          <span className="sm:hidden">{f.awayClub.shortName}</span>
          <span className="hidden sm:inline">{f.awayClub.commonName ?? f.awayClub.name}</span>
        </span>
      </span>
    </Link>
  );
}
