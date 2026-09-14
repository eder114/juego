import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_RULES, SCORING_ACTIONS } from '../src/domain/constants';
import { EMPTY_STATS, scorePerformance } from '../src/domain/scoring';
import { normalizeLineup, pickBestLineup, scoreLineup, validateLineup, type ScoringEntry } from '../src/domain/lineup';
import { computePriceChange } from '../src/domain/pricing';

const rules = DEFAULT_SCORING_RULES.map((r, i) => ({
  id: i,
  position: r.position,
  action: r.action,
  points: r.points,
  isActive: r.isActive,
  threshold: r.threshold ?? SCORING_ACTIONS[r.action].defaultThreshold,
}));

describe('motor de puntuación', () => {
  it('portero: 90 min, portería a cero y penalti atajado', () => {
    const r = scorePerformance('GK', { ...EMPTY_STATS, minutes: 90, cleanSheet: true, penaltiesSaved: 1 }, rules);
    expect(r.points).toBe(2 + 4 + 5);
  });

  it('portero con goles recibidos y menos de 60 minutos', () => {
    const r = scorePerformance('GK', { ...EMPTY_STATS, minutes: 45, goalsConceded: 2 }, rules);
    expect(r.points).toBe(-2);
  });

  it('defensa con gol, asistencia y amarilla', () => {
    const r = scorePerformance('DEF', { ...EMPTY_STATS, minutes: 90, goals: 1, assists: 1, yellowCards: 1 }, rules);
    expect(r.points).toBe(2 + 6 + 3 - 1);
  });

  it('centrocampista: la portería a cero requiere 60 minutos', () => {
    expect(scorePerformance('MID', { ...EMPTY_STATS, minutes: 59, cleanSheet: true }, rules).points).toBe(2);
    expect(scorePerformance('MID', { ...EMPTY_STATS, minutes: 60, cleanSheet: true }, rules).points).toBe(3);
  });

  it('delantero con doblete y roja', () => {
    expect(scorePerformance('FWD', { ...EMPTY_STATS, minutes: 70, goals: 2, redCards: 1 }, rules).points).toBe(2 + 8 - 3);
  });

  it('sin minutos no puntúa', () => {
    expect(scorePerformance('FWD', { ...EMPTY_STATS, goals: 1 }, rules).points).toBe(0);
  });

  it('las reglas inactivas y los umbrales se respetan', () => {
    const custom = [{ position: 'GK', action: 'saves', points: 1, threshold: 3, isActive: true }];
    expect(scorePerformance('GK', { ...EMPTY_STATS, minutes: 90, saves: 7 }, custom).points).toBe(2);
    expect(scorePerformance('GK', { ...EMPTY_STATS, minutes: 90, saves: 7 }, [{ ...custom[0], isActive: false }]).points).toBe(0);
  });
});

const squad = [
  { id: 1, position: 'GK' as const, status: 'AVAILABLE' },
  { id: 2, position: 'GK' as const, status: 'AVAILABLE' },
  ...[3, 4, 5, 6, 7].map((id) => ({ id, position: 'DEF' as const, status: 'AVAILABLE' })),
  ...[8, 9, 10, 11, 12].map((id) => ({ id, position: 'MID' as const, status: 'AVAILABLE' })),
  ...[13, 14, 15].map((id) => ({ id, position: 'FWD' as const, status: 'AVAILABLE' })),
];
const byId = (id: number) => squad.find((p) => p.id === id)!;

describe('validación de alineación', () => {
  const base = { formation: '4-4-2', starters: [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14].map(byId), bench: [2, 7, 12, 15].map(byId), captainId: 13, viceCaptainId: 8, squad };

  it('acepta una alineación válida', () => {
    expect(validateLineup(base).valid).toBe(true);
  });

  it('rechaza formación inconsistente', () => {
    const r = validateLineup({ ...base, formation: '3-5-2' });
    expect(r.valid).toBe(false);
  });

  it('exige capitán titular y distinto del vice', () => {
    expect(validateLineup({ ...base, captainId: 2 }).valid).toBe(false);
    expect(validateLineup({ ...base, viceCaptainId: 13 }).valid).toBe(false);
  });

  it('bloquea un lesionado si hay suplente disponible en su posición', () => {
    const injured = squad.map((p) => (p.id === 13 ? { ...p, status: 'INJURED' } : p));
    const r = validateLineup({ ...base, starters: base.starters.map((p) => (p.id === 13 ? { ...p, status: 'INJURED' } : p)), squad: injured });
    expect(r.valid).toBe(false);
  });
});

