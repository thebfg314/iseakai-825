import type { WorldState } from "./schema";
import { round1 } from "./util";

export const GRAIN_CROPS = ["rye", "wheat", "barley", "oats"] as const;
export type GrainCrop = (typeof GRAIN_CROPS)[number];

/** One household's seasonal grain take. Otto's Confirm extra uses this as a house ration. */
export const HOUSEHOLD_SEASON_GRAIN = 0.5;

export function grainOnHand(state: WorldState): number {
  return round1(GRAIN_CROPS.reduce((sum, g) => sum + state.resources[g], 0));
}

export function consumeGrain(state: WorldState, amount: number, label = "Households"): string {
  let left = amount;
  const taken: string[] = [];
  for (const g of GRAIN_CROPS) {
    if (left <= 0) break;
    const use = Math.min(state.resources[g], left);
    if (use > 0) {
      state.resources[g] = round1(state.resources[g] - use);
      left = round1(left - use);
      taken.push(`${round1(use)} ${g}`);
    }
  }
  if (left > 0.1) {
    state.flags.hunger = true;
    return `${label} needed ${amount} modii; short ${left}. Hunger begins.`;
  }
  return `${label} took ${taken.join(", ") || "nothing"}.`;
}
