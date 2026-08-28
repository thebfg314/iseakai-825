import type { WorldState } from "./schema";
import { LABOUR_MIDPOINTS } from "./projectCatalog";
import { modifiersFor, applyMultiplyAdd, moodFactor } from "./modifiers";

export type LabourPool = {
  men: number;
  women: number;
  youths: number;
};

export function labourPool(state: WorldState): LabourPool {
  const mid = LABOUR_MIDPOINTS[state.meta.season];
  const eff = applyMultiplyAdd(1, modifiersFor(state, "labour_efficiency"), { lo: 0.4, hi: 2.5 }) * moodFactor(state);
  return {
    men: Math.round(state.population.adult_men * mid.men * eff),
    women: Math.round(state.population.adult_women * mid.women * eff),
    youths: Math.round(state.population.youths * mid.youths * eff),
  };
}

export function labourUsed(state: WorldState): LabourPool {
  const used: LabourPool = { men: 0, women: 0, youths: 0 };
  for (const a of state.labour.assigned) {
    used.men += a.men;
    used.women += a.women;
    used.youths += a.youths;
  }
  return used;
}

export function labourRemaining(state: WorldState): LabourPool {
  const pool = labourPool(state);
  const used = labourUsed(state);
  return {
    men: Math.max(0, pool.men - used.men),
    women: Math.max(0, pool.women - used.women),
    youths: Math.max(0, pool.youths - used.youths),
  };
}

export function maleShareUsed(state: WorldState): number {
  const pool = labourPool(state);
  if (pool.men <= 0) return 0;
  return labourUsed(state).men / pool.men;
}

export function refreshHarvestRisk(state: WorldState): void {
  const season = state.meta.season;
  if (season === "winter") {
    state.labour.harvest_risk = false;
    return;
  }
  state.labour.harvest_risk = maleShareUsed(state) > 0.8;
}

export function labourDaysFromAssignment(
  kind: "mostly_men" | "men_women" | "mixed",
  men: number,
  women: number,
  youths: number,
): number {
  const womanFactor = kind === "mostly_men" ? 0.6 : 1;
  const youthFactor = 0.4;
  return men + women * womanFactor + youths * youthFactor;
}
