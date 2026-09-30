import { validateForgeObject } from "../combat/forge";
import { allUnitSheets, isBuiltinSheet, isBuiltinTag, registerCustomSheet, registerCustomTag, unitSheet } from "../combat/registry";
import { seedFromString } from "../combat/rng";
import type { UnitRequirement } from "../combat/schema";
import type {
  BattleCall,
  BattleCallKind,
  DisbandUnitProposal,
  RaiseUnitProposal,
  RegisterUnitSheetProposal,
  SeasonEffectLine,
  WorldState,
} from "./schema";
import { newId } from "./util";

/**
 * Raising, drilling, paying, and disbanding the estate's own units (Phase 4). A minor
 * noble's force is small: units carry a real headcount (`strength`) far below the roster
 * sheets' abstract 50–100, and casualties, ransoms, and levy feedback scale from it.
 */

export type RaiseSpec = {
  sheetId: string;
  label: string;
  /** Villa men (levy) or hired recruits from the district. */
  source: "villa" | "hire";
  men: { min: number; max: number };
  denariiPerMan: number;
  ironPerMan: number;
  horsesPerMan: number;
  /** Seasons of drill before the unit can march. 0 = at once. */
  seasons: number;
  /** Denarii per man per season while kept under arms. */
  upkeepPerMan: number;
  /** Needs Eberhard (a captain) to drill. */
  needsCaptain: boolean;
  note: string;
};

export const RAISE_SPECS: Record<string, RaiseSpec> = {
  peasant_levy: {
    sheetId: "peasant_levy",
    label: "Peasant levy",
    source: "villa",
    men: { min: 10, max: 100 },
    denariiPerMan: 0,
    ironPerMan: 0,
    horsesPerMan: 0,
    seasons: 0,
    upkeepPerMan: 0,
    needsCaptain: false,
    note: "The villa's own men with billhooks and quilted coats. Costs nothing but the men; only their dead come off the books.",
  },
  pedites_fyrd: {
    sheetId: "pedites_fyrd",
    label: "Spearmen",
    source: "hire",
    men: { min: 10, max: 80 },
    denariiPerMan: 4,
    ironPerMan: 1,
    horsesPerMan: 0,
    seasons: 2,
    upkeepPerMan: 0.4,
    needsCaptain: true,
    note: "Freemen hired from the district and drilled to the spear and shield over two seasons.",
  },
  sagittarii: {
    sheetId: "sagittarii",
    label: "Archers",
    source: "hire",
    men: { min: 10, max: 60 },
    denariiPerMan: 4,
    ironPerMan: 0.5,
    horsesPerMan: 0,
    seasons: 1,
    upkeepPerMan: 0.35,
    needsCaptain: true,
    note: "Men who already draw a bow, brought to shoot together in a season.",
  },
  caballarii: {
    sheetId: "caballarii",
    label: "Horsemen",
    source: "hire",
    men: { min: 5, max: 60 },
    denariiPerMan: 12,
    ironPerMan: 1,
    horsesPerMan: 1,
    seasons: 3,
    upkeepPerMan: 1,
    needsCaptain: true,
    note: "Riders with spear and shield; each needs a horse from the stables. Three seasons to ride as one.",
  },
};

export type RaiseQuote = {
  spec: RaiseSpec;
  men: number;
  denarii: number;
  iron: number;
  horses: number;
  seasons: number;
  upkeepPerSeason: number;
};

/**
 * Sheets outside RAISE_SPECS can still be raised when the district has what they want (design
 * review, item 12): roster sheets that carry `requirements` (crossbowmen, horse archers) and every
 * invented sheet. The spec is read off the sheet itself; Eberhard always drills them.
 */
export function derivedRaiseSpec(sheetId: string): RaiseSpec | undefined {
  const sheet = unitSheet(sheetId);
  if (!sheet || sheet.kind !== "troop") return undefined;
  const invented = !isBuiltinSheet(sheet.id);
  const wants = sheet.requirements ?? [];
  if (!invented && wants.length === 0) return undefined;
  const mounted = sheet.tags.includes("mounted");
  const ranged = sheet.range > 0;
  const heavy = sheet.def >= 12;
  return {
    sheetId: sheet.id,
    label: sheet.name,
    source: "hire",
    men: { min: mounted ? 5 : 10, max: 60 },
    denariiPerMan: mounted ? 12 : heavy ? 8 : 5,
    ironPerMan: heavy ? 2 : 1,
    horsesPerMan: mounted && !wants.some((w) => w.replacesHorses) ? 1 : 0,
    seasons: mounted ? 3 : 2,
    upkeepPerMan: mounted ? 1 : heavy ? 0.6 : 0.4,
    needsCaptain: true,
    note: wants.length
      ? `Wants, per man: ${wants.map((w) => `${w.perMan} ${w.name} (${w.source === "smith" ? "Bernard" : w.source === "hunt" ? "Gerulf" : "a merchant"})`).join("; ")}.`
      : "An invented sheet written into the rolls; drilled by Eberhard like any hired men.",
  };
}

