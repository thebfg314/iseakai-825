import { CANONICAL_RESOURCES, type ResourceMap, type WorldState } from "./schema";
import { round1 } from "./util";

export type SeasonLedgerSnapshot = {
  resources: ResourceMap;
  households: number;
  sown: { wheat: number; rye: number; barley: number; oats: number };
};

const SOWN_CROPS = ["wheat", "rye", "barley", "oats"] as const;

export function snapshotSeasonLedger(state: WorldState): SeasonLedgerSnapshot {
  const sown = { wheat: 0, rye: 0, barley: 0, oats: 0 };
  for (const h of state.holdings) {
    sown.wheat += h.sown.wheat;
    sown.rye += h.sown.rye;
    sown.barley += h.sown.barley;
    sown.oats += h.sown.oats;
  }
  return {
    resources: { ...state.resources },
    households: state.population.households,
    sown,
  };
}

/** Round like the ledger `fmt` (integers stay integers; else one decimal). Omit +0. */
export function signedLedgerDelta(n: number): number | null {
  const rounded = round1(n);
  if (rounded === 0) return null;
  return rounded;
}

export function diffSeasonLedger(before: SeasonLedgerSnapshot, after: WorldState): Record<string, number> {
  const deltas: Record<string, number> = {};
  const put = (id: string, n: number) => {
    const d = signedLedgerDelta(n);
    if (d != null) deltas[id] = d;
  };
  for (const key of CANONICAL_RESOURCES) {
    put(key, after.resources[key] - before.resources[key]);
  }
  put("households", after.population.households - before.households);
  const now = snapshotSeasonLedger(after);
  for (const crop of SOWN_CROPS) {
    put(`sown_${crop}`, now.sown[crop] - before.sown[crop]);
  }
  return deltas;
}

/** Replace the previous season's diffs. Call after the season tick (including events). */
export function writeLastSeasonDeltas(state: WorldState, before: SeasonLedgerSnapshot): void {
  state.last_season_deltas = diffSeasonLedger(before, state);
}
