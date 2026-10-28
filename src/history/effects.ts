import { applyRenown } from "../combat/renown";
import { createRng, seedFromString } from "../combat/rng";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import { applyPopulationDelta } from "../engine/peopleMovement";
import type { ModifierTarget, WorldState } from "../engine/schema";
import { newId } from "../engine/util";
import { evalCondition } from "./conditions";
import { applyFlagOp, conditionContext } from "./flags";
import { historyContent } from "./load";
import type { HistoryEffects, HistoryEffectsList } from "./schema";

/** Renown bands from the scripts: small 5–15, moderate 25–50, large 75–150. */
export const RENOWN_BAND_RANGES: Record<string, [number, number]> = {
  small: [5, 15],
  moderate: [25, 50],
  large: [75, 150],
};

export function rollRenownBand(band: string, seed: string): number {
  const neg = band.startsWith("-");
  const key = neg ? band.slice(1) : band;
  const range = RENOWN_BAND_RANGES[key];
  if (!range) return 0;
  const rng = createRng(seedFromString(seed));
  const n = rng.int(range[0], range[1]);
  return neg ? -n : n;
}

export type EffectReport = {
  /** Short ledger lines for the player, in order. */
  lines: string[];
  /** Why it could not be applied, if so. Nothing is written when this is set. */
  refused?: string;
};

function stockOf(state: WorldState, id: string): number {
  const canon = (state.resources as Record<string, number>)[id];
  if (typeof canon === "number") return canon;
  return state.custom_resources.find((c) => c.id === id)?.amount ?? 0;
}

function addStock(state: WorldState, id: string, delta: number): boolean {
  const res = state.resources as Record<string, number>;
  if (typeof res[id] === "number") {
    res[id] = Math.max(0, res[id] + delta);
    return true;
  }
  const custom = state.custom_resources.find((c) => c.id === id);
  if (custom) {
    custom.amount = Math.max(0, custom.amount + delta);
    return true;
  }
  if (id === "mancipia") {
    state.population.mancipia = Math.max(0, (state.population.mancipia ?? 0) + delta);
    return true;
  }
  return false;
}

/** Can the stores pay? Returns the first shortfall or null. */
export function costShortfall(state: WorldState, cost: Record<string, number> | undefined): string | null {
  if (!cost) return null;
  for (const [id, amount] of Object.entries(cost)) {
    if (amount <= 0) continue;
    const have = stockOf(state, id);
    if (have < amount) return `The stores hold ${have} ${id}; ${amount} are wanted.`;
  }
  return null;
}

/**
 * Apply an effects block or list (03_HISTORY §6.2) to the state. Blocks with a
 * `when` apply only when it holds. All-or-nothing on cost: if the stores cannot
 * pay any applicable block, nothing is written and `refused` says why.
 * `seed` makes renown bands reproducible per event + option.
 */
export function applyEffects(state: WorldState, effects: HistoryEffectsList | undefined, seed: string, opts?: { at?: { year: number; season: string } }): EffectReport {
  if (!effects) return { lines: [] };
  const list = Array.isArray(effects) ? effects : [effects];
  const ctx = conditionContext(state, opts?.at);
  const applicable = list.filter((e) => !e.when || evalCondition(e.when, ctx));
  for (const e of applicable) {
    const short = costShortfall(state, e.cost);
    if (short) return { lines: [], refused: short };
  }
  const lines: string[] = [];
  applicable.forEach((e, i) => lines.push(...applyOne(state, e, applicable.length > 1 ? `${seed}#${i}` : seed, opts)));
  return { lines };
}

