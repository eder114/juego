import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Coins, Gift, History, Layers, RefreshCw, Store, UserRound, Users } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTime, moneyIn, moneyK } from '../../lib/format';
import type { Coach, PowerUpCard } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, CardHeader, ConfirmModal, EmptyState, Field, Input, LoadingBlock, Modal, Select, StatCard, Tabs, Toggle } from '../../components/ui';
import { ClubCrest } from '../../components/sport';
import { CoachPhoto, RarityBadge } from '../../components/economy';

interface Overview {
  leagues: { id: number; name: string; type: string; economyVersion: number; marketTimezone: string; resetTime: number; marketPityCounter: number; createdAt: string; _count: { members: number; economyTeams: number } }[];
  teams: { inLeagueEconomy: number; classic: number };
  cards: (PowerUpCard & { _count: { inventory: number } })[];
  teamCards: Record<string, number>;
  coaches: { total: number; active: number };
  playersValued: number;
  wordle: { date: string; players: number; won: number };
  audit: AuditRow[];
}
interface AuditRow {
  id: number;
  leagueId: number | null;
  teamId: number | null;
  action: string;
  details: string;
  createdAt: string;
}
interface LeagueDetail {
  league: { id: number; name: string; economyVersion: number };
  current: { cycle: { cycleDate: string; startsAt: string; endsAt: string }; listings: { id: number; assetType: string; rarity: string; listingPrice: number; status: string; player: { displayName: string; position: string; club: { shortName: string } } | null; coach: { displayName: string } | null }[] } | null;
  audit: AuditRow[];
}
interface TeamRow {
  id: number;
  name: string;
  economyVersion: number;
  wallet: number;
  budget: number;
  economyLeague: { id: number; name: string } | null;
  user: { managerName: string };
}

const ACTION_LABEL: Record<string, string> = {
  CYCLE_GENERATED: 'Mercado generado',
  PURCHASE: 'Compra',
  PURCHASE_REJECTED: 'Compra rechazada',
  SALE: 'Venta',
  ECONOMY_JOINED: 'Entrada en la economía',
  ECONOMY_LEFT: 'Salida de la economía',
  ECONOMY_RESET: 'Reinicio de economía',
  LEAGUE_MIGRATED: 'Liga migrada',
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function AdminEconomy() {
  const [tab, setTab] = useState<'leagues' | 'cards' | 'coaches' | 'wallets' | 'audit'>('leagues');
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'economy'], queryFn: () => api.get<Overview>('/admin/economy/overview') });
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ligas con economía" value={data.leagues.filter((l) => l.economyVersion === 2).length} icon={<Store />} sub={`${data.leagues.length} ligas de usuarios`} />
        <StatCard label="Equipos en partida" value={data.teams.inLeagueEconomy} icon={<Users />} sub={`${data.teams.classic} en el sistema clásico`} />
        <StatCard label="Entrenadores" value={`${data.coaches.active}/${data.coaches.total}`} icon={<UserRound />} sub={`${data.playersValued} jugadores valorados`} />
        <StatCard label="Wordle de hoy" value={`${data.wordle.won}/${data.wordle.players}`} icon={<Gift />} sub="Aciertos / jugadores" />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'leagues', label: 'Ligas' },
          { value: 'cards', label: 'Cartas' },
          { value: 'coaches', label: 'Entrenadores y valores' },
          { value: 'wallets', label: 'Monederos' },
          { value: 'audit', label: 'Auditoría' },
        ]}
      />
      {tab === 'leagues' && <LeaguesTab leagues={data.leagues} />}
      {tab === 'cards' && <CardsTab cards={data.cards} counts={data.teamCards} />}
      {tab === 'coaches' && <CoachesTab />}
      {tab === 'wallets' && <WalletsTab />}
      {tab === 'audit' && <AuditList rows={data.audit} />}
      <p className="text-xs text-slate-500">Probabilidades, rarezas, pity, fórmula de valoración, premios y palabras del Wordle se editan en Configuración.</p>
    </div>
  );
}

function useAdminAction<T>(fn: (v: T) => Promise<unknown>, success: (r: unknown, v: T) => string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      toast.push('success', success(r, v));
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
}

