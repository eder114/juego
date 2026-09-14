import { prisma } from '../lib/prisma';
import { getSettings, squadRequirements } from './settings.service';
import { getGameweekContext, syncGameweekStatuses } from './gameweek.service';
import { processGameweek } from './scoring.service';
import { syncFromProvider } from './import.service';
import { notifyMany, type NotificationInput } from './notification.service';

/**
 * Tareas periódicas: estados de jornada, cierre y puntuación automática,
 * recordatorios de alineación y sincronización con la fuente de datos.
 */
const running = new Set<string>();

async function guarded(name: string, fn: () => Promise<unknown>) {
  if (running.has(name)) return;
  running.add(name);
  try {
    await fn();
  } catch (err) {
    console.warn(`[scheduler:${name}]`, (err as Error).message);
  } finally {
    running.delete(name);
  }
}

async function tickGameweeks() {
  const finished = await syncGameweekStatuses();
  for (const id of finished) {
    console.log(`[scheduler] Cerrando jornada ${id}`);
    await processGameweek(id, { final: true });
  }
  const { current } = await getGameweekContext();
  if (current && !current.isProcessed && current.status === 'LIVE') await processGameweek(current.id, { final: false });
}

async function sendReminders() {
  const soon = new Date(Date.now() + 24 * 3600 * 1000);
  const gw = await prisma.gameweek.findFirst({ where: { reminderSent: false, deadline: { gt: new Date(), lte: soon } }, orderBy: { id: 'asc' } });
  if (!gw) return;
  const settings = await getSettings();
  const req = squadRequirements(settings);
  const size = req.GK + req.DEF + req.MID + req.FWD;
  const teams = await prisma.fantasyTeam.findMany({
    select: {
      userId: true,
      _count: { select: { players: true } },
      lineups: { where: { gameweekId: gw.id }, select: { captainId: true } },
      players: { where: { player: { status: { in: ['INJURED', 'SUSPENDED', 'UNAVAILABLE'] } } }, select: { player: { select: { id: true, displayName: true } } } },
    },
  });
  const notifications: NotificationInput[] = [];
  for (const t of teams) {
    notifications.push({
      userId: t.userId,
      type: 'GAMEWEEK_REMINDER',
      title: `Tu jornada comienza mañana: ${gw.name}`,
      message: `El cierre es el ${gw.deadline.toLocaleString('es-ES', { timeZone: 'Europe/London' })} (hora de Londres). Revisa tu once.`,
      link: '/lineup',
    });
    if (t._count.players < size) {
      notifications.push({ userId: t.userId, type: 'LINEUP_INCOMPLETE', title: 'Tu alineación está incompleta', message: `Tienes ${t._count.players}/${size} jugadores en plantilla.`, link: '/market' });
    }
    const unavailable = t.players.map((p) => p.player);
    if (unavailable.length) {
      notifications.push({ userId: t.userId, type: 'INJURY', title: 'Tienes jugadores lesionados o sancionados', message: unavailable.map((p) => p.displayName).join(', '), link: '/lineup' });
      const captainId = t.lineups[0]?.captainId;
      if (captainId && unavailable.some((p) => p.id === captainId)) {
        notifications.push({ userId: t.userId, type: 'CAPTAIN_UNAVAILABLE', title: 'Tu capitán no está disponible', message: 'Elige otro capitán antes del cierre.', link: '/lineup' });
      }
    }
  }
  await notifyMany(notifications);
  await prisma.gameweek.update({ where: { id: gw.id }, data: { reminderSent: true } });
}

async function autoSync() {
  const settings = await getSettings();
  if (!settings.provider_auto_sync) return;
  const summary = await syncFromProvider();
  console.log('[scheduler] Sincronización FPL completada', summary);
}

export function startScheduler() {
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    setTimeout(() => guarded(name, fn), 5_000);
    return setInterval(() => guarded(name, fn), ms);
  };
  const timers = [
    every(60_000, 'gameweeks', tickGameweeks),
    every(10 * 60_000, 'reminders', sendReminders),
    every(15 * 60_000, 'provider-sync', autoSync),
  ];
  return () => timers.forEach(clearInterval);
}
