import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { money } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

interface PlayerRef {
  id: number;
  displayName: string;
}

export function useTransferActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();

  const invalidate = () => {
    for (const key of ['team', 'players', 'player', 'lineup', 'dashboard', 'compare', 'favorites', 'trends']) qc.invalidateQueries({ queryKey: [key] });
    void refresh();
  };

  const buy = useMutation({
    mutationFn: (p: PlayerRef) => api.post<{ budget: number }>(`/team/players/${p.id}`),
    onSuccess: (res, p) => {
      toast.push('success', `¡${p.displayName} fichado! Presupuesto: ${money(res.budget)}`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  const sell = useMutation({
    mutationFn: (p: PlayerRef) => api.del<{ budget: number; salePrice: number; profit: number }>(`/team/players/${p.id}`),
    onSuccess: (res, p) => {
      const profit = res.profit === 0 ? '' : res.profit > 0 ? ` (beneficio ${money(res.profit)})` : ` (pérdida ${money(-res.profit)})`;
      toast.push('success', `${p.displayName} vendido por ${money(res.salePrice)}${profit}`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  const favorite = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) => (value ? api.post(`/players/${id}/favorite`) : api.del(`/players/${id}/favorite`)),
    onSuccess: () => {
      for (const key of ['players', 'player', 'favorites']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  return { buy, sell, favorite };
}
