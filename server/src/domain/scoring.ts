import { SCORING_ACTIONS, type Position, type StatLine } from './constants';

export interface RuleLike {
  position: string;
  action: string;
  points: number;
  threshold: number;
  isActive: boolean;
}

export interface BreakdownItem {
  action: string;
  label: string;
  value: number;
  points: number;
}

export interface ScoreResult {
  points: number;
  breakdown: BreakdownItem[];
}

export const EMPTY_STATS: StatLine = {
  minutes: 0,
  goals: 0,
  assists: 0,
  cleanSheet: false,
  goalsConceded: 0,
  ownGoals: 0,
  penaltiesSaved: 0,
  penaltiesMissed: 0,
  yellowCards: 0,
  redCards: 0,
  saves: 0,
  bonus: 0,
};

/**
 * Motor de puntuación: aplica las reglas configuradas de una posición a una línea de estadísticas.
 * Es una función pura — no conoce la base de datos — para poder testearla y reutilizarla.
 */
export function scorePerformance(position: Position, stats: StatLine, rules: RuleLike[]): ScoreResult {
  const breakdown: BreakdownItem[] = [];
  if (stats.minutes <= 0) return { points: 0, breakdown };

  for (const rule of rules) {
    if (!rule.isActive || rule.position !== position) continue;
    const def = SCORING_ACTIONS[rule.action];
    if (!def) continue;
    const threshold = Math.max(1, rule.threshold || def.defaultThreshold);

    let value = 0;
    let units = 0;
    switch (def.mode) {
      case 'appearance':
        value = stats.minutes;
        units = stats.minutes >= threshold ? 1 : 0;
        break;
      case 'minutes_threshold':
        value = stats.minutes;
        units = stats.minutes >= threshold ? 1 : 0;
        break;
      case 'clean_sheet':
        value = stats.cleanSheet ? 1 : 0;
        units = stats.cleanSheet && stats.minutes >= threshold ? 1 : 0;
        break;
      case 'per_unit': {
        value = Number(stats[def.stat!] ?? 0);
        units = Math.floor(value / threshold);
        break;
      }
    }
    if (units <= 0) continue;
    const points = units * rule.points;
    if (points === 0) continue;
    breakdown.push({ action: rule.action, label: def.label, value, points });
  }

  return { points: breakdown.reduce((sum, b) => sum + b.points, 0), breakdown };
}

/** Suma varias líneas (dobles jornadas). */
export function sumStats(lines: StatLine[]): StatLine {
  return lines.reduce<StatLine>(
    (acc, s) => ({
      minutes: acc.minutes + s.minutes,
      goals: acc.goals + s.goals,
      assists: acc.assists + s.assists,
      cleanSheet: acc.cleanSheet || s.cleanSheet,
      goalsConceded: acc.goalsConceded + s.goalsConceded,
      ownGoals: acc.ownGoals + s.ownGoals,
      penaltiesSaved: acc.penaltiesSaved + s.penaltiesSaved,
      penaltiesMissed: acc.penaltiesMissed + s.penaltiesMissed,
      yellowCards: acc.yellowCards + s.yellowCards,
      redCards: acc.redCards + s.redCards,
      saves: acc.saves + s.saves,
      bonus: acc.bonus + s.bonus,
    }),
    { ...EMPTY_STATS },
  );
}
