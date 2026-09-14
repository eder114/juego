import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateShort } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, ConfirmModal, LoadingBlock } from '../../components/ui';
import { LEAGUE_TONE } from '../Leagues';

interface AdminLeague {
  id: number;
  name: string;
  type: string;
  code: string;
  maxMembers: number;
  isSystem: boolean;
  createdAt: string;
  owner: { managerName: string } | null;
  _count: { members: number };
}

const TYPE_LABEL: Record<string, string> = { GLOBAL: 'Global', PUBLIC: 'Pública', PRIVATE: 'Privada', FRIENDS: 'Amigos', INVITE: 'Invitación' };

export default function AdminLeagues() {
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<AdminLeague | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'leagues'], queryFn: () => api.get<AdminLeague[]>('/admin/leagues') });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admin/leagues/${id}`),
    onSuccess: () => {
      toast.push('success', 'Liga eliminada');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'leagues'] });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-4 py-3">Liga</th>
            <th className="px-2 py-3">Tipo</th>
            <th className="px-2 py-3">Código</th>
            <th className="px-2 py-3 text-center">Miembros</th>
            <th className="px-2 py-3">Administrador</th>
            <th className="px-2 py-3">Creada</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {data.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2.5"><Link to={`/leagues/${l.id}`} className="font-semibold text-white hover:text-pitch-300">{l.name}</Link></td>
              <td className="px-2 py-2.5"><Badge tone={LEAGUE_TONE[l.type]}>{TYPE_LABEL[l.type]}</Badge></td>
              <td className="px-2 py-2.5 font-mono text-slate-300">{l.code}</td>
              <td className="px-2 py-2.5 text-center tabular-nums">{l._count.members}{l.type !== 'GLOBAL' && `/${l.maxMembers}`}</td>
              <td className="px-2 py-2.5 text-slate-300">{l.owner?.managerName ?? '—'}</td>
              <td className="px-2 py-2.5 text-slate-400">{dateShort(l.createdAt)}</td>
              <td className="px-4 py-2.5 text-right">
                {!l.isSystem && <Button size="sm" variant="danger" className="px-2.5" onClick={() => setDeleting(l)} aria-label="Eliminar"><Trash2 className="size-4" /></Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} danger title="Eliminar liga" confirmLabel="Eliminar" loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} message={deleting && `Se eliminará "${deleting.name}" y sus ${deleting._count.members} membresías. Los equipos no se ven afectados.`} />
    </Card>
  );
}
