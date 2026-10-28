import type { WorldState } from "../engine/schema";
import { flagTruthy } from "./flags";

/**
 * Relics in the lord's keeping (03_HISTORY §11.7; scripts 853-V1). Pilgrims
 * bring gifts each season; monks who came with a larger treasury eat. Visibility
 * was raised when the treasure was accepted; the raid chance from 886 is in
 * vikings.ts.
 */

export const PILGRIM_GIFT_DENARII = 3;
export const MONKS_GRAIN_PER_SEASON = 2;
const GRAIN_ORDER = ["rye", "barley", "oats", "wheat"] as const;

export function tickRelics(state: WorldState): string[] {
  const lines: string[] = [];
  if (!flagTruthy(state, "relics_held")) return lines;
  state.resources.denarii = (state.resources.denarii ?? 0) + PILGRIM_GIFT_DENARII;
  lines.push(`Pilgrims to the relics left ${PILGRIM_GIFT_DENARII} denarii in gifts.`);
  if (flagTruthy(state, "relics_monks")) {
    let want = MONKS_GRAIN_PER_SEASON;
    for (const g of GRAIN_ORDER) {
      const have = state.resources[g] ?? 0;
      const take = Math.min(have, want);
      if (take > 0) {
        state.resources[g] = have - take;
        want -= take;
      }
      if (want <= 0) break;
    }
    lines.push(want > 0 ? "The monks who came with the treasury went short; the stores could not feed them." : `The monks who came with the treasury ate ${MONKS_GRAIN_PER_SEASON} of grain.`);
  }
  return lines;
}

/** One line for the prompt. */
export function relicsLine(state: WorldState): string | null {
  if (!flagTruthy(state, "relics_held")) return null;
  const monks = flagTruthy(state, "relics_monks") ? ", and the monks who came with it eat at the lord's table" : "";
  return `A church treasure and relics are in the lord's keeping (since 853): pilgrims come${monks}; thieves and greedy neighbours know it is here.`;
}
