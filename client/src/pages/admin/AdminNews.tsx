import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import type { News } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, Field, Input, LoadingBlock, Modal, Select, Toggle } from '../../components/ui';

type AdminNewsItem = News & { published: boolean; author: { managerName: string } | null };
const CATEGORY_LABEL: Record<string, string> = { GENERAL: 'General', INJURY: 'Lesiones', GAMEWEEK: 'Jornada', TRANSFER: 'Fichajes', MARKET: 'Mercado' };

export default function AdminNews() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AdminNewsItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminNewsItem | null>(null);
  const [broadcast, setBroadcast] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'news'], queryFn: () => api.get<AdminNewsItem[]>('/admin/news') });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'news'] });
    qc.invalidateQueries({ queryKey: ['news'] });
  };
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admin/news/${id}`),
    onSuccess: () => { toast.push('success', 'Noticia eliminada'); setDeleting(null); refresh(); },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon={<Megaphone className="size-4" />} onClick={() => setBroadcast(true)}>Aviso a todos</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nueva noticia</Button>
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-white/[0.05]">
          {data.map((n) => (
            <div key={n.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                  {n.title} <Badge>{CATEGORY_LABEL[n.category]}</Badge> {!n.published && <Badge tone="amber">Borrador</Badge>}
                </p>
                <p className="truncate text-xs text-slate-400">{n.summary} · {relativeTime(n.createdAt)}</p>
              </div>
              <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setEditing(n)} aria-label="Editar"><Pencil className="size-4" /></Button>
              <Button size="sm" variant="danger" className="px-2.5" onClick={() => setDeleting(n)} aria-label="Eliminar"><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
      </Card>
      {editing && <NewsModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {broadcast && <BroadcastModal onClose={() => setBroadcast(false)} />}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} danger title="Eliminar noticia" confirmLabel="Eliminar" loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} message={deleting?.title} />
    </div>
  );
}

function NewsModal({ item, onClose, onDone }: { item: AdminNewsItem | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: item?.title ?? '', summary: item?.summary ?? '', content: item?.content ?? '', category: item?.category ?? 'GENERAL', published: item?.published ?? true });
  const save = useMutation({
    mutationFn: () => (item ? api.patch(`/admin/news/${item.id}`, form) : api.post('/admin/news', form)),
    onSuccess: () => { toast.push('success', 'Noticia guardada'); onDone(); onClose(); },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={item ? 'Editar noticia' : 'Nueva noticia'} size="lg" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>Guardar</Button>}>
      <div className="space-y-3">
        <Field label="Título"><Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Resumen"><Input value={form.summary} maxLength={300} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
        <Field label="Contenido"><textarea className="input min-h-40" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
        <div className="flex flex-wrap items-center gap-4">
          <Select className="w-48" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-300"><Toggle checked={form.published} onChange={(v) => setForm({ ...form, published: v })} label="Publicada" /> Publicada</label>
        </div>
      </div>
    </Modal>
  );
}

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', message: '' });
  const send = useMutation({
    mutationFn: () => api.post<{ sent: number }>('/admin/notifications', form),
    onSuccess: (r) => { toast.push('success', `Aviso enviado a ${r.sent} usuarios`); onClose(); },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Enviar aviso a todos" size="sm" footer={<Button onClick={() => send.mutate()} loading={send.isPending} disabled={form.title.length < 3 || form.message.length < 3}>Enviar</Button>}>
      <div className="space-y-3">
        <Field label="Título"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Mensaje"><textarea className="input min-h-24" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
