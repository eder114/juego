import { describe, expect, it } from 'vitest';
import { FORMATIONS, PLAYER_RARITIES, type PlayerRarity, type Position } from '../src/domain/constants';
import { countPositions, parseFormation } from '../src/domain/lineup';
import {
  applyCardModifiers,
  buildStarterSquad,
  canFieldEleven,
  classifyRarities,
  coachMatchPoints,
  computeValuation,
  effectiveStreak,
  evaluateGuess,
  formatK,
  initialValueFromFpl,
  localDateKey,
  marketCycleWindow,
  nextLocalMidnight,
  nextStreak,
  normalizeWord,
  parseWordList,
  pityGuaranteed,
  pityWeights,
  seededRng,
  selectMarketCoaches,
  selectMarketPlayers,
  shiftDate,
  wordleReward,
  zonedTimeToUtc,
  type RarityWeights,
  type ValuationConfig,
} from '../src/domain/economy';

const WEIGHTS: RarityWeights = { COMMON: 45, UNCOMMON: 30, RARE: 18, EPIC: 6, STAR: 1 };
const POS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

/** Pool sintético con la distribución de rarezas de la Premier (≈650 jugadores). */
function pool(n = 650) {
  const rarityAt = (i: number): PlayerRarity => (i < 20 ? 'STAR' : i < 78 ? 'EPIC' : i < 195 ? 'RARE' : i < 390 ? 'UNCOMMON' : 'COMMON');
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, position: POS[i % 4], rarity: rarityAt(i), clubId: (i % 20) + 1 }));
}

describe('dinero', () => {
  it('formatea miles de libras', () => {
    expect(formatK(100000)).toBe('£100M');
    expect(formatK(74500)).toBe('£74.5M');
    expect(formatK(750)).toBe('£750K');
    expect(formatK(-1250)).toBe('-£1.25M');
  });

  it('valor inicial desde el precio real de FPL: las estrellas superan los £100M', () => {
    const cfg = { base: 3000, exponent: 3, min: 500, max: 250000 };
    expect(initialValueFromFpl(40, cfg)).toBe(3000);
    expect(initialValueFromFpl(150, cfg)).toBeGreaterThan(100000);
    expect(initialValueFromFpl(150, cfg)).toBeLessThanOrEqual(250000);
    expect(initialValueFromFpl(45, cfg)).toBeLessThan(initialValueFromFpl(60, cfg));
  });
});

describe('equipo inicial', () => {
  it('13 jugadores: 11 titulares según la formación + 2 suplentes, sin repetidos', () => {
    for (const formation of FORMATIONS) {
      const { starters, bench } = buildStarterSquad(pool(), { formation, bench: 2, weights: { COMMON: 60, UNCOMMON: 28, RARE: 10, EPIC: 2, STAR: 0 }, maxPerClub: 3 }, seededRng(formation));
      expect(starters).toHaveLength(11);
      expect(bench).toHaveLength(2);
      const ids = [...starters, ...bench].map((p) => p.id);
      expect(new Set(ids).size).toBe(13);
      const shape = parseFormation(formation)!;
      expect(countPositions(starters)).toEqual(shape);
    }
  });

  it('las estrellas con peso 0 quedan excluidas y la selección está ponderada', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const { starters, bench } = buildStarterSquad(pool(), { formation: '4-4-2', bench: 2, weights: { COMMON: 60, UNCOMMON: 28, RARE: 10, EPIC: 2, STAR: 0 }, maxPerClub: 3 }, seededRng(i));
      for (const p of [...starters, ...bench]) counts[p.rarity] = (counts[p.rarity] ?? 0) + 1;
    }
    expect(counts.STAR ?? 0).toBe(0);
    expect(counts.COMMON).toBeGreaterThan(counts.UNCOMMON);
    expect(counts.UNCOMMON).toBeGreaterThan(counts.RARE);
    expect(counts.RARE).toBeGreaterThan(counts.EPIC ?? 0);
  });

  it('respeta el máximo por club', () => {
    const { starters, bench } = buildStarterSquad(pool(), { formation: '3-4-3', bench: 2, weights: WEIGHTS, maxPerClub: 1 }, seededRng('club'));
    const clubs = [...starters, ...bench].map((p) => p.clubId);
    expect(new Set(clubs).size).toBe(clubs.length);
  });

  it('un once válido requiere poder formar alguna formación', () => {
    expect(canFieldEleven({ GK: 1, DEF: 4, MID: 4, FWD: 2 })).toBe(true);
    expect(canFieldEleven({ GK: 0, DEF: 5, MID: 5, FWD: 3 })).toBe(false);
    expect(canFieldEleven({ GK: 1, DEF: 2, MID: 6, FWD: 3 })).toBe(false);
  });
});

