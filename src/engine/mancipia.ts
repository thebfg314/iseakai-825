import type { WorldState } from "./schema";

/**
 * The unfree (Constitution §4.3 mancipia; design review). They are people, not a store, but the
 * stall and Gerulf's hunts move them like a good: "mancipia" is a pseudo-resource id that maps onto
 * population.mancipia wherever goods change hands. Historically an adult slave traded for roughly a
 * horse's price; captives from war were the usual source.
 */

export const MANCIPIA_ID = "mancipia";
export const MANCIPIA_PRICE = { min: 40, max: 120 } as const;
/** Peddlers occasionally have a few to sell. */
export const MERCHANT_MANCIPIA_CHANCE = 0.2;

export function isMancipia(resource: string): boolean {
  return resource === MANCIPIA_ID;
}

/** Words the lord or a model might use for them. */
export function looksLikeMancipia(text: string): boolean {
  return /\b(mancipi(a|um)|slaves?|unfree|servi\b|servus|bondsmen|captives?)\b/i.test(text);
}

export function mancipiaCount(state: WorldState): number {
  return state.population.mancipia ?? 0;
}

export function setMancipia(state: WorldState, n: number): void {
  state.population.mancipia = Math.max(0, Math.round(n));
}

/** Happiness the free tenants feel when the unfree are freed and settled among them: +2 each, capped. */
export const MANUMISSION_HAPPINESS_PER_HEAD = 2;
export const MANUMISSION_HAPPINESS_CAP = 8;

export type ManumissionResult = { ok: true; freed: number; households: number; logLine: string } | { ok: false; reason: string };

/**
 * Manumission: N of the unfree become free men of the villa. They take manses as tenants — every two
 * freed found a household — and the whole estate takes heart from it (the chaplain approves).
 */
export function applyFreeMancipia(state: WorldState, count: number): ManumissionResult {
  const have = mancipiaCount(state);
  if (have <= 0) return { ok: false, reason: "There are no unfree on the villa to free." };
  const freed = Math.max(1, Math.min(have, Math.round(count)));
  const households = Math.floor(freed / 2);
  setMancipia(state, have - freed);
  state.population.adult_men += freed;
  state.population.households += households;
  for (const h of state.holdings.slice(0, 1)) h.households += households;
  return {
    ok: true,
    freed,
    households,
    logLine: `Freed ${freed} of the unfree before witnesses; they hold ${households} manse${households === 1 ? "" : "s"} as free tenants now.`,
  };
}
