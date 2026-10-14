import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Coins, Flame, Layers, ShieldAlert, ShieldCheck, Sparkles, Undo2, Zap } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { CARD_CATEGORY_META, dateTime, moneyK, RARITY_META } from '../lib/format';
import type { CardCategory, Crest, Player, PowerUpCard, Squad } from '../types';
import { useToast } from '../context/ToastContext';
import { useLeague } from '../context/LeagueContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Select, Tabs } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, TeamCrest } from '../components/sport';
import { RarityBadge, useServerCountdown } from '../components/economy';

type InventoryItem = CardsData['inventory'][number];

interface Activation {
  id: number;
  teamCardId: number;
  gameweekId: number;
  status: 'ACTIVE' | 'APPLIED' | 'BLOCKED' | 'CONSUMED' | 'CANCELLED';
  effect: string;
  effectValue: number;
  pointsDelta: number;
  moneyDelta: number;
  blocked: boolean;
  card: PowerUpCard;
  targetPlayer: { id: number; displayName: string; photoUrl: string | null; position: string; club: { shortName: string } } | null;
  targetTeam: { id: number; name: string };
  cancellable: boolean;
  createdAt: string;
}

interface CardsData {
  gameweek: { id: number; name: string; deadline: string } | null;
  serverTime: string;
  inventory: { id: number; status: 'AVAILABLE' | 'ACTIVE' | 'USED'; source: string; acquiredAt: string; usedAt: string | null; card: PowerUpCard }[];
  activations: Activation[];
  received: {
    id: number;
    gameweekId: number;
    pointsDelta: number;
    blocked: boolean;
    status: 'ACTIVE' | 'BLOCKED' | 'APPLIED';
    card: PowerUpCard;
    fromTeam: { id: number; name: string };
    targetPlayer: { displayName: string } | null;
  }[];
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

const ACTIVATION_LABEL: Record<string, string> = {
  INSTANT: 'Efecto inmediato',
  PRE_GAMEWEEK: 'Antes del cierre de la jornada',
  REACTIVE: 'Se activa sola al recibir un ataque',
  POST_SCORING: 'Se resuelve al calcular los puntos',
};

/** Resumen corto del efecto, para la esquina de la carta. */
function effectLabel(c: PowerUpCard) {
  switch (c.effect) {
    case 'DOUBLE_POINTS':
      return `×${(c.effectValue / 100).toString().replace('.', ',')}`;
    case 'WEAKEN':
    case 'CAPTAIN_PENALTY':
      return `−${c.effectValue}%`;
    case 'FLAT_BONUS':
    case 'TEAM_BONUS':
    case 'SCORE_BET':
      return `+${c.effectValue}`;
    case 'FLAT_PENALTY':
    case 'TEAM_PENALTY':
    case 'POSITION_PENALTY':
      return `−${c.effectValue}`;
    case 'MONEY':
    case 'TEAM_THRESHOLD_MONEY':
      return moneyK(c.effectValue);
    case 'PLAYER_PERFORMANCE_MONEY':
      return `${moneyK(c.effectValue)}/pt`;
    case 'SHIELD':
      return c.effectValue > 1 ? `${c.effectValue}×🛡` : '🛡';
    default:
      return '🛡';
  }
}

/** Qué hace falta para poder usarla, en una línea. */
function requirement(c: PowerUpCard) {
  if (c.needsRival && c.needsPlayer) return 'Elegirás un rival de tu liga y uno de sus jugadores.';
  if (c.needsRival) return 'Elegirás un equipo rival de tu liga.';
  if (c.needsPlayer) return 'Elegirás un jugador de tu plantilla.';
  if (c.effect === 'ANTIDOTE') return 'Anulará un ataque que ya tengas encima.';
  return 'No necesita objetivo.';
}

const CATEGORY_TABS: { value: CardCategory | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'BOOST', label: 'Potenciadoras' },
  { value: 'WEAKEN', label: 'Debilitadoras' },
  { value: 'DEFENSE', label: 'Defensivas' },
  { value: 'ECONOMY', label: 'Económicas' },
  { value: 'TACTIC', label: 'Tácticas' },
  { value: 'LEGENDARY', label: 'Legendarias' },
];

