import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Coins, ShoppingBag } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { moneyK } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { useLeagueEconomy } from '../hooks/useLeagueEconomy';
import { useEconomyTerms } from '../hooks/usePublicConfig';
import { Badge, Button, Card, CardHeader, ConfirmModal, Field, Input, Modal } from './ui';

export interface LeagueEconomySummary {
  timezone: string;
  resetTime: string;
  startedAt: string;
  pityCounter: number;
  myStatus: 'NO_TEAM' | 'PLAYING' | 'OTHER_LEAGUE' | 'CLASSIC_SQUAD' | 'CAN_JOIN';
  otherLeagueName: string | null;
  participants: { teamId: number; teamName: string; managerName: string; players: number; squadValue: number }[];
}

/** Economía de la liga: estado del usuario, horario del mercado compartido y valor de cada plantilla. */
export function LeagueEconomyPanel({ leagueId, economy, isMember, canManage }: { leagueId: number; economy: LeagueEconomySummary; isMember: boolean; canManage: boolean }) {
  const { join } = useLeagueEconomy();
  const terms = useEconomyTerms();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [resetTime, setResetTime] = useState(economy.resetTime);
  const [timezone, setTimezone] = useState(economy.timezone);

  const schedule = useMutation({
    mutationFn: () => api.patch<{ timezone: string; resetTime: string }>(`/leagues/${leagueId}/economy/schedule`, { resetTime, timezone }),
    onSuccess: (r) => {
      toast.push('success', `El mercado se renovará a las ${r.resetTime} (${r.timezone}) desde el próximo ciclo`);
      qc.invalidateQueries({ queryKey: ['league', String(leagueId)] });
      qc.invalidateQueries({ queryKey: ['league-market'] });
      setScheduleOpen(false);
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  return (
    <Card>
      <CardHeader
        title="Economía de la liga"
        subtitle={`Mercado compartido · se renueva cada día a las ${economy.resetTime} (${economy.timezone})`}
        icon={<Coins className="size-5" />}
        action={
          canManage && (
            <Button size="sm" variant="secondary" icon={<Clock className="size-3.5" />} onClick={() => setScheduleOpen(true)}>
              Horario
            </Button>
          )
        }
      />
      <div className="space-y-4 p-4">
        {isMember && economy.myStatus === 'PLAYING' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-pitch-500/10 px-4 py-3">
            <p className="text-sm text-pitch-200">Juegas la economía de esta liga: tu plantilla y tu presupuesto pertenecen a esta partida.</p>
            <Link to="/market"><Button size="sm" icon={<ShoppingBag className="size-3.5" />}>Mercado de hoy</Button></Link>
          </div>
        )}
        {isMember && economy.myStatus === 'CAN_JOIN' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-4 py-3">
            <p className="text-sm text-slate-200">Entra en la economía de la liga: recibirás {terms.players} al azar y {terms.budget} para el mercado diario.</p>
            <Button size="sm" loading={join.isPending} onClick={() => join.mutate({ leagueId })}>Recibir mi equipo</Button>
          </div>
        )}
        {isMember && economy.myStatus === 'CLASSIC_SQUAD' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.07] px-4 py-3">
            <p className="text-sm text-amber-100">Tu equipo usa el sistema clásico. Para jugar el mercado de esta liga, tu plantilla actual se sustituirá por un equipo inicial (queda guardada en el historial).</p>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReplace(true)}>Pasar a esta liga</Button>
          </div>
        )}
        {isMember && economy.myStatus === 'OTHER_LEAGUE' && (
          <p className="rounded-xl bg-white/[0.05] px-4 py-3 text-sm text-slate-300">
            Tu equipo juega la economía de «{economy.otherLeagueName}». Aquí compites en la clasificación; un equipo solo puede jugar el mercado de una liga.
          </p>
        )}

        {economy.participants.length > 0 ? (
          <div>
            <p className="label mb-2">Plantillas de la partida ({economy.participants.length})</p>
            <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl bg-white/[0.03]">
              {economy.participants.map((p, i) => (
                <li key={p.teamId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-5 text-center font-bold text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-white">{p.teamName}</span>
                    <span className="block truncate text-xs text-slate-400">{p.managerName} · {p.players} jugadores</span>
                  </span>
                  <span className="font-bold tabular-nums text-white">{moneyK(p.squadValue)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Todavía no hay mánagers jugando la economía de esta liga.</p>
        )}
        {economy.pityCounter > 0 && <Badge tone="violet">{economy.pityCounter} día(s) sin jugadores de rareza alta: la probabilidad está aumentando</Badge>}
      </div>

      <ConfirmModal
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title="Pasar tu equipo a esta liga"
        danger
        confirmLabel="Sí, recibir mi equipo inicial"
        loading={join.isPending}
        onConfirm={() => join.mutate({ leagueId, confirmReplaceSquad: true }, { onSuccess: () => setConfirmReplace(false) })}
        message={`Tu plantilla del sistema clásico se sustituirá por ${terms.players} al azar y tendrás ${terms.budget} en el monedero de la liga. Tus puntos y tu historial se conservan. Esta acción no se puede deshacer.`}
      />

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Horario del mercado"
        footer={
          <>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancelar</Button>
            <Button loading={schedule.isPending} onClick={() => schedule.mutate()}>Guardar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Hora de renovación (HH:MM)">
            <Input type="time" value={resetTime} onChange={(e) => setResetTime(e.target.value)} />
          </Field>
          <Field label="Zona horaria (IANA)" hint="Por ejemplo Europe/London, Europe/Madrid o America/Bogota">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-400">El cambio se aplica a partir del próximo mercado: el de hoy se mantiene hasta su hora de cierre.</p>
        </div>
      </Modal>
    </Card>
  );
}
