import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, PiggyBank, Search, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { dateShort, money, relativeTime } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, Field, Input, LoadingBlock, Modal, Pagination, Toggle } from '../../components/ui';

interface AdminUser {
  id: string;
  email: string;
  managerName: string;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  team: { id: number; name: string; budget: number; totalPoints: number; _count: { players: number } } | null;
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [budgetUser, setBudgetUser] = useState<AdminUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', search, page],
    queryFn: () => api.get<{ items: AdminUser[]; total: number; page: number; pageSize: number }>(`/admin/users${qs({ search, page })}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: () => {
      toast.push('success', 'Usuario actualizado');
      refresh();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/users/${id}`),
    onSuccess: () => {
      toast.push('success', 'Usuario eliminado');
      setDeleting(null);
      refresh();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
        <input
          className="input pl-10"
          placeholder="Buscar por email o mánager…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <Card className="overflow-hidden">
        {isLoading || !data ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="divide-y divide-white/[0.05]">
              {data.items.map((u) => (
                <div key={u.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                      {u.managerName} {u.role === 'ADMIN' && <Badge tone="violet">Admin</Badge>} {!u.isActive && <Badge tone="red">Desactivado</Badge>}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {u.email} · alta {dateShort(u.createdAt)} · {u.lastLoginAt ? `último acceso ${relativeTime(u.lastLoginAt)}` : 'sin accesos'}
                    </p>
                  </div>
                  <div className="text-xs text-slate-300 lg:w-56">
                    {u.team ? (
                      <>
                        <p className="font-semibold text-white">{u.team.name}</p>
                        <p>
                          {u.team.totalPoints} pts · {money(u.team.budget)} · {u.team._count.players} jugadores
                        </p>
                      </>
                    ) : (
                      <span className="text-slate-500">Sin equipo</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Cuenta activa">
                      <Toggle checked={u.isActive} disabled={u.id === me?.id} onChange={(v) => update.mutate({ id: u.id, body: { isActive: v } })} label="Activo" />
                    </label>
                    <Button size="sm" variant="secondary" disabled={u.id === me?.id} icon={u.role === 'ADMIN' ? <UserX className="size-3.5" /> : <ShieldCheck className="size-3.5" />} onClick={() => update.mutate({ id: u.id, body: { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' } })}>
                      {u.role === 'ADMIN' ? 'Quitar admin' : 'Hacer admin'}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!u.team} className="px-2.5" onClick={() => setBudgetUser(u)} aria-label="Ajustar presupuesto">
                      <PiggyBank className="size-4" />
                    </Button>
                    <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setPasswordUser(u)} aria-label="Restablecer contraseña">
                      <KeyRound className="size-4" />
                    </Button>
                    <Button size="sm" variant="danger" className="px-2.5" disabled={u.id === me?.id} onClick={() => setDeleting(u)} aria-label="Eliminar">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4">
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

      {budgetUser && <BudgetModal user={budgetUser} onClose={() => setBudgetUser(null)} onDone={refresh} />}
      {passwordUser && (
        <PasswordModal
          user={passwordUser}
          onClose={() => setPasswordUser(null)}
          onSave={(password) => update.mutate({ id: passwordUser.id, body: { password } }, { onSuccess: () => setPasswordUser(null) })}
          loading={update.isPending}
        />
      )}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        title="Eliminar usuario"
        confirmLabel="Eliminar definitivamente"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        message={deleting && `Se eliminará ${deleting.managerName} (${deleting.email}) junto con su equipo, alineaciones y membresías. Esta acción no se puede deshacer.`}
      />
    </div>
  );
}

function BudgetModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('1.0');
  const [description, setDescription] = useState('Ajuste administrativo');
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.post(`/admin/users/${user.id}/budget`, { amount: Math.round(Number(amount) * 10), description }),
    onSuccess: () => {
      toast.push('success', 'Presupuesto ajustado');
      onDone();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Ajustar presupuesto" size="sm" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>Aplicar</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          {user.team?.name}: saldo actual {money(user.team?.budget)}
        </p>
        <Field label="Importe en £M (negativo para restar)">
          <Input type="number" step="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Motivo">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose, onSave, loading }: { user: AdminUser; onClose: () => void; onSave: (p: string) => void; loading: boolean }) {
  const [password, setPassword] = useState('');
  return (
    <Modal open onClose={onClose} title="Restablecer contraseña" size="sm" footer={<Button onClick={() => onSave(password)} loading={loading} disabled={password.length < 8}>Guardar</Button>}>
      <Field label={`Nueva contraseña para ${user.managerName}`} hint="Mínimo 8 caracteres con letras y números. Comunícasela por un canal seguro.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}
