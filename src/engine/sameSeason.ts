import type { ProjectResultEntry, WorldState } from "./schema";
import { notDoneThisSeasonLine } from "./proposalPack";

/** Stores a later work can spend. Timber is softwood, then hardwood. */
export type StorePurse = {
  softwood: number;
  hardwood: number;
  iron: number;
  stone: number;
  charcoal: number;
  denarii: number;
};

export type StoreBill = {
  lumber: number;
  iron: number;
  stone: number;
  charcoal: number;
  denarii: number;
};

export type SeasonWork = {
  name: string;
  finishes: boolean;
  result: ProjectResultEntry[];
};

type Shortfall = {
  lumber: number;
  iron: number;
  stone: number;
  charcoal: number;
  denarii: number;
};

export function storePurse(state: WorldState): StorePurse {
  return {
    softwood: state.resources.softwood,
    hardwood: state.resources.hardwood,
    iron: state.resources.iron,
    stone: state.resources.stone,
    charcoal: state.resources.charcoal,
    denarii: state.resources.denarii,
  };
}

function shortfall(purse: StorePurse, bill: StoreBill): Shortfall {
  return {
    lumber: Math.max(0, bill.lumber - (purse.softwood + purse.hardwood)),
    iron: Math.max(0, bill.iron - purse.iron),
    stone: Math.max(0, bill.stone - purse.stone),
    charcoal: Math.max(0, bill.charcoal - purse.charcoal),
    denarii: Math.max(0, bill.denarii - purse.denarii),
  };
}

function anyShort(gap: Shortfall): boolean {
  return gap.lumber > 0.001 || gap.iron > 0.001 || gap.stone > 0.001 || gap.charcoal > 0.001 || gap.denarii > 0.001;
}

function supplies(entries: ProjectResultEntry[], key: keyof Shortfall): boolean {
  for (const entry of entries) {
    if (key === "lumber" && (entry.resource === "softwood" || entry.resource === "hardwood") && entry.amount > 0) return true;
    if (entry.resource === key && entry.amount > 0) return true;
  }
  return false;
}

function touches(entries: ProjectResultEntry[], gap: Shortfall): boolean {
  return (Object.keys(gap) as (keyof Shortfall)[]).some((key) => gap[key] > 0.001 && supplies(entries, key));
}

function addYield(purse: StorePurse, entries: ProjectResultEntry[]): void {
  for (const entry of entries) {
    if (entry.amount <= 0) continue;
    if (entry.resource === "softwood") purse.softwood += entry.amount;
    else if (entry.resource === "hardwood") purse.hardwood += entry.amount;
    else if (entry.resource === "iron") purse.iron += entry.amount;
    else if (entry.resource === "stone") purse.stone += entry.amount;
    else if (entry.resource === "charcoal") purse.charcoal += entry.amount;
    else if (entry.resource === "denarii") purse.denarii += entry.amount;
  }
}

export function resultSuppliesStore(entries: ProjectResultEntry[], key: "lumber" | "iron" | "stone" | "charcoal" | "denarii"): boolean {
  return supplies(entries, key);
}

/**
 * In one Confirm pack, an earlier result is in the stores before a later cost
 * only when both works finish this season and the yield covers what is short.
 * Otherwise the later work waits, and nothing is added.
 */
export function sameSeasonYieldPlan(
  have: StorePurse,
  bill: StoreBill,
  earlier: SeasonWork[],
  use: { name: string; finishes: boolean },
): { credit: SeasonWork[]; block?: string } {
  const base = shortfall(have, bill);

  const waiting = earlier.find((work) => !work.finishes && touches(work.result, base));
  if (waiting) return { credit: [], block: notDoneThisSeasonLine(waiting.name) };

  if (!use.finishes && earlier.some((work) => work.finishes && touches(work.result, base))) {
    return { credit: [], block: notDoneThisSeasonLine(use.name) };
  }

  if (!use.finishes) return { credit: [] };

  const suppliesBill = (work: SeasonWork) =>
    (["lumber", "iron", "stone", "charcoal", "denarii"] as const).some((key) => bill[key] > 0.001 && supplies(work.result, key));

  // The barn can already pay, but an earlier work in this pack was gathered for this cost.
  // Put that yield in the stores first so the cost takes it and leaves the barn alone.
  if (!anyShort(base)) {
    return { credit: earlier.filter((work) => work.finishes && suppliesBill(work)) };
  }

  const sim: StorePurse = { ...have };
  const credit: SeasonWork[] = [];
  for (const work of earlier) {
    if (!work.finishes) continue;
    const gap = shortfall(sim, bill);
    if (!anyShort(gap)) break;
    if (!touches(work.result, gap)) continue;
    addYield(sim, work.result);
    credit.push(work);
  }
  if (credit.length && !anyShort(shortfall(sim, bill))) return { credit };
  return { credit: [] };
}
