import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudDownload, FileJson, FileSpreadsheet, FlaskConical, Upload } from 'lucide-react';
import { api, errorMessage, tokenStore } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, CardHeader, Tabs } from '../../components/ui';

interface ImportResult {
  total: number;
  valid: number;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
  dryRun: boolean;
}

export default function AdminImport() {
  const toast = useToast();
  const qc = useQueryClient();
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<ImportResult>('/admin/import/players', { format, content, dryRun }),
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun) {
        toast.push('success', `Importación completada: ${r.created} creados, ${r.updated} actualizados`);
        qc.invalidateQueries({ queryKey: ['players'] });
      }
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ playersCreated: number; playersUpdated: number; fixtures: number; stats: number; statusChanges: number }>('/admin/sync'),
    onSuccess: (r) => {
      toast.push('success', `API sincronizada: ${r.playersCreated} nuevos, ${r.playersUpdated} actualizados, ${r.stats} estadísticas, ${r.statusChanges} cambios de estado`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  const downloadTemplate = async () => {
    const res = await fetch(`/api/admin/import/template?format=${format}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plantilla-jugadores.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="Importar jugadores" subtitle="Crea o actualiza jugadores desde un archivo JSON o CSV" icon={format === 'csv' ? <FileSpreadsheet className="size-5" /> : <FileJson className="size-5" />} />
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={format} onChange={(f) => { setFormat(f); setResult(null); }} tabs={[{ value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }]} />
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>Descargar plantilla</Button>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-6 text-sm text-slate-300 hover:border-pitch-500/40">
            <Upload className="size-4" /> Seleccionar archivo .{format}
            <input
              type="file"
              accept={format === 'csv' ? '.csv,text/csv' : '.json,application/json'}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setContent(await file.text());
                e.target.value = '';
              }}
            />
          </label>
          <textarea className="input min-h-56 font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value)} placeholder={format === 'csv' ? 'firstName,lastName,displayName,position,club,price\nBukayo,Saka,Saka,MID,ARS,9.5' : '[{"firstName":"Bukayo","lastName":"Saka","displayName":"Saka","position":"MID","club":"ARS","price":9.5}]'} />
          <p className="text-xs text-slate-500">Columnas: externalId, firstName, lastName, displayName, position (GK/DEF/MID/FWD), club (código o nombre), birthDate, nationality, photoUrl, squadNumber, price (en millones o décimas), status, isActive. Se actualiza por externalId o por nombre+club.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<FlaskConical className="size-4" />} disabled={content.length < 5} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>Validar (sin guardar)</Button>
            <Button icon={<Upload className="size-4" />} disabled={content.length < 5} loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>Importar</Button>
          </div>
          {result && (
            <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{result.total} filas</Badge>
                <Badge tone="green">{result.valid} válidas</Badge>
                {!result.dryRun && <Badge tone="sky">{result.created} creadas</Badge>}
                {!result.dryRun && <Badge tone="violet">{result.updated} actualizadas</Badge>}
                {result.errors.length > 0 && <Badge tone="red">{result.errors.length} errores</Badge>}
                {result.dryRun && <Badge tone="amber">Validación</Badge>}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-red-300">Fila {e.row}: {e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="h-fit">
        <CardHeader title="API deportiva" subtitle="Fantasy Premier League (oficial)" icon={<CloudDownload className="size-5" />} />
        <div className="space-y-3 p-4 text-sm text-slate-300">
          <p>Actualiza clubes, jugadores (estado, lesiones, club, dorsal), calendario, resultados y estadísticas por partido de las jornadas recientes.</p>
          <p className="text-xs text-slate-500">Los precios de jugadores existentes los gestiona el sistema de precios propio. Para una carga completa de temporada usa <code className="text-slate-300">npm run data:fetch</code> y el seed.</p>
          <Button className="w-full" icon={<CloudDownload className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>Sincronizar ahora</Button>
        </div>
      </Card>
    </div>
  );
}