describe('sustituciones automáticas y capitán', () => {
  const entry = (playerId: number, role: 'STARTER' | 'BENCH', order: number, minutes: number, points: number): ScoringEntry => ({
    playerId,
    position: byId(playerId).position,
    role,
    order,
    minutes,
    points,
    done: true,
  });
  const starters = [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14];
  const opts = { captainId: 13, viceCaptainId: 8, captainMultiplier: 2, viceCaptainEnabled: true, autoSubsEnabled: true };

  it('dobla los puntos del capitán', () => {
    const entries = [...starters.map((id, i) => entry(id, 'STARTER', i, 90, 2)), ...[2, 7, 12, 15].map((id, i) => entry(id, 'BENCH', i, 90, 5))];
    entries.find((e) => e.playerId === 13)!.points = 8;
    const r = scoreLineup(entries, opts);
    expect(r.total).toBe(10 * 2 + 16);
  });

  it('el vicecapitán hereda si el capitán no juega y entra un suplente válido', () => {
    const entries = [...starters.map((id, i) => entry(id, 'STARTER', i, id === 13 ? 0 : 90, 2)), ...[2, 7, 12, 15].map((id, i) => entry(id, 'BENCH', i, 90, 3))];
    const r = scoreLineup(entries, opts);
    // El primer suplente de campo válido (7, DEF) entra por el delantero manteniendo 5-4-1
    expect(r.entries.find((e) => e.playerId === 7)!.autoSubIn).toBe(true);
    expect(r.activeCaptainId).toBe(8);
    expect(r.total).toBe(9 * 2 + 2 * 2 + 3);
  });

  it('un portero solo puede ser sustituido por otro portero', () => {
    const entries = [...starters.map((id, i) => entry(id, 'STARTER', i, id === 1 ? 0 : 90, 1)), ...[7, 12, 15, 2].map((id, i) => entry(id, 'BENCH', i, 90, 4))];
    const r = scoreLineup(entries, opts);
    expect(r.entries.find((e) => e.playerId === 2)!.autoSubIn).toBe(true);
    expect(r.entries.filter((e) => e.autoSubIn)).toHaveLength(1);
  });

  it('no sustituye mientras el partido del titular no ha terminado', () => {
    const entries = [...starters.map((id, i) => ({ ...entry(id, 'STARTER', i, 0, 0), done: id !== 14 })), ...[2, 7, 12, 15].map((id, i) => entry(id, 'BENCH', i, 90, 3))];
    const r = scoreLineup(entries, { ...opts, captainId: 14 });
    expect(r.entries.find((e) => e.playerId === 14)!.autoSubOut).toBe(false);
    expect(r.activeCaptainId).toBe(14);
  });
});

describe('mejor once y normalización', () => {
  const members = squad.map((p) => ({ id: p.id, position: p.position, score: p.id, available: true }));

  it('elige una formación válida con 11 titulares', () => {
    const best = pickBestLineup(members)!;
    expect(best.starters).toHaveLength(11);
    expect(best.bench).toHaveLength(4);
  });

  it('rellena huecos cuando se vende un titular', () => {
    const best = pickBestLineup(members)!;
    const sold = best.starters.find((id) => byId(id).position === 'DEF')!;
    const remaining = members.filter((m) => m.id !== sold);
    const n = normalizeLineup(best, remaining);
    expect(n.starters).toHaveLength(11);
    expect(n.starters).not.toContain(sold);
  });
});

describe('sistema de precios', () => {
  const cfg = { price_rise_points: 6, price_rise_points_high: 10, price_fall_points: 1, price_demand_ratio: 0.1, price_max_change: 3, price_min: 35, price_max: 200 };

  it('sube tras una gran actuación y con demanda', () => {
    expect(computePriceChange({ price: 130, points: 12, minutes: 90, netTransfers: 5, activeTeams: 10 }, cfg)).toMatchObject({ newPrice: 133, change: 3 });
  });

  it('baja si no juega', () => {
    expect(computePriceChange({ price: 50, points: 0, minutes: 0, netTransfers: 0, activeTeams: 10 }, cfg)?.change).toBe(-1);
  });

  it('nunca baja del mínimo ni produce precios negativos', () => {
    expect(computePriceChange({ price: 35, points: 0, minutes: 0, netTransfers: -50, activeTeams: 10 }, cfg)).toBeNull();
  });

  it('no penaliza a quien no tuvo partido (jornada en blanco)', () => {
    expect(computePriceChange({ price: 80, points: null, minutes: 0, netTransfers: 0, activeTeams: 10 }, cfg)).toBeNull();
  });
});
