import { applyRenown } from "../combat/renown";
import type { Holding, WorldState } from "../engine/schema";
import { openHistoricalBattle } from "./battles";
import { deliverEvent, type DeliveryResult, type HistoryBeat } from "./deliver";
import { rollRenownBand } from "./effects";
import { applyFlagOp } from "./flags";
import { historyContent } from "./load";
import { ensureNeighbours, neighbourById, pickNeighbour, type Neighbour } from "./neighbours";
import { currentRank, demoteBy } from "./promotion";
import { thresholdFor } from "./ranks";
import type { SeasonAt } from "./scheduler";
import { hundredValue } from "./standing";
import { departVassal, moveVassalMood, ownVassals } from "./vassals";

/**
 * The mishap table: what befalls a man holding a rank well above his standing.
 *
 * Trigger: renown below the threshold of the rank beneath his own. A Count fires below
 * 100, a Duke below 500, a King below 1000. Viscounts and villa lords are not subject
 * (the count's dismissal covers the viscount; office.ts). Severity scales with the gap:
 * just under the line is harassment, a full rank below is dismemberment.
 *
 * Every entry can be answered: fight the neighbour, judge the vassal, go to court and
 * defend. A decisive answer earns renown back, so the spiral is survivable for a man who
 * fights. Left unanswered, each entry takes something.
 *
 * Cadence (retunable): one mishap open at a time; the next comes two seasons after the
 * last was settled, while the trigger holds; the same entry does not come twice running.
 */

export type MishapSeverity = "low" | "moderate" | "high" | "severe";
export const MISHAP_SEVERITIES: readonly MishapSeverity[] = ["low", "moderate", "high", "severe"];
/** Seasons between one mishap settling and the next arriving. */
export const MISHAP_GAP = 2;
/** Seasons an entry waits for an answer before it takes its toll. */
export const MISHAP_WINDOW = 2;
/** Standing with the count that wins a plea before him; with the crown, before the king. */
export const PLEA_WINS_AT = 60;
export const CLAIM_WINS_AT = 55;
export const CROWN_WINS_AT = 55;

type Entry = { id: string; severity: MishapSeverity; needs?: (state: WorldState) => boolean };

const hasVassal = (state: WorldState) => ownVassals(state).length > 0;
const hasCounty = (state: WorldState) => state.history.rank.counties.length > 0 || currentRank(state) >= 3;

export const MISHAP_TABLE: readonly Entry[] = [
  { id: "M-001", severity: "low" },
  { id: "M-002", severity: "low", needs: hasVassal },
  { id: "M-003", severity: "low" },
  { id: "M-004", severity: "moderate" },
  { id: "M-005", severity: "moderate" },
  { id: "M-006", severity: "moderate", needs: hasVassal },
  { id: "M-007", severity: "high", needs: hasCounty },
  { id: "M-008", severity: "high" },
  { id: "M-009", severity: "severe", needs: hasCounty },
];

/** The line the lord's renown has fallen under, and how far: null when the table does not apply. */
export function mishapSeverity(state: WorldState): { severity: MishapSeverity; line: number; gap: number } | null {
  const rank = currentRank(state);
  if (rank < 3) return null;
  const renown = state.player.renown ?? 1;
  const line = thresholdFor(rank - 1);
  if (renown >= line) return null;
  const floor = thresholdFor(rank - 2);
  const gap = Math.min(1, (line - renown) / Math.max(1, line - floor));
  const severity: MishapSeverity = renown <= floor ? "severe" : gap <= 0.33 ? "low" : gap <= 0.66 ? "moderate" : "high";
  return { severity, line, gap };
}

function severityIndex(s: MishapSeverity): number {
  return MISHAP_SEVERITIES.indexOf(s);
}

/** Entries open at this severity: the band itself and the one below it, never the last one faced. */
export function mishapPool(state: WorldState, severity: MishapSeverity): Entry[] {
  const i = severityIndex(severity);
  const pool = MISHAP_TABLE.filter((e) => {
    const k = severityIndex(e.severity);
    if (k > i || k < i - 1) return false;
    if (e.needs && !e.needs(state)) return false;
    return e.id !== state.history.mishaps.lastId;
  });
  const exact = pool.filter((e) => e.severity === severity);
  return exact.length ? exact : pool;
}

