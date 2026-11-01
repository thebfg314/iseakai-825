import { CANONICAL_RESOURCES, type WorldState } from "../engine/schema";
import type { ConditionContext } from "./conditions";
import { historyContent } from "./load";
import type { FlagDef, FlagValue } from "./schema";

/** Body age this year (03_HISTORY §4): the modern man was `ageAt825` when he arrived. */
export function bodyAge(state: WorldState, year = state.meta.year): number {
  return (state.player.ageAt825 ?? 17) + (year - 825);
}

export function totalManses(state: WorldState): number {
  return state.holdings.reduce((n, h) => n + (h.manses?.free ?? 0) + (h.manses?.servile ?? 0), 0);
}

export function vacantManses(state: WorldState): number {
  return state.holdings.reduce((n, h) => n + (h.manses?.vacant ?? 0), 0);
}

export function flagValue(state: WorldState, id: string): FlagValue | undefined {
  return state.history.flags[id];
}

export function flagTruthy(state: WorldState, id: string): boolean {
  const v = state.history.flags[id];
  if (v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "" && v !== "none";
}

export function flagInt(state: WorldState, id: string): number {
  const v = state.history.flags[id];
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

/**
 * Apply one flag op from the effects vocabulary. "+n"/"-n" add to an int flag;
 * anything else sets. Enum values are checked against the registry; unknown
 * flags are refused so the data cannot invent vocabulary the design never listed.
 */
export function applyFlagOp(state: WorldState, id: string, op: FlagValue, registry: Map<string, FlagDef> = historyContent().flags): string | null {
  const def = registry.get(id);
  if (!def) return `Unknown history flag ${id}`;
  const flags = state.history.flags;
  if (typeof op === "string" && /^[+-]\d+$/.test(op)) {
    if (def.type !== "int") return `Flag ${id} is ${def.type}; cannot add ${op}`;
    flags[id] = flagInt(state, id) + Number(op);
    return null;
  }
  switch (def.type) {
    case "bool":
      flags[id] = typeof op === "boolean" ? op : Boolean(op);
      return null;
    case "int":
      if (typeof op === "number") flags[id] = op;
      else if (typeof op === "boolean") flags[id] = op ? 1 : 0;
      else return `Flag ${id} is int; got '${op}'`;
      return null;
    case "enum":
      if (typeof op !== "string" || !(def.values ?? []).includes(op)) return `Flag ${id} cannot be '${String(op)}'`;
      flags[id] = op;
      return null;
  }
  return null;
}

/** The variables a condition may read beside the flags (03_HISTORY §6.1). */
export function conditionVars(state: WorldState, at?: { year: number; season: string }): Record<string, FlagValue | undefined> {
  const year = at?.year ?? state.meta.year;
  const season = at?.season ?? state.meta.season;
  const h = state.history;
  const stores: Record<string, number> = {};
  for (const id of CANONICAL_RESOURCES) stores[id] = (state.resources as Record<string, number>)[id] ?? 0;
  return {
    ...stores,
    year,
    season,
    rank: state.player.rankLevel ?? 1,
    renown: state.player.renown ?? 1,
    age: bodyAge(state, year),
    units: state.military?.units?.length ?? 0,
    men_under_arms: (state.military?.units ?? []).reduce((n, u) => n + ((u as { men?: number }).men ?? 0), 0),
    manses: totalManses(state),
    vacant_manses: vacantManses(state),
    denarii: state.resources.denarii ?? 0,
    horses: state.resources.horses ?? 0,
    households: state.population.households,
    tenure: h.land.tenure,
    charter: h.land.charter,
    visibility: h.land.visibility,
    swornTo: h.realm.swornTo,
    king: h.realm.king ?? "none",
    emperor: h.realm.emperor ?? "none",
    count: h.realm.countOfAutun,
    severity: h.prices.severity,
    viking_danger: h.vikings.danger,
    ladder: h.ladder.stage,
    quest: h.quest.phase,
    quest_attempt: h.quest.attempt,
    allies: h.quest.nobles.filter((n) => n.status === "won" || n.status === "betrayer").length,
    happiness: state.peopleHappiness,
    favour: h.duties.favour,
    away: h.away ? 1 : 0,
    regional_famine: state.flags.regional_famine ? 1 : 0,
    hunger: state.flags.hunger ? 1 : 0,
    monastery_nearby: state.flags.monastery_nearby ? 1 : 0,
    relics: flagTruthy(state, "relics_held") ? 1 : 0,
    // Rank progression (03_HISTORY §10).
    villas: state.holdings.length,
    counties: h.rank?.counties.length ?? 0,
    vassals: (h.vassals ?? []).filter((v) => !v.group).length,
    vassal_mood: (() => {
      const own = (h.vassals ?? []).filter((v) => !v.group);
      return own.length ? Math.round(own.reduce((n, v) => n + v.mood, 0) / own.length) : 50;
    })(),
    trade_health: h.trade?.health ?? 55,
    justice_fairness: h.justice?.fairness ?? 0,
    justice_stance: h.justice?.stance ?? "fair",
  };
}

export function conditionContext(state: WorldState, at?: { year: number; season: string }): ConditionContext {
  return {
    flags: state.history.flags,
    fired: (id) => Boolean(state.history.fired[id]),
    chose: (eventId, optionId) =>
      state.history.chosen[eventId] === optionId ||
      Object.entries(state.history.chosen).some(([k, v]) => k.startsWith(`${eventId}#`) && v === optionId),
    feature: (name) => state.holdings.some((h) => h.features.includes(name)),
    vars: conditionVars(state, at),
  };
}
