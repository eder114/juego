import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, HeartHandshake, Pencil, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { money, POSITION_LABEL, POSITIONS, STATUS_META } from '../../lib/format';
import type { Club, Paginated, Player, PlayerStatus, Position } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Button, Card, ConfirmModal, Field, Input, LoadingBlock, Modal, Pagination, Select, Toggle } from '../../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, StatusBadge } from '../../components/sport';

export default function AdminPlayers() {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [club, setClub] = useState('');
  const [position, setPosition] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Player | 'new' | null>(null);
  const [pricing, setPricing] = useState<Player | null>(null);
  const [injuring, setInjuring] = useState<Player | null>(null);
  const [deleting, setDeleting] = useState<Player | null>(null);
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });
  const params = { search, club, position, includeInactive: includeInactive || undefined, page, pageSize: 25 };
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'players', params], queryFn: () => api.get<Paginated<Player>>(`/admin/players${qs(params)}`), placeholderData: keepPreviousData });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'players'] });
    qc.invalidateQueries({ queryKey: ['players'] });
  };
  const recover = useMutation({ mutationFn: (id: number) => api.post(`/admin/players/${id}/recover`), onSuccess: () => { toast.push('success', 'Jugador marcado como disponible'); refresh(); } });
  const remove = useMutation({
    mutationFn: (id: number) => api.del<{ deleted: boolean; message?: string }>(`/admin/players/${id}`),
    onSuccess: (r) => {
      toast.push('success', r.message ?? 'Jugador eliminado');
      setDeleting(null);
      refresh();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_180px_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input className="input pl-10" placeholder="Buscar jugador…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={club} onChange={(e) => { setClub(e.target.value); setPage(1); }}>
          <option value="">Todos los clubes</option>
          {clubs?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select value={position} onChange={(e) => { setPosition(e.target.value); setPage(1); }}>
          <option value="">Todas las posiciones</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{POSITION_LABEL[p]}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <Toggle checked={includeInactive} onChange={setIncludeInactive} label="Incluir inactivos" /> Inactivos
        </label>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nuevo jugador</Button>
      </Card>

      <Card className="overflow-hidden">
        {isLoading || !data ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="divide-y divide-white/[0.05]">
              {data.items.map((p) => (
                <div key={p.id} className="flex flex-col gap-3 px-4 py-2.5 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <PlayerPhoto player={p} size={40} rounded="rounded-xl" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{p.displayName} {!p.isActive && <span className="text-xs text-red-300">(inactivo)</span>}</p>
                      <p className="flex items-center gap-1.5 text-xs text-slate-400">
                        <PositionBadge position={p.position} /> <ClubCrest club={p.club} size={14} /> {p.club.shortName} · {p.stats.totalPoints} pts
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={p.status} chance={p.chanceOfPlaying} />
                    <span className="w-16 text-right font-display text-lg font-bold text-pitch-300">{money(p.price)}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setEditing(p)} aria-label="Editar"><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setPricing(p)} aria-label="Cambiar precio"><Tag className="size-4" /></Button>
                    {p.status === 'AVAILABLE' ? (
                      <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setInjuring(p)} aria-label="Registrar baja"><HeartPulse className="size-4" /></Button>
                    ) : (
                      <Button size="sm" variant="outline" className="px-2.5" onClick={() => recover.mutate(p.id)} aria-label="Marcar disponible"><HeartHandshake className="size-4" /></Button>
                    )}
                    <Button size="sm" variant="danger" className="px-2.5" onClick={() => setDeleting(p)} aria-label="Eliminar"><Trash2 className="size-4" /></Button>
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

      {editing && <PlayerFormModal player={editing === 'new' ? null : editing} clubs={clubs ?? []} onClose={() => setEditing(null)} onDone={refresh} />}
      {pricing && <PriceModal player={pricing} onClose={() => setPricing(null)} onDone={refresh} />}
      {injuring && <InjuryModal player={injuring} onClose={() => setInjuring(null)} onDone={refresh} />}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} danger title="Eliminar jugador" confirmLabel="Eliminar" loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} message="Si el jugador tiene historial (estadísticas, fichajes o alineaciones) se desactivará en lugar de borrarse para mantener la integridad de los datos." />
    </div>
  );
}

function PlayerFormModal({ player, clubs, onClose, onDone }: { player: Player | null; clubs: Club[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: player?.firstName ?? '',
    lastName: player?.lastName ?? '',
    displayName: player?.displayName ?? '',
    position: (player?.position ?? 'MID') as Position,
    clubId: player?.club.id ?? clubs[0]?.id ?? 0,
    birthDate: player?.birthDate?.slice(0, 10) ?? '',
    nationality: player?.nationality ?? '',
    photoUrl: player?.photoUrl ?? '',
    squadNumber: player?.squadNumber ? String(player.squadNumber) : '',
    price: player ? (player.price / 10).toFixed(1) : '5.0',
    status: (player?.status ?? 'AVAILABLE') as PlayerStatus,
    news: player?.news ?? '',
    isActive: player?.isActive ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        firstName: form.firstName,
        lastName: form.lastName,
        displayName: form.displayName,
        position: form.position,
        clubId: Number(form.clubId),
        birthDate: form.birthDate || null,
        nationality: form.nationality || null,
        photoUrl: form.photoUrl || null,
        squadNumber: form.squadNumber ? Number(form.squadNumber) : null,
        status: form.status,
        news: form.news || null,
        isActive: form.isActive,
      };
      return player ? api.patch(`/admin/players/${player.id}`, body) : api.post('/admin/players', { ...body, price: Math.round(Number(form.price) * 10) });
    },
    onSuccess: () => {
      toast.push('success', player ? 'Jugador actualizado' : 'Jugador creado');
      onDone();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={player ? `Editar ${player.displayName}` : 'Nuevo jugador'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre"><Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
        <Field label="Apellidos"><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
        <Field label="Nombre mostrado"><Input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} /></Field>
        <Field label="Club">
          <Select value={form.clubId} onChange={(e) => set('clubId', Number(e.target.value))}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Posición" hint={player ? 'No se puede cambiar si está en plantillas' : undefined}>
          <Select value={form.position} onChange={(e) => set('position', e.target.value as Position)}>
            {POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABEL[p]}</option>)}
          </Select>
        </Field>
        {!player && <Field label="Precio (£M)"><Input type="number" step="0.1" min="1" value={form.price} onChange={(e) => set('price', e.target.value)} /></Field>}
        <Field label="Fecha de nacimiento"><Input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
        <Field label="Nacionalidad"><Input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
        <Field label="Dorsal"><Input type="number" min={1} max={99} value={form.squadNumber} onChange={(e) => set('squadNumber', e.target.value)} /></Field>
        <Field label="URL de la foto"><Input value={form.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} /></Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as PlayerStatus)}>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Parte / noticia"><Input value={form.news} onChange={(e) => set('news', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-300"><Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Activo" /> Disponible en el mercado</label>
      </div>
    </Modal>
  );
}

