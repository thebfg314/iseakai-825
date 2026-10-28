import type { WorldState } from "../engine/schema";

/**
 * Named amounts the scripts leave as "[amount]" (03_HISTORY §11.8): the tribute
 * shares of 866 and 877, the 845 Paris levy, the bridge levy. A script block
 * writes `{tribute_866_personal}` and a choice may cost `"{tribute_866_personal}"`;
 * both resolve here from rank and the manse split, so an improved villa pays no
 * more than a poor one (the levies are assessed per recorded manse).
 */

export type ManseSplit = { free: number; servile: number; vacant: number; recorded: number };

export function manseSplit(state: WorldState): ManseSplit {
  const m = state.holdings[0]?.manses;
  const free = m?.free ?? 6;
  const servile = m?.servile ?? 4;
  const vacant = m?.vacant ?? 0;
  // The scripts' villa is "ten manses, say 6 free and 4 servile"; the vacant ones are not on the assessment roll.
  return { free, servile, vacant, recorded: free + servile };
}

/** 866: the lord's own share is the heribannum, graded by rank (scripts: 10 s, 20 s, 40 s, 3 lb cap). */
const HERIBANNUM_866 = [120, 240, 480, 720, 720];

export const SLOT_NAMES = [
  "tribute_866_personal",
  "tribute_866_tenants",
  "tribute_866_total",
  "tribute_877_demesne",
  "tribute_877_tenants",
  "tribute_877_rent",
  "tribute_877_personal",
  "tribute_877_total",
  "levy_845",
  "bridge_levy_862",
  "absolution_fee",
  "absolution_penance",
  "ally_price",
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export function isSlotName(name: string): name is SlotName {
  return (SLOT_NAMES as readonly string[]).includes(name);
}

export function slotValue(state: WorldState, name: string): number | null {
  const rank = Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
  const m = manseSplit(state);
  switch (name) {
    case "tribute_866_personal":
      return HERIBANNUM_866[rank - 1];
    case "tribute_866_tenants":
      return m.free * 7 + m.servile * 4;
    case "tribute_866_total":
      return HERIBANNUM_866[rank - 1] + m.free * 7 + m.servile * 4;
    case "tribute_877_demesne":
      // A solidus from each demesne farm: one per holding for a count; the villa alone below that.
      return rank >= 3 ? 12 * Math.max(1, state.holdings.length) : 12 * rank;
    case "tribute_877_tenants":
      return m.free * 4 + m.servile * 2;
    case "tribute_877_rent":
      return m.free * 4 + m.servile * 2;
    case "tribute_877_personal":
      return (slotValue(state, "tribute_877_demesne") ?? 0) + m.free * 4 + m.servile * 2;
    case "tribute_877_total":
      return (slotValue(state, "tribute_877_personal") ?? 0) + m.free * 4 + m.servile * 2;
    case "levy_845":
      return 6 * m.recorded;
    case "bridge_levy_862":
      return 15;
    case "absolution_fee":
      // "A large sum, scaled to what he holds": a tenth of the recorded value, rounded to the solidus.
      return Math.max(120, Math.round(state.history.land.recordedValue * 0.1 / 12) * 12);
    case "absolution_penance":
      return Math.round((slotValue(state, "absolution_fee") ?? 0) / 2 / 12) * 12;
    case "ally_price":
      // Silver for the noble whose motive is money: ten solidi a rank.
      return 120 * rank;
    default:
      return null;
  }
}

/** "120 denarii (10 solidi)" for round sums, "58 denarii" otherwise. */
export function formatDenarii(n: number): string {
  if (n >= 12 && n % 12 === 0) {
    const s = n / 12;
    return `${n} denarii (${s} ${s === 1 ? "solidus" : "solidi"})`;
  }
  return `${n} denarii`;
}

/** Replace every `{slot}` in a script with its amount; unknown names are left as they are. */
export function fillSlots(state: WorldState, text: string): string {
  return text.replace(/\{([a-z0-9_]+)\}/g, (whole, name: string) => {
    const v = slotValue(state, name);
    return v === null ? whole : formatDenarii(v);
  });
}

/** A cost or gain written as a number or a slot name. */
export function resolveAmount(state: WorldState, amount: number | string): number {
  if (typeof amount === "number") return amount;
  const key = amount.replace(/^\{|\}$/g, "");
  const v = slotValue(state, key);
  if (v === null) throw new Error(`Unknown amount slot '${amount}'`);
  return v;
}
