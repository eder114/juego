import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, CardHeader, Input, LoadingBlock, Select, Toggle } from '../../components/ui';

interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: 'number' | 'boolean' | 'string' | 'select' | 'money';
  options?: string[];
  min?: number;
  max?: number;
  value: unknown;
  default: unknown;
}

const OPTION_LABEL: Record<string, string> = { PER_MATCH: 'Por partido (al empezar cada partido)', DEADLINE: 'Por jornada (al cierre)' };

export default function AdminSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<SettingDef[]>('/admin/settings') });
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.map((s) => [s.key, s.value])));
  }, [data]);

  const changed = useMemo(() => Object.fromEntries(Object.entries(values).filter(([k, v]) => data?.find((s) => s.key === k)?.value !== v)), [values, data]);
  const save = useMutation({
    mutationFn: () => api.patch<SettingDef[]>('/admin/settings', changed),
    onSuccess: () => {
      toast.push('success', 'Configuración guardada');
      qc.invalidateQueries();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  if (isLoading || !data) return <LoadingBlock />;
  const groups = [...new Set(data.map((s) => s.group))];

  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-20 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-800/95 px-4 py-3 backdrop-blur">
        <p className="text-sm text-slate-300">{Object.keys(changed).length ? `${Object.keys(changed).length} cambio(s) sin guardar` : 'Sin cambios pendientes'}</p>
        <Button icon={<Save className="size-4" />} disabled={!Object.keys(changed).length} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => (
          <Card key={group}>
            <CardHeader title={group} />
            <div className="divide-y divide-white/[0.05]">
              {data
                .filter((s) => s.group === group)
                .map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{s.label}</p>
                      <p className="text-[11px] text-slate-500">
                        {s.key}
                        {s.min !== undefined && ` · ${s.type === 'money' ? `£${s.min / 10}M` : s.min} – ${s.type === 'money' ? `£${(s.max ?? 0) / 10}M` : s.max}`}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {s.type === 'boolean' && <Toggle checked={!!values[s.key]} onChange={(v) => setValues({ ...values, [s.key]: v })} label={s.label} />}
                      {s.type === 'number' && <Input type="number" step="any" className="w-24 text-right" value={String(values[s.key] ?? '')} onChange={(e) => setValues({ ...values, [s.key]: Number(e.target.value) })} />}
                      {s.type === 'money' && (
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-slate-400">£</span>
                          <Input type="number" step="0.1" className="w-24 text-right" value={Number(values[s.key] ?? 0) / 10} onChange={(e) => setValues({ ...values, [s.key]: Math.round(Number(e.target.value) * 10) })} />
                          <span className="text-sm text-slate-400">M</span>
                        </div>
                      )}
                      {s.type === 'string' && <Input className="w-32" value={String(values[s.key] ?? '')} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} />}
                      {s.type === 'select' && (
                        <Select className="w-60" value={String(values[s.key] ?? '')} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}>
                          {s.options?.map((o) => <option key={o} value={o}>{OPTION_LABEL[o] ?? o}</option>)}
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
