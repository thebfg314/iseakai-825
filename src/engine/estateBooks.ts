import type { EstateSeasonSnapshot, WorldState } from "./schema";
import { labourPool, labourRemaining } from "./labour";
import { clamp, deepClone } from "./util";

export const ESTATE_HISTORY_LIMIT = 32;

export function captureEstateSeason(state: WorldState): EstateSeasonSnapshot {
  return {
    year: state.meta.year,
    season: state.meta.season,
    turn: state.meta.turn,
    region: state.meta.region,
    holdings: deepClone(state.holdings),
    resources: { ...state.resources },
    custom_resources: deepClone(state.custom_resources),
    population: { ...state.population },
    agriculture: {
      springBarleyShare: state.agriculture?.springBarleyShare ?? 0.6,
      autumnWheatShare: state.agriculture?.autumnWheatShare ?? 0.45,
    },
    last_season_deltas: { ...(state.last_season_deltas ?? {}) },
    flags: {
      merchant_present: state.flags.merchant_present,
      hunger: state.flags.hunger,
    },
    merchant: {
      present: state.merchant.present,
      name: state.merchant.name,
      stock: deepClone(state.merchant.stock ?? []),
    },
    market: deepClone(state.market),
    npcs: state.npcs.filter((n) => n.id !== "merchant").map((n) => ({ name: n.name, role: n.role })),
    known_techniques: state.known_techniques.map((t) => ({ id: t.id, name: t.name })),
    labour: {
      pool: labourPool(state),
      remaining: labourRemaining(state),
    },
  };
}

/** Keep the season's books as they stood before the advance writes new figures. */
export function archiveEstateSeason(live: WorldState, source: WorldState): EstateSeasonSnapshot {
  const snap = captureEstateSeason(source);
  const history = [...(live.estate_history ?? [])];
  const already = history.some((h) => h.year === snap.year && h.season === snap.season && h.turn === snap.turn);
  if (!already) {
    history.push(snap);
    live.estate_history = history.slice(-ESTATE_HISTORY_LIMIT);
  }
  return snap;
}

/** 0 is this season; 1 is the most recent kept season, and so on. */
export function clampEstateOffset(offset: number, historyLength: number): number {
  if (historyLength <= 0) return 0;
  return clamp(Math.floor(offset), 0, historyLength);
}

export function stepEstateOffset(offset: number, historyLength: number, towardPast: boolean): number {
  return clampEstateOffset(towardPast ? offset + 1 : offset - 1, historyLength);
}

export function estatePagerFlags(offset: number, historyLength: number) {
  const clamped = clampEstateOffset(offset, historyLength);
  const viewingCurrent = clamped === 0;
  return {
    offset: clamped,
    viewingCurrent,
    canGoBack: clamped < historyLength,
    canGoForward: clamped > 0,
    showForward: !viewingCurrent,
  };
}

export function snapshotAtOffset(
  history: EstateSeasonSnapshot[] | undefined,
  offset: number,
): EstateSeasonSnapshot | undefined {
  const list = history ?? [];
  const clamped = clampEstateOffset(offset, list.length);
  if (clamped === 0) return undefined;
  return list[list.length - clamped];
}
