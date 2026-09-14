import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTime, FIXTURE_STATUS } from '../../lib/format';
import type { Club, ClubLite, Fixture, Gameweek, Position } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, Field, Input, LoadingBlock, Modal, Select } from '../../components/ui';
import { ClubCrest, PositionBadge } from '../../components/sport';
import { toLocalInput } from './AdminGameweeks';

type AdminFixture = Fixture & { _count: { statistics: number } };
const STAT_FIELDS = [
  ['minutes', 'Min'],
  ['goals', 'G'],
  ['assists', 'A'],
  ['yellowCards', 'TA'],
  ['redCards', 'TR'],
  ['ownGoals', 'PP'],
  ['penaltiesSaved', 'PenP'],
  ['penaltiesMissed', 'PenF'],
  ['saves', 'Par'],
  ['bonus', 'Bon'],
] as const;
type StatKey = (typeof STAT_FIELDS)[number][0];

export default function AdminFixtures() {
  const qc = useQueryClient();
  const toast = useToast();
  const gws = useQuery({ queryKey: ['gameweeks'], queryFn: () => api.get<{ currentId: number | null; nextId: number | null; gameweeks: Gameweek[] }>('/gameweeks') });
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });
  const [gw, setGw] = useState<number | null>(null);
  const gameweek = gw ?? gws.data?.currentId ?? gws.data?.nextId ?? 1;
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'fixtures', gameweek], queryFn: () => api.get<AdminFixture[]>(`/admin/fixtures?gameweek=${gameweek}`), enabled: !!gws.data });
  const [editing, setEditing] = useState<AdminFixture | 'new' | null>(null);
  const [statsFor, setStatsFor] = useState<AdminFixture | null>(null);
  const [deleting, setDeleting] = useState<AdminFixture | null>(null);
  const refresh = () => qc.invalidateQueries();
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admin/fixtures/${id}`),
    onSuccess: () => { toast.push('success', 'Partido eliminado'); setDeleting(null); refresh(); },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select className="w-52" value={gameweek} onChange={(e) => setGw(Number(e.target.value))}>
          {gws.data?.gameweeks.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nuevo partido</Button>
      </div>
      <Card className="overflow-hidden">
        {isLoading || !data ? (
          <LoadingBlock />
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {data.map((f) => (
              <div key={f.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                <div className="flex flex-1 items-center gap-3">
                  <ClubCrest club={f.homeClub} size={26} />
                  <span className="font-semibold text-white">{f.homeClub.shortName}</span>
                  <span className="rounded-lg bg-white/[0.06] px-2.5 py-0.5 font-display text-lg font-bold">{f.homeScore ?? '-'} : {f.awayScore ?? '-'}</span>
                  <span className="font-semibold text-white">{f.awayClub.shortName}</span>
                  <ClubCrest club={f.awayClub} size={26} />
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Badge tone={f.status === 'LIVE' ? 'amber' : f.status === 'FINISHED' ? 'green' : f.status === 'POSTPONED' ? 'red' : 'sky'}>{FIXTURE_STATUS[f.status]}</Badge>
                  {dateTime(f.kickoff)} · {f._count.statistics} estadísticas
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" icon={<ClipboardList className="size-3.5" />} onClick={() => setStatsFor(f)}>Resultado</Button>
                  <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setEditing(f)} aria-label="Editar"><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="danger" className="px-2.5" onClick={() => setDeleting(f)} aria-label="Eliminar"><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))}
            {data.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No hay partidos en esta jornada</p>}
          </div>
        )}
      </Card>
      {editing && clubs && <FixtureModal fixture={editing === 'new' ? null : editing} gameweek={gameweek} gameweeks={gws.data?.gameweeks ?? []} clubs={clubs} onClose={() => setEditing(null)} onDone={refresh} />}
      {statsFor && <StatsModal fixture={statsFor} onClose={() => setStatsFor(null)} onDone={refresh} />}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} danger title="Eliminar partido" confirmLabel="Eliminar" loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} message="Solo se pueden eliminar partidos sin estadísticas registradas." />
    </div>
  );
}

function FixtureModal({ fixture, gameweek, gameweeks, clubs, onClose, onDone }: { fixture: AdminFixture | null; gameweek: number; gameweeks: Gameweek[]; clubs: Club[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    gameweekId: fixture?.gameweekId ?? gameweek,
    homeClubId: fixture?.homeClubId ?? clubs[0].id,
    awayClubId: fixture?.awayClubId ?? clubs[1].id,
    kickoff: toLocalInput(fixture?.kickoff),
    status: fixture?.status ?? 'SCHEDULED',
    homeScore: fixture?.homeScore?.toString() ?? '',
    awayScore: fixture?.awayScore?.toString() ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        gameweekId: Number(form.gameweekId),
        homeClubId: Number(form.homeClubId),
        awayClubId: Number(form.awayClubId),
        kickoff: form.kickoff ? new Date(form.kickoff).toISOString() : null,
        status: form.status,
        homeScore: form.homeScore === '' ? null : Number(form.homeScore),
        awayScore: form.awayScore === '' ? null : Number(form.awayScore),
      };
      return fixture ? api.patch(`/admin/fixtures/${fixture.id}`, body) : api.post('/admin/fixtures', body);
    },
    onSuccess: () => { toast.push('success', 'Partido guardado'); onDone(); onClose(); },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open onClose={onClose} title={fixture ? 'Editar partido' : 'Nuevo partido'} footer={<Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jornada">
          <Select value={form.gameweekId} onChange={(e) => set('gameweekId', e.target.value)}>
            {gameweeks.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label="Fecha y hora"><Input type="datetime-local" value={form.kickoff} onChange={(e) => set('kickoff', e.target.value)} /></Field>
        <Field label="Local">
          <Select value={form.homeClubId} onChange={(e) => set('homeClubId', e.target.value)}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Visitante">
          <Select value={form.awayClubId} onChange={(e) => set('awayClubId', e.target.value)}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(FIXTURE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Goles local"><Input type="number" min={0} value={form.homeScore} onChange={(e) => set('homeScore', e.target.value)} /></Field>
          <Field label="Goles visitante"><Input type="number" min={0} value={form.awayScore} onChange={(e) => set('awayScore', e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

interface StatsPayload {
  fixture: Fixture;
  players: { id: number; displayName: string; position: Position; clubId: number; squadNumber: number | null; club: ClubLite }[];
  stats: ({ playerId: number } & Record<StatKey, number>)[];
}

/** Registro manual de resultado y estadísticas de jugadores. */
function StatsModal({ fixture, onClose, onDone }: { fixture: AdminFixture; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['admin', 'fixture-stats', fixture.id], queryFn: () => api.get<StatsPayload>(`/admin/fixtures/${fixture.id}/stats`) });
  const [rows, setRows] = useState<Record<number, Record<StatKey, number>>>({});
  const [score, setScore] = useState({ home: fixture.homeScore ?? 0, away: fixture.awayScore ?? 0 });
  const [status, setStatus] = useState<'LIVE' | 'FINISHED'>(fixture.status === 'LIVE' ? 'LIVE' : 'FINISHED');
  const [side, setSide] = useState<'home' | 'away'>('home');

  useEffect(() => {
    if (!data) return;
    const init: Record<number, Record<StatKey, number>> = {};
    for (const p of data.players) {
      const s = data.stats.find((x) => x.playerId === p.id);
      init[p.id] = Object.fromEntries(STAT_FIELDS.map(([k]) => [k, s ? Number(s[k]) : 0])) as Record<StatKey, number>;
    }
    setRows(init);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/fixtures/${fixture.id}/stats`, {
        homeScore: score.home,
        awayScore: score.away,
        status,
        stats: Object.entries(rows)
          .filter(([, r]) => r.minutes > 0)
          .map(([playerId, r]) => ({ playerId: Number(playerId), ...r })),
      }),
    onSuccess: () => { toast.push('success', 'Resultado registrado y puntos recalculados'); onDone(); onClose(); },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  const clubId = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
  const players = data?.players.filter((p) => p.clubId === clubId) ?? [];
  const setVal = (id: number, k: StatKey, v: number) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: Math.max(0, v) } }));

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${fixture.homeClub.shortName} vs ${fixture.awayClub.shortName}: resultado`}
      footer={
        <>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as 'LIVE' | 'FINISHED')}>
            <option value="LIVE">En vivo (provisional)</option>
            <option value="FINISHED">Finalizado</option>
          </Select>
          <Button onClick={() => save.mutate()} loading={save.isPending}>Guardar resultado</Button>
        </>
      }
    >
      {!data ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-4">
            <ClubCrest club={fixture.homeClub} size={40} />
            <Input type="number" min={0} className="w-16 text-center font-display text-2xl" value={score.home} onChange={(e) => setScore({ ...score, home: Number(e.target.value) })} aria-label="Goles local" />
            <span className="text-slate-500">–</span>
            <Input type="number" min={0} className="w-16 text-center font-display text-2xl" value={score.away} onChange={(e) => setScore({ ...score, away: Number(e.target.value) })} aria-label="Goles visitante" />
            <ClubCrest club={fixture.awayClub} size={40} />
          </div>
          <p className="text-center text-xs text-slate-400">Portería a cero y goles recibidos se calculan automáticamente con el marcador y los minutos (≥60).</p>
          <div className="flex gap-2">
            {(['home', 'away'] as const).map((s) => (
              <Button key={s} size="sm" variant={side === s ? 'primary' : 'secondary'} onClick={() => setSide(s)}>
                {s === 'home' ? fixture.homeClub.name : fixture.awayClub.name}
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2 text-left">Jugador</th>
                  {STAT_FIELDS.map(([k, label]) => <th key={k} className="px-1 py-2">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {players.map((p) => (
                  <tr key={p.id} className={rows[p.id]?.minutes ? 'bg-pitch-500/[0.05]' : ''}>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <PositionBadge position={p.position} />
                        <span className="truncate text-slate-200">{p.displayName}</span>
                        <button type="button" className="text-[10px] text-pitch-400" onClick={() => setVal(p.id, 'minutes', 90)}>90'</button>
                      </span>
                    </td>
                    {STAT_FIELDS.map(([k]) => (
                      <td key={k} className="px-1 py-1.5">
                        <input type="number" min={0} className="w-12 rounded-lg border border-white/10 bg-ink-900 px-1.5 py-1 text-center text-sm text-white" value={rows[p.id]?.[k] ?? 0} onChange={(e) => setVal(p.id, k, Number(e.target.value))} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
