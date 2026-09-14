import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, RotateCcw, Save } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../../lib/api';
import { POSITION_PLURAL } from '../../lib/format';
import type { Position } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Button, Card, CardHeader, ConfirmModal, Input, LoadingBlock, Select, Tabs, Toggle } from '../../components/ui';

interface Rule {
  position: Position;
  action: string;
  points: number;
  threshold: number;
  isActive: boolean;
}
interface ScoringData {
  actions: Record<string, { label: string; mode: string; thresholdHint?: string; defaultThreshold: number }>;
  positions: Position[];
  rules: Rule[];
}

export default function AdminScoring() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'scoring'], queryFn: () => api.get<ScoringData>('/admin/scoring-rules') });
  const [rules, setRules] = useState<Rule[]>([]);
  const [position, setPosition] = useState<Position>('GK');
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!data) return;
    const all: Rule[] = [];
    for (const pos of data.positions) {
      for (const [action, def] of Object.entries(data.actions)) {
        all.push(data.rules.find((r) => r.position === pos && r.action === action) ?? { position: pos, action, points: 0, threshold: def.defaultThreshold, isActive: false });
      }
    }
    setRules(all);
    setDirty(false);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put<{ recalculated: { gameweeks: number } | null }>('/admin/scoring-rules', { rules, recalculate: true }),
    onSuccess: (r) => {
      toast.push('success', `Reglas guardadas. Recalculadas ${r.recalculated?.gameweeks ?? 0} jornadas.`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post('/admin/scoring-rules/reset'),
    onSuccess: () => {
      toast.push('success', 'Reglas restablecidas');
      setConfirmReset(false);
      qc.invalidateQueries();
    },
  });

  if (isLoading || !data) return <LoadingBlock />;
  const update = (action: string, patch: Partial<Rule>) => {
    setRules((rs) => rs.map((r) => (r.position === position && r.action === action ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="overflow-hidden">
        <CardHeader
          title="Reglas de puntuación"
          subtitle="Editables por posición. Al guardar se recalculan todas las jornadas."
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirmReset(true)}>Por defecto</Button>
              <Button size="sm" icon={<Save className="size-3.5" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>
            </div>
          }
        />
        <div className="p-4">
          <Tabs value={position} onChange={setPosition} tabs={data.positions.map((p) => ({ value: p, label: POSITION_PLURAL[p] }))} />
        </div>
        <div className="divide-y divide-white/[0.05]">
          {rules
            .filter((r) => r.position === position)
            .map((r) => {
              const def = data.actions[r.action];
              const usesThreshold = def.mode !== 'appearance' || r.threshold !== 1;
              return (
                <div key={r.action} className={clsx('grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[auto_1fr_110px_150px]', !r.isActive && 'opacity-55')}>
                  <Toggle checked={r.isActive} onChange={(v) => update(r.action, { isActive: v })} label={`Activar ${def.label}`} />
                  <div>
                    <p className="text-sm font-semibold text-white">{def.label}</p>
                    <p className="text-xs text-slate-500">{r.action}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" className="w-20 text-center font-display text-lg" value={r.points} onChange={(e) => update(r.action, { points: Number(e.target.value) })} aria-label="Puntos" />
                    <span className="text-xs text-slate-500">pts</span>
                  </div>
                  <div className="col-span-3 flex items-center gap-1.5 sm:col-span-1">
                    {usesThreshold && (
                      <>
                        <Input type="number" min={1} className="w-16 text-center" value={r.threshold} onChange={(e) => update(r.action, { threshold: Math.max(1, Number(e.target.value)) })} aria-label={def.thresholdHint} />
                        <span className="text-[11px] leading-tight text-slate-500">{def.thresholdHint}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </Card>
      <ScorePreview positions={data.positions} />
      <ConfirmModal open={confirmReset} onClose={() => setConfirmReset(false)} title="Restablecer reglas" confirmLabel="Restablecer y recalcular" loading={reset.isPending} onConfirm={() => reset.mutate()} message="Se aplicarán las reglas por defecto y se recalcularán los puntos de toda la temporada." />
    </div>
  );
}

function ScorePreview({ positions }: { positions: Position[] }) {
  const [position, setPosition] = useState<Position>('MID');
  const [stats, setStats] = useState({ minutes: 90, goals: 1, assists: 0, goalsConceded: 0, yellowCards: 0, redCards: 0, saves: 0, penaltiesSaved: 0, bonus: 0, cleanSheet: false });
  const preview = useMutation({ mutationFn: () => api.post<{ points: number; breakdown: { label: string; value: number; points: number }[] }>('/admin/scoring-rules/preview', { position, stats }) });
  const fields: [keyof typeof stats, string][] = [
    ['minutes', 'Minutos'],
    ['goals', 'Goles'],
    ['assists', 'Asistencias'],
    ['goalsConceded', 'Goles recibidos'],
    ['saves', 'Paradas'],
    ['penaltiesSaved', 'Penaltis atajados'],
    ['yellowCards', 'Amarillas'],
    ['redCards', 'Rojas'],
    ['bonus', 'Bonus'],
  ];
  return (
    <Card className="h-fit">
      <CardHeader title="Simulador" subtitle="Prueba las reglas guardadas" icon={<Calculator className="size-5" />} />
      <div className="space-y-3 p-4">
        <Select value={position} onChange={(e) => setPosition(e.target.value as Position)}>
          {positions.map((p) => <option key={p} value={p}>{POSITION_PLURAL[p]}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          {fields.map(([k, label]) => (
            <label key={k} className="text-xs text-slate-400">
              {label}
              <Input type="number" min={0} value={stats[k] as number} onChange={(e) => setStats({ ...stats, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <Toggle checked={stats.cleanSheet} onChange={(v) => setStats({ ...stats, cleanSheet: v })} label="Portería a cero" /> Portería a cero
        </label>
        <Button className="w-full" onClick={() => preview.mutate()} loading={preview.isPending}>Calcular</Button>
        {preview.data && (
          <div className="rounded-xl bg-ink-900/60 p-3">
            <p className="stat-number text-center text-4xl text-pitch-300">{preview.data.points} pts</p>
            <div className="mt-2 space-y-1">
              {preview.data.breakdown.map((b) => (
                <p key={b.label} className="flex justify-between text-xs text-slate-300">
                  <span>{b.label}</span>
                  <span className={b.points >= 0 ? 'text-pitch-300' : 'text-red-300'}>{b.points > 0 ? '+' : ''}{b.points}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