export type MishapTick = DeliveryResult & { opened: string | null; resolved: string | null; refereeLines: string[] };

function beat(eventId: string, text: string): HistoryBeat {
  return { npcId: "steward", eventId, text };
}

function renownBack(state: WorldState, band: "small" | "moderate", seed: string, lines: string[]): void {
  const n = rollRenownBand(band, seed);
  const before = state.player.renown;
  state.player.renown = applyRenown(before, n);
  lines.push(`Renown +${state.player.renown - before} (the matter answered).`);
}

function renownLost(state: WorldState, band: "small" | "moderate", seed: string, lines: string[]): void {
  const n = rollRenownBand(`-${band}`, seed);
  const before = state.player.renown;
  state.player.renown = applyRenown(before, n);
  lines.push(`Renown −${before - state.player.renown} (the matter left unanswered).`);
}

/** The holding a neighbour would take: a benefice villa first, never the seat. */
function takeableVilla(state: WorldState): Holding | undefined {
  return state.holdings.find((h, i) => i > 0 && !h.seat && h.tenure === "benefice") ?? state.holdings.find((h, i) => i > 0 && !h.seat);
}

function loseVilla(state: WorldState, h: Holding, to: string, at: SeasonAt, lines: string[]): void {
  const i = state.holdings.indexOf(h);
  if (i <= 0) return;
  state.holdings.splice(i, 1);
  state.population.households = Math.max(0, state.population.households - h.households);
  state.history.vassals = state.history.vassals.filter((v) => v.holding !== h.name);
  state.history.record.push({ year: at.year, season: at.season, text: `The villa of ${h.name} passed to ${to}.`, thread: "mishaps" });
  lines.push(`The villa of ${h.name} is lost to ${to}.`);
}

/** A mill or a piece of woodland goes to the neighbour. Returns what went. */
function loseWoodlandOrMill(state: WorldState, n: Neighbour, at: SeasonAt, lines: string[]): string {
  const withMill = state.holdings.find((h) => h.features.some((f) => f === "mill" || f.startsWith("mill_")));
  let what: string;
  if (withMill) {
    const k = withMill.features.findIndex((f) => f === "mill" || f.startsWith("mill_"));
    withMill.features.splice(k, 1);
    what = `the mill at ${withMill.name}`;
  } else {
    const wooded = [...state.holdings].sort((a, b) => b.land.woodland - a.land.woodland)[0];
    const cut = Math.round(wooded.land.woodland * 0.5);
    wooded.land.woodland = Math.max(0, wooded.land.woodland - cut);
    what = `${cut} acres of woodland at ${wooded.name}`;
  }
  n.encroached.push(what);
  state.history.record.push({ year: at.year, season: at.season, text: `${n.name} of ${n.seat} took ${what}.`, thread: "mishaps" });
  lines.push(`${n.name} keeps ${what}.`);
  return what;
}

/** A county goes to another man; with only one held, the rank itself goes. */
function loseCounty(state: WorldState, by: string, at: SeasonAt, turn: number, lines: string[]): string {
  const counties = state.history.rank.counties;
  if (counties.length > 1) {
    const gone = counties.pop()!;
    state.history.vassals = state.history.vassals.filter((v) => !(v.group && v.holding === gone.name));
    if (gone.name === "Autun") delete state.history.flags.holds_autun;
    state.history.record.push({ year: at.year, season: at.season, text: `The county of ${gone.name} was given to another by ${by}.`, thread: "mishaps" });
    lines.push(`The county of ${gone.name} is given to another.`);
    return `the county of ${gone.name}`;
  }
  const r = demoteBy(state, 1, { by, turn, at, eventId: "mishap" });
  lines.push(...r.lines);
  return "the office itself";
}

function cutChest(state: WorldState, share: number, lines: string[], why: string): void {
  const cut = Math.round(state.resources.denarii * share);
  state.resources.denarii = Math.max(0, state.resources.denarii - cut);
  lines.push(`${cut} denarii gone from the chest: ${why}.`);
}