describe('mercado diario', () => {
  it('10 jugadores distintos, sin jugadores excluidos (ya comprados)', () => {
    const owned = new Set([1, 2, 3, 50, 100]);
    const candidates = pool().filter((p) => !owned.has(p.id));
    const picked = selectMarketPlayers(candidates, 10, { weights: WEIGHTS, maxSamePosition: 5 }, seededRng('m1'));
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((p) => p.id)).size).toBe(10);
    expect(picked.some((p) => owned.has(p.id))).toBe(false);
  });

  it('la rareza sigue las probabilidades configuradas', () => {
    const counts: Record<string, number> = Object.fromEntries(PLAYER_RARITIES.map((r) => [r, 0]));
    const candidates = pool();
    for (let i = 0; i < 400; i++) for (const p of selectMarketPlayers(candidates, 10, { weights: WEIGHTS, maxSamePosition: 10 }, seededRng(`r${i}`))) counts[p.rarity]++;
    const total = 4000;
    expect(counts.COMMON / total).toBeGreaterThan(0.38);
    expect(counts.COMMON / total).toBeLessThan(0.52);
    expect(counts.STAR / total).toBeLessThan(0.03);
    expect(counts.EPIC).toBeGreaterThan(counts.STAR);
  });

  it('diversidad: limita jugadores de la misma posición sin eliminar el azar', () => {
    const picked = selectMarketPlayers(pool(), 10, { weights: WEIGHTS, maxSamePosition: 3 }, seededRng('div'));
    const byPos = countPositions(picked.map((p) => ({ position: p.position as Position })));
    expect(Math.max(...Object.values(byPos))).toBeLessThanOrEqual(3);
  });

  it('pity: cada día sin rareza alta aumenta su peso y al límite se garantiza', () => {
    const pity = { counter: 0, stepPercent: 25, maxMultiplier: 4, minRarity: 'EPIC' as PlayerRarity, hardDays: 7 };
    expect(pityWeights(WEIGHTS, pity).EPIC).toBe(6);
    expect(pityWeights(WEIGHTS, { ...pity, counter: 4 }).EPIC).toBe(12);
    expect(pityWeights(WEIGHTS, { ...pity, counter: 40 }).STAR).toBe(4);
    expect(pityWeights(WEIGHTS, { ...pity, counter: 4 }).COMMON).toBe(45);
    expect(pityGuaranteed({ ...pity, counter: 5 })).toBe(false);
    expect(pityGuaranteed({ ...pity, counter: 6 })).toBe(true);
    const onlyLow = selectMarketPlayers(pool(), 10, { weights: { COMMON: 1, UNCOMMON: 0, RARE: 0, EPIC: 0, STAR: 0 }, maxSamePosition: 10, guaranteeRarity: 'EPIC' }, seededRng('g'));
    expect(onlyLow.some((p) => p.rarity === 'EPIC' || p.rarity === 'STAR')).toBe(true);
  });

  it('entre 1 y 2 entrenadores', () => {
    const coaches = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, rarity: 'COMMON' as PlayerRarity }));
    for (let i = 0; i < 50; i++) {
      const picked = selectMarketCoaches(coaches, { min: 1, max: 2, weights: WEIGHTS }, seededRng(i));
      expect(picked.length).toBeGreaterThanOrEqual(1);
      expect(picked.length).toBeLessThanOrEqual(2);
      expect(new Set(picked.map((c) => c.id)).size).toBe(picked.length);
    }
  });
});

describe('rareza', () => {
  it('reparte los niveles por percentiles combinados (valor, puntos, forma)', () => {
    const inputs = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, value: i * 1000, seasonPoints: i, recentForm: i / 10 }));
    const r = classifyRarities(inputs, { pctStar: 3, pctEpic: 9, pctRare: 18, pctUncommon: 30, wValue: 50, wPoints: 30, wForm: 20 });
    const count = (x: string) => [...r.values()].filter((v) => v === x).length;
    expect(count('STAR')).toBe(3);
    expect(count('EPIC')).toBe(9);
    expect(count('RARE')).toBe(18);
    expect(count('UNCOMMON')).toBe(30);
    expect(count('COMMON')).toBe(40);
    expect(r.get(100)).toBe('STAR');
    expect(r.get(1)).toBe('COMMON');
  });
});

