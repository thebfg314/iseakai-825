import { createRng, seedFromString } from "../combat/rng";
import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import type { SeasonAt } from "./scheduler";
import { addGrievance, clearGrievance, moveVassalMood, ownVassals, type Vassal } from "./vassals";

/**
 * Occasions the sworn men expect to be met in public.
 * One man: a wedding, a son to confirm, a funeral, a victory, the birth of an heir.
 * Twice a year, Christmas and Easter: one distribution to all of them.
 * Spillover is small per man and so matters more when the lord has many.
 * Letting the season pass is not a snub. A snub is the choice that says, in public, nothing.
 */

export type OccasionKind = "wedding" | "confirm" | "funeral" | "victory" | "birth" | "holy";
export type OccasionOption = "snub" | "token" | "customary" | "lavish";

const PERSONAL: OccasionKind[] = ["wedding", "confirm", "funeral", "victory", "birth"];
const ROLL = 0.12;

const BASE_COST: Record<Exclude<OccasionOption, "snub">, number> = { token: 8, customary: 20, lavish: 50 };
const RANK_MUL = [1, 1, 2, 4, 8];

const KIND_WORD: Record<OccasionKind, string> = {
  wedding: "is to be married",
  confirm: "asks that his son be confirmed in the holding",
  funeral: "buries his dead",
  victory: "has won a fight and the hall should feast it",
  birth: "has a son, an heir",
  holy: "the holy day",
};

export type OccasionTick = { beats: HistoryBeat[]; lines: string[] };

function rankMul(state: WorldState): number {
  const r = Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
  return RANK_MUL[r - 1];
}

export function occasionCost(state: WorldState, option: OccasionOption, holy: boolean): number {
  if (option === "snub") return 0;
  const men = holy ? Math.max(1, ownVassals(state).length) : 1;
  return Math.round(BASE_COST[option] * rankMul(state) * men);
}

function holySeason(season: string): boolean {
  return season === "winter" || season === "spring";
}

export function tickOccasions(state: WorldState, at: SeasonAt, turn: number): OccasionTick {
  const out: OccasionTick = { beats: [], lines: [] };
  if (state.history.dead) return out;
  const box = state.history.occasions;
  if (box.open && box.open.turn < turn) {
    box.open = null;
    out.lines.push("An occasion passed with no word from the lord. It was not a public snub; it was only unanswered.");
  }
  const men = ownVassals(state);
  if (!men.length || box.open) return out;

  const key = `${at.year}-${at.season}`;
  if (holySeason(at.season) && box.holyKey !== key) {
    box.holyKey = key;
    box.open = { id: `holy:${key}`, kind: "holy", vassalId: null, turn };
    out.beats.push({
      npcId: "steward",
      eventId: `occasion:${key}`,
      text: `My lord, ${at.season === "winter" ? "Christmas" : "Easter"} is on us, and the sworn men look to the hall. One decision covers all of them: nothing, a token, what custom requires, or a lavish hand. What you do, they all see, and they will expect the same of one another.`,
    });
    return out;
  }

  const rng = createRng(seedFromString(`${state.meta.region}:occasion:${turn}`));
  if (!rng.chance(ROLL)) return out;
  const v = men[rng.int(0, men.length - 1)];
  const kind = PERSONAL[rng.int(0, PERSONAL.length - 1)];
  box.open = { id: `occasion:${turn}`, kind, vassalId: v.id, turn };
  out.beats.push({
    npcId: "steward",
    eventId: `occasion:${turn}`,
    text: `My lord, ${v.name} of ${v.holding} ${KIND_WORD[kind]}. The hall can snub him, send a token, do what custom requires, or spend lavishly. The others are watching.`,
  });
  return out;
}

function pay(state: WorldState, cost: number): boolean {
  if (cost <= 0) return true;
  if (state.resources.denarii < cost) return false;
  state.resources.denarii = Math.round(state.resources.denarii - cost);
  return true;
}

