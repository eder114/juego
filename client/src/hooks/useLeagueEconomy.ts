import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../lib/api';
import { moneyK, signedMoneyK } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

/** Acciones de la economía de liga. Tras cada operación se refrescan mercado, plantilla, saldo y alineación. */
export function useLeagueEconomy() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();

  const invalidate = () => {
    for (const key of ['league-market', 'team', 'dashboard', 'lineup', 'economy-tx', 'league', 'leagues', 'cards']) qc.invalidateQueries({ queryKey: [key] });
    void refresh();
  };

  const buy = useMutation({
    mutationFn: (listing: { id: number; name: string }) => api.post<{ wallet: number; price: number }>(`/market/league/listings/${listing.id}/buy`),
    onSuccess: (res, l) => {
      toast.push('success', `¡${l.name} fichado por ${moneyK(res.price)}! Te quedan ${moneyK(res.wallet)}`);
      invalidate();
    },
    onError: (err) => {
      toast.push('error', errorMessage(err));
      // Si otro mánager se adelantó, el mercado se actualiza al momento
      if (err instanceof ApiError && err.status === 409) qc.invalidateQueries({ queryKey: ['league-market'] });
    },
  });

  const sellPlayer = useMutation({
    mutationFn: (p: { id: number; displayName: string }) => api.post<{ wallet: number; salePrice: number; profit: number }>(`/market/league/players/${p.id}/sell`),
    onSuccess: (res, p) => {
      toast.push('success', `${p.displayName} vendido por ${moneyK(res.salePrice)} (${signedMoneyK(res.profit)} respecto a su precio de compra)`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  const sellCoach = useMutation({
    mutationFn: (c: { id: number; displayName: string }) => api.post<{ wallet: number; salePrice: number }>(`/market/league/coaches/${c.id}/sell`),
    onSuccess: (res, c) => {
      toast.push('success', `${c.displayName} vendido por ${moneyK(res.salePrice)}`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  const join = useMutation({
    mutationFn: (v: { leagueId: number; confirmReplaceSquad?: boolean }) => api.post<{ players: number; wallet: number }>(`/leagues/${v.leagueId}/economy/join`, { confirmReplaceSquad: v.confirmReplaceSquad }),
    onSuccess: (res) => {
      toast.push('success', `¡Equipo listo! Has recibido ${res.players} jugadores y ${moneyK(res.wallet)}`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  return { buy, sellPlayer, sellCoach, join };
}
