import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Camera, Crown, Flag, Flame, Handshake, Lock, Medal, Repeat, ShoppingCart, Trash2, Trophy, Users, Zap } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { dateShort } from '../lib/format';
import type { Club, Crest, Me } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, CardHeader, Field, Input, LoadingBlock, PageHeader, Select, StatCard, Tabs } from '../components/ui';
import { Avatar, ClubCrest, TeamCrest } from '../components/sport';
import { CrestEditor, DEFAULT_CREST } from '../components/CrestEditor';

const ACH_ICONS: Record<string, typeof Award> = { 'shopping-cart': ShoppingCart, users: Users, flag: Flag, handshake: Handshake, repeat: Repeat, flame: Flame, zap: Zap, trophy: Trophy, crown: Crown, medal: Medal };

/** Recorta al centro y reduce la foto (las del móvil pesan varios MB) antes de subirla. */
async function resizeAvatar(file: File, size = 320): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(size, side);
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85));
}

interface PersonalStats {
  totalPoints: number;
  gameweeksPlayed: number;
  averagePoints: number;
  bestGameweek: { gameweek: number; points: number } | null;
  benchPointsLost: number;
  captainPoints: number;
  purchases: number;
  sales: number;
  leagues: number;
  globalRank: number | null;
  totalManagers: number;
}

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const [tab, setTab] = useState<'profile' | 'stats' | 'achievements' | 'security'>('profile');
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });
  const stats = useQuery({ queryKey: ['me', 'stats'], queryFn: () => api.get<PersonalStats | null>('/users/me/stats'), enabled: tab === 'stats' });
  const achievements = useQuery({ queryKey: ['me', 'achievements'], queryFn: () => api.get<{ code: string; title: string; description: string; icon: string; unlockedAt: string | null }[]>('/users/me/achievements'), enabled: tab === 'achievements' });

  const [managerName, setManagerName] = useState(user?.managerName ?? '');
  const [favoriteClubId, setFavoriteClubId] = useState<string>(user?.favoriteClub ? String(user.favoriteClub.id) : '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  const saveProfile = useMutation({
    mutationFn: () => api.patch<Me>('/users/me', { managerName, favoriteClubId: favoriteClubId ? Number(favoriteClubId) : null }),
    onSuccess: (me) => {
      setUser(me);
      toast.push('success', 'Perfil actualizado');
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('avatar', await resizeAvatar(file), 'avatar.jpg');
      return api.post<Me>('/users/me/avatar', form);
    },
    onSuccess: (me) => {
      setUser(me);
      toast.push('success', 'Foto actualizada');
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const removeAvatar = useMutation({ mutationFn: () => api.del<Me>('/users/me/avatar'), onSuccess: (me) => setUser(me) });
  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: () => {
      toast.push('success', 'Contraseña cambiada');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  if (!user) return <LoadingBlock />;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return toast.push('error', 'Las contraseñas no coinciden');
    changePassword.mutate();
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Mi cuenta" title="Perfil" />

      <Card className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:p-6">
        <div className="relative">
          <Avatar name={user.managerName} url={user.avatarUrl} size={96} />
          <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full bg-pitch-500 text-ink-950 shadow-lg" aria-label="Cambiar foto">
            <Camera className="size-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadAvatar.mutate(file);
              e.target.value = '';
            }}
          />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-4xl font-extrabold uppercase">{user.managerName}</h2>
          <p className="text-sm text-slate-400">{user.email}</p>
          <p className="mt-1 text-xs text-slate-500">
            Mánager desde {dateShort(user.createdAt)} {user.role === 'ADMIN' && '· Administrador'}
          </p>
          {user.avatarUrl && (
            <button onClick={() => removeAvatar.mutate()} className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-300">
              <Trash2 className="size-3" /> Quitar foto
            </button>
          )}
        </div>
        {user.team && (
          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/50 p-3">
            <TeamCrest crest={user.team.crest} name={user.team.name} size={54} />
            <div>
              <p className="font-display text-xl font-bold uppercase text-white">{user.team.name}</p>
              <p className="text-sm text-slate-400">{user.team.totalPoints} puntos</p>
            </div>
          </div>
        )}
      </Card>

      {!user.team && <CreateTeamCard />}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Datos' },
          { value: 'stats', label: 'Estadísticas' },
          { value: 'achievements', label: 'Logros' },
          { value: 'security', label: 'Seguridad' },
        ]}
      />

      {tab === 'profile' && (
        <Card className="p-5">
          <form
            className="grid gap-4 sm:max-w-xl"
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
          >
            <Field label="Nombre de mánager">
              <Input value={managerName} maxLength={30} onChange={(e) => setManagerName(e.target.value)} />
            </Field>
            <Field label="Equipo favorito">
              <div className="flex items-center gap-3">
                {favoriteClubId && <ClubCrest club={clubs?.find((c) => String(c.id) === favoriteClubId)} size={32} />}
                <Select value={favoriteClubId} onChange={(e) => setFavoriteClubId(e.target.value)}>
                  <option value="">Sin equipo favorito</option>
                  {clubs?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <div>
              <Button type="submit" loading={saveProfile.isPending}>
                Guardar cambios
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'stats' &&
        (stats.isLoading ? (
          <LoadingBlock />
        ) : stats.data ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard accent label="Puntos totales" value={stats.data.totalPoints} sub={`${stats.data.gameweeksPlayed} jornadas`} />
            <StatCard label="Posición global" value={stats.data.globalRank ? `#${stats.data.globalRank}` : '—'} sub={`de ${stats.data.totalManagers}`} />
            <StatCard label="Media por jornada" value={stats.data.averagePoints} />
            <StatCard label="Mejor jornada" value={stats.data.bestGameweek?.points ?? 0} sub={stats.data.bestGameweek ? `Jornada ${stats.data.bestGameweek.gameweek}` : undefined} />
            <StatCard label="Puntos de capitanes" value={stats.data.captainPoints} />
            <StatCard label="Puntos en el banquillo" value={stats.data.benchPointsLost} />
            <StatCard label="Fichajes / Ventas" value={`${stats.data.purchases} / ${stats.data.sales}`} />
            <StatCard label="Ligas" value={stats.data.leagues} />
          </div>
        ) : (
          <Card className="p-6 text-sm text-slate-400">Crea tu equipo para ver estadísticas.</Card>
        ))}

      {tab === 'achievements' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.data?.map((a) => {
            const Icon = ACH_ICONS[a.icon] ?? Award;
            return (
              <Card key={a.code} className={clsx('flex items-center gap-4 p-4', !a.unlockedAt && 'opacity-50')}>
                <span className={clsx('grid size-14 shrink-0 place-items-center rounded-2xl', a.unlockedAt ? 'bg-gradient-to-br from-gold to-amber-600 text-ink-950' : 'bg-white/[0.06] text-slate-500')}>
                  {a.unlockedAt ? <Icon className="size-7" /> : <Lock className="size-6" />}
                </span>
                <div>
                  <p className="font-display text-xl font-bold uppercase text-white">{a.title}</p>
                  <p className="text-sm text-slate-400">{a.description}</p>
                  {a.unlockedAt && <p className="text-xs text-gold">Desbloqueado {dateShort(a.unlockedAt)}</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'security' && (
        <Card className="p-5">
          <CardHeader title="Cambiar contraseña" />
          <form onSubmit={submitPassword} className="mt-4 grid gap-4 sm:max-w-md">
            <Field label="Contraseña actual">
              <Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números">
              <Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label="Repite la nueva contraseña">
              <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={changePassword.isPending} disabled={!pw.currentPassword || !pw.newPassword}>
                Cambiar contraseña
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  logout();
                  qc.clear();
                  navigate('/login');
                }}
              >
                Cerrar sesión
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function CreateTeamCard() {
  const [name, setName] = useState('');
  const [crest, setCrest] = useState<Crest>(DEFAULT_CREST);
  const { refresh } = useAuth();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/team', { name, crest }),
    onSuccess: async () => {
      toast.push('success', '¡Equipo creado! Ya puedes fichar jugadores.');
      await refresh();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Card className="border-pitch-500/30 p-5">
      <h3 className="text-2xl font-bold uppercase">Crea tu equipo Fantasy</h3>
      <p className="mb-4 text-sm text-slate-400">Necesitas un equipo para fichar jugadores y competir en ligas.</p>
      <div className="space-y-4">
        <Field label="Nombre del equipo">
          <Input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </Field>
        <CrestEditor value={crest} onChange={setCrest} teamName={name} />
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={name.trim().length < 3}>
          Crear equipo
        </Button>
      </div>
    </Card>
  );
}
