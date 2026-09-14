import { BLOCKING_STATUSES, FORMATIONS, type Formation, type PlayerStatus, type Position } from './constants';

export interface FormationShape {
  GK: number;
  DEF: number;
  MID: number;
  FWD: number;
}

export function parseFormation(formation: string): FormationShape | null {
  if (!(FORMATIONS as readonly string[]).includes(formation)) return null;
  const [DEF, MID, FWD] = formation.split('-').map(Number);
  return { GK: 1, DEF, MID, FWD };
}

export function formationFromCounts(counts: FormationShape): Formation | null {
  if (counts.GK !== 1) return null;
  const f = `${counts.DEF}-${counts.MID}-${counts.FWD}`;
  return (FORMATIONS as readonly string[]).includes(f) ? (f as Formation) : null;
}

export function countPositions<T extends { position: string }>(players: T[]): FormationShape {
  const counts: FormationShape = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of players) counts[p.position as Position] += 1;
  return counts;
}

/** Límites mínimos/máximos por línea que respetan las formaciones permitidas. */
export const LINE_LIMITS = (() => {
  const shapes = FORMATIONS.map((f) => parseFormation(f)!);
  return {
    DEF: { min: Math.min(...shapes.map((s) => s.DEF)), max: Math.max(...shapes.map((s) => s.DEF)) },
    MID: { min: Math.min(...shapes.map((s) => s.MID)), max: Math.max(...shapes.map((s) => s.MID)) },
    FWD: { min: Math.min(...shapes.map((s) => s.FWD)), max: Math.max(...shapes.map((s) => s.FWD)) },
  };
})();

export interface LineupPlayerLite {
  id: number;
  position: Position;
  status: PlayerStatus | string;
  name?: string;
}

