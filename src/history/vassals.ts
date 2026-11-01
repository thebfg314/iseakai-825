import { createRng, seedFromString } from "../combat/rng";
import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import type { SeasonAt } from "./scheduler";
import type { HistoryState } from "./schema";

/**
 * Vassals (rank design 'Vassals'; 03_HISTORY §10a). The men sworn to the lord once he
 * has rank: a few named men at Viscount and Count, a line per county at Duke and King.
 * Each has a mood 0–100, distinct from the tenants' happiness: tenants want feeding and
 * protecting, vassals want rewarding and fearing. Mood is moved by what the engine sees
 * (victory, defeat, a call refused, a step up, a holding taken back, a feast) and by
 * Aldric's `vassal_mood` proposal for what happens in talk. It fades toward the middle.
 *
 * Where it pays out: men at muster (content men bring one more, angry men none); an
 * angry man four seasons running may leave with his men and the villa he held; the
 * average feeds the king quest's nine and whether a king can strip the lord by a word.
 */

export type Vassal = HistoryState["vassals"][number];

export const CONTENT_AT = 65;
export const ANGRY_BELOW = 35;
const FADE_PER_SEASON = 1;
const SEASONS_BEFORE_DEFECTION = 4;
const DEFECTION_CHANCE = 0.25;
/** A county's lords bring a tenth of the levy as a file at the lord's side. */
const GROUP_LEVY_SHARE = 0.1;
const MAX_FILE = 30;

export const VASSAL_EVENTS = {
  victory: { delta: 8, why: "led to victory" },
  defeat: { delta: -8, why: "led to defeat" },
  held: { delta: -2, why: "service with nothing to show for it" },
  refused_call: { delta: -6, why: "the lord did not answer the call" },
  promotion: { delta: 5, why: "their lord raised up" },
  demotion: { delta: -10, why: "their lord stripped of his office" },
  feast: { delta: 4, why: "feasted at the hall" },
  holding_taken: { delta: -5, why: "a holding taken back" },
  judged_for: { delta: 6, why: "judged in his favour" },
  judged_against: { delta: -8, why: "judged against him" },
  confirmed_heir: { delta: 8, why: "his son confirmed in the holding" },
  protected: { delta: 6, why: "protected when threatened" },
  left_out: { delta: -4, why: "left out of a victory" },
} as const;
export type VassalEventKind = keyof typeof VASSAL_EVENTS;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function vassalMoodWord(mood: number): "content" | "steady" | "angry" {
  if (mood >= CONTENT_AT) return "content";
  if (mood < ANGRY_BELOW) return "angry";
  return "steady";
}

export function ownVassals(state: WorldState): Vassal[] {
  return (state.history.vassals ?? []).filter((v) => !v.group);
}

export function vassalGroups(state: WorldState): Vassal[] {
  return (state.history.vassals ?? []).filter((v) => v.group);
}

/** The average mood of the lord's sworn men (groups weigh as one each); 50 when he has none. */
export function averageVassalMood(state: WorldState): number {
  const all = state.history.vassals ?? [];
  if (!all.length) return 50;
  return Math.round(all.reduce((n, v) => n + v.mood, 0) / all.length);
}

function touch(v: Vassal, delta: number, why: string, turn: number): void {
  v.mood = clamp(Math.round(v.mood + delta), 0, 100);
  v.lastReason = why;
  if (v.mood < ANGRY_BELOW) v.angrySince ??= turn;
  else v.angrySince = null;
}

/**
 * Move the mood of some or all of the lord's men. `ids` empty means every vassal.
 * Returns the names moved.
 */
export function moveVassalMood(state: WorldState, delta: number, why: string, turn: number, ids: readonly string[] = []): string[] {
  const targets = (state.history.vassals ?? []).filter((v) => !ids.length || ids.includes(v.id));
  for (const v of targets) touch(v, delta, why, turn);
  return targets.map((v) => v.name);
}

/** One of the engine's recognised movers, applied to all (or the named) men. */
export function noteVassalEvent(state: WorldState, kind: VassalEventKind, turn: number, ids: readonly string[] = []): string | null {
  if (!(state.history.vassals ?? []).length) return null;
  const e = VASSAL_EVENTS[kind];
  const names = moveVassalMood(state, e.delta, e.why, turn, ids);
  if (!names.length) return null;
  const who = ids.length ? names.join(", ") : names.length === 1 ? names[0] : "the sworn men";
  return `${who[0].toUpperCase()}${who.slice(1)}: ${e.why} (${e.delta > 0 ? "+" : ""}${e.delta}).`;
}

/** Men a vassal brings when the lord rides: content men one more, angry men none. */
export function menAtMuster(v: Vassal): number {
  const word = vassalMoodWord(v.mood);
  if (v.group) {
    const share = word === "content" ? 1 : word === "steady" ? 0.75 : 0.4;
    return Math.min(MAX_FILE, Math.round(v.men * GROUP_LEVY_SHARE * share));
  }
  if (word === "angry") return 0;
  return v.men + (word === "content" ? 1 : 0);
}

export type MusterLine = { sheetId: string; name: string; overrides: { strength: number }; vassalIds: string[] };

/**
 * The sworn men as allied files for the field: the named men in files of up to thirty,
 * and each county's lords as a file of their own. Empty when no one comes.
 */
