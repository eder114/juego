import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Flame, Layers, ShieldAlert, Sparkles, Undo2, Zap } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { dateTime, RARITY_META } from '../lib/format';
import type { Crest, Player, PowerUpCard, Squad } from '../types';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Select } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, TeamCrest } from '../components/sport';
import { RarityBadge, useServerCountdown } from '../components/economy';

interface CardsData {
  gameweek: { id: number; name: string; deadline: string } | null;
  serverTime: string;
  inventory: { id: number; status: 'AVAILABLE' | 'ACTIVE' | 'USED'; source: string; acquiredAt: string; usedAt: string | null; card: PowerUpCard }[];
  activations: {
    id: number;
    teamCardId: number;
    gameweekId: number;
    status: 'ACTIVE' | 'APPLIED';
    effect: string;
    effectValue: number;
    pointsDelta: number;
    card: PowerUpCard;
    targetPlayer: { id: number; displayName: string; photoUrl: string | null; position: string; club: { shortName: string } } | null;
    targetTeam: { id: number; name: string };
    cancellable: boolean;
    createdAt: string;
  }[];
  received: { id: number; gameweekId: number; pointsDelta: number; card: PowerUpCard; fromTeam: { id: number; name: string }; targetPlayer: { displayName: string } | null }[];
  catalog: PowerUpCard[];
}

interface Rival {
  teamId: number;
  teamName: string;
  managerName: string;
  crest: Crest;
  leagues: string[];
}

const SOURCE_LABEL: Record<string, string> = { STREAK: 'Racha diaria', CHALLENGE: 'Desafío', ACHIEVEMENT: 'Logro', EVENT: 'Evento', ADMIN: 'Regalo de la administración' };
const effectLabel = (c: PowerUpCard) => (c.effect === 'DOUBLE_POINTS' ? `×${(c.effectValue / 100).toString().replace('.', ',')}` : `−${c.effectValue}%`);

