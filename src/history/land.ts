import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { flagTruthy } from "./flags";
import { seasonOrdinal } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * Land and value (03_HISTORY §11.3). Two values per villa: the recorded value
 * frozen in the 825 assessment (6,500 d) and the true value, twelve times the
 * yearly income. Visibility rises with visible wealth and draws attention.
 */

/** Produce counted toward yearly income, valued at market mid. Coin and bought goods are not produce. */
export const INCOME_RESOURCES = [
  "wheat",
  "rye",
  "barley",
  "oats",
  "cattle",
  "sheep",
  "pigs",
  "horses",
  "poultry",
  "wine",
  "cheese",
  "honey",
  "wool",
  "linen",
  "softwood",
  "hardwood",
  "charcoal",
] as const;

export const VALUE_MULTIPLE = 12;

/** Features that raise visibility while they stand. */
const VISIBILITY_FEATURES: Record<string, number> = {
  flour_mill: 10,
  mill: 10,
  mill_forge: 6,
  stone_hall: 15,
  manor_hall: 0,
  palisade: 8,
  stone_wall: 10,
  gatehouse: 6,
  tower: 8,
  stone_chapel: 6,
  landing_stage: 5,
  vineyard: 4,
  orchard: 2,
  bloomery: 3,
};

export function marketMid(state: WorldState, id: string): number {
  const band = state.market[id];
  if (!band) return 0;
  return (band.min + band.max) / 2;
}

/** Value of the last four closed seasons' positive produce deltas at market mid. */
export function yearlyIncome(state: WorldState): number {
  const history = state.estate_history ?? [];
  const recent = history.slice(-4);
  if (!recent.length) return state.history.land.yearlyIncome;
  let total = 0;
  for (const snap of recent) {
    const deltas = snap.last_season_deltas ?? {};
    for (const id of INCOME_RESOURCES) {
      const d = deltas[id];
      if (typeof d === "number" && d > 0) total += d * marketMid(state, id);
    }
  }
  // Fewer than four seasons on the books: scale to a year.
  return Math.round((total * 4) / recent.length);
}

export function visibilityFloor(state: WorldState): number {
  let floor = 5;
  for (const h of state.holdings) {
    for (const f of h.features) floor += VISIBILITY_FEATURES[f] ?? 0;
    if (h.land.vineyard > 0) floor += Math.min(10, Math.round(h.land.vineyard / 2));
    if (h.land.orchard > 0) floor += Math.min(5, Math.round(h.land.orchard / 2));
  }
  if ((state.resources.horses ?? 0) > 4) floor += Math.min(10, state.resources.horses - 4);
  if (flagTruthy(state, "relics_held")) floor += 10;
  return Math.min(100, floor);
}

/** True when the gap between what the records say and what the land yields invites attention. */
export function landIsConspicuous(state: WorldState): boolean {
  const land = state.history.land;
  return land.visibility >= 60 && land.trueValue >= 1.5 * land.recordedValue;
}

/**
 * The forfeiture deadline for an open claim: Aachen, February 831, for the 830
 * crisis; for an outlaw of 832 the claim hangs until Warin takes Autun (837-03
 * lifts it before spring 838); four seasons for anything else.
 */
export function claimDeadlineFor(state: WorldState, at: SeasonAt, turn: number): number {
  const now = seasonOrdinal(at.year, at.season);
  if (now < seasonOrdinal(831, "spring")) return seasonOrdinal(831, "spring") + 1;
  if (flagTruthy(state, "outlaw_832")) return seasonOrdinal(838, "spring") + 1;
  return turn + 4;
}

export type LandTick = { beats: HistoryBeat[]; lines: string[] };

/**
 * Season tick: recompute true value each spring, decay visibility toward its
 * floor, and run the forfeiture clock when a count has claimed the villa.
 */
export function tickLand(state: WorldState, at: SeasonAt, turn: number): LandTick {
  const out: LandTick = { beats: [], lines: [] };
  const land = state.history.land;
  if (at.season === "spring") {
    const income = yearlyIncome(state);
    if (income > 0) {
      land.yearlyIncome = income;
      land.trueValue = income * VALUE_MULTIPLE;
    }
    land.visibility = Math.max(visibilityFloor(state), land.visibility - 2);
  }
  land.visibility = Math.max(land.visibility, visibilityFloor(state));

  if (land.tenure === "forfeit_claimed") {
    if (land.claimDeadlineTurn === null) land.claimDeadlineTurn = claimDeadlineFor(state, at, turn);
    const left = land.claimDeadlineTurn - turn;
    if (left === 1) {
      out.beats.push({
        npcId: "steward",
        eventId: "land:warning",
        text: "My lord, a word on the villa itself. The count's claim on it stands, and nothing we have done yet answers it. One season more and his officers will come with a writ, and they will take what the records say is theirs. If there is a price to pay, a match to make, or a church to shelter under, it must be now.",
      });
    } else if (left <= 0) {
      seizeVilla(state);
      out.beats.push({
        npcId: "steward",
        eventId: "land:seizure",
        text: "It is done, my lord, and there was no stopping it. The count's men came with the writ and the old assessment, and they have taken the empty manses and two of the free ones for the count's own use. We keep the hall, the demesne we work ourselves, and what tenants are left. It is a smaller villa than it was. I have written it all down.",
      });
      out.lines.push("The count seized part of the villa under the forfeiture.");
    }
  } else {
    land.claimDeadlineTurn = null;
  }
  return out;
}

/** The hard consequence: the vacant manses go first, then two free ones; the hall stays. */
export function seizeVilla(state: WorldState): void {
  const home = state.holdings[0];
  if (home?.manses) {
    home.manses.vacant = 0;
    home.manses.free = Math.max(0, home.manses.free - 2);
  }
  const land = state.history.land;
  land.tenure = "benefice";
  land.claimDeadlineTurn = null;
  land.recordedValue = Math.round(land.recordedValue * 0.6);
  state.history.flags.forfeit_830 = true;
  state.history.record.push({ year: state.meta.year, season: state.meta.season, text: "The count seized part of the villa under the forfeiture.", thread: "land" });
}

/** One prompt line for the household: what the land is worth and who is looking. */
export function landLine(state: WorldState): string {
  const l = state.history.land;
  const tenure =
    l.tenure === "benefice"
      ? `held as a benefice${l.charter !== "none" ? ` with a ${l.charter}'s charter` : ", no charter"}`
      : l.tenure === "owned"
        ? "the lord's own land"
        : l.tenure === "precaria"
          ? `held from the church as precaria (${l.precariaRent?.kind === "nona" ? "a ninth of the produce" : `${l.precariaRent?.denarii ?? 36} d a year`})`
          : "claimed as forfeit by the count";
  return `The villa: ${tenure}; recorded at ${l.recordedValue} d, worth about ${l.trueValue} d by its yield (${l.yearlyIncome} d a year); ${landIsConspicuous(state) ? "its wealth is being noticed" : "its wealth is not much remarked on"}.`;
}