function kingName(state: WorldState): string {
  return `${state.history.realm.king ?? "the king"}, the king`;
}

function countName(state: WorldState): string {
  return `${state.history.realm.countOfAutun}, count of Autun`;
}

type Outcome = { answered: boolean; lines: string[]; beats: HistoryBeat[] };

/**
 * Settle the open mishap from what the lord did (hooks taken, the choice made, the battle's result).
 * Returns null while it still waits for an answer inside its window.
 */
function settle(state: WorldState, at: SeasonAt, turn: number): Outcome | null {
  const open = state.history.mishaps.open!;
  const id = open.id;
  const hooks = state.history.hooksTaken[id] ?? [];
  const chosen = state.history.chosen[id];
  const expired = turn >= open.turn + MISHAP_WINDOW;
  const n = neighbourById(state, open.neighbourId) ?? pickNeighbour(state, id);
  const vassal = open.vassalId ? state.history.vassals.find((v) => v.id === open.vassalId) : undefined;
  const lines: string[] = [];
  const beats: HistoryBeat[] = [];
  const seed = `${state.meta.region}:mishap:${id}:${turn}`;
  const lordStanding = hundredValue(state, "lord");

  // Battles: wait on the field, then read it.
  if (open.battleOpen) {
    const result = state.history.flags.mishap_battle;
    if (typeof result !== "string") return null;
    delete state.history.flags.mishap_battle;
    if (result === "won" || result === "held") {
      if (id === "M-008") beats.push(beat(id, result === "won" ? `My lord, ${n.name} will call it a border dispute to anyone who asks, and nobody who was there will believe him. His men went home the shorter way. It is known now that you will fight.` : `My lord, ${n.name}'s men drew off without the villa. He has learned that the gate is held; the next test will be another kind.`));
      else beats.push(beat(id, result === "won" ? `My lord, the woodland and the mill are ours again and ${n.name}'s reeve has found that his charter was a misunderstanding after all. It is known now that you will come.` : `My lord, neither side could claim the woodland; it stays in dispute, but ${n.name} has learned that you come when you are pressed.`));
      return { answered: true, lines, beats };
    }
    if (id === "M-008") {
      const villa = takeableVilla(state);
      if (villa) loseVilla(state, villa, `${n.name} of ${n.seat}`, at, lines);
      else loseWoodlandOrMill(state, n, at, lines);
      if (villa) n.encroached.push(`the villa of ${villa.name}`);
      if (result === "refused") renownLost(state, "moderate", seed, lines);
      beats.push(beat(id, result === "refused" ? `My lord, the hall was barred and ${n.name} took what he came for. He calls it a border dispute; the country calls it what it was.` : `My lord, the gate was broken and ${n.name} holds what he came for. He calls it a border dispute, and after a day like that nobody will argue with him.`));
      return { answered: false, lines, beats };
    }
    loseWoodlandOrMill(state, n, at, lines);
    if (result === "refused") renownLost(state, "moderate", seed, lines);
    beats.push(beat(id, `My lord, the woodland is ${n.name}'s now, and the mill with it; the field said so.`));
    return { answered: false, lines, beats };
  }

  switch (id) {
    case "M-001": {
      if (hooks.length) return { answered: true, lines, beats };
      if (!expired) return null;
      applyFlagOp(state, "charles_disfavor", "-4");
      applyFlagOp(state, "count_opinion", "-4");
      renownLost(state, "small", seed, lines);
      beats.push(beat(id, "My lord, the talk at court has settled into a judgement, since nothing came from here to answer it. They say the rank sits on you like a borrowed coat."));
      return { answered: false, lines, beats };
    }
    case "M-002": {
      if (hooks.includes("judge_him")) {
        if (vassal) moveVassalMood(state, -6, "called to account before the others", turn, [vassal.id]);
        moveVassalMood(state, 4, "the lord still has a hand", turn, ownVassals(state).filter((v) => v.id !== vassal?.id).map((v) => v.id));
        return { answered: true, lines, beats };
      }
      if (hooks.includes("bind_him")) {
        if (vassal) moveVassalMood(state, 10, "bound with a gift", turn, [vassal.id]);
        return { answered: true, lines, beats };
      }
      if (!expired) return null;
      if (vassal) {
        const gone = departVassal(state, vassal, at, turn, "a muster half-answered and nothing said", `${n.name} of ${n.seat}`);
        lines.push(`${vassal.name} did not come at all, and has commended himself to ${n.name}${gone.villaName ? `, taking ${gone.villaName} with him` : ""}.`);
        beats.push(beat(id, `My lord, ${vassal.name} did not come to the muster at all this time, and he has commended himself to ${n.name}${gone.villaName ? `; ${gone.villaName} goes with him` : ""}. The others watched you let the first time pass. They will remember that.`));
      }
      renownLost(state, "small", seed, lines);
      return { answered: false, lines, beats };
    }
    case "M-003": {
      if (hooks.length) return { answered: true, lines, beats };
      if (!expired) return null;
      cutChest(state, 0.1, lines, "an officer's hand in the tolls");
      renownLost(state, "small", seed, lines);
      beats.push(beat(id, "My lord, the man with the new horse has a second one. He was right that nobody would come to count, and the other officers have noticed he was right."));
      return { answered: false, lines, beats };
    }
    case "M-004": {
      if (hooks.includes("plead_at_court")) {
        if (lordStanding >= PLEA_WINS_AT) {
          renownBack(state, "small", seed, lines);
          beats.push(beat(id, `My lord, the count found for you: ${n.name}'s charter was not one he recognised. The woodland is ours. It was your standing with him that did it, not the parchment.`));
          return { answered: true, lines, beats };
        }
        loseWoodlandOrMill(state, n, at, lines);
        beats.push(beat(id, `My lord, the count heard ${n.name} first and found for him. The gifts are spent and the woodland is his. A man who stands better with the count would have had another answer.`));
        return { answered: false, lines, beats };
      }
      if (hooks.includes("let_it_go")) {
        loseWoodlandOrMill(state, n, at, lines);
        return { answered: false, lines, beats };
      }
      if (!expired) return null;
      loseWoodlandOrMill(state, n, at, lines);
      renownLost(state, "moderate", seed, lines);
      beats.push(beat(id, `My lord, ${n.name}'s men are still in the woodland and his reeve takes the mill-toll as his own. Nothing was done, and the country has seen that nothing was done.`));
      return { answered: false, lines, beats };
    }
    case "M-005": {
      const claimant = "the abbey";
      if (hooks.includes("settle")) return { answered: true, lines, beats };
      if (hooks.includes("defend_it")) {
        if (lordStanding >= CLAIM_WINS_AT) {
          renownBack(state, "small", seed, lines);
          beats.push(beat(id, "My lord, the count found for you: the abbey's charter was older than its ink. Your witnesses were believed because he wished to believe them."));
          return { answered: true, lines, beats };
        }
        const villa = takeableVilla(state);
        if (villa) loseVilla(state, villa, claimant, at, lines);
        else cutChest(state, 0.2, lines, "the abbey's claim found good");
        beats.push(beat(id, "My lord, the count found for the abbey. The charter may have been found last month; it was found good all the same, which tells you how you stand with him."));
        return { answered: false, lines, beats };
      }
      if (!expired) return null;
      const villa = takeableVilla(state);
      if (villa) loseVilla(state, villa, claimant, at, lines);
      else cutChest(state, 0.2, lines, "the abbey's claim unanswered");
      renownLost(state, "moderate", seed, lines);
      beats.push(beat(id, "My lord, the claim went to judgement without you and the abbey has what it asked. Nobody spoke for us because nobody was sent to."));
      return { answered: false, lines, beats };
    }
    case "M-006": {
      if (hooks.includes("make_it_right")) {
        if (vassal) moveVassalMood(state, 20, "a wrong made good", turn, [vassal.id]);
        return { answered: true, lines, beats };
      }
      if (hooks.includes("contest_it")) {
        if (lordStanding >= PLEA_WINS_AT) {
          renownBack(state, "small", seed, lines);
          if (vassal) moveVassalMood(state, -5, "held to his oath against his will", turn, [vassal.id]);
          beats.push(beat(id, `My lord, the count would not hear the renunciation; ${vassal?.name ?? "the man"} is held to his oath. He is not glad of it, but he is yours.`));
          return { answered: true, lines, beats };
        }
      }
      const release = hooks.includes("release_him") || hooks.includes("contest_it");
      if (!release && !expired) return null;
      if (vassal) {
        const gone = departVassal(state, vassal, at, turn, "a lord who did not defend him", `${n.name} of ${n.seat}`);
        lines.push(`${vassal.name} has commended himself to ${n.name}${gone.villaName ? `, taking ${gone.villaName} with him` : ""}.`);
        beats.push(beat(id, release ? `My lord, ${vassal.name} has gone to ${n.name}${gone.villaName ? ` with ${gone.villaName}` : ""}. It was done lawfully and without a quarrel, which is the most that could be made of it.` : `My lord, ${vassal.name} has gone to ${n.name}${gone.villaName ? ` with ${gone.villaName}` : ""}, and nothing was said from this hall to stop him. The others have noticed what a renunciation costs here: nothing.`));
      }
      if (!release) renownLost(state, "moderate", seed, lines);
      return { answered: false, lines, beats };
    }
    case "M-007": {
      if (chosen === "go_and_defend") {
        beats.push(beat(id, "My lord, you stood before the assembly and answered, and the man who drew the charges found the ears he had bought were listening to you. The office is yours and they saw you keep it."));
        return { answered: true, lines, beats };
      }
      if (chosen === "send_gifts") return { answered: false, lines, beats };
      if (!chosen && !expired) return null;
      const what = loseCounty(state, kingName(state), at, turn, lines);
      beats.push(beat(id, `My lord, the assembly heard the charges with nobody to answer them, and the rival has ${what}. It was his the day you did not go.`));
      return { answered: false, lines, beats };
    }
    case "M-009": {
      if (chosen === "go_to_court") {
        if (hundredValue(state, "crown") >= CROWN_WINS_AT) {
          renownBack(state, "moderate", seed, lines);
          beats.push(beat(id, "My lord, the king heard you and the letter is withdrawn; the county stays. He said he had been misinformed, which is what a king says when he has changed his mind."));
          return { answered: true, lines, beats };
        }
        const what = loseCounty(state, kingName(state), at, turn, lines);
        beats.push(beat(id, `My lord, the king heard you out and did not change his mind; ${what} is gone. He was civil about it. The gifts are spent.`));
        return { answered: false, lines, beats };
      }
      if (!chosen && !expired) return null;
      const what = loseCounty(state, kingName(state), at, turn, lines);
      beats.push(beat(id, `My lord, ${what} has been handed over at Easter as the letter said. The king did not need to be careful of you, and he was not.`));
      return { answered: false, lines, beats };
    }
    default:
      return { answered: false, lines, beats };
  }
}