export default function Cards() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['cards'], queryFn: () => api.get<CardsData>('/cards') });
  const [activating, setActivating] = useState<CardsData['inventory'][number] | null>(null);
  const countdown = useServerCountdown(data?.gameweek?.deadline, data?.serverTime);

  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/cards/activations/${id}/cancel`),
    onSuccess: () => {
      toast.push('success', 'Carta desactivada: vuelve a tu inventario');
      qc.invalidateQueries({ queryKey: ['cards'] });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  const grouped = useMemo(() => {
    const available = (data?.inventory ?? []).filter((t) => t.status === 'AVAILABLE');
    const map = new Map<string, typeof available>();
    for (const t of available) map.set(t.card.code, [...(map.get(t.card.code) ?? []), t]);
    return [...map.values()];
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  const active = data.activations.filter((a) => a.status === 'ACTIVE');
  const applied = data.activations.filter((a) => a.status === 'APPLIED');
  const open = !!data.gameweek && !countdown.done;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Estrategia"
        title="Cartas"
        subtitle="Cartas de un solo uso para una jornada. Se activan antes del cierre y no se pueden cambiar después."
      />

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Clock aria-hidden className="size-5 text-pitch-300" />
        {data.gameweek ? (
          <p className="text-sm text-slate-200">
            Activa tus cartas para la <b className="text-white">{data.gameweek.name}</b> antes del cierre ({dateTime(data.gameweek.deadline)}):{' '}
            <span className="font-mono font-bold text-white">{countdown.label}</span>
          </p>
        ) : (
          <p className="text-sm text-slate-300">No hay ninguna jornada abierta para activar cartas.</p>
        )}
      </Card>

      <section aria-labelledby="inv">
        <h2 id="inv" className="mb-3 font-display text-2xl font-bold uppercase text-white">Tu inventario</h2>
        {grouped.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {grouped.map((group) => {
              const c = group[0].card;
              return (
                <li key={c.code}>
                  <CardFace card={c} count={group.length}>
                    <p className="text-xs text-slate-400">Conseguida por: {[...new Set(group.map((g) => SOURCE_LABEL[g.source] ?? g.source))].join(', ')}</p>
                    <Button className="w-full" disabled={!open || !c.isActive} onClick={() => setActivating(group[0])} icon={<Zap className="size-4" />}>
                      {c.isActive ? 'Activar' : 'Desactivada temporalmente'}
                    </Button>
                  </CardFace>
                </li>
              );
            })}
          </ul>
        ) : (
          <Card>
            <EmptyState
              icon={<Layers className="size-6" />}
              title="No tienes cartas disponibles"
              description="Las cartas se consiguen con recompensas: mantén tu racha en los desafíos diarios para ganarlas."
              action={<Link to="/challenges"><Button variant="secondary" icon={<Flame className="size-4" />}>Ir a Desafíos diarios</Button></Link>}
            />
          </Card>
        )}
      </section>

      {active.length > 0 && (
        <Card>
          <CardHeader title="Cartas activadas" subtitle="Se aplican automáticamente al puntuar la jornada" icon={<Sparkles className="size-5" />} />
          <ul className="divide-y divide-white/[0.05]">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <RarityBadge rarity={a.card.rarity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {a.card.name} ({effectLabel(a.card)}) → {a.targetPlayer?.displayName}
                    {a.effect === 'WEAKEN' && <span className="text-slate-400"> de {a.targetTeam.name}</span>}
                  </p>
                  <p className="text-xs text-slate-400">Jornada {a.gameweekId} · activada {dateTime(a.createdAt)}</p>
                </div>
                {a.cancellable ? (
                  <Button size="sm" variant="secondary" icon={<Undo2 className="size-3.5" />} loading={cancel.isPending && cancel.variables === a.id} onClick={() => cancel.mutate(a.id)}>
                    Desactivar
                  </Button>
                ) : (
                  <Badge tone="amber">Bloqueada</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cartas usadas" icon={<Layers className="size-5" />} />
          {applied.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {applied.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <RarityBadge rarity={a.card.rarity} />
                  <span className="min-w-0 flex-1 truncate text-white">{a.card.name} → {a.targetPlayer?.displayName} (J{a.gameweekId})</span>
                  <span className={clsx('font-bold tabular-nums', a.pointsDelta >= 0 ? 'text-pitch-300' : 'text-red-300')}>{a.pointsDelta > 0 ? '+' : ''}{a.pointsDelta} pts</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Aún no has usado cartas" />
          )}
        </Card>
        <Card>
          <CardHeader title="Cartas recibidas" subtitle="Presión de tus rivales" icon={<ShieldAlert className="size-5" />} />
          {data.received.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {data.received.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-white">{r.fromTeam.name} usó {r.card.name} sobre {r.targetPlayer?.displayName} (J{r.gameweekId})</span>
                  <span className="font-bold tabular-nums text-red-300">{r.pointsDelta} pts</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nadie te ha presionado todavía" />
          )}
        </Card>
      </div>

      <section aria-labelledby="catalog">
        <h2 id="catalog" className="mb-3 font-display text-2xl font-bold uppercase text-white">Catálogo</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.catalog.map((c) => (
            <li key={c.id}>
              <CardFace card={c}>
                <p className="text-xs text-slate-400">{c.obtainable ? 'Se consigue con premios de racha, desafíos y eventos.' : 'No disponible como recompensa ahora mismo.'}</p>
              </CardFace>
            </li>
          ))}
        </ul>
      </section>

      {activating && data.gameweek && (
        <ActivateModal key={activating.id} teamCard={activating} gameweek={data.gameweek} onClose={() => setActivating(null)} />
      )}
    </div>
  );
}

function CardFace({ card, count, children }: { card: PowerUpCard; count?: number; children?: React.ReactNode }) {
  const meta = RARITY_META[card.rarity] ?? RARITY_META.COMMON;
  return (
    <article className={clsx('card flex h-full flex-col gap-3 p-4 ring-1 ring-inset', meta.ring)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <RarityBadge rarity={card.rarity} />
          <h3 className="mt-2 text-xl font-bold uppercase">{card.name}</h3>
        </div>
        <span className={clsx('font-headline text-3xl', meta.text)}>{effectLabel(card)}</span>
      </div>
      <p className="flex-1 text-sm text-slate-300">{card.description}</p>
      {count !== undefined && <p className="text-xs font-semibold text-white">Tienes {count}</p>}
      {children}
    </article>
  );
}

function ActivateModal({ teamCard, gameweek, onClose }: { teamCard: CardsData['inventory'][number]; gameweek: { id: number; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const card = teamCard.card;
  const rival = card.target === 'RIVAL_PLAYER';
  // Un identificador por intento de activación: un doble clic o un reintento no gastan dos cartas
  const [requestId] = useState(() => crypto.randomUUID());
  const [teamId, setTeamId] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);

  const squad = useQuery({ queryKey: ['team'], queryFn: () => api.get<Squad>('/team'), enabled: !rival });
  const rivals = useQuery({ queryKey: ['cards', 'rivals'], queryFn: () => api.get<Rival[]>('/cards/rivals'), enabled: rival });
  const rivalSquad = useQuery({ queryKey: ['cards', 'rival-squad', teamId], queryFn: () => api.get<Player[]>(`/cards/teams/${teamId}/players`), enabled: rival && !!teamId });
  const players: Player[] = rival ? (rivalSquad.data ?? []) : (squad.data?.players ?? []);

  const activate = useMutation({
    mutationFn: () => api.post('/cards/activate', { teamCardId: teamCard.id, targetPlayerId: playerId, targetTeamId: rival ? teamId : null, requestId }),
    onSuccess: () => {
      toast.push('success', `«${card.name}» activada para la ${gameweek.name}`);
      qc.invalidateQueries({ queryKey: ['cards'] });
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Activar «${card.name}»`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!playerId} loading={activate.isPending} onClick={() => activate.mutate()} icon={<Zap className="size-4" />}>
            Activar para la {gameweek.name}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-300">{card.description}</p>
        {rival && (
          <div>
            <label htmlFor="rival" className="label">Equipo rival</label>
            {rivals.isLoading ? (
              <LoadingBlock />
            ) : rivals.data?.length ? (
              <Select id="rival" className="mt-1 w-full" value={teamId ?? ''} onChange={(e) => { setTeamId(Number(e.target.value) || null); setPlayerId(null); }}>
                <option value="">Elige un rival…</option>
                {rivals.data.map((r) => (
                  <option key={r.teamId} value={r.teamId}>{r.teamName} · {r.managerName} ({r.leagues.join(', ')})</option>
                ))}
              </Select>
            ) : (
              <p className="mt-1 text-sm text-amber-200">Solo puedes usar esta carta contra rivales de tus ligas. Únete a una liga con otros mánagers.</p>
            )}
          </div>
        )}
        {(!rival || teamId) && (
          <div>
            <p className="label mb-2">{rival ? 'Jugador del rival' : 'Jugador de tu plantilla'}</p>
            {(rival ? rivalSquad.isLoading : squad.isLoading) ? (
              <LoadingBlock />
            ) : (
              <ul className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" role="radiogroup" aria-label="Jugador objetivo">
                {players.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={playerId === p.id}
                      aria-label={`${p.displayName} (${p.club.shortName})`}
                      onClick={() => setPlayerId(p.id)}
                      className={clsx('flex w-full items-center gap-2 rounded-xl border p-2 text-left transition', playerId === p.id ? 'border-pitch-400 bg-pitch-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/30')}
                    >
                      <PlayerPhoto player={p} size={36} rounded="rounded-lg" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{p.displayName}</span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <PositionBadge position={p.position} /> <ClubCrest club={p.club} size={12} /> {p.club.shortName} · {p.stats.form} forma
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {players.length === 0 && <li className="text-sm text-slate-400">Sin jugadores en la plantilla.</li>}
              </ul>
            )}
          </div>
        )}
        {rival && teamId && rivals.data && (
          <p className="flex items-center gap-2 text-xs text-slate-400">
            <TeamCrest crest={rivals.data.find((r) => r.teamId === teamId)?.crest} size={18} /> Sus estadísticas reales no cambian: solo sus puntos Fantasy en esta jornada.
          </p>
        )}
      </div>
    </Modal>
  );
}