function touchOne(v: Vassal, delta: number, why: string, turn: number): void {
  v.mood = Math.max(0, Math.min(100, Math.round(v.mood + delta)));
  v.lastReason = why;
  if (v.mood < 35) v.angrySince ??= turn;
  else v.angrySince = null;
}

/**
 * Resolve the occasion in front of the hall.
 * Snub: a large loss, and gifts cannot unsay it. The others lose a little.
 * Token: a small loss, no spillover. Customary: a small gain. Lavish: a large gain, and the others hear of it.
 */
export function resolveOccasion(state: WorldState, option: OccasionOption): { ok: true; line: string } | { ok: false; line: string } {
  const open = state.history.occasions.open;
  if (!open) return { ok: false, line: "No occasion is before the hall." };
  const holy = open.kind === "holy";
  const cost = occasionCost(state, option, holy);
  if (!pay(state, cost)) return { ok: false, line: `The chest has not the ${cost} denarii for that.` };

  const turn = state.meta.turn;
  const named = ownVassals(state);
  const target = holy ? null : named.find((v) => v.id === open.vassalId);
  if (!holy && !target) {
    state.history.occasions.open = null;
    return { ok: false, line: "The man is no longer sworn here." };
  }

  const targets = holy ? named : [target!];
  const others = holy ? [] : named.filter((v) => v.id !== target!.id);
  let line = "";

  if (option === "snub") {
    for (const v of targets) {
      touchOne(v, -12, "snubbed in public", turn);
      v.snubbed = true;
      if (open.kind === "confirm") addGrievance(v, "heir");
    }
    if (others.length) moveVassalMood(state, -2, "saw a man of theirs snubbed", turn, others.map((v) => v.id));
    line = holy
      ? "Nothing was sent at the holy day. Every sworn man saw it, and a later gift will not unsay a public snub."
      : `${target!.name} was given nothing, in public. The others saw it. A later gift will not unsay the snub.`;
  } else if (option === "token") {
    for (const v of targets) {
      touchOne(v, -4, "sent a token, when he could have done more", turn);
      if (open.kind === "confirm") addGrievance(v, "heir");
    }
    line = holy ? "A token went round at the holy day. They know he could have done more." : `${target!.name} was sent a token. He knows the hall could have done more.`;
  } else if (option === "customary") {
    for (const v of targets) {
      touchOne(v, 4, "met as custom requires", turn);
      v.snubbed = false;
      if (open.kind === "confirm") clearGrievance(v, "heir");
    }
    line = holy ? "The holy day was kept as custom requires. That is not a gift. It is the absence of an insult." : `${target!.name} was met as custom requires. Meeting an obligation is not a gift.`;
  } else {
    for (const v of targets) {
      touchOne(v, 12, "honoured lavishly", turn);
      v.snubbed = false;
      if (open.kind === "confirm") clearGrievance(v, "heir");
    }
    if (others.length) moveVassalMood(state, 1, "heard of a lavish gift, and will expect the same", turn, others.map((v) => v.id));
    line = holy
      ? "The holy day was kept lavishly. They will talk of it, and each will expect the same when his turn comes."
      : `${target!.name} was honoured lavishly, and he will talk. The others expect the same when their turn comes.`;
  }

  if (cost > 0) line += ` ${cost} d.`;
  state.history.occasions.open = null;
  state.history.record.push({
    year: state.meta.year,
    season: state.meta.season,
    text: line,
    thread: "vassals",
  });
  return { ok: true, line };
}

export function occasionLine(state: WorldState): string | null {
  const open = state.history.occasions?.open;
  if (!open) return null;
  const who = open.vassalId ? (state.history.vassals.find((v) => v.id === open.vassalId)?.name ?? "a sworn man") : "all the sworn men";
  const costs = (["token", "customary", "lavish"] as const).map((o) => `${o} ${occasionCost(state, o, open.kind === "holy")} d`).join(", ");
  return `Occasion open (${open.id}): ${who}, ${open.kind}. Options snub (nothing), ${costs}. Propose vassal_occasion { option } for Confirm. A snub is remembered, and a later gift does not unsay it. Lavish is talked about. The spillover is small per man.`;
}