function open(state: WorldState, id: string, severity: MishapSeverity, at: SeasonAt, turn: number, out: MishapTick): void {
  const event = historyContent().byId.get(id);
  if (!event) return;
  const m = state.history.mishaps;
  ensureNeighbours(state);
  const neighbour = pickNeighbour(state, `${id}:${turn}`);
  const vassals = ownVassals(state);
  const vassal = vassals.length ? vassals.reduce((a, b) => (a.mood <= b.mood ? a : b)) : undefined;
  m.open = { id, turn, severity, vassalId: vassal?.id ?? null, neighbourId: neighbour.id, holdingId: null, battleOpen: false };
  m.lastTurn = turn;
  m.lastId = id;
  m.faced += 1;
  state.history.flags.mishaps_faced = m.faced;
  delete state.history.hooksTaken[id];
  delete state.history.chosen[id];
  const r = deliverEvent(state, event, at, turn);
  out.beats.push(...r.beats);
  out.lines.push(...r.lines);
  out.opened = id;
  out.lines.push(`Mishap (${severity}): ${event.title}.`);
  if (id === "M-008") {
    const opened = openHistoricalBattle(state, event, at, turn);
    out.beats.push(...opened.beats);
    out.lines.push(...opened.lines);
    if (opened.call) {
      m.open.battleOpen = true;
      out.refereeLines.push(`History: ${neighbour.name}'s men are attacking the villa (M-008); the call to arms is open and the player must ride out or bar the hall. Do not tell the fight.`);
    } else {
      // No field (the lord is captive, or away): the attack goes unopposed.
      state.history.flags.mishap_battle = "refused";
      m.open.battleOpen = true;
    }
  } else {
    out.refereeLines.push(`History: ${event.title} (${id}) came to the hall this season start, because the lord's name is below his rank; Aldric told it. Do not retell it; the lord answers it in talk with him.`);
  }
}

