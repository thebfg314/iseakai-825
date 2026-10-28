import type { WorldState } from "../engine/schema";
import { deliverEvent, expireDeadlines, markInterimBattle, type HistoryBeat } from "./deliver";
import { tickLand } from "./land";
import { historyContent } from "./load";
import { tickHungerDebuffs, tickPrices } from "./prices";
import { tickRealm } from "./realm";
import { tickRelics } from "./relics";
import { dueEvents, type SeasonAt } from "./scheduler";
import { runSupplyCheck } from "./supply";
import { tickTributes } from "./tributes";
import { tickVikings } from "./vikings";
import { tickWeather } from "./weather";

export type HistoryPassResult = {
  /** Verbatim lines to post on the speakers' tabs, in order. */
  beats: HistoryBeat[];
  /** Engine lines for the referee's season prompt. */
  refereeLines: string[];
  /** Ledger lines (costs, renown, defaults taken). */
  effects: string[];
  /** A dated event fired: the random "other" event stands down (03_HISTORY §2). */
  suppressOther: boolean;
  /** Catalog id of a forced weather event for the closing season, when a famine table says so. */
  forcedWeatherId: string | null;
  /** Multiplier on the forced event's crop effect (2 unimproved, toward 1 with improvements). */
  forcedSeverity: number;
  /** Ids delivered this pass. */
  fired: string[];
};

/**
 * The history season pass (03_HISTORY §5). Runs inside advanceSeason before the
 * random roll; `incoming` is the season about to begin and `turn` its turn number.
 * State is mutated (flags, fired, deadlines); the caller posts the beats.
 */
export function runHistorySeasonPass(state: WorldState, incoming: SeasonAt, turn: number): HistoryPassResult {
  const out: HistoryPassResult = { beats: [], refereeLines: [], effects: [], suppressOther: false, forcedWeatherId: null, forcedSeverity: 1, fired: [] };
  if (state.history.dead) return out;
  const content = historyContent();

  if (state.history.away && state.history.away.untilTurn <= turn) {
    out.beats.push({ npcId: "steward", eventId: "away:home", text: `The lord is home again, my lord; the hall has kept as well as it could while you were ${state.history.away.reason}.` });
    state.history.away = null;
  }

  const realm = tickRealm(state, incoming);
  out.beats.push(...realm.beats);

  const expired = expireDeadlines(state, incoming, turn);
  out.beats.push(...expired.beats);
  out.effects.push(...expired.lines);

  const land = tickLand(state, incoming, turn);
  out.beats.push(...land.beats);
  out.effects.push(...land.lines);

  const priceLine = tickPrices(state, incoming, turn);
  if (priceLine) out.effects.push(priceLine);
  const seedLine = tickHungerDebuffs(state);
  if (seedLine) out.effects.push(seedLine);
  // The weather roll describes the season now closing (the clock turns after the roll), so the table is read for it.
  const weather = tickWeather(state, { year: state.meta.year, season: state.meta.season as SeasonAt["season"] });
  out.forcedWeatherId = weather.forcedWeatherId;
  out.forcedSeverity = weather.severity;
  if (weather.forcedWeatherId) out.refereeLines.push(`History: the weather this season is set by the famine calendar (${weather.forcedWeatherId}); its effect is ${weather.severity.toFixed(2)}× the usual.`);

  out.effects.push(...tickRelics(state));
  const tributes = tickTributes(state, turn);
  out.beats.push(...tributes.beats);
  out.effects.push(...tributes.lines);
  const vikings = tickVikings(state, incoming, turn);
  out.beats.push(...vikings.beats);
  out.effects.push(...vikings.lines);
  if (vikings.raid) out.refereeLines.push("History: Northmen are coming for the villa this season; the call to arms is open and the player must answer or refuse it.");

  const due = dueEvents(state, incoming, content);
  for (const id of due.dropped) if (!state.history.dropped.includes(id)) state.history.dropped.push(id);
  for (const id of due.skipped) if (!state.history.dropped.includes(id)) state.history.dropped.push(id);

  // Told and interim events interleave in calendar order so a fight comes before its aftermath.
  const interim = new Set(due.interim.map((e) => e.id));
  const sequence = [...due.fire, ...due.interim].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const event of sequence) {
    const r = interim.has(event.id) ? markInterimBattle(state, event, incoming, turn) : deliverEvent(state, event, incoming, turn);
    out.beats.push(...r.beats);
    out.effects.push(...r.lines);
    out.fired.push(event.id);
    if (event.supplyCheck) {
      const s = runSupplyCheck(state, event, turn);
      out.beats.push(...s.beats);
      out.effects.push(...s.lines);
    }
    if (interim.has(event.id)) {
      out.refereeLines.push(`History: the lord rode out for ${event.id} "${event.title}"; the fight itself is not told yet.`);
    } else {
      const speakers = Array.from(new Set(r.beats.map((b) => b.npcId)));
      const by = speakers.length ? speakers.map((s) => (s === "steward" ? "Aldric" : "Ermenald")).join(" and ") : "the household";
      out.refereeLines.push(`History: ${event.id} "${event.title}" was told by ${by} this season start. Do not retell it; you may refer to it.`);
    }
  }
  out.suppressOther = due.fire.length > 0 || due.interim.length > 0;
  return out;
}
