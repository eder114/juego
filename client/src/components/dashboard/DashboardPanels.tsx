import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, ChartLine, Crown, Newspaper, Star } from 'lucide-react';
import clsx from 'clsx';
import { dateTime, relativeTime } from '../../lib/format';
import type { Fixture, StandingRow } from '../../types';
import { PointsHistoryChart } from '../charts';
import { ClubCrest, PlayerPhoto, PositionBadge, StatusBadge, TeamCrest } from '../sport';
import { DashCard, DashEmpty, DashLink } from './DashCard';
import type { DashboardData } from './types';

/* ───────── Evolución por jornada ───────── */

export function HistoryPanel({ history }: { history: DashboardData['history'] }) {
  return (
    <DashCard title="Evolución por jornada" subtitle="Tus puntos frente a la media y el máximo" icon={ChartLine} className="lg:col-span-2" bodyClassName="flex flex-col">
      {history.length ? (
        <div className="flex flex-1 flex-col">
          <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-white/80" aria-label="Leyenda">
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-[#4ade80]" /> Tus puntos</li>
            <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded bg-[#38bdf8]" /> Media</li>
            <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded border-t-2 border-dashed border-[#f5c542]" /> Máximo</li>
          </ul>
          <div className="dash-inner flex-1 p-2 sm:p-4">
            <PointsHistoryChart data={history} height={260} />
          </div>
        </div>
      ) : (
        <DashEmpty className="min-h-60 sm:mt-8" title="Sin datos todavía" description="Tus puntos aparecerán cuando empiece la primera jornada." />
      )}
    </DashCard>
  );
}

/* ───────── Próximo partido ───────── */

const clubName = (c: Fixture['homeClub']) => c.commonName ?? c.name;

export function NextFixturePanel({ next, upcoming }: { next: Fixture | null; upcoming: Fixture[] }) {
  const others = upcoming.filter((f) => f.id !== next?.id).slice(0, 3);
  return (
    <DashCard title="Próximo partido" icon={CalendarDays} action={<DashLink to="/fixtures">Calendario</DashLink>}>
      {next ? (
        <>
          <Link
            to={`/fixtures/${next.id}`}
            className="block rounded-xl border border-white/[0.06] bg-[#0c141b]/90 px-4 py-5 shadow-[0_14px_30px_-18px_rgb(0_0_0/0.9)] transition hover:border-lime-glow/40"
          >
            <p className="text-center font-tech text-xs font-semibold uppercase tracking-[0.12em] text-white/90">Jornada {next.gameweekId}</p>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
              <div className="flex min-w-0 flex-col items-center gap-2">
                <ClubCrest club={next.homeClub} size={52} />
                <span className="w-full truncate font-semibold text-white">{clubName(next.homeClub)}</span>
              </div>
              <span className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 font-tech text-sm font-bold text-white/80">VS</span>
              <div className="flex min-w-0 flex-col items-center gap-2">
                <ClubCrest club={next.awayClub} size={52} />
                <span className="w-full truncate font-semibold text-white">{clubName(next.awayClub)}</span>
              </div>
            </div>
            <p className="mt-4 text-center text-sm text-white/85">{dateTime(next.kickoff)}</p>
          </Link>
          {others.length > 0 && (
            <ul className="mt-5 space-y-1 border-t border-white/25 pt-3">
              {others.map((f) => (
                <li key={f.id}>
                  <Link to={`/fixtures/${f.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.06]">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: f.homeClub.primaryColor }} />
                      <span title={f.homeClub.name}>{f.homeClub.shortName}</span>
                      <span className="font-medium text-lime-glow">v</span>
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: f.awayClub.primaryColor }} />
                      <span title={f.awayClub.name}>{f.awayClub.shortName}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-white/85">{dateTime(f.kickoff)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <DashEmpty title="Sin partidos programados" description="El calendario se actualiza automáticamente con la Premier League." />
      )}
    </DashCard>
  );
}

/* ───────── Jugadores destacados ───────── */

export function FeaturedPlayersPanel({ players }: { players: DashboardData['featuredPlayers'] }) {
  return (
    <DashCard title="Jugadores destacados" subtitle="Tu plantilla en la última jornada" icon={Star} bodyClassName="flex flex-col">
      {players.length ? (
        <ul className="space-y-2">
          {players.map((p, i) => (
            <li key={p.id}>
              <Link to={`/players/${p.id}`} className="dash-inner flex items-center gap-3 px-3 py-2.5 transition hover:border-white/25 hover:bg-[#0c1320]/80">
                <PlayerPhoto player={p} size={42} rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-white">{p.displayName}</span>
                    {p.status !== 'AVAILABLE' && <StatusBadge status={p.status} compact />}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
                    <PositionBadge position={p.position} />
                    <ClubCrest club={p.club} size={14} />
                    {p.club.shortName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-extrabold tabular-nums text-white">{p.stats.lastPoints}</p>
                  <p className="flex items-center justify-end gap-1 text-[10px] font-semibold uppercase text-white/60">
                    {i === 0 && <Crown aria-label="Mejor de la jornada" className="size-3 text-gold" />}
                    pts
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 items-center">
          <DashEmpty
            className="w-full"
            title="Plantilla vacía"
            description="Ficha jugadores para verlos aquí."
            action={
              <Link to="/market" className="btn-go h-10 px-5 text-sm">
                Ir al mercado
              </Link>
            }
          />
        </div>
      )}
    </DashCard>
  );
}

/* ───────── Líderes globales ───────── */

const RANK_COLOR: Record<number, string> = { 1: 'text-gold', 2: 'text-slate-300', 3: 'text-orange-400' };

function LeaderRow({ row, me }: { row: Pick<StandingRow, 'rank' | 'teamId' | 'teamName' | 'managerName' | 'crest' | 'points'>; me: boolean }) {
  return (
    <Link
      to={`/managers/${row.teamId}`}
      aria-current={me ? 'true' : undefined}
      className={clsx(
        'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition sm:px-4',
        me ? 'border-lime-glow/30 bg-[#08252c]/90 hover:bg-[#0b2f37]' : 'border-white/[0.05] bg-[#141424]/60 hover:border-white/20 hover:bg-[#1a1a2e]/80',
      )}
    >
      <span className={clsx('w-6 shrink-0 text-center font-bold tabular-nums', RANK_COLOR[row.rank] ?? 'text-white/80')}>{row.rank}</span>
      <TeamCrest crest={row.crest} name={row.teamName} size={30} />
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate font-semibold text-white', me && 'uppercase')}>{row.teamName}</p>
        <p className={clsx('truncate text-xs', me ? 'uppercase text-white/80' : 'text-white/55')}>{row.managerName}</p>
      </div>
      <span className="shrink-0 text-lg font-extrabold tabular-nums text-white">{row.points}</span>
    </Link>
  );
}

export function LeadersPanel({ data, userId, managerName }: { data: DashboardData; userId?: string; managerName?: string }) {
  const inTop = data.leaders.some((r) => r.userId === userId);
  // Si el usuario no está entre los 5 primeros, se añade su fila con su posición real
  const mine = !inTop && data.team && data.globalRank && managerName ? { rank: data.globalRank, teamId: data.team.id, teamName: data.team.name, managerName, crest: data.team.crest, points: data.totalPoints } : null;
  return (
    <DashCard title="Líderes globales" icon={BookOpen} action={<DashLink to="/rankings">Ver todo</DashLink>}>
      {data.leaders.length ? (
        <ol className="space-y-2.5">
          {data.leaders.map((r) => (
            <li key={r.teamId}>
              <LeaderRow row={r} me={r.userId === userId} />
            </li>
          ))}
          {mine && (
            <>
              <li aria-hidden className="text-center text-sm leading-none text-white/40">⋯</li>
              <li>
                <LeaderRow row={mine} me />
              </li>
            </>
          )}
        </ol>
      ) : (
        <DashEmpty title="Sin clasificación" description="La clasificación aparecerá cuando haya mánagers con equipo." />
      )}
    </DashCard>
  );
}

/* ───────── Noticias y alertas ───────── */

const NEWS_CATEGORY: Record<string, { label: string; cls: string }> = {
  INJURY: { label: 'Lesiones', cls: 'bg-red-500/20 text-red-300' },
  GAMEWEEK: { label: 'Jornada', cls: 'bg-sky-500/20 text-sky-200' },
  TRANSFER: { label: 'Fichajes', cls: 'bg-violet-500/25 text-violet-200' },
  MARKET: { label: 'Mercado', cls: 'bg-amber-500/20 text-amber-200' },
};
const GENERAL = { label: 'General', cls: 'bg-white/10 text-white/80' };

function Tag({ className, children }: { className: string; children: string }) {
  return <span className={clsx('rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em]', className)}>{children}</span>;
}

export function NewsPanel({ notifications, news, className }: { notifications: DashboardData['notifications']; news: DashboardData['news']; className?: string }) {
  const items = [...notifications.slice(0, 2), ...news.slice(0, 4)];
  return (
    <DashCard title="Noticias y alertas" icon={Newspaper} className={className} action={<DashLink to="/news">Ver todo</DashLink>}>
      {items.length ? (
        <ul className="space-y-2.5">
          {notifications.slice(0, 2).map((n) => (
            <li key={`n${n.id}`}>
              <Link to={n.link ?? '/notifications'} className="dash-inner block px-4 py-3 transition hover:border-white/25 hover:bg-[#0c1320]/80">
                <div className="flex items-center justify-between gap-2">
                  <Tag className="bg-brand-teal/45 text-pitch-300">Aviso</Tag>
                  <span className="text-[11px] text-white/45">{relativeTime(n.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-sm font-bold text-white">{n.title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-white/70">{n.message}</p>
              </Link>
            </li>
          ))}
          {news.slice(0, 4).map((n) => {
            const cat = NEWS_CATEGORY[n.category] ?? GENERAL;
            return (
              <li key={n.id}>
                <Link to={`/news?id=${n.id}`} className="dash-inner block px-4 py-3 transition hover:border-white/25 hover:bg-[#0c1320]/80">
                  <div className="flex items-center justify-between gap-2">
                    <Tag className={cat.cls}>{cat.label}</Tag>
                    <span className="text-[11px] text-white/45">{relativeTime(n.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-white">{n.title}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <DashEmpty title="Sin novedades" description="Aquí verás avisos de tu equipo y noticias de la Premier League." />
      )}
    </DashCard>
  );
}
