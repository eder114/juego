import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Copy, LogOut, Settings, Share2, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../lib/api';
import { dateShort } from '../lib/format';
import type { StandingRow } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, Select, Tabs } from '../components/ui';
import { StandingsTable } from '../components/StandingsTable';
import { CHART_COLORS, tooltipStyle } from '../components/charts';
import { LEAGUE_TONE } from './Leagues';

interface LeagueDetailData {
  id: number;
  name: string;
  description: string | null;
  type: string;
  typeLabel: string;
  maxMembers: number;
  startGameweek: number;
  createdAt: string;
  hasPassword: boolean;
  isSystem: boolean;
  owner: { id: string; managerName: string } | null;
  memberCount: number;
  code: string | null;
  myRole: string | null;
  isMember: boolean;
  standings: StandingRow[];
  totalParticipants: number;
  lastGameweekId: number | null;
  history: Record<string, number>[];
  invites: { id: number; receiver: { managerName: string } }[];
  canInvite: boolean;
}

export default function LeagueDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'standings' | 'weekly' | 'history'>('standings');
  const [gw, setGw] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [removing, setRemoving] = useState<StandingRow | null>(null);

  const { data: league, isLoading, error, refetch } = useQuery({ queryKey: ['league', id], queryFn: () => api.get<LeagueDetailData>(`/leagues/${id}`) });
  const weekly = useQuery({
    queryKey: ['league', id, 'weekly', gw ?? league?.lastGameweekId],
    queryFn: () => api.get<{ rows: StandingRow[]; gameweekIds: number[] }>(`/rankings?type=weekly&leagueId=${id}&pageSize=100${gw ?? league?.lastGameweekId ? `&gameweek=${gw ?? league?.lastGameweekId}` : ''}`),
    enabled: tab === 'weekly' && !!league,
  });

  const onDone = (msg: string, go?: string) => {
    toast.push('success', msg);
    qc.invalidateQueries({ queryKey: ['leagues'] });
    qc.invalidateQueries({ queryKey: ['league', id] });
    if (go) navigate(go);
  };
  const leave = useMutation({ mutationFn: () => api.post(`/leagues/${id}/leave`), onSuccess: () => onDone('Has abandonado la liga', '/leagues'), onError: (e) => toast.push('error', errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.del(`/leagues/${id}`), onSuccess: () => onDone('Liga eliminada', '/leagues'), onError: (e) => toast.push('error', errorMessage(e)) });
  const kick = useMutation({
    mutationFn: (userId: string) => api.del(`/leagues/${id}/members/${userId}`),
    onSuccess: () => {
      setRemoving(null);
      onDone('Mánager retirado de la liga');
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !league) return <LoadingBlock />;

  const isAdmin = league.myRole === 'ADMIN';
  const shareText = league.code ? `¡Únete a mi liga "${league.name}" en Premier Fantasy! Código: ${league.code}${league.hasPassword ? ' (te paso la contraseña por privado)' : ''}` : '';
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.push('success', msg);
    } catch {
      toast.push('info', text);
    }
  };
  const teams = league.standings.slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Badge tone={LEAGUE_TONE[league.type]}>{league.typeLabel}</Badge>
            {isAdmin && <Badge>Eres administrador</Badge>}
          </span>
        }
        title={league.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {league.description && <span>{league.description}</span>}
            <span className="flex items-center gap-1">
              <Users className="size-3.5" /> {league.totalParticipants}
              {league.type !== 'GLOBAL' && `/${league.maxMembers}`}
            </span>
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" /> Creada {dateShort(league.createdAt)} · desde J{league.startGameweek}
            </span>
            {league.owner && <span>Admin: {league.owner.managerName}</span>}
          </span>
        }
        actions={
          <>
            {league.canInvite && (
              <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
                Invitar
              </Button>
            )}
            {isAdmin && !league.isSystem && (
              <Button variant="secondary" className="px-3" onClick={() => setSettingsOpen(true)} aria-label="Ajustes de liga">
                <Settings className="size-4" />
              </Button>
            )}
            {league.isMember && league.type !== 'GLOBAL' && (
              <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => setConfirm('leave')}>
                Salir
              </Button>
            )}
          </>
        }
      />

      {league.code && league.type !== 'GLOBAL' && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="label">Código de invitación</p>
            <p className="font-display text-3xl font-bold tracking-[0.25em] text-pitch-300">{league.code}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={() => copy(league.code!, 'Código copiado')}>
              Copiar código
            </Button>
            <Button size="sm" icon={<Share2 className="size-4" />} onClick={() => (navigator.share ? navigator.share({ title: league.name, text: shareText }).catch(() => undefined) : copy(shareText, 'Mensaje de invitación copiado'))}>
              Compartir
            </Button>
          </div>
        </Card>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'standings', label: 'Clasificación' },
          { value: 'weekly', label: 'Por jornada' },
          { value: 'history', label: 'Historial' },
        ]}
      />

      {tab === 'standings' && (
        <Card className="overflow-hidden">
          {league.standings.length ? (
            <StandingsTable
              rows={league.standings}
              action={
                isAdmin && league.type !== 'GLOBAL'
                  ? (r) =>
                      r.userId !== user?.id && (
                        <button onClick={() => setRemoving(r)} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label={`Retirar a ${r.managerName}`}>
                          <UserMinus className="size-4" />
                        </button>
                      )
                  : undefined
              }
            />
          ) : (
            <EmptyState title="Sin participantes" />
          )}
          {league.type === 'GLOBAL' && <p className="border-t border-white/[0.06] px-4 py-3 text-xs text-slate-400">Mostrando el top 100 de {league.totalParticipants} mánagers.</p>}
        </Card>
      )}

      {tab === 'weekly' && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <p className="text-sm text-slate-300">Clasificación de la jornada</p>
            <Select className="w-44" value={gw ?? league.lastGameweekId ?? ''} onChange={(e) => setGw(Number(e.target.value))}>
              {league.history.map((h) => (
                <option key={h.gameweek} value={h.gameweek}>
                  Jornada {h.gameweek}
                </option>
              ))}
            </Select>
          </div>
          {weekly.isLoading ? <LoadingBlock /> : weekly.data?.rows.length ? <StandingsTable rows={weekly.data.rows.map((r) => ({ ...r, isMe: r.userId === user?.id }))} pointsLabel="Puntos" showLast={false} /> : <EmptyState title="Sin puntos en esta jornada" />}
        </Card>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          <Card className="p-3 sm:p-5">
            {league.history.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={league.history.map((h, i) => {
                    const row: Record<string, number> = { gameweek: h.gameweek };
                    for (const t of teams) row[t.teamName] = league.history.slice(0, i + 1).reduce((s, x) => s + (x[String(t.teamId)] ?? 0), 0);
                    return row;
                  })}
                  margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="gameweek" tickFormatter={(v) => `J${v}`} stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip {...tooltipStyle} labelFormatter={(v) => `Tras la jornada ${v}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {teams.map((t, i) => (
                    <Line key={t.teamId} dataKey={t.teamName} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={t.userId === user?.id ? 3.5 : 1.8} dot={false} type="monotone" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Aún no hay jornadas puntuadas" />
            )}
          </Card>
          {league.history.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="sticky left-0 bg-ink-800 px-4 py-2">Equipo</th>
                    {league.history.map((h) => (
                      <th key={h.gameweek} className="px-2 py-2 text-center">
                        J{h.gameweek}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {league.standings.map((r) => {
                    const best = (gwRow: Record<string, number>) => Math.max(...league.standings.map((s) => gwRow[String(s.teamId)] ?? 0));
                    return (
                      <tr key={r.teamId} className={r.isMe ? 'bg-pitch-500/[0.06]' : ''}>
                        <td className="sticky left-0 truncate bg-ink-800 px-4 py-2 font-semibold text-white">{r.teamName}</td>
                        {league.history.map((h) => {
                          const v = h[String(r.teamId)];
                          return (
                            <td key={h.gameweek} className={`px-2 py-2 text-center tabular-nums ${v !== undefined && v === best(h) ? 'font-bold text-pitch-300' : 'text-slate-300'}`}>
                              {v ?? '–'}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-right font-display text-lg font-bold">{r.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} leagueId={league.id} pending={league.invites} />
      {settingsOpen && <SettingsModal league={league} onClose={() => setSettingsOpen(false)} onDelete={() => { setSettingsOpen(false); setConfirm('delete'); }} />}
      <ConfirmModal open={confirm === 'leave'} onClose={() => setConfirm(null)} title="Abandonar liga" danger confirmLabel="Salir de la liga" loading={leave.isPending} onConfirm={() => leave.mutate()} message="Dejarás de aparecer en la clasificación. Podrás volver a unirte con el código si hay plazas." />
      <ConfirmModal open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Eliminar liga" danger confirmLabel="Eliminar definitivamente" loading={remove.isPending} onConfirm={() => remove.mutate()} message="La liga y su clasificación se eliminarán para todos los participantes. Los equipos y puntos de cada mánager no se ven afectados." />
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} title="Retirar mánager" danger confirmLabel="Retirar" loading={kick.isPending} onConfirm={() => removing && kick.mutate(removing.userId)} message={removing && `¿Retirar a ${removing.managerName} (${removing.teamName}) de la liga?`} />
    </div>
  );
}

function InviteModal({ open, onClose, leagueId, pending }: { open: boolean; onClose: () => void; leagueId: number; pending: { id: number; receiver: { managerName: string } }[] }) {
  const [identifier, setIdentifier] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const invite = useMutation({
    mutationFn: () => api.post<{ managerName: string }>(`/leagues/${leagueId}/invite`, { identifier }),
    onSuccess: (res) => {
      toast.push('success', `Invitación enviada a ${res.managerName}`);
      setIdentifier('');
      qc.invalidateQueries({ queryKey: ['league', String(leagueId)] });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="Invitar amigos" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Email o nombre de mánager" hint="Recibirá una notificación con la invitación">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="amigo@email.com" />
        </Field>
        <Button type="submit" className="w-full" loading={invite.isPending} disabled={identifier.trim().length < 3}>
          Enviar invitación
        </Button>
        {pending.length > 0 && (
          <div>
            <p className="label mb-2">Invitaciones pendientes</p>
            <div className="flex flex-wrap gap-1.5">
              {pending.map((p) => (
                <Badge key={p.id}>{p.receiver.managerName}</Badge>
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

function SettingsModal({ league, onClose, onDelete }: { league: LeagueDetailData; onClose: () => void; onDelete: () => void }) {
  const [form, setForm] = useState({ name: league.name, description: league.description ?? '', maxMembers: league.maxMembers, password: '', removePassword: false });
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/leagues/${league.id}`, {
        name: form.name,
        description: form.description || null,
        maxMembers: form.maxMembers,
        ...(form.removePassword ? { password: null } : form.password ? { password: form.password } : {}),
      }),
    onSuccess: () => {
      toast.push('success', 'Liga actualizada');
      qc.invalidateQueries({ queryKey: ['league', String(league.id)] });
      qc.invalidateQueries({ queryKey: ['leagues'] });
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Ajustes de la liga"
      footer={
        <>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={onDelete} className="mr-auto">
            Eliminar
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre">
          <Input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Descripción">
          <Input value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Máximo de participantes">
          <Input type="number" min={2} max={500} value={form.maxMembers} onChange={(e) => setForm({ ...form, maxMembers: Number(e.target.value) })} />
        </Field>
        {league.type !== 'PUBLIC' && (
          <>
            <Field label={league.hasPassword ? 'Nueva contraseña' : 'Añadir contraseña'} hint="Déjalo vacío para no cambiarla">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value, removePassword: false })} autoComplete="new-password" />
            </Field>
            {league.hasPassword && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={form.removePassword} onChange={(e) => setForm({ ...form, removePassword: e.target.checked, password: '' })} className="accent-pitch-500" /> Quitar la contraseña
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