function LeaguesTab({ leagues }: { leagues: Overview['leagues'] }) {
  const [migrating, setMigrating] = useState<Overview['leagues'][number] | null>(null);
  const [resetting, setResetting] = useState<Overview['leagues'][number] | null>(null);
  const [resetWord, setResetWord] = useState('');
  const [detail, setDetail] = useState<number | null>(null);
  const [scheduling, setScheduling] = useState<Overview['leagues'][number] | null>(null);
  const [schedule, setSchedule] = useState({ resetTime: '', timezone: '' });

  const migrate = useAdminAction((id: number) => api.post<{ joined: number; skipped: unknown[] }>(`/admin/economy/leagues/${id}/migrate`, { confirm: true }), (r) => {
    const res = r as { joined: number; skipped: unknown[] };
    return `Liga migrada: ${res.joined} equipo(s) con equipo inicial${res.skipped.length ? `, ${res.skipped.length} ya jugaban otra liga` : ''}`;
  });
  const reset = useAdminAction((id: number) => api.post<{ teams: number }>(`/admin/economy/leagues/${id}/reset`, { confirm: resetWord }), (r) => `Economía reinicializada: ${(r as { teams: number }).teams} equipo(s)`);
  const saveSchedule = useAdminAction((id: number) => api.patch(`/admin/economy/leagues/${id}/schedule`, schedule), () => 'Horario actualizado (se aplica desde el próximo mercado)');
  const leagueDetail = useQuery({ queryKey: ['admin', 'economy', 'league', detail], queryFn: () => api.get<LeagueDetail>(`/admin/economy/leagues/${detail}`), enabled: !!detail });

  return (
    <Card className="overflow-hidden">
      {leagues.length === 0 ? (
        <EmptyState title="No hay ligas de usuarios" />
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {leagues.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                  {l.name}
                  <Badge tone={l.economyVersion === 2 ? 'green' : 'slate'}>{l.economyVersion === 2 ? 'Economía de liga' : 'Clásica'}</Badge>
                </p>
                <p className="text-xs text-slate-400">
                  {l._count.members} miembros · {l._count.economyTeams} en la partida · mercado {hhmm(l.resetTime)} ({l.marketTimezone}) · pity {l.marketPityCounter}
                </p>
              </div>
              {l.economyVersion === 2 ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setDetail(detail === l.id ? null : l.id)}>Mercado</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setScheduling(l); setSchedule({ resetTime: hhmm(l.resetTime), timezone: l.marketTimezone }); }}>Horario</Button>
                  <Button size="sm" variant="danger" onClick={() => { setResetting(l); setResetWord(''); }}>Reinicializar</Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setMigrating(l)}>Migrar a economía de liga</Button>
              )}
              {detail === l.id && (
                <div className="w-full rounded-xl bg-white/[0.03] p-3">
                  {leagueDetail.isLoading || !leagueDetail.data ? (
                    <LoadingBlock />
                  ) : leagueDetail.data.current ? (
                    <>
                      <p className="label mb-2">Mercado {leagueDetail.data.current.cycle.cycleDate} · cierra {dateTime(leagueDetail.data.current.cycle.endsAt)}</p>
                      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                        {leagueDetail.data.current.listings.map((li) => (
                          <li key={li.id} className="flex items-center gap-2">
                            <RarityBadge rarity={li.rarity} />
                            <span className="min-w-0 flex-1 truncate text-white">{li.player ? `${li.player.displayName} (${li.player.position}, ${li.player.club.shortName})` : `Entrenador: ${li.coach?.displayName}`}</span>
                            <span className="tabular-nums text-slate-300">{moneyK(li.listingPrice)}</span>
                            <Badge tone={li.status === 'SOLD' ? 'red' : 'green'}>{li.status === 'SOLD' ? 'Vendido' : 'Disponible'}</Badge>
                          </li>
                        ))}
                      </ul>
                      <p className="label mb-1 mt-4">Últimos movimientos</p>
                      <AuditList rows={leagueDetail.data.audit.slice(0, 15)} compact />
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">Sin mercado.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!migrating}
        onClose={() => setMigrating(null)}
        title="Migrar liga a la economía de liga"
        danger
        confirmLabel="Migrar liga"
        loading={migrate.isPending}
        onConfirm={() => migrating && migrate.mutate(migrating.id, { onSuccess: () => setMigrating(null) })}
        message={
          <>
            Los miembros de <b className="text-white">{migrating?.name}</b> que no jueguen ya otra liga recibirán un equipo inicial nuevo y el presupuesto inicial; su plantilla del sistema clásico se guarda en la auditoría y se sustituye. Los puntos y clasificaciones se conservan.
          </>
        }
      />

      <Modal
        open={!!resetting}
        onClose={() => setResetting(null)}
        title="REINICIALIZAR ECONOMÍA DE LIGA"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetting(null)}>Cancelar</Button>
            <Button variant="danger" disabled={resetWord !== 'REINICIALIZAR'} loading={reset.isPending} onClick={() => resetting && reset.mutate(resetting.id, { onSuccess: () => setResetting(null) })}>
              Reinicializar
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-300">
          <p className="flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">
            <AlertTriangle className="size-5 shrink-0" /> Todas las plantillas y monederos de <b>{resetting?.name}</b> se liberan y cada equipo recibe un equipo inicial nuevo. El mercado de hoy se regenera.
          </p>
          <p>Se guarda antes una instantánea completa en la auditoría. Las jornadas, los puntos y los mercados anteriores no se borran.</p>
          <Field label="Escribe REINICIALIZAR para confirmar">
            <Input value={resetWord} onChange={(e) => setResetWord(e.target.value)} autoComplete="off" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!scheduling}
        onClose={() => setScheduling(null)}
        title={`Horario del mercado · ${scheduling?.name ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setScheduling(null)}>Cancelar</Button>
            <Button loading={saveSchedule.isPending} onClick={() => scheduling && saveSchedule.mutate(scheduling.id, { onSuccess: () => setScheduling(null) })}>Guardar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Hora de renovación"><Input type="time" value={schedule.resetTime} onChange={(e) => setSchedule({ ...schedule, resetTime: e.target.value })} /></Field>
          <Field label="Zona horaria (IANA)"><Input value={schedule.timezone} onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

function CardsTab({ cards, counts }: { cards: Overview['cards']; counts: Record<string, number> }) {
  const [editing, setEditing] = useState<PowerUpCard | null>(null);
  const [form, setForm] = useState<Partial<PowerUpCard>>({});
  const [grant, setGrant] = useState({ search: '', teamId: 0, cardCode: cards[0]?.code ?? '' });
  const teams = useQuery({ queryKey: ['admin', 'economy', 'teams', grant.search], queryFn: () => api.get<TeamRow[]>(`/admin/economy/teams?search=${encodeURIComponent(grant.search)}`) });
  const save = useAdminAction((c: PowerUpCard) => api.patch(`/admin/economy/cards/${c.id}`, form), () => 'Carta actualizada');
  const give = useAdminAction(() => api.post('/admin/economy/cards/grant', { teamId: grant.teamId, cardCode: grant.cardCode }), () => 'Carta concedida');
  const restore = useAdminAction(() => api.post('/admin/economy/cards/restore-defaults'), () => 'Catálogo revisado: se han creado las cartas que faltaban');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="overflow-hidden">
        <CardHeader
          title="Catálogo de cartas"
          subtitle={`Inventario: ${counts.AVAILABLE ?? 0} disponibles · ${counts.ACTIVE ?? 0} activas · ${counts.USED ?? 0} usadas`}
          icon={<Layers className="size-5" />}
          action={<Button size="sm" variant="secondary" loading={restore.isPending} onClick={() => restore.mutate(undefined)}>Restaurar faltantes</Button>}
        />
        <div className="divide-y divide-white/[0.05]">
          {cards.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <RarityBadge rarity={c.rarity} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{c.name} <span className="text-xs text-slate-500">({c.code})</span></p>
                <p className="text-xs text-slate-400">
                  {c.effect === 'DOUBLE_POINTS' ? `Multiplicador ${c.effectValue}%` : `Resta ${c.effectValue}% de los puntos`} · máx. {c.maxPerGameweek}/jornada · {c._count.inventory} repartidas
                </p>
              </div>
              <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'Activable' : 'Desactivada'}</Badge>
              <Badge tone={c.obtainable ? 'sky' : 'slate'}>{c.obtainable ? 'Obtenible' : 'No obtenible'}</Badge>
              <Button size="sm" variant="secondary" onClick={() => { setEditing(c); setForm({ name: c.name, description: c.description, rarity: c.rarity, effectValue: c.effectValue, maxPerGameweek: c.maxPerGameweek, isActive: c.isActive, obtainable: c.obtainable }); }}>
                Editar
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Conceder carta" subtitle="Eventos o compensaciones" icon={<Gift className="size-5" />} />
        <div className="space-y-3 p-4">
          <Field label="Buscar equipo o mánager"><Input value={grant.search} onChange={(e) => setGrant({ ...grant, search: e.target.value })} /></Field>
          <Select value={grant.teamId} onChange={(e) => setGrant({ ...grant, teamId: Number(e.target.value) })} className="w-full">
            <option value={0}>Elige un equipo…</option>
            {teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.user.managerName}</option>)}
          </Select>
          <Select value={grant.cardCode} onChange={(e) => setGrant({ ...grant, cardCode: e.target.value })} className="w-full">
            {cards.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <Button className="w-full" disabled={!grant.teamId} loading={give.isPending} onClick={() => give.mutate(undefined)}>Conceder</Button>
        </div>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Editar «${editing?.name ?? ''}»`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button loading={save.isPending} onClick={() => editing && save.mutate(editing, { onSuccess: () => setEditing(null) })}>Guardar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Descripción"><Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Rareza">
              <Select value={form.rarity} onChange={(e) => setForm({ ...form, rarity: e.target.value as PowerUpCard['rarity'] })}>
                {['COMMON', 'RARE', 'EPIC', 'LEGENDARY'].map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label={editing?.effect === 'DOUBLE_POINTS' ? 'Multiplicador (%)' : 'Penalización (%)'}>
              <Input type="number" value={form.effectValue ?? 0} onChange={(e) => setForm({ ...form, effectValue: Number(e.target.value) })} />
            </Field>
            <Field label="Máx. por jornada"><Input type="number" min={1} max={5} value={form.maxPerGameweek ?? 1} onChange={(e) => setForm({ ...form, maxPerGameweek: Number(e.target.value) })} /></Field>
          </div>
          <Toggle checked={!!form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Se puede activar" />
          <Toggle checked={!!form.obtainable} onChange={(v) => setForm({ ...form, obtainable: v })} label="Se puede conseguir como recompensa" />
        </div>
      </Modal>
    </div>
  );
}

function CoachesTab() {
  const coaches = useQuery({ queryKey: ['admin', 'economy', 'coaches'], queryFn: () => api.get<Coach[]>('/admin/economy/coaches') });
  const [confirm, setConfirm] = useState<'recalibrate' | null>(null);
  const sync = useAdminAction(() => api.post<{ created: number; updated: number; deactivated: number }>('/admin/economy/coaches/sync'), (r) => {
    const s = r as { created: number; updated: number; deactivated: number };
    return `Entrenadores sincronizados: ${s.created} nuevos, ${s.updated} actualizados, ${s.deactivated} sin club`;
  });
  const recalibrate = useAdminAction(() => api.post<{ players: number }>('/admin/economy/valuations/recalibrate'), (r) => `Valores recalculados con la curva actual (${(r as { players: number }).players} jugadores)`);
  const rarities = useAdminAction(() => api.post<{ changed: number }>('/admin/economy/valuations/rarities'), (r) => `Rarezas recalculadas (${(r as { changed: number }).changed} cambios)`);

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Coins className="size-5 text-pitch-300" />
        <p className="min-w-0 flex-1 text-sm text-slate-300">Los valores cambian solos tras cada jornada. Recalibrar aplica la curva inicial de Configuración a todos los jugadores (queda en el historial).</p>
        <Button size="sm" variant="secondary" loading={rarities.isPending} onClick={() => rarities.mutate(undefined)}>Recalcular rarezas</Button>
        <Button size="sm" variant="danger" onClick={() => setConfirm('recalibrate')}>Recalibrar valores</Button>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader
          title="Entrenadores reales"
          subtitle="Fuente: API oficial de la Premier League (cuerpo técnico de cada club)"
          icon={<UserRound className="size-5" />}
          action={<Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} onClick={() => sync.mutate(undefined)}>Sincronizar</Button>}
        />
        {coaches.isLoading ? (
          <LoadingBlock />
        ) : coaches.data?.length ? (
          <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {coaches.data.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-2.5">
                <CoachPhoto url={c.photoUrl} name={c.displayName} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{c.displayName}</p>
                  <p className="flex items-center gap-1 text-xs text-slate-400">{c.club && <ClubCrest club={c.club} size={12} />} {c.club?.shortName ?? 'Sin club'} · {moneyK(c.marketValue)}</p>
                </div>
                {c.isActive ? <RarityBadge rarity={c.rarity} /> : <Badge>Inactivo</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin entrenadores" description="Pulsa Sincronizar para descargarlos de la API oficial." />
        )}
      </Card>
      <ConfirmModal
        open={confirm === 'recalibrate'}
        onClose={() => setConfirm(null)}
        title="Recalibrar todos los valores"
        danger
        confirmLabel="Recalibrar"
        loading={recalibrate.isPending}
        onConfirm={() => recalibrate.mutate(undefined, { onSuccess: () => setConfirm(null) })}
        message="Todos los jugadores y entrenadores vuelven al valor de la curva inicial (precio oficial FPL). Se pierden las subidas y bajadas por rendimiento acumuladas, aunque quedan en el historial. Los anuncios del mercado de hoy mantienen su precio."
      />
    </div>
  );
}

function WalletsTab() {
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState<TeamRow | null>(null);
  const [adj, setAdj] = useState({ millions: 0, description: '' });
  const teams = useQuery({ queryKey: ['admin', 'economy', 'teams', search], queryFn: () => api.get<TeamRow[]>(`/admin/economy/teams?search=${encodeURIComponent(search)}`) });
  const save = useAdminAction((t: TeamRow) => api.post(`/admin/economy/teams/${t.id}/wallet`, { amount: Math.round(adj.millions * 1000), description: adj.description }), () => 'Monedero ajustado (registrado como ajuste de administración)');
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <Input placeholder="Buscar equipo o mánager…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="divide-y divide-white/[0.05]">
        {teams.data?.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{t.name} <span className="text-slate-400">· {t.user.managerName}</span></p>
              <p className="text-xs text-slate-400">{t.economyVersion === 2 ? (t.economyLeague ? `Liga «${t.economyLeague.name}»` : 'Economía de liga (sin liga)') : 'Sistema clásico'}</p>
            </div>
            <span className="font-bold tabular-nums text-white">{t.economyVersion === 2 ? moneyK(t.wallet) : moneyIn(t.budget, 'TENTHS')}</span>
            <Button size="sm" variant="secondary" disabled={t.economyVersion !== 2} onClick={() => { setAdjusting(t); setAdj({ millions: 0, description: '' }); }}>Ajustar</Button>
          </div>
        ))}
      </div>
      <Modal
        open={!!adjusting}
        onClose={() => setAdjusting(null)}
        title={`Ajustar monedero · ${adjusting?.name ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjusting(null)}>Cancelar</Button>
            <Button disabled={!adj.millions || adj.description.trim().length < 3} loading={save.isPending} onClick={() => adjusting && save.mutate(adjusting, { onSuccess: () => setAdjusting(null) })}>Aplicar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Importe en millones (negativo para restar)"><Input type="number" step="0.05" value={adj.millions} onChange={(e) => setAdj({ ...adj, millions: Number(e.target.value) })} /></Field>
          <Field label="Motivo"><Input value={adj.description} maxLength={120} onChange={(e) => setAdj({ ...adj, description: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

function AuditList({ rows, compact }: { rows: AuditRow[]; compact?: boolean }) {
  if (!rows.length) return <EmptyState icon={<History className="size-6" />} title="Sin registros" />;
  const list = (
    <ul className="divide-y divide-white/[0.05] text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
          <Badge tone={r.action === 'PURCHASE_REJECTED' ? 'amber' : r.action.startsWith('ECONOMY') || r.action === 'LEAGUE_MIGRATED' ? 'violet' : 'slate'}>{ACTION_LABEL[r.action] ?? r.action}</Badge>
          <span className="text-xs text-slate-400">{dateTime(r.createdAt)}{r.leagueId ? ` · liga ${r.leagueId}` : ''}{r.teamId ? ` · equipo ${r.teamId}` : ''}</span>
          {!compact && <code className="block w-full truncate text-[11px] text-slate-500">{r.details}</code>}
        </li>
      ))}
    </ul>
  );
  return compact ? list : <Card className="overflow-hidden">{list}</Card>;
}
