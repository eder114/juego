import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Pencil, Receipt, ShoppingBag, Shirt, Users } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { dateTime, money, POSITION_PLURAL, POSITIONS } from '../lib/format';
import type { Crest, Player, Squad } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTransferActions } from '../hooks/useTransferActions';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, ProgressBar, StatCard, Tabs } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, PriceChange, StatusBadge, TeamCrest } from '../components/sport';
import { CrestEditor } from '../components/CrestEditor';

interface TransferHistory {
  transfers: { id: number; type: 'BUY' | 'SELL'; price: number; createdAt: string; player: Player; gameweek: { id: number; name: string } | null }[];
  transactions: { id: number; type: string; amount: number; balanceAfter: number; description: string; createdAt: string }[];
}

export default function Team() {
  const [tab, setTab] = useState<'squad' | 'transfers' | 'money'>('squad');
  const [editOpen, setEditOpen] = useState(false);
  const [selling, setSelling] = useState<Squad['players'][number] | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['team'], queryFn: () => api.get<Squad>('/team') });
  const history = useQuery({ queryKey: ['team', 'transfers'], queryFn: () => api.get<TransferHistory>('/team/transfers'), enabled: tab !== 'squad' });
  const { sell } = useTransferActions();

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mi equipo"
        title={
          <span className="flex items-center gap-3">
            <TeamCrest crest={data.team.crest} name={data.team.name} size={48} />
            {data.team.name}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
              Editar equipo
            </Button>
            <Link to="/lineup">
              <Button icon={<Shirt className="size-4" />}>Alineación</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent label="Valor del equipo" value={money(data.teamValue)} sub="Precio actual de mercado" />
        <StatCard label="Presupuesto restante" value={money(data.budget)} sub={data.marketOpen ? 'Mercado abierto' : 'Mercado cerrado'} />
        <StatCard label="Valor total" value={money(data.totalValue)} sub="Plantilla + presupuesto" />
        <StatCard label="Jugadores" value={`${data.players.length}/${data.squadSize}`} sub={data.isComplete ? 'Plantilla completa' : 'Completa tu plantilla'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {POSITIONS.map((pos) => (
          <div key={pos} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <PositionBadge position={pos} /> {POSITION_PLURAL[pos]}
              </span>
              <span className={clsx('font-display text-xl font-bold', data.counts[pos] === data.requirements[pos] ? 'text-pitch-300' : 'text-white')}>
                {data.counts[pos]}/{data.requirements[pos]}
              </span>
            </div>
            <ProgressBar value={data.counts[pos]} max={data.requirements[pos]} className="mt-3" />
          </div>
        ))}
      </div>

      {Object.keys(data.clubCounts).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Jugadores por club (máx. {data.maxPerClub})</span>
          {Object.entries(data.clubCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([club, count]) => (
              <Badge key={club} tone={count >= data.maxPerClub ? 'amber' : 'slate'}>
                {club} · {count}
              </Badge>
            ))}
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'squad', label: 'Plantilla', count: data.players.length },
          { value: 'transfers', label: 'Historial de fichajes' },
          { value: 'money', label: 'Movimientos' },
        ]}
      />

      {tab === 'squad' &&
        (data.players.length === 0 ? (
          <Card>
            <EmptyState icon={<Users className="size-6" />} title="Tu plantilla está vacía" description={`Tienes ${money(data.budget)} para fichar a ${data.squadSize} jugadores.`} action={<Link to="/market"><Button icon={<ShoppingBag className="size-4" />}>Ir al mercado</Button></Link>} />
          </Card>
        ) : (
          <div className="space-y-4">
            {POSITIONS.map((pos) => {
              const players = data.players.filter((p) => p.position === pos);
              return (
                <Card key={pos} className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
                    <h3 className="text-lg font-bold uppercase">{POSITION_PLURAL[pos]}</h3>
                    {players.length < data.requirements[pos] && (
                      <Link to="/market" className="text-xs font-semibold text-pitch-400">
                        + Fichar ({data.requirements[pos] - players.length})
                      </Link>
                    )}
                  </div>
                  <div className="hidden grid-cols-[2fr_repeat(5,1fr)_auto] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 md:grid">
                    <span>Jugador</span>
                    <span className="text-right">Compra</span>
                    <span className="text-right">Actual</span>
                    <span className="text-right">Variación</span>
                    <span className="text-right">Puntos</span>
                    <span className="text-right">Forma</span>
                    <span className="w-20" />
                  </div>
                  <div className="divide-y divide-white/[0.05]">
                    {players.map((p) => (
                      <div key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-3 md:grid-cols-[2fr_repeat(5,1fr)_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                          <Link to={`/players/${p.id}`}>
                            <PlayerPhoto player={p} size={44} rounded="rounded-xl" />
                          </Link>
                          <div className="min-w-0">
                            <Link to={`/players/${p.id}`} className="block truncate font-semibold text-white hover:text-pitch-300">
                              {p.displayName}
                            </Link>
                            <div className="flex items-center gap-1.5 text-xs text-slate-400">
                              <ClubCrest club={p.club} size={14} /> {p.club.shortName}
                              {p.status !== 'AVAILABLE' && <StatusBadge status={p.status} chance={p.chanceOfPlaying} />}
                            </div>
                            <div className="mt-1 flex gap-3 text-xs text-slate-400 md:hidden">
                              <span>{money(p.purchasePrice)} → <b className="text-white">{money(p.price)}</b></span>
                              <PriceChange value={p.priceDelta} />
                              <span>{p.stats.totalPoints} pts</span>
                            </div>
                          </div>
                        </div>
                        <span className="hidden text-right text-sm tabular-nums text-slate-400 md:block">{money(p.purchasePrice)}</span>
                        <span className="hidden text-right text-sm font-semibold tabular-nums text-white md:block">{money(p.price)}</span>
                        <span className="hidden text-right md:block">
                          <PriceChange value={p.priceDelta} />
                        </span>
                        <span className="hidden text-right font-display text-lg font-bold md:block">{p.stats.totalPoints}</span>
                        <span className="hidden text-right text-sm tabular-nums text-slate-300 md:block">{p.stats.form.toFixed(1)}</span>
                        <Button variant="danger" size="sm" className="w-20" onClick={() => setSelling(p)}>
                          Vender
                        </Button>
                      </div>
                    ))}
                    {players.length === 0 && <p className="px-4 py-4 text-sm text-slate-500">Sin jugadores en esta posición</p>}
                  </div>
                </Card>
              );
            })}
          </div>
        ))}

      {tab === 'transfers' && (
        <Card className="overflow-hidden">
          {history.isLoading ? (
            <LoadingBlock />
          ) : history.data?.transfers.length ? (
            <div className="divide-y divide-white/[0.05]">
              {history.data.transfers.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', t.type === 'BUY' ? 'bg-pitch-500/15 text-pitch-400' : 'bg-red-500/15 text-red-400')}>
                    {t.type === 'BUY' ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <PlayerPhoto player={t.player} size={40} rounded="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {t.type === 'BUY' ? 'Fichaje' : 'Venta'}: {t.player.displayName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {t.player.club.shortName} · {dateTime(t.createdAt)} {t.gameweek && `· antes de ${t.gameweek.name}`}
                    </p>
                  </div>
                  <span className={clsx('font-display text-lg font-bold tabular-nums', t.type === 'BUY' ? 'text-red-300' : 'text-pitch-300')}>
                    {t.type === 'BUY' ? '−' : '+'}
                    {money(t.price)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ShoppingBag className="size-6" />} title="Sin operaciones" />
          )}
        </Card>
      )}

      {tab === 'money' && (
        <Card className="overflow-hidden">
          {history.isLoading ? (
            <LoadingBlock />
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {history.data?.transactions.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <Receipt className="size-5 shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{t.description}</p>
                    <p className="text-xs text-slate-400">{dateTime(t.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className={clsx('font-display text-lg font-bold tabular-nums', t.amount >= 0 ? 'text-pitch-300' : 'text-red-300')}>
                      {t.amount >= 0 ? '+' : '−'}
                      {money(Math.abs(t.amount))}
                    </p>
                    <p className="text-[11px] text-slate-500">Saldo {money(t.balanceAfter)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <ConfirmModal
        open={!!selling}
        onClose={() => setSelling(null)}
        title="Vender jugador"
        danger
        confirmLabel={selling ? `Vender por ${money(selling.salePrice)}` : 'Vender'}
        loading={sell.isPending}
        onConfirm={() => selling && sell.mutate(selling, { onSuccess: () => setSelling(null) })}
        message={
          selling && (
            <>
              ¿Vender a <b className="text-white">{selling.displayName}</b>? Lo compraste por {money(selling.purchasePrice)} y recibirás {money(selling.salePrice)}.
            </>
          )
        }
      />

      <EditTeamModal open={editOpen} onClose={() => setEditOpen(false)} name={data.team.name} crest={data.team.crest} />
    </div>
  );
}

function EditTeamModal({ open, onClose, name, crest }: { open: boolean; onClose: () => void; name: string; crest: Crest }) {
  const [teamName, setTeamName] = useState(name);
  const [value, setValue] = useState<Crest>(crest);
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const save = useMutation({
    mutationFn: () => api.patch('/team', { name: teamName, crest: { shape: 'shield', pattern: 'plain', primary: '#16a34a', secondary: '#0f172a', initials: '', ...value } }),
    onSuccess: () => {
      toast.push('success', 'Equipo actualizado');
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      void refresh();
      onClose();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar equipo"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={teamName.trim().length < 3}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Nombre del equipo">
          <Input value={teamName} maxLength={30} onChange={(e) => setTeamName(e.target.value)} />
        </Field>
        <CrestEditor value={value} onChange={setValue} teamName={teamName} />
      </div>
    </Modal>
  );
}