describe('valoración dinámica', () => {
  const cfg: ValuationConfig = {
    sensitivity: 4,
    varMin: -8,
    varMax: 8,
    wLast: 40,
    wAvg: 40,
    wTrend: 20,
    scalePoints: 6,
    consistency: 0.5,
    elasticity: 0.15,
    minChange: 0.3,
    min: 500,
    max: 250000,
    referenceValue: 10000,
  };

  it('sube tras una jornada excelente y baja tras una mala', () => {
    const up = computeValuation({ value: 96000, lastPoints: 15, recent: [6, 7, 8, 15], expected: 5 }, cfg)!;
    expect(up.newValue).toBeGreaterThan(96000);
    const down = computeValuation({ value: 96000, lastPoints: 0, recent: [5, 4, 3, 0], expected: 6 }, cfg)!;
    expect(down.newValue).toBeLessThan(96000);
  });

  it('respeta la variación máxima por jornada y los límites de valor', () => {
    const r = computeValuation({ value: 100000, lastPoints: 30, recent: [30, 30, 30, 30], expected: 1 }, { ...cfg, sensitivity: 50 })!;
    expect(r.variation).toBeCloseTo(0.08, 5);
    expect(r.newValue).toBeLessThanOrEqual(108000);
    const floor = computeValuation({ value: 520, lastPoints: -3, recent: [-3, -2], expected: 6 }, { ...cfg, sensitivity: 50 })!;
    expect(floor.newValue).toBeGreaterThanOrEqual(500);
    const ceiling = computeValuation({ value: 249000, lastPoints: 30, recent: [30], expected: 1 }, { ...cfg, sensitivity: 50 })!;
    expect(ceiling.newValue).toBeLessThanOrEqual(250000);
  });

  it('un solo partido pesa menos que una racha (suavizado) y sin partido no hay cambio', () => {
    const single = computeValuation({ value: 50000, lastPoints: 14, recent: [2, 2, 2, 14], expected: 4 }, cfg)!;
    const streak = computeValuation({ value: 50000, lastPoints: 14, recent: [14, 14, 14, 14], expected: 4 }, cfg)!;
    expect(streak.change).toBeGreaterThan(single.change);
    expect(computeValuation({ value: 50000, lastPoints: null, recent: [5], expected: 4 }, cfg)).toBeNull();
  });

  it('los valores altos cambian menos en porcentaje (elasticidad)', () => {
    const cheap = computeValuation({ value: 5000, lastPoints: 12, recent: [12, 12], expected: 4 }, cfg)!;
    const star = computeValuation({ value: 150000, lastPoints: 12, recent: [12, 12], expected: 4 }, cfg)!;
    expect(cheap.variation).toBeGreaterThan(star.variation);
  });
});

