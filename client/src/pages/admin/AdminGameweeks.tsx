import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, CheckCircle2, Pencil, Plus, RefreshCw, Tag } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTime, GW_STATUS } from '../../lib/format';
import type { Gameweek } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, Field, Input, LoadingBlock, Modal } from '../../components/ui';

type AdminGameweek = Gameweek & { _count: { fixtures: number; lineups: number } };

export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function AdminGameweeks() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AdminGameweek | 'new' | null>(null);
  const [finalizing, setFinalizing] = useState<AdminGameweek | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'gameweeks'], queryFn: () => api.get<AdminGameweek[]>('/admin/gameweeks') });
  const refresh = () => qc.invalidateQueries();
  const onError = (e: unknown) => toast.push('error', errorMessage(e));

  const process = useMutation({
    mutationFn: ({ id, final }: { id: number; final: boolean }) => api.post<{ lineups: number }>(`/admin/gameweeks/${id}/process`, { final }),
    onSuccess: (r, v) => {
      toast.push('success', `${v.final ? 'Jornada cerrada' : 'Puntuación recalculada'}: ${r.lineups} alineaciones`);
      setFinalizing(null);
      refresh();
    },
    onError,
  });
  const prices = useMutation({
    mutationFn: (id: number) => api.post<{ changed: number; rises: number; falls: number }>(`/admin/gameweeks/${id}/prices`),
    onSuccess: (r) => {
      toast.push('success', `Precios actualizados: ${r.rises} suben, ${r.falls} bajan`);
      refresh();
    },
    onError,
  });
  const syncStatuses = useMutation({ mutationFn: () => api.post('/admin/gameweeks/sync-statuses'), onSuccess: () => { toast.push('success', 'Estados sincronizados'); refresh(); }, onError });

  if (isLoading || !data) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">El estado de cada jornada se calcula automáticamente con los horarios y resultados. Al finalizar todos sus partidos se cierra y puntúa sola.</p>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={syncStatuses.isPending} onClick={() => syncStatuses.mutate()}>Sincronizar estados</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nueva jornada</Button>
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Jornada</th>
              <th className="px-2 py-3">Cierre</th>
              <th className="px-2 py-3">Estado</th>
              <th className="px-2 py-3 text-center">Partidos</th>
              <th className="px-2 py-3 text-center">Alineaciones</th>
              <th className="px-2 py-3">Proceso</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {data.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-2.5 font-semibold text-white">{g.name}</td>
                <td className="px-2 py-2.5 text-slate-300">{dateTime(g.deadline)}</td>
                <td className="px-2 py-2.5"><Badge tone={g.status === 'LIVE' ? 'amber' : g.status === 'FINISHED' ? 'green' : 'sky'}>{GW_STATUS[g.status]}</Badge></td>
                <td className="px-2 py-2.5 text-center tabular-nums">{g._count.fixtures}</td>
                <td className="px-2 py-2.5 text-center tabular-nums">{g._count.lineups}</td>
                <td className="px-2 py-2.5">
                  <div className="flex gap-1.5">
                    {g.isProcessed && <Badge tone="green"><CheckCircle2 className="size-3" /> Puntuada</Badge>}
                    {g.pricesUpdated && <Badge>Precios</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setEditing(g)} aria-label="Editar"><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="secondary" icon={<Calculator className="size-3.5" />} disabled={g.status === 'UPCOMING'} loading={process.isPending && process.variables?.id === g.id && !process.variables.final} onClick={() => process.mutate({ id: g.id, final: g.isProcessed })}>Recalcular</Button>
                    {!g.isProcessed && <Button size="sm" variant="outline" disabled={g.status === 'UPCOMING'} onClick={() => setFinalizing(g)}>Cerrar</Button>}
                    <Button size="sm" variant="secondary" className="px-2.5" disabled={!g.isProcessed} loading={prices.isPending && prices.variables === g.id} onClick={() => prices.mutate(g.id)} aria-label="Actualizar precios" title="Aplicar sistema de precios"><Tag className="size-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <GameweekModal gameweek={editing === 'new' ? null : editing} nextNumber={data.length + 1} onClose={() => setEditing(null)} onDone={refresh} />}
      <ConfirmModal
        open={!!finalizing}
        onClose={() => setFinalizing(null)}
        title={`Cerrar ${finalizing?.name}`}
        confirmLabel="Cerrar y puntuar"
        loading={process.isPending}
        onConfirm={() => finalizing && process.mutate({ id: finalizing.id, final: true })}
        message="Se aplicarán las sustituciones automáticas, se fijarán los puntos definitivos, se notificará a los mánagers y, si está activado, se actualizarán los precios. Los jugadores sin partido terminado contarán como no presentados."
      />
    </div>
  );
}

function GameweekModal({ gameweek, nextNumber, onClose, onDone }: { gameweek: AdminGameweek | null; nextNumber: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [number, setNumber] = useState(gameweek?.id ?? nextNumber);
  const [name, setName] = useState(gameweek?.name ?? `Jornada ${nextNumber}`);
  const [deadline, setDeadline] = useState(toLocalInput(gameweek?.deadline));
  const save = useMutation({
    mutationFn: () => {
      const body = { name, deadline: new Date(deadline).toISOString() };
      return gameweek ? api.patch(`/admin/gameweeks/${gameweek.id}`, body) : api.post('/admin/gameweeks', { ...body, number });
    },
    onSuccess: () => {
      toast.push('success', 'Jornada guardada');
      onDone();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={gameweek ? `Editar ${gameweek.name}` : 'Nueva jornada'} size="sm" footer={<Button onClick={() => save.mutate()} loading={save.isPending} disabled={!deadline}>Guardar</Button>}>
      <div className="space-y-3">
        {!gameweek && <Field label="Número"><Input type="number" min={1} max={60} value={number} onChange={(e) => setNumber(Number(e.target.value))} /></Field>}
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Cierre de alineaciones"><Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
