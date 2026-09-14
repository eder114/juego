import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { Club } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, Field, Input, LoadingBlock, Modal, Toggle } from '../../components/ui';
import { ClubCrest } from '../../components/sport';

type AdminClub = Club & { _count: { players: number } };

export default function AdminClubs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AdminClub | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminClub | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'clubs'], queryFn: () => api.get<AdminClub[]>('/admin/clubs') });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
    qc.invalidateQueries({ queryKey: ['clubs'] });
  };
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admin/clubs/${id}`),
    onSuccess: () => {
      toast.push('success', 'Club eliminado');
      setDeleting(null);
      refresh();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  if (isLoading || !data) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{data.filter((c) => c.isActive).length} clubes activos en la temporada. Desactiva los descendidos al cambiar de temporada.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nuevo club</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((c) => (
          <Card key={c.id} className="flex items-center gap-3 p-4">
            <ClubCrest club={c} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{c.name} <span className="text-xs text-slate-400">({c.shortName})</span></p>
              <p className="truncate text-xs text-slate-400">{c.stadium} · {c.city}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="size-3 rounded-full ring-1 ring-white/20" style={{ background: c.primaryColor }} />
                <span className="size-3 rounded-full ring-1 ring-white/20" style={{ background: c.secondaryColor }} />
                <span className="text-xs text-slate-500">{c._count.players} jugadores</span>
                {!c.isActive && <Badge tone="red">Inactivo</Badge>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setEditing(c)} aria-label="Editar"><Pencil className="size-4" /></Button>
              <Button size="sm" variant="danger" className="px-2.5" onClick={() => setDeleting(c)} aria-label="Eliminar"><Trash2 className="size-4" /></Button>
            </div>
          </Card>
        ))}
      </div>
      {editing && <ClubModal club={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} danger title="Eliminar club" confirmLabel="Eliminar" loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} message="Solo se pueden eliminar clubes sin jugadores ni partidos. Para clubes descendidos, desactívalos." />
    </div>
  );
}

function ClubModal({ club, onClose, onDone }: { club: AdminClub | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: club?.name ?? '',
    shortName: club?.shortName ?? '',
    commonName: club?.commonName ?? '',
    city: club?.city ?? '',
    stadium: club?.stadium ?? '',
    primaryColor: club?.primaryColor ?? '#22c55e',
    secondaryColor: club?.secondaryColor ?? '#ffffff',
    crestUrl: club?.crestUrl ?? '',
    isActive: club?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, commonName: form.commonName || null, crestUrl: form.crestUrl || null };
      return club ? api.patch(`/admin/clubs/${club.id}`, body) : api.post('/admin/clubs', body);
    },
    onSuccess: () => {
      toast.push('success', 'Club guardado');
      onDone();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open onClose={onClose} title={club ? `Editar ${club.name}` : 'Nuevo club'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre completo"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Nombre corto (3 letras)"><Input value={form.shortName} maxLength={3} onChange={(e) => set('shortName', e.target.value.toUpperCase())} /></Field>
        <Field label="Nombre común"><Input value={form.commonName} onChange={(e) => set('commonName', e.target.value)} /></Field>
        <Field label="Ciudad"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Estadio"><Input value={form.stadium} onChange={(e) => set('stadium', e.target.value)} /></Field>
        <Field label="URL del escudo"><Input value={form.crestUrl} onChange={(e) => set('crestUrl', e.target.value)} /></Field>
        <Field label="Color principal"><Input type="color" className="h-11 p-1" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} /></Field>
        <Field label="Color secundario"><Input type="color" className="h-11 p-1" value={form.secondaryColor} onChange={(e) => set('secondaryColor', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-300"><Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Activo" /> Participa en la temporada activa</label>
      </div>
    </Modal>
  );
}
