export interface PriceConfig {
  price_rise_points: number;
  price_rise_points_high: number;
  price_fall_points: number;
  price_demand_ratio: number;
  price_max_change: number;
  price_min: number;
  price_max: number;
}

export interface PriceInput {
  price: number;
  /** Puntos de la jornada, null si su club no jugó (jornada en blanco). */
  points: number | null;
  minutes: number;
  netTransfers: number;
  activeTeams: number;
}

export interface PriceDecision {
  newPrice: number;
  change: number;
  reason: 'PERFORMANCE' | 'DEMAND';
}

/**
 * Sistema de precios: rendimiento + demanda, con límites por jornada y rango de precio.
 * Devuelve null si no hay cambio. Nunca produce precios negativos ni fuera de [min, max].
 */
export function computePriceChange(input: PriceInput, cfg: PriceConfig): PriceDecision | null {
  let performance = 0;
  if (input.points !== null) {
    if (input.points >= cfg.price_rise_points_high) performance = 2;
    else if (input.points >= cfg.price_rise_points) performance = 1;
    else if (input.minutes <= 0 || input.points <= cfg.price_fall_points) performance = -1;
  }

  let demand = 0;
  if (input.activeTeams > 0) {
    const ratio = input.netTransfers / input.activeTeams;
    if (ratio >= cfg.price_demand_ratio) demand = 1;
    else if (ratio <= -cfg.price_demand_ratio) demand = -1;
  }

  const maxChange = Math.max(1, Math.round(cfg.price_max_change));
  const raw = Math.max(-maxChange, Math.min(maxChange, performance + demand));
  const floor = Math.max(1, Math.round(cfg.price_min));
  const ceiling = Math.max(floor, Math.round(cfg.price_max));
  const newPrice = Math.max(floor, Math.min(ceiling, input.price + raw));
  const change = newPrice - input.price;
  if (change === 0) return null;
  return { newPrice, change, reason: Math.abs(demand) > Math.abs(performance) ? 'DEMAND' : 'PERFORMANCE' };
}