describe('zonas horarias y ciclos', () => {
  it('el mercado se reinicia a la hora local de la liga (con horario de verano)', () => {
    // 21-09-2026 09:30 UTC = 10:30 en Londres (BST): reinicio a las 10:00 → ciclo del día 21
    const w = marketCycleWindow(new Date('2026-09-21T09:30:00Z'), 'Europe/London', 600);
    expect(w.cycleDate).toBe('2026-09-21');
    expect(w.startsAt.toISOString()).toBe('2026-09-21T09:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-09-22T09:00:00.000Z');
    // Antes de la hora de reinicio sigue el ciclo del día anterior
    expect(marketCycleWindow(new Date('2026-09-21T08:30:00Z'), 'Europe/London', 600).cycleDate).toBe('2026-09-20');
    // Cambio de hora de octubre: el ciclo dura 25 horas
    const dst = marketCycleWindow(new Date('2026-10-24T12:00:00Z'), 'Europe/London', 600);
    expect(dst.endsAt.getTime() - dst.startsAt.getTime()).toBe(25 * 3600 * 1000);
  });

  it('fechas locales y reinicio diario', () => {
    expect(localDateKey(new Date('2026-09-21T03:00:00Z'), 'America/Bogota')).toBe('2026-09-20');
    expect(nextLocalMidnight(new Date('2026-09-21T12:00:00Z'), 'Europe/Madrid').toISOString()).toBe('2026-09-21T22:00:00.000Z');
    expect(zonedTimeToUtc(2026, 1, 15, 0, 'Europe/London').toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('Wordle', () => {
  it('evalúa letras correctas, presentes y ausentes (con repetidas)', () => {
    expect(evaluateGuess('BALON', 'BALON').every((r) => r === 'correct')).toBe(true);
    expect(evaluateGuess('LLAVE', 'BALON')).toEqual(['present', 'absent', 'present', 'absent', 'absent']);
    expect(evaluateGuess('GOLES', 'GOLES')).toEqual(Array(5).fill('correct'));
    expect(evaluateGuess('AAAAA', 'CARTA')).toEqual(['absent', 'correct', 'absent', 'absent', 'correct']);
  });

  it('normaliza tildes y conserva la Ñ', () => {
    expect(normalizeWord('balón')).toBe('BALON');
    expect(normalizeWord('  Añejo ')).toBe('AÑEJO');
    expect(parseWordList('balón, líder\nPEÑAS xx', 5)).toEqual(['BALON', 'LIDER', 'PEÑAS']);
  });

  it('recompensas por intento (valores iniciales de la especificación)', () => {
    const rewards = [1000, 1000, 750, 750, 600, 500];
    expect([1, 2, 3, 4, 5, 6].map((n) => wordleReward(n, rewards))).toEqual([1000, 1000, 750, 750, 600, 500]);
    expect(wordleReward(0, rewards)).toBe(0);
  });
});

describe('rachas', () => {
  it('continúa en días consecutivos, se reinicia al saltar un día y no cuenta dos veces el mismo día', () => {
    let s = nextStreak(null, '2026-09-01', true);
    s = nextStreak(s, '2026-09-02', true);
    s = nextStreak(s, '2026-09-03', true);
    expect(s.current).toBe(3);
    expect(nextStreak(s, '2026-09-03', true).current).toBe(3);
    const broken = nextStreak(s, '2026-09-05', true);
    expect(broken.current).toBe(1);
    expect(broken.best).toBe(3);
    expect(nextStreak(s, '2026-09-04', false).current).toBe(0);
    expect(effectiveStreak(s, '2026-09-04')).toBe(3);
    expect(effectiveStreak(s, '2026-09-06')).toBe(0);
  });
});

describe('cartas', () => {
  it('doble puntos duplica los puntos del jugador', () => {
    expect(applyCardModifiers(6, 1, [{ effect: 'DOUBLE_POINTS', value: 200 }], 'MAX')).toEqual({ total: 12, base: 6, delta: 6 });
  });

  it('presión resta un % solo de los puntos positivos, sin tocar negativos', () => {
    expect(applyCardModifiers(10, 1, [{ effect: 'WEAKEN', value: 20 }], 'MAX').total).toBe(8);
    expect(applyCardModifiers(-2, 1, [{ effect: 'WEAKEN', value: 20 }], 'MAX').total).toBe(-2);
  });

  it('capitán + doble puntos: sin acumular (MAX) o acumulando (STACK)', () => {
    expect(applyCardModifiers(5, 2, [{ effect: 'DOUBLE_POINTS', value: 200 }], 'MAX').total).toBe(10);
    expect(applyCardModifiers(5, 2, [{ effect: 'DOUBLE_POINTS', value: 200 }], 'STACK').total).toBe(20);
  });

  it('orden: penalización antes que potenciación y capitán; un suplente sin entrar no suma', () => {
    expect(applyCardModifiers(10, 1, [{ effect: 'DOUBLE_POINTS', value: 200 }, { effect: 'WEAKEN', value: 20 }], 'MAX').total).toBe(16);
    expect(applyCardModifiers(10, 0, [{ effect: 'DOUBLE_POINTS', value: 200 }], 'MAX').total).toBe(0);
    expect(applyCardModifiers(10, 1, [{ effect: 'DOUBLE_POINTS', value: 200 }, { effect: 'DOUBLE_POINTS', value: 200 }], 'MAX').total).toBe(20);
  });
});

describe('entrenadores', () => {
  it('puntos por resultado real', () => {
    const cfg = { win: 3, draw: 1, loss: -1, cleanSheet: 1, goal: 0 };
    expect(coachMatchPoints(2, 0, cfg)).toBe(4);
    expect(coachMatchPoints(1, 1, cfg)).toBe(1);
    expect(coachMatchPoints(0, 3, cfg)).toBe(-1);
  });
});
