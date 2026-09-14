import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Crown, Eye, Lock, RotateCcw, Save, ShieldAlert, ShoppingBag, UserMinus } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { countdown, dateTime, GW_STATUS, POSITION_PLURAL, STATUS_META } from '../lib/format';
import type { LineupEntry, LineupView, Position } from '../types';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, StatusBadge } from '../components/sport';
import { Pitch, type LineupState } from '../components/Pitch';

const FORMATIONS = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];
const BLOCKING = ['INJURED', 'SUSPENDED', 'UNAVAILABLE'];

function fromView(view: LineupView): LineupState {
  const byOrder = (role: string) => view.players.filter((e) => e.role === role).sort((a, b) => a.order - b.order).map((e) => e.player.id);
  return { formation: view.formation, starters: byOrder('STARTER'), bench: byOrder('BENCH'), captainId: view.captainId, viceCaptainId: view.viceCaptainId };
}

function counts(ids: number[], entries: Map<number, LineupEntry>) {
  const c: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of ids) {
    const e = entries.get(id);
    if (e) c[e.player.position] += 1;
  }
  return c;
}

function formationOf(ids: number[], entries: Map<number, LineupEntry>) {
  const c = counts(ids, entries);
  const f = `${c.DEF}-${c.MID}-${c.FWD}`;
  return ids.length === 11 && c.GK === 1 && FORMATIONS.includes(f) ? f : null;
}

