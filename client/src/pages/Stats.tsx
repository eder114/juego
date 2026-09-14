import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Crown, Flame, Goal, ShoppingCart, Star, Tag, Users } from 'lucide-react';
import { api, qs } from '../lib/api';
import { money } from '../lib/format';
import type { Gameweek, LineupEntry, Player } from '../types';
import { Card, CardHeader, EmptyState, LoadingBlock, PageHeader, Select } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, PriceChange } from '../components/sport';
import { PlayerRow } from '../components/PlayerCard';
import { Pitch } from '../components/Pitch';

type TotwPlayer = Player & { gameweekPoints: number };
interface Totw {
  gameweek: { id: number; name: string; status: string };
  formation: string;
  total: number;
  players: TotwPlayer[];
  playerOfTheWeek: TotwPlayer;
}
type TrendPlayer = Player & { count?: number };
interface Trends {
  mostSelected: TrendPlayer[];
  mostBought: TrendPlayer[];
  mostSold: TrendPlayer[];
  risers: TrendPlayer[];
  fallers: TrendPlayer[];
  inForm: TrendPlayer[];
  topScorers: TrendPlayer[];
}

function TrendList({ title, icon, players, value }: { title: string; icon: React.ReactNode; players: TrendPlayer[]; value: (p: TrendPlayer) => React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} icon={icon} />
      {players.length === 0 ? (
        <EmptyState title="Sin datos todavía" />
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {players.slice(0, 6).map((p, i) => (
            <div key={p.id} className="flex items-center">
              <span className="w-8 pl-4 font-display text-sm font-bold text-slate-500">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <PlayerRow player={p} right={<div className="text-right">{value(p)}</div>} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Stats() {
  const [gw, setGw] = useState<number | undefined>();
  const gws = useQuery({ queryKey: ['gameweeks'], queryFn: () => api.get<{ gameweeks: Gameweek[] }>('/gameweeks') });
  const totw = useQuery({ queryKey: ['totw', gw], queryFn: () => api.get<Totw | null>(`/stats/team-of-the-week${qs({ gameweek: gw })}`) });
  const trends = useQuery({ queryKey: ['trends'], queryFn: () => api.get<Trends>('/stats/trends') });

  const pitch = useMemo(() => {
    if (!totw.data) return null;
    const entries = new Map<number, LineupEntry>(
      totw.data.players.map((p, i) => [p.id, { player: p, role: 'STARTER', order: i, inSquad: true, locked: false, fixtures: [], minutes: 90, points: p.gameweekPoints, multiplier: 1, autoSubIn: false, autoSubOut: false }]),
    );
    return { entries, state: { formation: totw.data.formation, starters: totw.data.players.map((p) => p.id), bench: [], captainId: totw.data.playerOfTheWeek.id, viceCaptainId: null } };
  }, [totw.data]);

  const played = gws.data?.gameweeks.filter((g) => g.status !== 'UPCOMING') ?? [];
  const potw = totw.data?.playerOfTheWeek;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Análisis" title="Estadísticas" subtitle="Equipo de la jornada, tendencias del mercado y los mejores jugadores." />

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-3xl font-extrabold uppercase">Equipo de la jornada</h2>
        <Select className="w-44" value={gw ?? totw.data?.gameweek.id ?? ''} onChange={(e) => setGw(Number(e.target.value))}>
          {played.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>

      {totw.isLoading ? (
        <LoadingBlock />
      ) : !totw.data || !pitch ? (
        <Card>
          <EmptyState title="Sin datos de jornada" />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Pitch entries={pitch.entries} state={pitch.state} editable={false} showPoints activeCaptainId={null} />
          </div>
          <div className="space-y-4">
            {potw && (
              <Link to={`/players/${potw.id}`} className="card relative block overflow-hidden p-5">
                <div className="absolute inset-0" style={{ background: `radial-gradient(400px 220px at 50% 0%, ${potw.club.primaryColor}66, transparent 70%)` }} />
                <div className="relative flex flex-col items-center text-center">
                  <p className="label flex items-center gap-1.5 text-gold">
                    <Crown className="size-4" /> Jugador de la jornada
                  </p>
                  <PlayerPhoto player={potw} size={130} className="mt-3" rounded="rounded-3xl" />
                  <h3 className="mt-3 text-3xl font-extrabold uppercase">{potw.displayName}</h3>
                  <p className="flex items-center gap-1.5 text-sm text-slate-300">
                    <PositionBadge position={potw.position} /> <ClubCrest club={potw.club} size={16} /> {potw.club.name}
                  </p>
                  <p className="stat-number mt-3 text-6xl text-pitch-300">{potw.gameweekPoints}</p>
                  <p className="label">puntos</p>
                </div>
              </Link>
            )}
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Puntos del once ideal</span>
                <span className="stat-number text-3xl">{totw.data.total}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm text-slate-400">Formación</span>
                <span className="font-display text-xl font-bold text-white">{totw.data.formation}</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      <h2 className="pt-2 text-3xl font-extrabold uppercase">Tendencias</h2>
      {trends.isLoading || !trends.data ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TrendList title="Más seleccionados" icon={<Users className="size-5" />} players={trends.data.mostSelected} value={(p) => <span className="stat-number text-xl">{p.stats.selectedBy}%</span>} />
          <TrendList title="Más fichados" icon={<ShoppingCart className="size-5" />} players={trends.data.mostBought} value={(p) => <span className="stat-number text-xl text-pitch-300">{p.count}</span>} />
          <TrendList title="Más vendidos" icon={<Tag className="size-5" />} players={trends.data.mostSold} value={(p) => <span className="stat-number text-xl text-red-300">{p.count}</span>} />
          <TrendList title="En forma" icon={<Flame className="size-5" />} players={trends.data.inForm} value={(p) => <span className="stat-number text-xl">{p.stats.form.toFixed(1)}</span>} />
          <TrendList title="Máximos goleadores" icon={<Goal className="size-5" />} players={trends.data.topScorers} value={(p) => <span className="stat-number text-xl">{p.stats.goals}</span>} />
          <TrendList
            title="Suben de precio"
            icon={<ArrowUpRight className="size-5" />}
            players={trends.data.risers}
            value={(p) => (
              <>
                <p className="text-sm font-semibold text-white">{money(p.price)}</p>
                <PriceChange value={p.stats.weeklyChange} />
              </>
            )}
          />
          <TrendList
            title="Bajan de precio"
            icon={<ArrowDownRight className="size-5" />}
            players={trends.data.fallers}
            value={(p) => (
              <>
                <p className="text-sm font-semibold text-white">{money(p.price)}</p>
                <PriceChange value={p.stats.weeklyChange} />
              </>
            )}
          />
          <Card className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Star className="size-8 text-gold" />
            <p className="font-display text-2xl font-bold uppercase text-white">¿Dudas entre dos jugadores?</p>
            <Link to="/compare" className="rounded-xl bg-pitch-500 px-4 py-2 text-sm font-bold text-ink-950">
              Abrir comparador
            </Link>
          </Card>
        </div>
      )}
    </div>
  );
}
