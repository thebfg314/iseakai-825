import type { WorldState } from "../engine/schema";
import { evalCondition, type ConditionContext } from "./conditions";
import { conditionContext } from "./flags";
import { historyContent, seasonOrdinal, type HistoryContent } from "./load";
import type { HistoryEvent, HistoryOption, HistorySeason } from "./schema";

export type SeasonAt = { year: number; season: HistorySeason };

export type DueResult = {
  /** Events to deliver this season start, in calendar order. */
  fire: HistoryEvent[];
  /** Deferred battles whose summons the lord accepted: one neutral line each (03_HISTORY §9). */
  interim: HistoryEvent[];
  /** Events whose season has passed without their requirements; recorded in history.dropped. */
  dropped: string[];
  /** Events skipped because their pass is switched off (promotions). */
  skipped: string[];
};

export function eventRequirementsHold(state: WorldState, event: HistoryEvent, at: SeasonAt): boolean {
  const ctx = conditionContext(state, at);
  if (!evalCondition(event.requires, ctx)) return false;
  if (event.unless && evalCondition(event.unless, ctx)) return false;
  return true;
}

/**
 * What fires at the start of `at`. Carried events wait up to `carryMax` seasons
 * for their requirements; everything else fires in its season or is dropped.
 * Events the clock has already passed (a save loaded late, a dev jump) are
 * dropped silently rather than delivered out of order.
 */
export function dueEvents(state: WorldState, at: SeasonAt, content: HistoryContent = historyContent()): DueResult {
  const out: DueResult = { fire: [], interim: [], dropped: [], skipped: [] };
  const now = seasonOrdinal(at.year, at.season);
  const dropped = new Set(state.history.dropped);
  for (const event of content.events) {
    if (state.history.fired[event.id] || dropped.has(event.id)) continue;
    const when = seasonOrdinal(event.fires.year, event.fires.season);
    if (when > now) continue;
    const late = now - when;
    if (late > 0 && !(event.carry && late <= event.carryMax)) {
      out.dropped.push(event.id);
      continue;
    }
    if (event.deferred === "promotion" && !content.features.promotions) {
      out.skipped.push(event.id);
      continue;
    }
    const holds = eventRequirementsHold(state, event, at);
    if (!holds) {
      if (event.carry && late < event.carryMax) continue; // wait another season
      out.dropped.push(event.id);
      continue;
    }
    if (event.deferred === "battle" && !content.features.historicalBattles) {
      out.interim.push(event);
      continue;
    }
    out.fire.push(event);
  }
  return out;
}

/** The option taken when the lord says nothing: the first default whose `requires` holds, else the last open option. */
export function defaultOption(options: HistoryOption[], ctx?: ConditionContext): HistoryOption {
  const open = ctx ? options.filter((o) => !o.requires || evalCondition(o.requires, ctx)) : options;
  const pool = open.length ? open : options;
  return pool.find((o) => o.default) ?? pool[pool.length - 1];
}

export function stageOf(event: HistoryEvent, stageId: string | undefined) {
  if (!stageId) return undefined;
  return event.stages.find((s) => s.id === stageId);
}

/** Choices whose deadline has passed at `turn`. */
export function expiredChoices(state: WorldState, turn: number) {
  return state.history.openChoices.filter((c) => c.deadlineTurn <= turn);
}

export function expiredOutcomes(state: WorldState, turn: number) {
  return state.history.openOutcomes.filter((c) => c.deadlineTurn <= turn);
}

/** Next event on a speaker's channel after `event`, to size the default hook window. */
export function hookWindowTurns(event: HistoryEvent): number {
  return Math.max(2, event.hookWindow);
}

/** True while the event's hooks and Knows may still be used. */
export function eventActive(state: WorldState, event: HistoryEvent, turn: number): boolean {
  const fired = state.history.fired[event.id];
  if (!fired) return false;
  if (state.history.scenes[event.id]) return true;
  if (state.history.openChoices.some((c) => c.eventId === event.id)) return true;
  if (state.history.openOutcomes.some((c) => c.eventId === event.id)) return true;
  return turn - fired.turn < hookWindowTurns(event);
}

/** Fired events still active, newest first. */
export function activeEvents(state: WorldState, turn: number, content: HistoryContent = historyContent()): HistoryEvent[] {
  const list: HistoryEvent[] = [];
  for (const id of Object.keys(state.history.fired)) {
    const e = content.byId.get(id);
    if (e && eventActive(state, e, turn)) list.push(e);
  }
  list.sort((a, b) => (state.history.fired[b.id]?.turn ?? 0) - (state.history.fired[a.id]?.turn ?? 0));
  return list;
}