export default function Lineup() {
  const [params, setParams] = useSearchParams();
  const gw = params.get('gw') ?? undefined;
  const toast = useToast();
  const qc = useQueryClient();
  const { data: view, isLoading, error, refetch } = useQuery({ queryKey: ['lineup', gw ?? 'current'], queryFn: () => api.get<LineupView>(`/team/lineup${gw ? `?gameweek=${gw}` : ''}`) });

  const [state, setState] = useState<LineupState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (view) {
      setState(fromView(view));
      setDirty(false);
      setSelected(null);
    }
  }, [view]);

  const entries = useMemo(() => new Map((view?.players ?? []).map((e) => [e.player.id, e])), [view]);
  const squadEntries = useMemo(() => (view?.players ?? []).filter((e) => e.inSquad), [view]);

  const save = useMutation({
    mutationFn: () => api.put<{ warnings: string[] }>(`/team/lineup/${view!.gameweek.id}`, state),
    onSuccess: (res) => {
      toast.push('success', res.warnings.length ? `Alineación guardada. Aviso: ${res.warnings[0]}` : 'Alineación guardada');
      qc.invalidateQueries({ queryKey: ['lineup'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  const roleOf = (s: LineupState, id: number) => (s.starters.includes(id) ? 'S' : s.bench.includes(id) ? 'B' : 'O');

  /** Intercambia dos jugadores respetando formaciones y bloqueos. */
  const trySwap = (s: LineupState, a: number, b: number): { next?: LineupState; error?: string } => {
    const ea = entries.get(a);
    const eb = entries.get(b);
    if (!ea || !eb || a === b) return {};
    if (ea.locked || eb.locked) return { error: `${ea.locked ? ea.player.displayName : eb.player.displayName} está bloqueado: su partido ya ha comenzado` };
    const ra = roleOf(s, a);
    const rb = roleOf(s, b);
    if (ra === 'S' && rb === 'S') return { error: 'Ambos jugadores ya son titulares' };
    if (ra === 'O' && rb === 'O') return {};
    if (ra !== 'S' && rb !== 'S') {
      const bench = [...s.bench];
      if (ra === 'B' && rb === 'B') {
        const ia = bench.indexOf(a);
        const ib = bench.indexOf(b);
        bench[ia] = b;
        bench[ib] = a;
      } else {
        const benchId = ra === 'B' ? a : b;
        bench[bench.indexOf(benchId)] = ra === 'B' ? b : a;
      }
      return { next: { ...s, bench } };
    }
    const starter = ra === 'S' ? a : b;
    const other = ra === 'S' ? b : a;
    const starters = s.starters.map((x) => (x === starter ? other : x));
    const formation = formationOf(starters, entries);
    if (!formation) return { error: 'Ese cambio deja una formación no permitida' };
    const bench = roleOf(s, other) === 'B' ? s.bench.map((x) => (x === other ? starter : x)) : s.bench;
    let { captainId, viceCaptainId } = s;
    if (captainId === starter) captainId = other;
    if (viceCaptainId === starter) viceCaptainId = other;
    if (captainId === viceCaptainId) viceCaptainId = null;
    return { next: { formation, starters, bench, captainId, viceCaptainId } };
  };

  const validTargets = useMemo(() => {
    if (!state || selected === null) return new Set<number>();
    return new Set([...entries.keys()].filter((id) => entries.get(id)!.inSquad && trySwap(state, selected, id).next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected, entries]);

  const apply = (next: LineupState) => {
    setState(next);
    setDirty(true);
  };

  const doSwap = (a: number, b: number) => {
    if (!state) return;
    const res = trySwap(state, a, b);
    if (res.error) toast.push('warning', res.error);
    if (res.next) {
      apply(res.next);
      navigator.vibrate?.(12);
    }
    setSelected(null);
  };

  const onTokenClick = (id: number) => {
    if (!view?.editable) {
      setSelected(selected === id ? null : id);
      return;
    }
    if (selected === null) setSelected(id);
    else if (selected === id) setSelected(null);
    else if (validTargets.has(id)) doSwap(selected, id);
    else setSelected(id);
  };

  const changeFormation = (formation: string) => {
    if (!state || formation === state.formation) return;
    const [DEF, MID, FWD] = formation.split('-').map(Number);
    const shape: Record<Position, number> = { GK: 1, DEF, MID, FWD };
    let starters = [...state.starters];
    let bench = [...state.bench];
    const score = (id: number) => entries.get(id)!.player.stats.totalPoints - (BLOCKING.includes(entries.get(id)!.player.status) ? 1000 : 0);
    for (const pos of ['DEF', 'MID', 'FWD'] as Position[]) {
      const current = starters.filter((id) => entries.get(id)!.player.position === pos);
      const extra = current.length - shape[pos];
      if (extra > 0) {
        const out = current.filter((id) => !entries.get(id)!.locked).sort((a, b) => score(a) - score(b)).slice(0, extra);
        if (out.length < extra) return toast.push('warning', 'No puedes cambiar la formación: hay jugadores bloqueados');
        starters = starters.filter((id) => !out.includes(id));
        bench = [...bench, ...out];
      }
    }
    for (const pos of ['DEF', 'MID', 'FWD'] as Position[]) {
      const missing = shape[pos] - starters.filter((id) => entries.get(id)!.player.position === pos).length;
      if (missing > 0) {
        const pool = [...bench, ...squadEntries.map((e) => e.player.id).filter((id) => !starters.includes(id) && !bench.includes(id))]
          .filter((id) => entries.get(id)!.player.position === pos && !entries.get(id)!.locked)
          .sort((a, b) => score(b) - score(a))
          .slice(0, missing);
        if (pool.length < missing) return toast.push('warning', `No tienes suficientes ${POSITION_PLURAL[pos].toLowerCase()} disponibles para ${formation}`);
        starters = [...starters, ...pool];
        bench = bench.filter((id) => !pool.includes(id));
      }
    }
    bench = bench.slice(0, 4);
    let { captainId, viceCaptainId } = state;
    if (captainId && !starters.includes(captainId)) captainId = null;
    if (viceCaptainId && !starters.includes(viceCaptainId)) viceCaptainId = null;
    apply({ formation, starters, bench, captainId, viceCaptainId });
  };

  const setCaptain = (id: number, vice = false) => {
    if (!state) return;
    const e = entries.get(id)!;
    const currentId = vice ? state.viceCaptainId : state.captainId;
    if (e.locked || (currentId && entries.get(currentId)?.locked)) return toast.push('warning', 'No se puede cambiar: el partido de uno de los jugadores ya ha comenzado');
    if (vice) apply({ ...state, viceCaptainId: id, captainId: state.captainId === id ? state.viceCaptainId : state.captainId });
    else apply({ ...state, captainId: id, viceCaptainId: state.viceCaptainId === id ? state.captainId : state.viceCaptainId });
    setSelected(null);
  };

  const localIssues = useMemo(() => {
    if (!state || !view) return { errors: [] as string[], warnings: [] as string[] };
    if (!dirty) return view.validation;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (state.starters.length !== 11) errors.push(`Necesitas 11 titulares (tienes ${state.starters.length})`);
    if (!formationOf(state.starters, entries)) errors.push('Formación no válida');
    if (!state.captainId) errors.push('Elige un capitán');
    if (!state.viceCaptainId) warnings.push('No has elegido vicecapitán');
    for (const id of state.starters) {
      const p = entries.get(id)!.player;
      if (BLOCKING.includes(p.status)) {
        const alt = state.bench.some((b) => entries.get(b)!.player.position === p.position && !BLOCKING.includes(entries.get(b)!.player.status));
        (alt ? errors : warnings).push(`${p.displayName}: ${STATUS_META[p.status].label.toLowerCase()}`);
      } else if (p.status === 'DOUBTFUL') warnings.push(`${p.displayName} es duda`);
    }
    return { errors, warnings };
  }, [state, dirty, view, entries]);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !view || !state) return <LoadingBlock />;

  if (squadEntries.length === 0)
    return (
      <Card>
        <EmptyState icon={<ShoppingBag className="size-6" />} title="Necesitas jugadores" description="Ficha tu plantilla en el mercado para poder alinear tu once." action={<Link to="/market"><Button>Ir al mercado</Button></Link>} />
      </Card>
    );

  const showPoints = view.gameweek.status !== 'UPCOMING' || view.isFinal;
  const sel = selected !== null ? entries.get(selected) : null;
  const outPlayers = squadEntries.filter((e) => roleOf(state, e.player.id) === 'O');
  const unavailable = squadEntries.filter((e) => e.player.status !== 'AVAILABLE');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={view.isOwner ? 'Alineación' : 'Alineación rival'}
        title={view.gameweek.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={view.gameweek.status === 'LIVE' ? 'green' : view.gameweek.status === 'FINISHED' ? 'slate' : 'sky'}>{GW_STATUS[view.gameweek.status]}</Badge>
            {view.gameweek.status === 'UPCOMING' ? `Cierre: ${dateTime(view.gameweek.deadline)} · faltan ${countdown(view.gameweek.deadline)}` : view.lockMode === 'PER_MATCH' && !view.gameweek.isProcessed ? 'Los jugadores se bloquean al empezar su partido' : ''}
          </span>
        }
        actions={
          <Select value={view.gameweek.id} onChange={(e) => setParams({ gw: e.target.value })} className="w-52" aria-label="Jornada">
            {view.gameweeks.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} {g.points !== null && g.status !== 'UPCOMING' ? `· ${g.points} pts` : `· ${GW_STATUS[g.status]}`}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {showPoints && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="card p-3 text-center">
                <p className="label">{view.isFinal ? 'Puntos finales' : 'Puntos en vivo'}</p>
                <p className="stat-number mt-1 text-4xl text-pitch-300">{view.points}</p>
              </div>
              <div className="card p-3 text-center">
                <p className="label">Banquillo</p>
                <p className="stat-number mt-1 text-4xl text-slate-300">{view.benchPoints}</p>
              </div>
              <div className="card p-3 text-center">
                <p className="label">Formación</p>
                <p className="stat-number mt-1 text-4xl">{state.formation}</p>
              </div>
            </div>
          )}

          {view.editable && (
            <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto">
              {FORMATIONS.map((f) => (
                <button key={f} onClick={() => changeFormation(f)} className={clsx('h-9 shrink-0 rounded-xl px-3.5 font-display text-base font-bold tracking-wide transition', state.formation === f ? 'bg-pitch-500 text-ink-950' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]')}>
                  {f}
                </button>
              ))}
            </div>
          )}

          <Pitch
            entries={entries}
            state={state}
            editable={view.editable}
            showPoints={showPoints}
            selectedId={selected}
            validTargets={validTargets}
            activeCaptainId={view.activeCaptainId ?? (showPoints ? state.captainId : null)}
            onTokenClick={onTokenClick}
            onSwap={doSwap}
          />
          {view.editable && <p className="mt-2 text-center text-xs text-slate-500">Arrastra un jugador sobre otro o tócalo y después toca un jugador resaltado para intercambiarlos.</p>}
        </div>

        <div className="space-y-4">
          {view.isOwner && (
            <Card className="p-4">
              {view.editable ? (
                <>
                  {localIssues.errors.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm font-semibold text-pitch-300">
                      <CheckCircle2 className="size-5" /> Alineación válida
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {localIssues.errors.map((e) => (
                        <p key={e} className="flex items-start gap-2 text-sm text-red-300">
                          <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {e}
                        </p>
                      ))}
                    </div>
                  )}
                  {localIssues.warnings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {localIssues.warnings.map((w) => (
                        <p key={w} className="flex items-start gap-2 text-xs text-amber-300">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button className="flex-1" icon={<Save className="size-4" />} loading={save.isPending} disabled={localIssues.errors.length > 0 || (!dirty && view.isSaved)} onClick={() => save.mutate()}>
                      {dirty || !view.isSaved ? 'Guardar alineación' : 'Guardada'}
                    </Button>
                    {dirty && (
                      <Button variant="secondary" className="px-3" onClick={() => {
                          setState(fromView(view));
                          setDirty(false);
                        }} aria-label="Descartar cambios">
                        <RotateCcw className="size-4" />
                      </Button>
                    )}
                  </div>
                  {!view.isSaved && !dirty && <p className="mt-2 text-xs text-slate-400">Propuesta automática basada en tu última alineación. Guárdala para confirmarla.</p>}
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-slate-300">
                  <Lock className="size-4 text-slate-500" /> {view.isFinal ? 'Jornada cerrada: puntuación definitiva.' : 'La alineación está bloqueada.'}
                </p>
              )}
            </Card>
          )}

          {sel && (
            <Card className="animate-pop p-4">
              <div className="flex items-center gap-3">
                <PlayerPhoto player={sel.player} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-xl font-bold uppercase text-white">{sel.player.displayName}</p>
                  <p className="flex items-center gap-1.5 text-xs text-slate-400">
                    <PositionBadge position={sel.player.position} /> <ClubCrest club={sel.player.club} size={14} /> {sel.player.club.shortName}
                  </p>
                </div>
                {showPoints && <span className="stat-number text-3xl">{sel.points}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge status={sel.player.status} chance={sel.player.chanceOfPlaying} />
                {sel.locked && (
                  <Badge>
                    <Lock className="size-3" /> Bloqueado
                  </Badge>
                )}
              </div>
              {sel.fixtures.map((f) => (
                <p key={f.id} className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                  <ClubCrest club={f.opponent} size={16} /> {f.home ? 'vs' : 'en'} {f.opponent.name} · {f.status === 'FINISHED' ? `${f.homeScore}-${f.awayScore}` : dateTime(f.kickoff)}
                </p>
              ))}
              {view.editable && roleOf(state, sel.player.id) === 'S' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" variant={state.captainId === sel.player.id ? 'primary' : 'secondary'} icon={<Crown className="size-4" />} onClick={() => setCaptain(sel.player.id)}>
                    Capitán
                  </Button>
                  <Button size="sm" variant={state.viceCaptainId === sel.player.id ? 'primary' : 'secondary'} onClick={() => setCaptain(sel.player.id, true)}>
                    Vicecapitán
                  </Button>
                </div>
              )}
              <Link to={`/players/${sel.player.id}`} className="mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-pitch-400 hover:bg-white/[0.04]">
                <Eye className="size-3.5" /> Ver ficha del jugador
              </Link>
            </Card>
          )}

          <Card className="p-4">
            <p className="label mb-3">Estado de la plantilla</p>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Titulares</span>
                <span className="font-semibold text-white">{state.starters.length}/11</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Suplentes</span>
                <span className="font-semibold text-white">{state.bench.length}/4</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Capitán</span>
                <span className="font-semibold text-gold">{state.captainId ? entries.get(state.captainId)?.player.displayName : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Vicecapitán</span>
                <span className="font-semibold text-white">{state.viceCaptainId ? entries.get(state.viceCaptainId)?.player.displayName : '—'}</span>
              </div>
            </div>
            {unavailable.length > 0 && (
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <p className="label mb-2">Lesionados, sancionados y dudas</p>
                {unavailable.map((e) => (
                  <button key={e.player.id} onClick={() => onTokenClick(e.player.id)} className="flex w-full items-center justify-between gap-2 py-1 text-left text-sm">
                    <span className="truncate text-slate-200">{e.player.displayName}</span>
                    <StatusBadge status={e.player.status} chance={e.player.chanceOfPlaying} />
                  </button>
                ))}
              </div>
            )}
            {outPlayers.length > 0 && (
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <p className="label mb-2 flex items-center gap-1.5">
                  <UserMinus className="size-3.5" /> No convocados
                </p>
                {outPlayers.map((e) => (
                  <button key={e.player.id} onClick={() => onTokenClick(e.player.id)} className={clsx('flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm', validTargets.has(e.player.id) && 'bg-lime-glow/10')}>
                    <PositionBadge position={e.player.position} /> <span className="truncate text-slate-200">{e.player.displayName}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