export function raiseSpecFor(sheetId: string): RaiseSpec | undefined {
  return RAISE_SPECS[sheetId] ?? derivedRaiseSpec(sheetId);
}

/** Every sheet the estate could raise: the fixed four plus roster/invented sheets with a derived spec. */
export function raisableSpecs(state: WorldState): RaiseSpec[] {
  ensureCampaignContent(state);
  const out = Object.values(RAISE_SPECS);
  for (const sheet of allUnitSheets()) {
    if (RAISE_SPECS[sheet.id]) continue;
    const spec = derivedRaiseSpec(sheet.id);
    if (spec) out.push(spec);
  }
  return out;
}

export function quoteRaise(sheetId: string, men: number): RaiseQuote | undefined {
  const spec = raiseSpecFor(sheetId);
  if (!spec) return undefined;
  const n = Math.max(spec.men.min, Math.min(spec.men.max, Math.round(men)));
  return {
    spec,
    men: n,
    denarii: Math.round(n * spec.denariiPerMan),
    iron: Math.ceil(n * spec.ironPerMan),
    horses: n * spec.horsesPerMan,
    seasons: spec.seasons,
    upkeepPerSeason: Math.round(n * spec.upkeepPerMan),
  };
}

// ---------------------------------------------------------------------------
// What the district lacks (design review, item 12)
// ---------------------------------------------------------------------------

export type UnitWant = {
  sheetId: string;
  sheetName: string;
  resource: string;
  name: string;
  perMan: number;
  /** In store now. */
  have: number;
  source: UnitRequirement["source"];
  /** Who the lord should ask. */
  askOf: string;
  note?: string;
};

export function supplierFor(source: UnitRequirement["source"]): string {
  return source === "smith" ? "Bernard the smith" : source === "hunt" ? "Gerulf the negotiator" : "a visiting merchant";
}

function goodInStore(state: WorldState, resource: string): number {
  if (resource in state.resources) return (state.resources as Record<string, number>)[resource] ?? 0;
  return state.custom_resources.find((c) => c.id === resource)?.amount ?? 0;
}

function takeGood(state: WorldState, resource: string, amount: number): void {
  if (resource in state.resources) {
    const r = state.resources as Record<string, number>;
    r[resource] = Math.max(0, r[resource] - amount);
    return;
  }
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (custom) custom.amount = Math.max(0, custom.amount - amount);
}

/** Every requirement line across the sheets the estate could raise, with what is already in store. */
export function unitWants(state: WorldState): UnitWant[] {
  ensureCampaignContent(state);
  const out: UnitWant[] = [];
  for (const sheet of allUnitSheets()) {
    if (!sheet.requirements?.length || !derivedRaiseSpec(sheet.id)) continue;
    for (const w of sheet.requirements) {
      out.push({
        sheetId: sheet.id,
        sheetName: sheet.name,
        resource: w.resource,
        name: w.name,
        perMan: w.perMan,
        have: goodInStore(state, w.resource),
        source: w.source,
        askOf: supplierFor(w.source),
        note: w.note,
      });
    }
  }
  return out;
}

/** Requirements a raise of `men` would fall short on. */
export function unmetRequirements(state: WorldState, sheetId: string, men: number): { want: UnitRequirement; need: number; have: number }[] {
  const sheet = unitSheet(sheetId);
  const out = [];
  for (const want of sheet?.requirements ?? []) {
    const need = Math.ceil(want.perMan * men);
    const have = goodInStore(state, want.resource);
    if (have < need) out.push({ want, need, have });
  }
  return out;
}

/**
 * Eberhard is sought once the lord has men of his own to drill — a levy called up, men in
 * training — or has begun gathering what a new kind of soldier wants (design review, item 12).
 */
export function captainWanted(state: WorldState): boolean {
  if (state.military.units.length > 0 || state.military.training.length > 0) return true;
  return unitWants(state).some((w) => w.have > 0);
}

export function hasCaptain(state: WorldState): boolean {
  return state.npcs.some((n) => n.id === "captain" || n.role === "captain");
}

