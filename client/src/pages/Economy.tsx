import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Receipt, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { dateTime, money, moneyFull, moneyIn, moneyK, TX_LABEL } from '../lib/format';
import type { EconomyTransaction } from '../types';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, StatCard } from '../components/ui';

interface TxPage {
  economyVersion: 1 | 2;
  wallet: number;
  budget: number;
  items: EconomyTransaction[];
  nextCursor: number | null;
}

/** Historial económico auditable: cada movimiento con saldo anterior y posterior. */
export default function Economy() {
  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['economy-tx'],
    queryFn: ({ pageParam }) => api.get<TxPage>(`/economy/transactions${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  const first = data.pages[0];
  const items = data.pages.flatMap((p) => p.items);
  const v2 = first.economyVersion === 2;
  const k = items.filter((t) => t.currency === 'K');
  const income = k.filter((t) => t.amount > 0 && t.type !== 'INITIAL_BUDGET').reduce((s, t) => s + t.amount, 0);
  const spent = k.filter((t) => t.amount < 0 && t.type !== 'ECONOMY_RESET').reduce((s, t) => s - t.amount, 0);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Economía" title="Movimientos" subtitle="Todos los cambios de tu presupuesto quedan registrados con su motivo y el saldo resultante." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard accent label="Saldo actual" value={v2 ? moneyK(first.wallet) : money(first.budget)} icon={<Wallet />} sub={v2 ? moneyFull(first.wallet) : 'Sistema clásico'} />
        {v2 && <StatCard label="Ingresos" value={moneyK(income)} icon={<ArrowDownLeft />} sub="Ventas y premios (movimientos cargados)" />}
        {v2 && <StatCard label="Gastos" value={moneyK(spent)} icon={<ArrowUpRight />} sub="Fichajes (movimientos cargados)" className="col-span-2 lg:col-span-1" />}
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={<Receipt className="size-6" />} title="Sin movimientos" description="Aquí verás fichajes, ventas, premios de desafíos y ajustes." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {items.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', t.amount >= 0 ? 'bg-pitch-500/15 text-pitch-300' : 'bg-red-500/15 text-red-300')}>
                  {t.amount >= 0 ? <ArrowDownLeft aria-hidden className="size-4" /> : <ArrowUpRight aria-hidden className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                    <span className="truncate">{t.description}</span>
                    <Badge tone={t.amount >= 0 ? 'green' : 'slate'}>{TX_LABEL[t.type] ?? t.type}</Badge>
                  </p>
                  <p className="text-xs text-slate-400">
                    {dateTime(t.createdAt)}
                    {t.balanceBefore !== null && ` · saldo anterior ${moneyIn(t.balanceBefore, t.currency)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className={clsx('font-display text-lg font-bold tabular-nums', t.amount >= 0 ? 'text-pitch-300' : 'text-red-300')}>
                    {t.amount >= 0 ? '+' : '−'}
                    {moneyIn(Math.abs(t.amount), t.currency)}
                  </p>
                  <p className="text-[11px] text-slate-500">Saldo {moneyIn(t.balanceAfter, t.currency)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>Cargar más</Button>
        </div>
      )}
    </div>
  );
}