/** Season tick: settle what is open, then (two seasons after the last) raise the next while the trigger holds. */
export function tickMishaps(state: WorldState, at: SeasonAt, turn: number): MishapTick {
  const out: MishapTick = { beats: [], lines: [], opened: null, resolved: null, refereeLines: [] };
  if (state.history.dead) return out;
  const m = state.history.mishaps;
  if (m.open) {
    if (m.open.battleOpen && (state.battle || state.battle_session || state.battle_call?.kind === "history")) return out;
    const r = settle(state, at, turn);
    if (!r) return out;
    out.lines.push(...r.lines);
    out.beats.push(...r.beats);
    out.resolved = m.open.id;
    if (r.answered) {
      m.answered += 1;
      state.history.flags.mishaps_answered = m.answered;
    }
    m.open = null;
    m.lastTurn = turn;
    return out;
  }
  if (state.history.away) return out;
  const sev = mishapSeverity(state);
  if (!sev) return out;
  if (m.lastTurn !== null && turn - m.lastTurn < MISHAP_GAP) return out;
  const pool = mishapPool(state, sev.severity);
  if (!pool.length) return out;
  // Deterministic walk through the band, so a save replays the same and the entries do not repeat at once.
  const pick = pool[m.faced % pool.length];
  open(state, pick.id, sev.severity, at, turn, out);
  return out;
}

