import type { WorldState } from "../engine/schema";
import { tickAge } from "./age";
import { forcesForEvent, openHistoricalBattle } from "./battles";
import { deliverEvent, expireDeadlines, markInterimBattle, type HistoryBeat } from "./deliver";
import { tickDiffusion } from "./diffusion";
import { tickDuties } from "./duties";
import { tickLadder } from "./ladder";
import { tickLand } from "./land";
import { tickQuest } from "./quest";
import { historyContent } from "./load";
import { tickHungerDebuffs, tickPrices } from "./prices";
import { tickRealm } from "./realm";
import { tickRelics } from "./relics";
import { tickRichard } from "./richard";
import { dueEvents, type SeasonAt } from "./scheduler";
import { applySupplyLoss, runSupplyCheck } from "./supply";
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
  /** The lord died of old age at this season's turn (03_HISTORY §11.2). */
  died: boolean;
};

/**
 * The history season pass (03_HISTORY §5). Runs inside advanceSeason before the
 * random roll; `incoming` is the season about to begin and `turn` its turn number.
 * State is mutated (flags, fired, deadlines); the caller posts the beats.
 */
export function runHistorySeasonPass(state: WorldState, incoming: SeasonAt, turn: number): HistoryPassResult {
  const out: HistoryPassResult = { beats: [], refereeLines: [], effects: [], suppressOther: false, forcedWeatherId: null, forcedSeverity: 1, fired: [], died: false };
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
  const richard = tickRichard(state, incoming);
  out.beats.push(...richard.beats);
  out.effects.push(...richard.lines);

  const due = dueEvents(state, incoming, content);
  for (const id of due.dropped) if (!state.history.dropped.includes(id)) state.history.dropped.push(id);
  for (const id of due.skipped) if (!state.history.dropped.includes(id)) state.history.dropped.push(id);

  // Told and interim events interleave in calendar order so a fight comes before its aftermath.
  const interim = new Set(due.interim.map((e) => e.id));
  const sequence = [...due.fire, ...due.interim].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const battlesOn = content.features.historicalBattles;
  for (const event of sequence) {
    const r = interim.has(event.id) ? markInterimBattle(state, event, incoming, turn) : deliverEvent(state, event, incoming, turn);
    out.beats.push(...r.beats);
    out.effects.push(...r.lines);
    out.fired.push(event.id);
    let battleOpened = false;
    if (event.deferred === "battle" && battlesOn && !interim.has(event.id)) {
      const opened = openHistoricalBattle(state, event, incoming, turn);
      out.beats.push(...opened.beats);
      out.effects.push(...opened.lines);
      if (opened.call) {
        battleOpened = true;
        out.refereeLines.push(`History: ${event.id} "${event.title}" is about to be fought; the call to arms is open and the season cannot turn until the lord rides out or turns back. Do not tell the fight.`);
      }
    }
    if (event.supplyCheck) {
      // With the battle pass on and a forces table for the event, a standing militia fights at the gate instead of rolling
      // (unless the lord is already called away to a greater field this season).
      const militiaBattle = battlesOn && state.battle_call?.kind !== "history" && Boolean(forcesForEvent(state, event.id, incoming, { supply: true }));
      const s = runSupplyCheck(state, event, turn, { militiaBattle });
      out.beats.push(...s.beats);
      out.effects.push(...s.lines);
      if (s.militiaCall) {
        const opened = openHistoricalBattle(state, event, incoming, turn, { supply: s.militiaCall });
        out.beats.push(...opened.beats);
        out.effects.push(...opened.lines);
        if (opened.call) out.refereeLines.push("History: foragers are at the villa's gate and the lord's men are under arms; the call to arms is open and the player must ride out or bar the hall.");
        else out.effects.push(...applySupplyLoss(state, s.militiaCall.situation, s.militiaCall.share));
      }
    }
    if (battleOpened) continue;
    if (interim.has(event.id)) {
      out.refereeLines.push(`History: the lord rode out for ${event.id} "${event.title}"; the fight itself is not told yet.`);
    } else {
      const speakers = Array.from(new Set(r.beats.map((b) => b.npcId)));
      const by = speakers.length ? speakers.map((s) => (s === "steward" ? "Aldric" : "Ermenald")).join(" and ") : "the household";
      out.refereeLines.push(`History: ${event.id} "${event.title}" was told by ${by} this season start. Do not retell it; you may refer to it.`);
    }
  }
  out.suppressOther = due.fire.length > 0 || due.interim.length > 0;

  // The king's small duties take a quiet season; the ladder and the quest run after the calendar.
  const duties = tickDuties(state, incoming, turn, sequence.length > 0);
  out.beats.push(...duties.beats);
  out.effects.push(...duties.lines);
  if (duties.duty) {
    out.fired.push(duties.duty);
    out.suppressOther = true;
    out.refereeLines.push(`History: the king's service this season (${duties.duty}) was told by Aldric; do not retell it.`);
  }
  const ladder = tickLadder(state, incoming, turn);
  out.beats.push(...ladder.beats);
  out.effects.push(...ladder.lines);
  const quest = tickQuest(state, incoming, turn, ladder.questStarts);
  out.beats.push(...quest.beats);
  out.effects.push(...quest.lines);
  for (const b of [...ladder.beats, ...quest.beats]) {
    if (!out.fired.includes(b.eventId) && content.byId.has(b.eventId)) out.fired.push(b.eventId);
  }
  if (ladder.beats.length || quest.beats.length) out.suppressOther = true;
  const diffusion = tickDiffusion(state, incoming, turn);
  out.beats.push(...diffusion.beats);
  out.effects.push(...diffusion.lines);

  // Last: the old man's season. 911-F1 above still fires in the autumn he dies.
  const age = tickAge(state, incoming, turn);
  if (age.died) {
    out.died = true;
    if (age.line) out.effects.push(age.line);
    out.refereeLines.push("History: the lord of Fontenay has died of old age at the turn of this season. Report the season as the household saw it; the chronicle's last page is written separately.");
  }
  return out;
}
