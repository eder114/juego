import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Bell, CalendarClock, CheckCheck, Crown, HeartPulse, Megaphone, ShoppingBag, Trash2, TrendingUp, Trophy, Users } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { AppNotification } from '../types';
import { Button, Card, EmptyState, LoadingBlock, PageHeader, Tabs } from '../components/ui';

const ICONS: Record<string, typeof Bell> = {
  GAMEWEEK_REMINDER: CalendarClock,
  INJURY: HeartPulse,
  LINEUP_INCOMPLETE: Users,
  PRICE_CHANGE: TrendingUp,
  CAPTAIN_UNAVAILABLE: Crown,
  MARKET: ShoppingBag,
  GAMEWEEK_RESULT: Trophy,
  LEAGUE: Users,
  ACHIEVEMENT: Award,
  SYSTEM: Megaphone,
};

export default function Notifications() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notifications', filter], queryFn: () => api.get<{ items: AppNotification[]; unreadCount: number }>(`/notifications${filter === 'unread' ? '?unread=true' : ''}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/notifications/${id}`), onSuccess: refresh });

  const open = async (n: AppNotification) => {
    if (!n.isRead) await api.post(`/notifications/${n.id}/read`).then(refresh);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Centro de avisos"
        title="Notificaciones"
        actions={
          (data?.unreadCount ?? 0) > 0 && (
            <Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => readAll.mutate()} loading={readAll.isPending}>
              Marcar todo como leído
            </Button>
          )
        }
      />
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'Todas' }, { value: 'unread', label: 'Sin leer', count: data?.unreadCount }]} />
      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingBlock />
        ) : !data?.items.length ? (
          <EmptyState icon={<Bell className="size-6" />} title="Todo al día" description="No tienes notificaciones." />
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {data.items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <div key={n.id} className={clsx('group flex items-start gap-3 px-4 py-3.5', !n.isRead && 'bg-pitch-500/[0.05]')}>
                  <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl', n.isRead ? 'bg-white/[0.05] text-slate-400' : 'bg-pitch-500/15 text-pitch-400')}>
                    <Icon className="size-5" />
                  </span>
                  <button onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                    <p className={clsx('text-sm', n.isRead ? 'text-slate-300' : 'font-semibold text-white')}>{n.title}</p>
                    <p className="text-sm text-slate-400">{n.message}</p>
                    <p className="mt-1 text-xs text-slate-500">{relativeTime(n.createdAt)}</p>
                  </button>
                  <button onClick={() => remove.mutate(n.id)} className="grid size-8 place-items-center rounded-lg text-slate-500 opacity-100 hover:bg-white/[0.06] hover:text-red-300 sm:opacity-0 sm:group-hover:opacity-100" aria-label="Eliminar notificación">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
