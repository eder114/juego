import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../lib/api';
import { moneyK, signedMoneyK } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';

/** Acciones de la economía de liga. Tras cada operación se refrescan mercado, plantilla, saldo y alineación. */
export function useLeagueEconomy() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const { withLeague } = useLeague();

  const invalidate = () => {
    for (const key of ['league-market', 'market-pulse', 'team', 'dashboard', 'lineup', 'economy-tx', 'league', 'leagues', 'cards']) qc.invalidateQueries({ queryKey: [key] });
    void refresh();
  };

  const bid = useMutation({
    // La subasta ya determina la liga: no hace falta enviarla
    mutationFn: (v: { id: number; name: string; amount: number }) =>
      api.post<{ amount: number; available: number; reserved: number; minNext: number }>(`/market/league/listings/${v.id}/bid`, { amount: v.amount }),
    onSuccess: (res, v) => {
      toast.push('success', `Vas ganando a ${v.name} con ${moneyK(res.amount)}. Te quedan ${moneyK(res.available)} disponibles`);
      invalidate();
      qc.invalidateQueries({ queryKey: ['auction-bids', v.id] });
    },
    onError: (err, v) => {
      toast.push('error', errorMessage(err));
      // Si otro mánager se adelantó, el mercado se actualiza al momento para mostrar la puja real
      if (err instanceof ApiError && err.status === 409) {
        qc.invalidateQueries({ queryKey: ['league-market'] });
        qc.invalidateQueries({ queryKey: ['market-pulse'] });
        qc.invalidateQueries({ queryKey: ['auction-bids', v.id] });
      }
    },
  });

  const sellPlayer = useMutation({
    mutationFn: (p: { id: number; displayName: string }) => api.post<{ wallet: number; salePrice: number; profit: number }>(withLeague(`/market/league/players/${p.id}/sell`)),
    onSuccess: (res, p) => {
      toast.push('success', `${p.displayName} vendido por ${moneyK(res.salePrice)} (${signedMoneyK(res.profit)} respecto a su precio de compra)`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  const sellCoach = useMutation({
    mutationFn: (c: { id: number; displayName: string }) => api.post<{ wallet: number; salePrice: number }>(withLeague(`/market/league/coaches/${c.id}/sell`)),
    onSuccess: (res, c) => {
      toast.push('success', `${c.displayName} vendido por ${moneyK(res.salePrice)}`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  const join = useMutation({
    mutationFn: (v: { leagueId: number }) => api.post<{ players: number; wallet: number }>(`/leagues/${v.leagueId}/economy/join`),
    onSuccess: (res) => {
      toast.push('success', `¡Equipo listo! Has recibido ${res.players} jugadores y ${moneyK(res.wallet)}`);
      invalidate();
    },
    onError: (err) => toast.push('error', errorMessage(err)),
  });

  return { bid, sellPlayer, sellCoach, join };
}