export function vassalMusterLines(state: WorldState): { lines: MusterLine[]; men: number; stayed: string[] } {
  const lines: MusterLine[] = [];
  const stayed: string[] = [];
  let pool = 0;
  const poolIds: string[] = [];
  for (const v of ownVassals(state)) {
    const men = menAtMuster(v);
    if (men <= 0) {
      stayed.push(v.name);
      continue;
    }
    pool += men;
    poolIds.push(v.id);
  }
  let total = 0;
  let n = 0;
  while (pool > 0) {
    const strength = Math.min(MAX_FILE, pool);
    pool -= strength;
    total += strength;
    n += 1;
    lines.push({ sheetId: "caballarii", name: n === 1 ? "The sworn men" : `The sworn men (${n})`, overrides: { strength }, vassalIds: poolIds });
  }
  for (const g of vassalGroups(state)) {
    const strength = menAtMuster(g);
    if (strength <= 0) {
      stayed.push(g.name);
      continue;
    }
    total += strength;
    lines.push({ sheetId: "pedites_fyrd", name: g.name, overrides: { strength }, vassalIds: [g.id] });
  }
  return { lines, men: total, stayed };
}

/** After a field the sworn men rode to: their mood follows the result. */
export function noteBattleForVassals(state: WorldState, outcome: string, turn: number, rode: boolean): string | null {
  if (!(state.history.vassals ?? []).length) return null;
  if (!rode) return outcome === "victory" ? noteVassalEvent(state, "left_out", turn) : null;
  if (outcome === "victory") return noteVassalEvent(state, "victory", turn);
  if (outcome === "defeat") return noteVassalEvent(state, "defeat", turn);
  return noteVassalEvent(state, "held", turn);
}

export type VassalTick = { beats: HistoryBeat[]; lines: string[]; left: string[] };

/**
 * The season: moods fade toward the middle, and a man angry four seasons running may go
 * over to another lord with his men and the villa he held from this one.
 */
export function tickVassals(state: WorldState, at: SeasonAt, turn: number): VassalTick {
  const out: VassalTick = { beats: [], lines: [], left: [] };
  const all = state.history.vassals ?? [];
  if (!all.length) return out;
  for (const v of all) {
    if (v.mood > 50) v.mood = Math.max(50, v.mood - FADE_PER_SEASON);
    else if (v.mood < 50) v.mood = Math.min(50, v.mood + FADE_PER_SEASON);
    if (v.mood < ANGRY_BELOW) v.angrySince ??= turn;
    else v.angrySince = null;
  }
  const leaving: Vassal[] = [];
  for (const v of all) {
    if (v.group || v.angrySince === null || turn - v.angrySince < SEASONS_BEFORE_DEFECTION) continue;
    const rng = createRng(seedFromString(`${state.meta.region}:vassal:${v.id}:${turn}`));
    if (rng.chance(DEFECTION_CHANCE)) leaving.push(v);
  }
  for (const v of leaving) {
    const i = state.history.vassals.indexOf(v);
    if (i >= 0) state.history.vassals.splice(i, 1);
    const villa = state.holdings.findIndex((h, k) => k > 0 && h.name === v.holding && h.tenure === "benefice");
    let villaName: string | null = null;
    if (villa > 0) {
      const h = state.holdings[villa];
      state.holdings.splice(villa, 1);
      state.population.households = Math.max(0, state.population.households - h.households);
      villaName = h.name;
    }
    const why = v.lastReason ?? "his grievances";
    state.history.vassalsLost.push({ name: v.name, turn, why });
    state.history.record.push({
      year: at.year,
      season: at.season,
      text: `${v.name} left the lord's service over ${why}${villaName ? `, taking the villa of ${villaName} with him` : ""}.`,
      thread: "vassals",
    });
    out.left.push(v.name);
    out.lines.push(`${v.name} has gone over to another lord with his ${v.men} men${villaName ? ` and the villa of ${villaName}` : ""}.`);
    out.beats.push({
      npcId: "steward",
      eventId: "vassals:left",
      text: `My lord, ${v.name} has taken his men and gone. He has been sour since ${why}, and he has found a lord who will have him${villaName ? `; ${villaName} goes with him, since he held it of you` : ""}. I have struck him from the books.`,
    });
  }
  return out;
}

/** The sworn men for Aldric's HISTORY block: ids, moods and men, who has gone, and when to propose vassal_mood. */
export function vassalsLine(state: WorldState): string | null {
  const own = ownVassals(state);
  const groups = vassalGroups(state);
  if (!own.length && !groups.length) return null;
  const parts: string[] = [];
  if (own.length) {
    parts.push(
      `Sworn men (id: name, mood, men): ${own.map((v) => `${v.id}: ${v.name} of ${v.holding}, ${vassalMoodWord(v.mood)}${v.lastReason ? ` (${v.lastReason})` : ""}, ${v.men} men`).join("; ")}.`,
    );
  }
  if (groups.length) parts.push(`The counties' lords: ${groups.map((g) => `${g.id}: ${g.name}, ${vassalMoodWord(g.mood)}`).join("; ")}.`);
  const lost = state.history.vassalsLost ?? [];
  if (lost.length) parts.push(`Gone from the lord's service: ${lost.map((l) => `${l.name} (${l.why})`).join(", ")}.`);
  parts.push(
    "When the lord rewards, slights, protects, judges for or against, or confirms one of them in talk, propose vassal_mood { vassalId (or \"all\"), delta −15..15, reason } for Confirm; the engine moves them itself for battles, calls refused, rank, feasts and holdings taken.",
  );
  return parts.join(" ");
}
