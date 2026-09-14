import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import type { Club, ClubLite } from '../types';
import { Card, ErrorState, LoadingBlock, PageHeader, Tabs } from '../components/ui';
import { ClubCrest } from '../components/sport';

export interface TableRow {
  position: number;
  club: ClubLite;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string[];
}

export function FormDots({ form }: { form: string[] }) {
  return (
    <span className="flex gap-0.5">
      {form.map((r, i) => (
        <span key={i} className={clsx('grid size-4 place-items-center rounded-sm text-[9px] font-bold', r === 'W' ? 'bg-pitch-500 text-ink-950' : r === 'D' ? 'bg-slate-500 text-white' : 'bg-red-500 text-white')}>
          {r === 'W' ? 'V' : r === 'D' ? 'E' : 'D'}
        </span>
      ))}
    </span>
  );
}

export default function Clubs() {
  const [tab, setTab] = useState<'table' | 'clubs'>('table');
  const table = useQuery({ queryKey: ['clubs', 'table'], queryFn: () => api.get<TableRow[]>('/clubs/table') });
  const clubs = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Premier League 2026/27" title="Clubes" subtitle="Clasificación calculada a partir de los resultados oficiales." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'table', label: 'Clasificación' }, { value: 'clubs', label: 'Los 20 clubes' }]} />

      {tab === 'table' &&
        (table.error ? (
          <ErrorState error={table.error} />
        ) : table.isLoading ? (
          <LoadingBlock />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-2 py-3 text-left">Club</th>
                  <th className="px-2 py-3">PJ</th>
                  <th className="px-2 py-3">G</th>
                  <th className="px-2 py-3">E</th>
                  <th className="px-2 py-3">P</th>
                  <th className="hidden px-2 py-3 sm:table-cell">GF</th>
                  <th className="hidden px-2 py-3 sm:table-cell">GC</th>
                  <th className="px-2 py-3">DG</th>
                  <th className="hidden px-2 py-3 md:table-cell">Forma</th>
                  <th className="px-4 py-3 text-right">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {table.data?.map((r) => (
                  <tr key={r.club.id} className="text-center hover:bg-white/[0.02]">
                    <td className="relative px-4 py-2.5 text-left font-display text-lg font-bold text-slate-300">
                      <span className={clsx('absolute inset-y-1 left-0 w-1 rounded-r', r.position <= 4 ? 'bg-sky-400' : r.position === 5 ? 'bg-orange-400' : r.position >= 18 ? 'bg-red-500' : 'bg-transparent')} />
                      {r.position}
                    </td>
                    <td className="px-2 py-2.5 text-left">
                      <Link to={`/clubs/${r.club.id}`} className="flex items-center gap-2.5 font-semibold text-white hover:text-pitch-300">
                        <ClubCrest club={r.club} size={24} /> <span className="hidden sm:inline">{r.club.name}</span>
                        <span className="sm:hidden">{r.club.shortName}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 tabular-nums">{r.played}</td>
                    <td className="px-2 py-2.5 tabular-nums">{r.won}</td>
                    <td className="px-2 py-2.5 tabular-nums">{r.drawn}</td>
                    <td className="px-2 py-2.5 tabular-nums">{r.lost}</td>
                    <td className="hidden px-2 py-2.5 tabular-nums sm:table-cell">{r.goalsFor}</td>
                    <td className="hidden px-2 py-2.5 tabular-nums sm:table-cell">{r.goalsAgainst}</td>
                    <td className="px-2 py-2.5 tabular-nums">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                    <td className="hidden px-2 py-2.5 md:table-cell">
                      <div className="flex justify-center">
                        <FormDots form={r.form} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-display text-xl font-bold text-white">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-4 border-t border-white/[0.06] px-4 py-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-400" /> Champions League</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-orange-400" /> Europa League</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" /> Descenso</span>
            </div>
          </Card>
        ))}

      {tab === 'clubs' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {clubs.data?.map((c) => (
            <Link key={c.id} to={`/clubs/${c.id}`} className="card card-hover relative overflow-hidden p-5">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${c.primaryColor}, ${c.secondaryColor})` }} />
              <div className="absolute -right-6 -top-6 size-28 rounded-full opacity-20 blur-2xl" style={{ background: c.primaryColor }} />
              <ClubCrest club={c} size={56} />
              <h3 className="mt-3 text-2xl font-bold uppercase">{c.name}</h3>
              <p className="flex items-center gap-1 text-xs text-slate-400">
                <MapPin className="size-3.5" /> {c.stadium} · {c.city}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
