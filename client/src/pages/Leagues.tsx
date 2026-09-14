import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, KeyRound, Lock, Mail, Plus, Search, Trophy, Users } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { Movement } from '../types';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, Select, Tabs } from '../components/ui';
import { Avatar, MovementIndicator } from '../components/sport';

interface MyLeague {
  id: number;
  name: string;
  description: string | null;
  type: string;
  typeLabel: string;
  memberCount: number;
  maxMembers: number;
  code: string;
  role: string;
  myRank: number | null;
  myPoints: number;
  movement: Movement;
  hasPassword: boolean;
  leader: { managerName: string; teamName: string; points: number } | null;
}
interface PublicLeague {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  maxMembers: number;
  owner: { managerName: string; avatarUrl: string | null } | null;
}
interface Invite {
  id: number;
  league: { id: number; name: string; type: string; maxMembers: number; _count: { members: number } };
  sender: { managerName: string; avatarUrl: string | null };
}

export const LEAGUE_TONE: Record<string, 'green' | 'sky' | 'violet' | 'amber' | 'gold'> = { GLOBAL: 'gold', PUBLIC: 'sky', PRIVATE: 'violet', FRIENDS: 'green', INVITE: 'amber' };

export default function Leagues() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'mine' | 'public' | 'invites') ?? 'mine';
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const mine = useQuery({ queryKey: ['leagues', 'mine'], queryFn: () => api.get<MyLeague[]>('/leagues') });
  const invites = useQuery({ queryKey: ['leagues', 'invites'], queryFn: () => api.get<Invite[]>('/leagues/invites') });
  const publicLeagues = useQuery({ queryKey: ['leagues', 'public', search], queryFn: () => api.get<PublicLeague[]>(`/leagues/public?search=${encodeURIComponent(search)}`), enabled: tab === 'public' });

  const joinPublic = useMutation({
    mutationFn: (id: number) => api.post(`/leagues/${id}/join`),
    onSuccess: (_, id) => {
      toast.push('success', '¡Te has unido a la liga!');
      qc.invalidateQueries({ queryKey: ['leagues'] });
      navigate(`/leagues/${id}`);
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: number; accept: boolean }) => api.post<{ accepted: boolean; leagueId?: number }>(`/leagues/invites/${id}`, { accept }),
    onSuccess: (res) => {
      toast.push(res.accepted ? 'success' : 'info', res.accepted ? 'Invitación aceptada' : 'Invitación rechazada');
      qc.invalidateQueries({ queryKey: ['leagues'] });
      if (res.leagueId) navigate(`/leagues/${res.leagueId}`);
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Compite con amigos"
        title="Ligas"
        actions={
          <>
            <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setJoinOpen(true)}>
              Unirse con código
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
              Crear liga
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { value: 'mine', label: 'Mis ligas', count: mine.data?.length },
          { value: 'public', label: 'Ligas públicas' },
          { value: 'invites', label: 'Invitaciones', count: invites.data?.length },
        ]}
      />

      {tab === 'mine' &&
        (mine.error ? (
          <ErrorState error={mine.error} />
        ) : mine.isLoading ? (
          <LoadingBlock />
        ) : mine.data?.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mine.data.map((l) => (
              <Link key={l.id} to={`/leagues/${l.id}`} className="card card-hover flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={LEAGUE_TONE[l.type]}>{l.typeLabel}</Badge>
                      {l.role === 'ADMIN' && <Badge>Admin</Badge>}
                      {l.hasPassword && <Lock className="size-3.5 text-slate-500" />}
                    </div>
                    <h3 className="mt-2 truncate text-2xl font-bold uppercase">{l.name}</h3>
                    <p className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Users className="size-3.5" /> {l.memberCount.toLocaleString('es-ES')}
                      {l.type !== 'GLOBAL' && ` / ${l.maxMembers}`} mánagers
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="label">Tu posición</p>
                    <p className="stat-number flex items-center justify-end gap-1.5 text-4xl">
                      {l.myRank ? `#${l.myRank}` : '—'}
                    </p>
                    <MovementIndicator movement={l.movement} />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-ink-900/60 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-slate-400">
                    <Trophy className="size-4 shrink-0 text-gold" />
                    <span className="truncate">{l.leader ? `${l.leader.teamName} · ${l.leader.points}` : 'Sin puntos'}</span>
                  </span>
                  <span className="shrink-0 font-semibold text-white">{l.myPoints} pts</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={<Trophy className="size-6" />} title="Aún no estás en ninguna liga" description="Crea una liga y comparte el código con tus amigos." action={<Button onClick={() => setCreateOpen(true)}>Crear liga</Button>} />
          </Card>
        ))}

      {tab === 'public' && (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input className="input pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ligas públicas…" />
          </div>
          {publicLeagues.isLoading ? (
            <LoadingBlock />
          ) : publicLeagues.data?.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {publicLeagues.data.map((l) => (
                <Card key={l.id} className="flex items-center gap-4 p-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sky-500/15 text-sky-300">
                    <Globe2 className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-xl font-bold uppercase text-white">{l.name}</p>
                    <p className="truncate text-xs text-slate-400">{l.description ?? 'Liga pública'}</p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      {l.owner && <Avatar name={l.owner.managerName} url={l.owner.avatarUrl} size={18} />}
                      {l.memberCount}/{l.maxMembers} mánagers
                    </p>
                  </div>
                  <Button size="sm" disabled={l.memberCount >= l.maxMembers} loading={joinPublic.isPending && joinPublic.variables === l.id} onClick={() => joinPublic.mutate(l.id)}>
                    {l.memberCount >= l.maxMembers ? 'Completa' : 'Unirse'}
                  </Button>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={<Globe2 className="size-6" />} title="No hay ligas públicas disponibles" description="¡Crea la primera!" />
            </Card>
          )}
        </div>
      )}

      {tab === 'invites' && (
        <div className="space-y-3">
          {invites.data?.length ? (
            invites.data.map((i) => (
              <Card key={i.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <Mail className="size-6 text-pitch-400" />
                <div className="flex-1">
                  <p className="font-semibold text-white">{i.league.name}</p>
                  <p className="text-sm text-slate-400">
                    {i.sender.managerName} te ha invitado · {i.league._count.members}/{i.league.maxMembers} mánagers
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => respond.mutate({ id: i.id, accept: false })}>
                    Rechazar
                  </Button>
                  <Button size="sm" onClick={() => respond.mutate({ id: i.id, accept: true })} loading={respond.isPending}>
                    Aceptar
                  </Button>
                </div>
              </Card>
            ))
          ) : (
            <Card>
              <EmptyState icon={<Mail className="size-6" />} title="No tienes invitaciones pendientes" />
            </Card>
          )}
        </div>
      )}

      <CreateLeagueModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <JoinLeagueModal open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: 'PRIVATE', label: 'Liga privada', hint: 'Acceso con código y contraseña opcional' },
  { value: 'FRIENDS', label: 'Liga entre amigos', hint: 'Código compartido; cualquier miembro puede invitar' },
  { value: 'INVITE', label: 'Liga por invitación', hint: 'Solo entran los mánagers que invite el administrador' },
  { value: 'PUBLIC', label: 'Liga pública', hint: 'Visible en el buscador para cualquier mánager' },
];

function CreateLeagueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', type: 'PRIVATE', password: '', maxMembers: 20, startGameweek: 1 });
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.post<{ id: number; code: string }>('/leagues', { ...form, description: form.description || null, password: form.type === 'PUBLIC' || !form.password ? null : form.password }),
    onSuccess: (league) => {
      toast.push('success', `Liga creada. Código de invitación: ${league.code}`);
      qc.invalidateQueries({ queryKey: ['leagues'] });
      onClose();
      navigate(`/leagues/${league.id}`);
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Crear liga">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre de la liga">
          <Input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="La liga del barrio" required />
        </Field>
        <Field label="Descripción (opcional)">
          <Input value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div>
          <p className="label mb-2">Tipo de liga</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TYPE_OPTIONS.map((t) => (
              <button type="button" key={t.value} onClick={() => setForm({ ...form, type: t.value })} className={`rounded-xl border p-3 text-left transition ${form.type === t.value ? 'border-pitch-500 bg-pitch-500/10' : 'border-white/10 hover:border-white/20'}`}>
                <p className="text-sm font-semibold text-white">{t.label}</p>
                <p className="text-xs text-slate-400">{t.hint}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Máx. participantes">
            <Input type="number" min={2} max={500} value={form.maxMembers} onChange={(e) => setForm({ ...form, maxMembers: Number(e.target.value) })} />
          </Field>
          <Field label="Puntúa desde">
            <Select value={form.startGameweek} onChange={(e) => setForm({ ...form, startGameweek: Number(e.target.value) })}>
              {Array.from({ length: 38 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Jornada {i + 1}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {form.type !== 'PUBLIC' && (
          <Field label="Contraseña (opcional)" hint="Se pedirá además del código para unirse">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending} disabled={form.name.trim().length < 3}>
            Crear liga
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function JoinLeagueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const join = useMutation({
    mutationFn: () => api.post<{ id: number; name: string }>('/leagues/join', { code, password: password || null }),
    onSuccess: (league) => {
      toast.push('success', `Te has unido a ${league.name}`);
      qc.invalidateQueries({ queryKey: ['leagues'] });
      onClose();
      navigate(`/leagues/${league.id}`);
    },
    onError: (e) => {
      if (/contraseña/i.test(errorMessage(e))) setNeedsPassword(true);
      toast.push('error', errorMessage(e));
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Unirse a una liga" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          join.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Código de invitación">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={12} className="text-center font-display text-2xl tracking-[0.3em]" />
        </Field>
        {needsPassword && (
          <Field label="Contraseña de la liga">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={join.isPending} disabled={code.length < 4}>
          Unirse
        </Button>
      </form>
    </Modal>
  );
}