export interface LineupValidationInput {
  formation: string;
  starters: LineupPlayerLite[];
  bench: LineupPlayerLite[];
  captainId: number | null | undefined;
  viceCaptainId: number | null | undefined;
  squad: LineupPlayerLite[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Valida una alineación contra la plantilla, la formación y la disponibilidad. */
export function validateLineup(input: LineupValidationInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shape = parseFormation(input.formation);
  if (!shape) errors.push(`Formación no permitida: ${input.formation}`);

  const squadIds = new Set(input.squad.map((p) => p.id));
  const all = [...input.starters, ...input.bench];
  const seen = new Set<number>();
  for (const p of all) {
    if (!squadIds.has(p.id)) errors.push(`${p.name ?? p.id} no pertenece a tu plantilla`);
    if (seen.has(p.id)) errors.push(`${p.name ?? p.id} aparece repetido`);
    seen.add(p.id);
  }

  if (input.starters.length !== 11) errors.push(`Debes alinear 11 titulares (tienes ${input.starters.length})`);
  if (input.bench.length > BENCH_SIZE) errors.push(`El banquillo admite como máximo ${BENCH_SIZE} suplentes`);

  if (shape) {
    const counts = countPositions(input.starters);
    for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
      if (counts[pos] !== shape[pos]) {
        errors.push(`La formación ${input.formation} requiere ${shape[pos]} ${pos} titulares (tienes ${counts[pos]})`);
      }
    }
  }

  const missing = input.squad.filter((p) => !seen.has(p.id));
  if (missing.length > 0) warnings.push(`${missing.length} jugador(es) de la plantilla quedan fuera de la convocatoria`);

  const starterIds = new Set(input.starters.map((p) => p.id));
  if (!input.captainId) errors.push('Debes elegir un capitán');
  else if (!starterIds.has(input.captainId)) errors.push('El capitán debe ser titular');
  if (input.viceCaptainId) {
    if (!starterIds.has(input.viceCaptainId)) errors.push('El vicecapitán debe ser titular');
    if (input.viceCaptainId === input.captainId) errors.push('Capitán y vicecapitán deben ser jugadores distintos');
  } else {
    warnings.push('No has elegido vicecapitán');
  }

  // Disponibilidad: bloquea titulares lesionados/sancionados solo si existe una alternativa disponible
  const benchAvailable = input.bench.filter((p) => !BLOCKING_STATUSES.includes(p.status as PlayerStatus));
  for (const p of input.starters) {
    if (BLOCKING_STATUSES.includes(p.status as PlayerStatus)) {
      const hasAlternative = benchAvailable.some((b) => b.position === p.position);
      const msg = `${p.name ?? p.id} no está disponible (${statusLabel(p.status)})`;
      if (hasAlternative) errors.push(`${msg}. Tienes un suplente disponible en su posición`);
      else warnings.push(msg);
    } else if (p.status === 'DOUBTFUL') {
      warnings.push(`${p.name ?? p.id} es duda para la jornada`);
    }
  }
  if (input.captainId) {
    const cap = input.starters.find((p) => p.id === input.captainId);
    if (cap && cap.status !== 'AVAILABLE') warnings.push('Tu capitán no está totalmente disponible');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function statusLabel(status: string): string {
  return (
    {
      AVAILABLE: 'disponible',
      DOUBTFUL: 'duda',
      INJURED: 'lesionado',
      SUSPENDED: 'sancionado',
      UNAVAILABLE: 'no disponible',
    } as Record<string, string>
  )[status] ?? status;
}

export const BENCH_SIZE = 4;

// ─────────────────────── Normalización con la plantilla ───────────────────────

export interface LineupDraft {
  formation: string;
  starters: number[];
  bench: number[];
  captainId: number | null;
  viceCaptainId: number | null;
}

export interface SquadMember {
  id: number;
  position: Position;
  score: number;
  available: boolean;
}

/**
 * Reconcilia una alineación con la plantilla actual (ventas/compras):
 * elimina jugadores que ya no están, añade los nuevos al banquillo, completa huecos
 * de titulares respetando la formación y reasigna capitanía si hace falta.
 */
export function normalizeLineup(draft: LineupDraft, squad: SquadMember[]): LineupDraft {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const starters = draft.starters.filter((id) => byId.has(id));
  let bench = draft.bench.filter((id) => byId.has(id) && !starters.includes(id));
  const used = new Set([...starters, ...bench]);
  const newcomers = squad
    .filter((p) => !used.has(p.id))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.id);
  bench = [...bench, ...newcomers];
  let formation = draft.formation;

  const counts = () => countPositions(starters.map((id) => byId.get(id)!));
  const promote = (predicate: (p: SquadMember) => boolean) => {
    const idx = bench.findIndex((id) => predicate(byId.get(id)!));
    if (idx < 0) return false;
    starters.push(bench[idx]);
    bench.splice(idx, 1);
    return true;
  };

  const shape = parseFormation(formation);
  while (starters.length < 11) {
    const c = counts();
    let promoted = false;
    if (shape) {
      const needed = (['GK', 'DEF', 'MID', 'FWD'] as Position[]).find((pos) => c[pos] < shape[pos]);
      if (needed) promoted = promote((p) => p.position === needed && p.available) || promote((p) => p.position === needed);
    }
    if (!promoted) {
      promoted =
        promote((p) => {
          if (p.position === 'GK') return c.GK === 0;
          const lim = LINE_LIMITS[p.position as 'DEF' | 'MID' | 'FWD'];
          return c.GK <= 1 && c[p.position] < lim.max && p.available;
        }) ||
        promote((p) => {
          if (p.position === 'GK') return c.GK === 0;
          return c[p.position] < LINE_LIMITS[p.position as 'DEF' | 'MID' | 'FWD'].max;
        });
    }
    if (!promoted) break;
  }
  const fromCounts = formationFromCounts(counts());
  if (starters.length === 11 && fromCounts) formation = fromCounts;

  bench = bench.slice(0, Math.max(0, BENCH_SIZE));
  // Orden de titulares por línea para una representación estable
  const posOrder: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  starters.sort((a, b) => posOrder[byId.get(a)!.position] - posOrder[byId.get(b)!.position]);

  let { captainId, viceCaptainId } = draft;
  const ranked = [...starters].sort((a, b) => byId.get(b)!.score - byId.get(a)!.score);
  if (!captainId || !starters.includes(captainId)) {
    captainId = viceCaptainId && starters.includes(viceCaptainId) ? viceCaptainId : (ranked[0] ?? null);
  }
  if (!viceCaptainId || !starters.includes(viceCaptainId) || viceCaptainId === captainId) {
    viceCaptainId = ranked.find((id) => id !== captainId) ?? null;
  }
  return { formation, starters, bench, captainId, viceCaptainId };
}

// ─────────────────────────── Mejor once ───────────────────────────

export interface RankedPlayer {
  id: number;
  position: Position;
  score: number;
  available?: boolean;
}

export interface PickedLineup {
  formation: Formation;
  starters: number[];
  bench: number[];
  captainId: number | null;
  viceCaptainId: number | null;
  total: number;
}

/** Elige la formación y el once que maximizan `score` (usado para alineación por defecto y equipo de la jornada). */
export function pickBestLineup(players: RankedPlayer[]): PickedLineup | null {
  const byPos = (pos: Position) =>
    players
      .filter((p) => p.position === pos)
      .sort((a, b) => Number(b.available !== false) - Number(a.available !== false) || b.score - a.score);

  let best: PickedLineup | null = null;
  for (const formation of FORMATIONS) {
    const shape = parseFormation(formation)!;
    const starters: RankedPlayer[] = [];
    let ok = true;
    for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
      const pool = byPos(pos);
      if (pool.length < shape[pos]) {
        ok = false;
        break;
      }
      starters.push(...pool.slice(0, shape[pos]));
    }
    if (!ok) continue;
    const total = starters.reduce((s, p) => s + (p.available === false ? -1000 : p.score), 0);
    if (!best || total > best.total) {
      const starterIds = new Set(starters.map((s) => s.id));
      const bench = players
        .filter((p) => !starterIds.has(p.id))
        .sort((a, b) => Number(a.position === 'GK') - Number(b.position === 'GK') || b.score - a.score)
        .map((p) => p.id);
      const ordered = [...starters].sort((a, b) => b.score - a.score);
      best = {
        formation,
        starters: starters.map((s) => s.id),
        bench,
        captainId: ordered[0]?.id ?? null,
        viceCaptainId: ordered[1]?.id ?? null,
        total,
      };
    }
  }
  return best;
}

// ─────────────────────── Sustituciones y capitán ───────────────────────

export interface ScoringEntry {
  playerId: number;
  position: Position;
  role: 'STARTER' | 'BENCH';
  order: number;
  points: number;
  minutes: number;
  /** true cuando todos los partidos del jugador en la jornada han terminado (o no tiene partido). */
  done: boolean;
}

export interface ScoringOptions {
  captainId: number | null;
  viceCaptainId: number | null;
  captainMultiplier: number;
  viceCaptainEnabled: boolean;
  autoSubsEnabled: boolean;
}

export interface ScoredEntry extends ScoringEntry {
  multiplier: number;
  autoSubIn: boolean;
  autoSubOut: boolean;
}

export interface LineupScore {
  entries: ScoredEntry[];
  total: number;
  benchPoints: number;
  activeCaptainId: number | null;
}

/**
 * Calcula los puntos de una alineación: sustituciones automáticas (respetando formación)
 * y reglas de capitán/vicecapitán. Función pura.
 */
export function scoreLineup(input: ScoringEntry[], opts: ScoringOptions): LineupScore {
  const entries: ScoredEntry[] = input.map((e) => ({ ...e, multiplier: e.role === 'STARTER' ? 1 : 0, autoSubIn: false, autoSubOut: false }));
  const didNotPlay = (e: ScoringEntry) => e.minutes <= 0 && e.done;

  if (opts.autoSubsEnabled) {
    const starters = () => entries.filter((e) => e.role === 'STARTER');
    const bench = entries.filter((e) => e.role === 'BENCH').sort((a, b) => a.order - b.order);
    const absent = starters()
      .filter(didNotPlay)
      .sort((a, b) => a.order - b.order);

    for (const out of absent) {
      for (const sub of bench) {
        if (sub.role !== 'BENCH' || sub.minutes <= 0) continue;
        if ((out.position === 'GK') !== (sub.position === 'GK')) continue;
        const counts = countPositions(starters().filter((s) => s.playerId !== out.playerId));
        counts[sub.position] += 1;
        const okShape =
          counts.GK === 1 &&
          counts.DEF >= LINE_LIMITS.DEF.min &&
          counts.DEF <= LINE_LIMITS.DEF.max &&
          counts.MID >= LINE_LIMITS.MID.min &&
          counts.MID <= LINE_LIMITS.MID.max &&
          counts.FWD >= LINE_LIMITS.FWD.min &&
          counts.FWD <= LINE_LIMITS.FWD.max;
        if (!okShape) continue;
        sub.role = 'STARTER';
        sub.multiplier = 1;
        sub.autoSubIn = true;
        out.role = 'BENCH';
        out.multiplier = 0;
        out.autoSubOut = true;
        break;
      }
    }
  }

  const startersNow = entries.filter((e) => e.role === 'STARTER');
  const captain = startersNow.find((e) => e.playerId === opts.captainId);
  const vice = startersNow.find((e) => e.playerId === opts.viceCaptainId);
  let activeCaptainId: number | null = null;
  if (captain && !didNotPlay(captain)) {
    captain.multiplier = opts.captainMultiplier;
    activeCaptainId = captain.playerId;
  } else if (opts.viceCaptainEnabled && vice && !didNotPlay(vice)) {
    vice.multiplier = opts.captainMultiplier;
    activeCaptainId = vice.playerId;
  }

  const total = entries.reduce((s, e) => s + e.points * e.multiplier, 0);
  const benchPoints = entries.filter((e) => e.role === 'BENCH').reduce((s, e) => s + e.points, 0);
  return { entries, total, benchPoints, activeCaptainId };
}
