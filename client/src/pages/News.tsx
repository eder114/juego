import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper } from 'lucide-react';
import { api, qs } from '../lib/api';
import { dateLong, relativeTime } from '../lib/format';
import type { News } from '../types';
import { Badge, Card, EmptyState, LoadingBlock, Modal, PageHeader, Tabs } from '../components/ui';
import { ClubCrest, PlayerPhoto } from '../components/sport';

const CATEGORIES: Record<string, { label: string; tone: 'slate' | 'red' | 'sky' | 'green' | 'amber' }> = {
  GENERAL: { label: 'General', tone: 'slate' },
  INJURY: { label: 'Lesiones', tone: 'red' },
  GAMEWEEK: { label: 'Jornada', tone: 'sky' },
  TRANSFER: { label: 'Fichajes', tone: 'green' },
  MARKET: { label: 'Mercado', tone: 'amber' },
};

export default function NewsPage() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState('ALL');
  const openId = params.get('id');
  const { data, isLoading } = useQuery({ queryKey: ['news', category], queryFn: () => api.get<News[]>(`/news${qs({ category: category === 'ALL' ? undefined : category, take: 50 })}`) });
  const detail = useQuery({ queryKey: ['news', 'item', openId], queryFn: () => api.get<News>(`/news/${openId}`), enabled: !!openId });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Actualidad" title="Noticias" subtitle="Partes médicos, resultados y novedades del juego." />
      <Tabs value={category} onChange={setCategory} tabs={[{ value: 'ALL', label: 'Todas' }, ...Object.entries(CATEGORIES).map(([value, c]) => ({ value, label: c.label }))]} />
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Newspaper className="size-6" />} title="No hay noticias" />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((n, i) => (
            <button key={n.id} onClick={() => setParams({ id: String(n.id) })} className={`card card-hover flex flex-col p-5 text-left ${i === 0 ? 'md:col-span-2' : ''}`}>
              <div className="flex items-center gap-2">
                <Badge tone={CATEGORIES[n.category]?.tone}>{CATEGORIES[n.category]?.label ?? n.category}</Badge>
                {n.club && <ClubCrest club={n.club} size={18} />}
                <span className="text-xs text-slate-500">{relativeTime(n.createdAt)}</span>
              </div>
              <div className="mt-3 flex gap-4">
                {n.player && <PlayerPhoto player={{ ...n.player, club: n.club ?? undefined }} size={i === 0 ? 88 : 60} />}
                <div className="min-w-0">
                  <h3 className={`font-bold uppercase leading-tight ${i === 0 ? 'text-3xl' : 'text-xl'}`}>{n.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-400">{n.summary}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!openId} onClose={() => setParams({})} title={detail.data?.title ?? 'Noticia'} size="lg">
        {detail.isLoading || !detail.data ? (
          <LoadingBlock />
        ) : (
          <article>
            <div className="flex items-center gap-2">
              <Badge tone={CATEGORIES[detail.data.category]?.tone}>{CATEGORIES[detail.data.category]?.label}</Badge>
              <span className="text-xs capitalize text-slate-400">{dateLong(detail.data.createdAt)}</span>
            </div>
            <p className="mt-3 text-base font-semibold text-slate-200">{detail.data.summary}</p>
            <div className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-300">{detail.data.content}</div>
          </article>
        )}
      </Modal>
    </div>
  );
}