/** The condition variables an effects `when` may read include every flag written so far this call. */
function applyOne(state: WorldState, effects: HistoryEffects, seed: string, opts?: { at?: { year: number; season: string } }): string[] {
  const lines: string[] = [];

  const registry = historyContent().flags;
  if (effects.cost) {
    for (const [id, amount] of Object.entries(effects.cost)) {
      if (amount > 0 && addStock(state, id, -amount)) lines.push(`${amount} ${id} paid out.`);
    }
  }
  if (effects.gain) {
    for (const [id, amount] of Object.entries(effects.gain)) {
      if (amount > 0 && addStock(state, id, amount)) lines.push(`${amount} ${id} received.`);
    }
  }
  if (effects.flags) {
    for (const [id, op] of Object.entries(effects.flags)) {
      const err = applyFlagOp(state, id, op, registry);
      if (err) throw new Error(err);
    }
  }
  if (effects.renown !== undefined) {
    const delta = typeof effects.renown === "number" ? effects.renown : rollRenownBand(effects.renown, `${seed}:renown`);
    if (delta !== 0) {
      state.player.renown = applyRenown(state.player.renown ?? 1, delta);
      lines.push(delta > 0 ? `Renown rises by ${delta}.` : `Renown falls by ${-delta}.`);
    }
  }
  if (effects.mood) {
    applyPeopleHappinessDelta(state, effects.mood);
    lines.push(effects.mood > 0 ? "The people take heart." : "The people grow uneasy.");
  }
  if (effects.modifier) {
    const m = effects.modifier;
    state.modifiers.push({
      id: newId("mod"),
      target: m.target as ModifierTarget,
      kind: m.kind,
      seasons_remaining: m.kind === "temporary" ? (m.seasonsRemaining ?? 4) : null,
      effect: { op: m.op, value: m.value },
      source: m.source,
      customNote: m.customNote,
    });
    lines.push(m.customNote ?? `A change on ${m.target}.`);
  }
  if (effects.settle) {
    const n = effects.settle.households;
    applyPopulationDelta(state, { households: n, adult_men: n, adult_women: n, youths: n });
    const home = state.holdings[0];
    if (home?.manses) home.manses.vacant = Math.max(0, home.manses.vacant - n);
    lines.push(n === 1 ? "A household settles on a vacant manse." : `${n} households settle on vacant manses.`);
  }
  if (effects.land) {
    const land = state.history.land;
    const l = effects.land;
    if (l.tenure) land.tenure = l.tenure;
    if (l.charter) land.charter = l.charter;
    if (l.recordedValue !== undefined) land.recordedValue = l.recordedValue;
    if (l.marriedLocal !== undefined) land.marriedLocal = l.marriedLocal;
    if (l.secondVilla !== undefined) land.secondVilla = l.secondVilla;
    if (l.precariaRent) land.precariaRent = l.precariaRent;
    if (l.visibility !== undefined) {
      const v = typeof l.visibility === "number" ? l.visibility : land.visibility + Number(l.visibility);
      land.visibility = Math.max(0, Math.min(100, Number.isFinite(v) ? v : land.visibility));
    }
    if (l.manses) {
      const home = state.holdings[0];
      if (home?.manses) {
        if (l.manses > 0) home.manses.free += l.manses;
        else {
          let left = -l.manses;
          const takeVacant = Math.min(home.manses.vacant, left);
          home.manses.vacant -= takeVacant;
          left -= takeVacant;
          const takeFree = Math.min(home.manses.free, left);
          home.manses.free -= takeFree;
          left -= takeFree;
          home.manses.servile = Math.max(0, home.manses.servile - left);
        }
      }
    }
  }
  if (effects.realm?.swornTo) {
    const to = effects.realm.swornTo;
    if (to === "count" || to === "church" || to === "king" || to === "none") state.history.realm.swornTo = to;
  }
  if (effects.prices) {
    const p = state.history.prices;
    p.severity = effects.prices.severity;
    p.untilTurn = effects.prices.seasons ? state.meta.turn + effects.prices.seasons : null;
  }
  if (effects.away) {
    state.history.away = { reason: effects.away.reason, untilTurn: state.meta.turn + effects.away.seasons };
    lines.push(`The lord will be away: ${effects.away.reason}.`);
  }
  if (effects.record) {
    const at = opts?.at ?? { year: state.meta.year, season: state.meta.season };
    state.history.record.push({ year: at.year, season: at.season as never, text: effects.record, thread: seed.split(":")[0] });
  }
  if (effects.scene) {
    const s = effects.scene;
    if (s.open) state.history.scenes[s.open] = { stage: 0, openedTurn: state.meta.turn, stageTurn: state.meta.turn };
    // advance/close are handled by the scene machinery (deliver.ts), which calls back here for stage effects.
  }
  return lines;
}
