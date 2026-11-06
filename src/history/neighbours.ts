import { createRng, seedFromString } from "../combat/rng";
import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { demoteBy } from "./promotion";
import { ranksTable } from "./ranks";
import type { SeasonAt } from "./scheduler";

/**
 * The lords next door. From Viscount on, a household that slips away goes
 * somewhere in particular: a named neighbour's lands. The same men press a
 * lord whose rank has outrun his standing (mishaps.ts). That makes leaving a
 * rivalry, with a face on it, and not a number going down.
 */

const NEIGHBOUR_NAMES = ["Nithard", "Adalbert", "Ebroin", "Fulcrad", "Eberhard", "Rotgar", "Gislebert", "Hildebrand"] as const;

export type Neighbour = WorldState["history"]["neighbours"][number];

/** Three neighbours, seeded once from the villa, with seats that are not the lord's villas. */
export function ensureNeighbours(state: WorldState): Neighbour[] {
  if (state.history.neighbours.length >= 3) return state.history.neighbours;
  const rng = createRng(seedFromString(`${state.meta.region}:neighbours:${state.holdings[0]?.id ?? "villa"}`));
  const used = new Set(state.history.neighbours.map((n) => n.name));
  const seats = ranksTable().villaNames.filter((v) => !state.holdings.some((h) => h.name === v) && !state.history.vassals.some((x) => x.holding === v) && !state.history.neighbours.some((n) => n.seat === v));
  const names = NEIGHBOUR_NAMES.filter((n) => !used.has(n));
  while (state.history.neighbours.length < 3 && names.length && seats.length) {
    const name = names.splice(rng.int(0, names.length - 1), 1)[0];
    const seat = seats.splice(rng.int(0, seats.length - 1), 1)[0];
    state.history.neighbours.push({ id: `neighbour_${name.toLowerCase()}`, name, seat, taken: 0, encroached: [], kin: false });
  }
  return state.history.neighbours;
}

/**
 * The neighbour who gains most from the lord's trouble: the one who has already taken the most.
 * The lord's father-in-law (marriage.ts) neither takes his people in nor presses him; he is passed over
 * while any other neighbour stands.
 */
export function pickNeighbour(state: WorldState, seed: string): Neighbour {
  const every = ensureNeighbours(state);
  const all = every.some((n) => !n.kin) ? every.filter((n) => !n.kin) : every;
  const rng = createRng(seedFromString(`${state.meta.region}:neighbour:${seed}`));
  const most = Math.max(...all.map((n) => n.taken + n.encroached.length));
  const strong = all.filter((n) => n.taken + n.encroached.length === most);
  return strong[rng.int(0, strong.length - 1)];
}

export function neighbourById(state: WorldState, id: string | null | undefined): Neighbour | undefined {
  return id ? state.history.neighbours.find((n) => n.id === id) : undefined;
}

/**
 * A household has gone. Below Viscount it simply goes; from Viscount on it goes to a named
 * neighbour, who is counted. Returns the line for the season and marks the flight for renown.
 */
export function recordFlight(state: WorldState, turn: number): string {
  state.history.decay.flightTurn = turn;
  if ((state.player.rankLevel ?? 1) < 2) return "In the night a household slipped away from the demesne.";
  const n = pickNeighbour(state, `flight:${turn}`);
  n.taken += 1;
  return `In the night a household slipped away from the demesne, to ${n.name}'s lands at ${n.seat}. He offered them better terms than the hall did.`;
}

/**
 * The lord's villas stand empty and he has rank to fall back on. A viscount is a minor noble
 * again with whatever remains (the count does not keep a viscount over nobody). A count or
 * above goes on: the land yields nothing without hands, the office's duties cannot be met,
 * and the renown goes (decay.ts reads emptiedTurn); the ending, if it comes, is political.
 */
export function resolveDepopulation(state: WorldState, turn: number): { lines: string[]; beats: HistoryBeat[] } {
  const out = { lines: [] as string[], beats: [] as HistoryBeat[] };
  const rank = state.player.rankLevel ?? 1;
  const at: SeasonAt = { year: state.meta.year, season: state.meta.season as SeasonAt["season"] };
  if (rank === 2) {
    const by = state.history.rank.patron ?? `${state.history.realm.countOfAutun}, count of Autun`;
    const r = demoteBy(state, 1, { by, turn, at, eventId: "depopulation" });
    out.lines.push("The villas stand empty; the count has taken back the office he gave over them.", ...r.lines);
    state.history.record.push({ year: at.year, season: at.season, text: "The villas emptied, and the office of viscount went with the people.", thread: "office" });
    out.beats.push({
      npcId: "steward",
      eventId: "depopulation:viscount",
      text: `My lord, there is nobody left on the land, and ${by} does not keep a viscount over nobody. The office is gone and the villas he lent with it. What you own is still yours: the hall, the ground, whatever stock is in the byres. If people can be brought back, it begins again from here.`,
    });
    return out;
  }
  if (rank >= 3 && state.history.decay.emptiedTurn === null) {
    state.history.decay.emptiedTurn = turn;
    state.history.record.push({ year: at.year, season: at.season, text: "The lord's own villas stood empty.", thread: "mishaps" });
    out.lines.push("The lord's own villas stand empty: nothing will be reaped, the levy cannot be met, and his name goes with the people.");
    out.beats.push({
      npcId: "steward",
      eventId: "depopulation:count",
      text: "My lord, the last of our own people have gone. A count does not fall for that the way a villa lord does; the office stands, the counties pay what they pay. But nothing will be reaped on our own ground, the levy we owe cannot be raised from it, the sworn men see it, and every hall in the kingdom will hear that your villas are empty. If it ends, it will end at court, not in the fields.",
    });
  }
  return out;
}

/** The villas have people again: the emptied mark is lifted. */
export function clearDepopulation(state: WorldState): void {
  if (state.history.decay.emptiedTurn !== null && state.population.households > 0) state.history.decay.emptiedTurn = null;
}

/** One line for Aldric: who has been gaining at the lord's expense. */
export function neighboursLine(state: WorldState): string | null {
  const all = state.history.neighbours.filter((n) => n.taken > 0 || n.encroached.length > 0);
  if (!all.length) return null;
  const parts = all.map((n) => {
    const bits: string[] = [];
    if (n.taken) bits.push(`${n.taken} household${n.taken === 1 ? "" : "s"} of ours`);
    if (n.encroached.length) bits.push(n.encroached.join(", "));
    return `${n.name} of ${n.seat} has ${bits.join(" and ")}`;
  });
  const kin = state.history.neighbours.find((n) => n.kin);
  const kinNote = kin ? ` ${kin.name} of ${kin.seat} is the lady's father and takes nobody of ours in.` : "";
  return `The neighbours: ${parts.join("; ")}. People leave for the man who offers more than the hall does; to keep them the hall must offer more than he does, not merely enough.${kinNote}`;
}