/** Villa men already standing as levy (they are not removed from the population). */
export function levyMenUnderArms(state: WorldState): number {
  return state.military.units.filter((u) => u.sheetId === "peasant_levy").reduce((s, u) => s + u.strength, 0);
}

export type RaiseResult = { ok: true; logLine: string; unitId?: string; trainingId?: string } | { ok: false; reason: string };

export function applyRaiseUnit(state: WorldState, p: RaiseUnitProposal): RaiseResult {
  ensureCampaignContent(state);
  const quote = quoteRaise(p.sheetId, p.men);
  if (!quote) {
    const known = raisableSpecs(state).map((s) => s.label.toLowerCase()).join(", ");
    return { ok: false, reason: `Only these can be raised here: ${known}.` };
  }
  const { spec } = quote;
  if (spec.needsCaptain && !hasCaptain(state)) return { ok: false, reason: `No one to drill them. ${spec.label} need a captain of the watch.` };
  if (spec.source === "villa") {
    const free = state.population.adult_men - levyMenUnderArms(state);
    if (quote.men > free) return { ok: false, reason: `Only ${Math.max(0, free)} men of the villa are free to stand as levy.` };
  }
  const short = unmetRequirements(state, spec.sheetId, quote.men);
  if (short.length) {
    const list = short.map((s) => `${s.need} ${s.want.name} (${s.have} in store; ask ${supplierFor(s.want.source)})`).join("; ");
    return { ok: false, reason: `${spec.label} cannot be raised yet. Wanting: ${list}.` };
  }
  if (state.resources.denarii < quote.denarii) return { ok: false, reason: `That costs ${quote.denarii} denarii; the chest holds ${state.resources.denarii}.` };
  if (state.resources.iron < quote.iron) return { ok: false, reason: `That needs ${quote.iron} pounds of iron for points and rims; the store holds ${state.resources.iron}.` };
  if (state.resources.horses < quote.horses) return { ok: false, reason: `That needs ${quote.horses} horses; the stables hold ${state.resources.horses}.` };

  state.resources.denarii -= quote.denarii;
  state.resources.iron -= quote.iron;
  state.resources.horses -= quote.horses;
  for (const want of unitSheet(spec.sheetId)?.requirements ?? []) takeGood(state, want.resource, Math.ceil(want.perMan * quote.men));
  const name = p.name?.trim() || `${spec.label} of ${state.holdings[0]?.name ?? "the villa"}`;
  if (quote.seasons === 0) {
    const id = newId("unit");
    state.military.units.push({ id, sheetId: spec.sheetId, name, veteran: false, strength: quote.men, raisedTurn: state.meta.turn });
    return { ok: true, unitId: id, logLine: `Raised ${quote.men} men as ${name}.` };
  }
  const id = newId("drill");
  state.military.training.push({ id, sheetId: spec.sheetId, name, men: quote.men, seasonsRequired: quote.seasons, seasonsElapsed: 0, startedTurn: state.meta.turn });
  const costBits = [quote.denarii ? `${quote.denarii} denarii` : "", quote.iron ? `${quote.iron} lb iron` : "", quote.horses ? `${quote.horses} horses` : ""].filter(Boolean).join(", ");
  return { ok: true, trainingId: id, logLine: `${quote.men} men taken on as ${name} for ${costBits}; ${quote.seasons} season${quote.seasons === 1 ? "" : "s"} of drill before they march.` };
}

export function applyDisbandUnit(state: WorldState, p: DisbandUnitProposal): RaiseResult {
  const idx = state.military.units.findIndex((u) => u.id === p.unitId || u.name.toLowerCase() === p.unitId.toLowerCase());
  if (idx >= 0) {
    const [unit] = state.military.units.splice(idx, 1);
    const spec = raiseSpecFor(unit.sheetId);
    const horses = spec ? unit.strength * spec.horsesPerMan : 0;
    state.resources.horses += horses;
    return { ok: true, logLine: `Disbanded ${unit.name} (${unit.strength} men)${horses ? `; ${horses} horses back to the stables` : ""}.` };
  }
  const tidx = state.military.training.findIndex((t) => t.id === p.unitId || t.name.toLowerCase() === p.unitId.toLowerCase());
  if (tidx >= 0) {
    const [t] = state.military.training.splice(tidx, 1);
    const spec = raiseSpecFor(t.sheetId);
    const horses = spec ? t.men * spec.horsesPerMan : 0;
    state.resources.horses += horses;
    return { ok: true, logLine: `Sent the ${t.name} home before their drill was done; the hiring money is spent.` };
  }
  return { ok: false, reason: "No such unit stands under your banner." };
}