/** After a hook on an open mishap (hooks.ts): the ride against the neighbour raises its battle at once. */
export function afterMishapHook(state: WorldState, eventId: string, hookId: string, at: SeasonAt, turn: number): DeliveryResult {
  const out: DeliveryResult = { beats: [], lines: [] };
  const m = state.history.mishaps;
  if (!m.open || m.open.id !== eventId) return out;
  if (eventId === "M-004" && hookId === "ride_against_him") {
    const battleEvent = historyContent().byId.get("M-004-B");
    if (!battleEvent) return out;
    const opened = openHistoricalBattle(state, battleEvent, at, turn);
    out.beats.push(...opened.beats);
    out.lines.push(...opened.lines);
    if (opened.call) m.open.battleOpen = true;
    else out.lines.push("The lord cannot take the field this season; the woodland waits on him.");
  }
  return out;
}

/** The refusal of a mishap's battle, from the hall (battle.ts refuseCall); the forces' onRefuse sets the flag too. */
export function noteMishapBattle(state: WorldState, eventId: string, result: "won" | "held" | "lost" | "refused"): void {
  const m = state.history.mishaps;
  if (!m.open || !m.open.battleOpen) return;
  const battleEventId = m.open.id === "M-004" ? "M-004-B" : m.open.id;
  if (eventId !== battleEventId) return;
  state.history.flags.mishap_battle = result;
}

/** One line for Aldric's prompt while the table is in play. */
export function mishapsLine(state: WorldState): string | null {
  const m = state.history.mishaps;
  const sev = mishapSeverity(state);
  if (!sev && !m.open) return null;
  const parts: string[] = [];
  if (sev) parts.push(`The lord's renown (${state.player.renown}) is below the line of the rank beneath his (${sev.line}); the mishap table is in play at ${sev.severity} severity. Every entry can be answered, and a decisive answer earns renown back.`);
  if (m.open) {
    const event = historyContent().byId.get(m.open.id);
    parts.push(`Open now: ${event?.title ?? m.open.id} (${m.open.id})${m.open.battleOpen ? ", waiting on the field" : `; unanswered it takes its toll ${MISHAP_WINDOW} seasons after it came`}.`);
  }
  if (m.faced) parts.push(`Faced ${m.faced}, answered ${m.answered}.`);
  return parts.join(" ");
}