function PriceModal({ player, onClose, onDone }: { player: Player; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState((player.price / 10).toFixed(1));
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.put(`/admin/players/${player.id}/price`, { price: Math.round(Number(price) * 10) }),
    onSuccess: () => {
      toast.push('success', 'Precio actualizado y registrado en el historial');
      onDone();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Precio de ${player.displayName}`} size="sm" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>Guardar precio</Button>}>
      <Field label="Nuevo precio (£M)" hint={`Actual: ${money(player.price)}. Se notificará a los mánagers que lo tengan.`}>
        <Input type="number" step="0.1" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
    </Modal>
  );
}

function InjuryModal({ player, onClose, onDone }: { player: Player; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ type: 'INJURY', status: 'INJURED', description: '', expectedReturn: '', chanceOfPlaying: '' });
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.post(`/admin/players/${player.id}/injuries`, { ...form, expectedReturn: form.expectedReturn || null, chanceOfPlaying: form.chanceOfPlaying ? Number(form.chanceOfPlaying) : null }),
    onSuccess: () => {
      toast.push('success', 'Baja registrada y mánagers notificados');
      onDone();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Registrar baja: ${player.displayName}`} footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={form.description.length < 3}>Registrar</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, status: e.target.value === 'SUSPENSION' ? 'SUSPENDED' : form.status })}>
            <option value="INJURY">Lesión</option>
            <option value="SUSPENSION">Sanción</option>
            <option value="ILLNESS">Enfermedad</option>
            <option value="OTHER">Otro</option>
          </Select>
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="DOUBTFUL">Duda</option>
            <option value="INJURED">Lesionado</option>
            <option value="SUSPENDED">Sancionado</option>
            <option value="UNAVAILABLE">No disponible</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Descripción"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Lesión muscular, 3 semanas" /></Field>
        </div>
        <Field label="Regreso estimado"><Input type="date" value={form.expectedReturn} onChange={(e) => setForm({ ...form, expectedReturn: e.target.value })} /></Field>
        <Field label="Probabilidad de jugar (%)"><Input type="number" min={0} max={100} value={form.chanceOfPlaying} onChange={(e) => setForm({ ...form, chanceOfPlaying: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