export default function Cards() {
  const qc = useQueryClient();
  const toast = useToast();
  const { activeLeagueId, activeTeam, withLeague } = useLeague();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['cards', activeLeagueId], queryFn: () => api.get<CardsData>(withLeague('/cards')) });
  const [detail, setDetail] = useState<{ card: PowerUpCard; owned: InventoryItem[] } | null>(null);
  const [activating, setActivating] = useState<InventoryItem | null>(null);
  const [category, setCategory] = useState<CardCategory | 'ALL'>('ALL');
  const [rarity, setRarity] = useState<string>('ALL');
  const [showHistory, setShowHistory] = useState(false);
  const countdown = useServerCountdown(data?.gameweek?.deadline, data?.serverTime);

  const cancel = useMutation({
    mutationFn: (id: number) => api.post(withLeague(`/cards/activations/${id}/cancel`)),
    onSuccess: () => {
      toast.push('success', 'Carta desactivada: vuelve a tu inventario');
      qc.invalidateQueries({ queryKey: ['cards'] });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  // El inventario se agrupa por carta: varias copias de la misma se muestran juntas
  const groups = useMemo(() => {
    const available = (data?.inventory ?? []).filter((t) => t.status === 'AVAILABLE');
    const map = new Map<string, InventoryItem[]>();
    for (const t of available) map.set(t.card.code, [...(map.get(t.card.code) ?? []), t]);
    return [...map.values()];
  }, [data]);

  const visible = useMemo(
    () => groups.filter((g) => (category === 'ALL' || g[0].card.category === category) && (rarity === 'ALL' || g[0].card.rarity === rarity)),
    [groups, category, rarity],
  );

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;

  const active = data.activations.filter((a) => a.status === 'ACTIVE');
  const open = !!data.gameweek && !countdown.done;
  const total = groups.reduce((n, g) => n + g.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={activeTeam?.league ? `Liga · ${activeTeam.league.type === 'GLOBAL' ? 'Liga global' : activeTeam.league.name}` : 'Estrategia'}
        title="Fantasy Cards"
        subtitle="Tus cartas son de esta liga. Cada una se usa una vez: potencia a los tuyos, castiga a un rival, defiéndete o consigue dinero."
        actions={
          <Button variant="secondary" icon={<Layers className="size-4" />} onClick={() => setShowHistory(true)}>
            Historial
          </Button>
        }
      />

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Clock aria-hidden className="size-5 shrink-0 text-pitch-300" />
        {data.gameweek ? (
          <p className="text-sm text-slate-200">
            Tienes <b className="text-white">{total}</b> carta{total === 1 ? '' : 's'} disponible{total === 1 ? '' : 's'}. Las de jornada se activan para la{' '}
            <b className="text-white">{data.gameweek.name}</b> antes del cierre ({dateTime(data.gameweek.deadline)}):{' '}
            <span className="font-mono font-bold text-white">{countdown.label}</span>
          </p>
        ) : (
          <p className="text-sm text-slate-300">No hay ninguna jornada abierta: solo puedes usar cartas de efecto inmediato.</p>
        )}
      </Card>

      {active.length > 0 && (
        <Card>
          <CardHeader title="Cartas en juego" subtitle="Se resuelven al puntuar la jornada" icon={<Sparkles className="size-5" />} />
          <ul className="divide-y divide-white/[0.05]">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <RarityBadge rarity={a.card.rarity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {a.card.name} ({effectLabel(a.card)})
                    {a.targetPlayer && <> → {a.targetPlayer.displayName}</>}
                    {a.targetTeam && a.card.needsRival && <span className="text-slate-400"> de {a.targetTeam.name}</span>}
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

      <section aria-labelledby="inv" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="inv" className="font-display text-2xl font-bold uppercase text-white">Tu colección</h2>
          <Select className="w-44" value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Filtrar por rareza">
            <option value="ALL">Todas las rarezas</option>
            {['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'].map((r) => (
              <option key={r} value={r}>{RARITY_META[r].label}</option>
            ))}
          </Select>
        </div>
        <Tabs value={category} onChange={setCategory} tabs={CATEGORY_TABS} />

        {visible.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((group) => (
              <li key={group[0].card.code}>
                <CardFace card={group[0].card} count={group.length} onClick={() => setDetail({ card: group[0].card, owned: group })}>
                  <p className="text-xs text-slate-400">Conseguida por: {[...new Set(group.map((g) => SOURCE_LABEL[g.source] ?? g.source))].join(', ')}</p>
                </CardFace>
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <EmptyState
              icon={<Layers className="size-6" />}
              title={groups.length ? 'Ninguna carta con ese filtro' : 'Todavía no tienes cartas en esta liga'}
              description={
                groups.length
                  ? 'Prueba con otra categoría o rareza.'
                  : 'Las cartas se consiguen con recompensas: mantén tu racha en los desafíos diarios y gánalas al acertar el Wordle.'
              }
              action={
                groups.length ? undefined : (
                  <Link to="/challenges">
                    <Button variant="secondary" icon={<Flame className="size-4" />}>Ir a Desafíos diarios</Button>
                  </Link>
                )
              }
            />
          </Card>
        )}
      </section>

      <section aria-labelledby="catalog" className="space-y-3">
        <h2 id="catalog" className="font-display text-2xl font-bold uppercase text-white">Catálogo completo</h2>
        <p className="text-sm text-slate-400">Todas las cartas que existen. Las que no tienes aparecen apagadas.</p>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.catalog
            .filter((c) => (category === 'ALL' || c.category === category) && (rarity === 'ALL' || c.rarity === rarity))
            .map((c) => {
              const owned = groups.find((g) => g[0].card.code === c.code);
              return (
                <li key={c.id}>
                  <CardFace card={c} count={owned?.length} dimmed={!owned} onClick={() => setDetail({ card: c, owned: owned ?? [] })}>
                    <p className="text-xs text-slate-400">
                      {c.unavailableReason ? c.unavailableReason : c.obtainable ? 'Se consigue con rachas, desafíos y eventos.' : 'No disponible como recompensa ahora mismo.'}
                    </p>
                  </CardFace>
                </li>
              );
            })}
        </ul>
      </section>

      {detail && (
        <DetailModal
          card={detail.card}
          owned={detail.owned}
          canActivate={open || detail.card.activation === 'INSTANT'}
          onActivate={() => {
            setActivating(detail.owned[0]);
            setDetail(null);
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {showHistory && <HistoryModal data={data} onClose={() => setShowHistory(false)} />}
      {activating && <ActivateModal key={activating.id} teamCard={activating} gameweek={data.gameweek} received={data.received} onClose={() => setActivating(null)} />}
    </div>
  );
}

function CardFace({
  card,
  count,
  dimmed,
  onClick,
  children,
}: {
  card: PowerUpCard;
  count?: number;
  dimmed?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const rarityMeta = RARITY_META[card.rarity] ?? RARITY_META.COMMON;
  const cat = CARD_CATEGORY_META[card.category] ?? CARD_CATEGORY_META.BOOST;
  return (
    <article
      className={clsx(
        'card relative flex h-full flex-col gap-3 overflow-hidden p-4 text-left ring-1 ring-inset transition',
        cat.ring,
        dimmed ? 'opacity-55' : 'hover:border-white/25',
        onClick && 'cursor-pointer',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div aria-hidden className={clsx('pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent', cat.glow)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={clsx('rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset', cat.chip)}>{cat.label}</span>
            <RarityBadge rarity={card.rarity} />
          </div>
          <h3 className="mt-2 truncate text-xl font-bold uppercase text-white">{card.name}</h3>
        </div>
        <span className={clsx('shrink-0 font-headline text-3xl', rarityMeta.text)}>{effectLabel(card)}</span>
      </div>
      <p className="relative flex-1 text-sm text-slate-300">{card.description}</p>
      {count !== undefined && count > 0 && <p className="relative text-xs font-semibold text-white">Tienes {count}</p>}
      {!card.isActive && <Badge tone="amber">No disponible</Badge>}
      <div className="relative">{children}</div>
    </article>
  );
}

/** Ficha completa: qué hace, sobre quién, cuándo y cuánto consume. */
function DetailModal({
  card,
  owned,
  canActivate,
  onActivate,
  onClose,
}: {
  card: PowerUpCard;
  owned: InventoryItem[];
  canActivate: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const cat = CARD_CATEGORY_META[card.category] ?? CARD_CATEGORY_META.BOOST;
  const usable = owned.length > 0 && card.isActive && canActivate;
  return (
    <Modal
      open
      onClose={onClose}
      title={card.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          {owned.length > 0 && (
            <Button disabled={!usable} loading={false} onClick={onActivate} icon={<Zap className="size-4" />}>
              Usar carta
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset', cat.chip)}>{cat.label}</span>
          <RarityBadge rarity={card.rarity} />
          {owned.length > 0 && <Badge tone="green">Tienes {owned.length}</Badge>}
        </div>
        <p className="text-slate-300">{card.description}</p>
        <dl className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.05] p-3">
          <dt className="text-slate-400">Efecto</dt>
          <dd className="text-right font-semibold text-white">{effectLabel(card)}</dd>
          <dt className="text-slate-400">Cuándo</dt>
          <dd className="text-right text-white">{ACTIVATION_LABEL[card.activation]}</dd>
          <dt className="text-slate-400">Objetivo</dt>
          <dd className="text-right text-white">{requirement(card)}</dd>
          <dt className="text-slate-400">Duración</dt>
          <dd className="text-right text-white">{card.activation === 'INSTANT' ? 'Inmediata' : 'Una jornada'}</dd>
          <dt className="text-slate-400">Consume</dt>
          <dd className="text-right text-white">1 copia</dd>
          <dt className="text-slate-400">Máximo por jornada</dt>
          <dd className="text-right text-white">{card.maxPerGameweek}</dd>
        </dl>
        {card.unavailableReason && <p className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200">{card.unavailableReason}</p>}
        {owned.length > 0 && card.isActive && !canActivate && <p className="text-xs text-amber-200">No hay ninguna jornada abierta para activarla.</p>}
        {owned.length > 0 && card.isActive && canActivate && (
          <p className="text-xs text-slate-400">Al confirmar se gasta una copia y, salvo las de jornada antes del cierre, no se puede deshacer.</p>
        )}
      </div>
    </Modal>
  );
}

/** Historial: lo que has usado, lo que has ganado y los ataques en ambos sentidos. */
function HistoryModal({ data, onClose }: { data: CardsData; onClose: () => void }) {
  const applied = data.activations.filter((a) => a.status !== 'ACTIVE');
  return (
    <Modal open onClose={onClose} title="Historial de cartas" size="lg">
      <div className="space-y-5">
        <section>
          <h3 className="label mb-2">Cartas que has usado</h3>
          {applied.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {applied.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <RarityBadge rarity={a.card.rarity} />
                  <span className="min-w-0 flex-1 truncate text-white">
                    {a.card.name}
                    {a.targetPlayer && ` → ${a.targetPlayer.displayName}`} (J{a.gameweekId})
                  </span>
                  {a.blocked && <Badge tone="amber">Neutralizada</Badge>}
                  {a.moneyDelta > 0 && <span className="font-bold tabular-nums text-amber-200">{moneyK(a.moneyDelta)}</span>}
                  {a.pointsDelta !== 0 && (
                    <span className={clsx('font-bold tabular-nums', a.pointsDelta >= 0 ? 'text-pitch-300' : 'text-red-300')}>
                      {a.pointsDelta > 0 ? '+' : ''}
                      {a.pointsDelta} pts
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Aún no has usado cartas" />
          )}
        </section>
        <section>
          <h3 className="label mb-2 flex items-center gap-2">
            <ShieldAlert className="size-4" /> Ataques recibidos
          </h3>
          {data.received.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {data.received.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-white">
                    {r.fromTeam.name} usó {r.card.name}
                    {r.targetPlayer && ` sobre ${r.targetPlayer.displayName}`} (J{r.gameweekId})
                  </span>
                  {r.blocked ? (
                    <Badge tone="green">
                      <ShieldCheck className="size-3" /> Bloqueado
                    </Badge>
                  ) : (
                    <span className="font-bold tabular-nums text-red-300">{r.pointsDelta} pts</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nadie te ha atacado todavía" />
          )}
        </section>
      </div>
    </Modal>
  );
}

function ActivateModal({
  teamCard,
  gameweek,
  received,
  onClose,
}: {
  teamCard: InventoryItem;
  gameweek: { id: number; name: string } | null;
  received: CardsData['received'];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const card = teamCard.card;
  const needsRival = card.needsRival;
  const needsPlayer = card.needsPlayer;
  const isAntidote = card.effect === 'ANTIDOTE';
  // Un identificador por intento de activación: un doble clic o un reintento no gastan dos cartas
  const [requestId] = useState(() => crypto.randomUUID());
  const [teamId, setTeamId] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [activationId, setActivationId] = useState<number | null>(null);

  const { activeLeagueId, withLeague } = useLeague();
  const squad = useQuery({ queryKey: ['team', activeLeagueId], queryFn: () => api.get<Squad>(withLeague('/team')), enabled: needsPlayer && !needsRival });
  const rivals = useQuery({ queryKey: ['cards', activeLeagueId, 'rivals'], queryFn: () => api.get<Rival[]>(withLeague('/cards/rivals')), enabled: needsRival });
  const rivalSquad = useQuery({
    queryKey: ['cards', activeLeagueId, 'rival-squad', teamId],
    queryFn: () => api.get<Player[]>(withLeague(`/cards/teams/${teamId}/players`)),
    enabled: needsRival && needsPlayer && !!teamId,
  });
  const players: Player[] = needsRival ? (rivalSquad.data ?? []) : (squad.data?.players ?? []);
  // Para el antídoto: los ataques vivos que se pueden anular
  const anulables = received.filter((r) => r.status === 'ACTIVE' && gameweek && r.gameweekId === gameweek.id);

  const activate = useMutation({
    mutationFn: () =>
      api.post<{ blocked?: boolean; money?: number }>(withLeague('/cards/activate'), {
        teamCardId: teamCard.id,
        targetPlayerId: needsPlayer ? playerId : null,
        targetTeamId: needsRival ? teamId : null,
        targetActivationId: isAntidote ? activationId : null,
        requestId,
      }),
    onSuccess: (res) => {
      if (res.blocked) toast.push('info', `«${card.name}» fue neutralizada por la defensa del rival`);
      else if (res.money) toast.push('success', `«${card.name}»: ${moneyK(res.money)} ingresados`);
      else toast.push('success', `«${card.name}» activada${gameweek ? ` para la ${gameweek.name}` : ''}`);
      for (const key of ['cards', 'team', 'dashboard', 'lineup', 'economy-tx', 'league-market']) qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  const ready = (!needsRival || !!teamId) && (!needsPlayer || !!playerId) && (!isAntidote || !!activationId || anulables.length === 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Usar «${card.name}»`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!ready} loading={activate.isPending} onClick={() => activate.mutate()} icon={card.effect === 'MONEY' ? <Coins className="size-4" /> : <Zap className="size-4" />}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-300">{card.description}</p>
        <p className="text-xs text-slate-400">{ACTIVATION_LABEL[card.activation]} · consume 1 copia{card.activation === 'INSTANT' ? ' y no se puede deshacer' : ''}.</p>

        {needsRival && (
          <div>
            <label htmlFor="rival" className="label">Equipo rival</label>
            {rivals.isLoading ? (
              <LoadingBlock />
            ) : rivals.data?.length ? (
              <Select
                id="rival"
                className="mt-1 w-full"
                value={teamId ?? ''}
                onChange={(e) => {
                  setTeamId(Number(e.target.value) || null);
                  setPlayerId(null);
                }}
              >
                <option value="">Elige un rival…</option>
                {rivals.data.map((r) => (
                  <option key={r.teamId} value={r.teamId}>
                    {r.teamName} · {r.managerName}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="mt-1 text-sm text-amber-200">Solo puedes usar esta carta contra rivales de tu liga.</p>
            )}
          </div>
        )}

        {isAntidote && (
          <div>
            <label htmlFor="attack" className="label">Ataque que quieres anular</label>
            {anulables.length ? (
              <Select id="attack" className="mt-1 w-full" value={activationId ?? ''} onChange={(e) => setActivationId(Number(e.target.value) || null)}>
                <option value="">Elige un ataque…</option>
                {anulables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.card.name} de {r.fromTeam.name}
                    {r.targetPlayer ? ` sobre ${r.targetPlayer.displayName}` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="mt-1 text-sm text-amber-200">Ahora mismo no tienes ningún ataque que anular.</p>
            )}
          </div>
        )}

        {needsPlayer && (!needsRival || teamId) && (
          <div>
            <p className="label mb-2">{needsRival ? 'Jugador del rival' : 'Jugador de tu plantilla'}</p>
            {(needsRival ? rivalSquad.isLoading : squad.isLoading) ? (
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
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-xl border p-2 text-left transition',
                        playerId === p.id ? 'border-pitch-400 bg-pitch-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/30',
                      )}
                    >
                      <PlayerPhoto player={p} size={36} rounded="rounded-lg" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{p.displayName}</span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <PositionBadge position={p.position} /> <ClubCrest club={p.club} size={12} /> {p.club.shortName}
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

        {needsRival && teamId && rivals.data && (
          <p className="flex items-center gap-2 text-xs text-slate-400">
            <TeamCrest crest={rivals.data.find((r) => r.teamId === teamId)?.crest} size={18} /> Sus estadísticas reales no cambian: solo sus puntos Fantasy de esta jornada. Si
            tiene una defensa activa, puede bloquear tu carta.
          </p>
        )}
      </div>
    </Modal>
  );
}