/** Upkeep owed this season by units kept under arms (levy cost nothing). */
export function upkeepDue(state: WorldState): number {
  return state.military.units.reduce((sum, u) => {
    const spec = raiseSpecFor(u.sheetId);
    return sum + (spec ? Math.round(u.strength * spec.upkeepPerMan) : 0);
  }, 0);
}

/** Season tick: drill advances, finished drills become units, upkeep is paid or men drift away. */
export function tickMilitary(state: WorldState): SeasonEffectLine[] {
  const lines: SeasonEffectLine[] = [];
  const done: string[] = [];
  for (const t of state.military.training) {
    t.seasonsElapsed += 1;
    if (t.seasonsElapsed >= t.seasonsRequired) {
      state.military.units.push({ id: newId("unit"), sheetId: t.sheetId, name: t.name, veteran: false, strength: t.men, raisedTurn: state.meta.turn });
      done.push(t.id);
      lines.push({ kind: "info", text: `${t.name} have finished their drill: ${t.men} men ready to march.` });
    }
  }
  state.military.training = state.military.training.filter((t) => !done.includes(t.id));

  const due = upkeepDue(state);
  if (due > 0) {
    if (state.resources.denarii >= due) {
      state.resources.denarii -= due;
      lines.push({ kind: "apply", text: `Paid ${due} denarii to the men under arms.` });
    } else {
      const paid = state.resources.denarii;
      state.resources.denarii = 0;
      for (const u of state.military.units) {
        const spec = raiseSpecFor(u.sheetId);
        if (!spec || spec.upkeepPerMan === 0) continue;
        const lost = Math.max(1, Math.round(u.strength * 0.1));
        u.strength = Math.max(0, u.strength - lost);
        if (spec.horsesPerMan) state.resources.horses += lost * spec.horsesPerMan;
      }
      state.military.units = state.military.units.filter((u) => u.strength > 0);
      lines.push({ kind: "reject", text: `Only ${paid} of ${due} denarii could be paid to the men under arms; some have gone home with their gear.` });
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Calls to arms (shared by season events, Eberhard's proposal, and the test hook)
// ---------------------------------------------------------------------------

export const CALL_TEXT: Record<BattleCallKind, string> = {
  summons: "A rider from the count: every man who holds land of him is to come armed to the muster at the ford within the week.",
  raid: "Smoke on the river. Northmen have beached their ships below the villa and are coming up the bank.",
  bandits: "An outlaw band has been driving off cattle from the outlying manses and now holds the road to the ford.",
};

export function raiseCallDirect(state: WorldState, kind: BattleCallKind, seed?: number): BattleCall {
  const call: BattleCall = {
    kind,
    eventId: `direct-${kind}`,
    text: CALL_TEXT[kind],
    seed: seed ?? seedFromString(`${kind}:${state.meta.turn}:${state.battle_history.length}:${state.resources.denarii}`),
    createdTurn: state.meta.turn,
  };
  state.battle_call = call;
  return call;
}

// ---------------------------------------------------------------------------
// Invented units (design doc §1/§6 seam) — validated data, persisted with the save
// ---------------------------------------------------------------------------

export function applyRegisterUnitSheet(state: WorldState, p: RegisterUnitSheetProposal): RaiseResult {
  const result = validateForgeObject({ sheet: p.sheet, newTags: p.newTags, rationale: p.rationale ?? "" });
  if (!result.ok) return { ok: false, reason: `The design does not hold together: ${result.errors.join("; ")}` };
  const { sheet, newTags } = result.proposal;
  if (state.military.customSheets.some((s) => s.id === sheet.id)) return { ok: false, reason: `A unit called ${sheet.id} is already known.` };
  for (const t of newTags) if (!state.military.customTags.some((x) => x.id === t.id)) state.military.customTags.push(t);
  state.military.customSheets.push(sheet);
  ensureCampaignContent(state);
  return { ok: true, logLine: `Written into the muster rolls: ${sheet.name} (${sheet.tags.join(", ")}).` };
}

/** Make the save's invented sheets and tags resolvable in the registry (idempotent; safe after the lab clears its own). */
export function ensureCampaignContent(state: WorldState): void {
  for (const t of state.military.customTags) if (!isBuiltinTag(t.id)) registerCustomTag(t);
  for (const s of state.military.customSheets) if (!isBuiltinSheet(s.id) && unitSheet(s.id) !== s) registerCustomSheet(s);
}
