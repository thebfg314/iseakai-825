import table from "../../data/history/tables/viking-danger.json";
import { createRng, seedFromString } from "../combat/rng";
import { applyRenown } from "../combat/renown";
import type { BattleCall, WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { rollRenownBand } from "./effects";
import { applyFlagOp, flagTruthy } from "./flags";
import { historyContent, seasonOrdinal } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * Viking danger in Burgundy (03_HISTORY §11.7). Distant news until 886; from
 * then a per-season raid chance by band, using the game's existing raid call
 * so the battle screen, refusal and aftermath all work as they do today.
 */

type Danger = "none" | "low" | "moderate" | "high";
type Band = { from: SeasonAt; to: SeasonAt; danger: Danger; chance: number; camp: boolean; what: string };

const BANDS = table.bands as Band[];

export type DangerNow = { danger: Danger; chance: number; camp: boolean; what: string | null };

export function dangerAt(at: SeasonAt, spared = false): DangerNow {
  const now = seasonOrdinal(at.year, at.season);
  const band = BANDS.find((b) => seasonOrdinal(b.from.year, b.from.season) <= now && now <= seasonOrdinal(b.to.year, b.to.season));
  if (!band) return { danger: "none", chance: 0, camp: false, what: null };
  if (spared) return { danger: table.spared.danger as Danger, chance: table.spared.chance, camp: false, what: band.what };
  return { danger: band.danger, chance: band.chance, camp: band.camp, what: band.what };
}

function raidAllowed(state: WorldState): boolean {
  return !state.battle_call && !state.battle && !state.battle_session && !state.player.dead && !state.player.captive && !state.player.maimed && !state.history.away;
}

export type VikingTick = { beats: HistoryBeat[]; lines: string[]; raid: boolean };

/** Set the band for the incoming season and roll the raid. */
export function tickVikings(state: WorldState, at: SeasonAt, turn: number): VikingTick {
  const out: VikingTick = { beats: [], lines: [], raid: false };
  const spared = flagTruthy(state, "vikings_sent_elsewhere");
  const now = dangerAt(at, spared);
  const v = state.history.vikings;
  v.danger = now.danger;
  v.campNear = now.camp;
  if (now.chance <= 0) return out;

  let chance = now.chance;
  if (flagTruthy(state, "relics_held")) chance += table.relicsHeldExtra; // a known treasure draws them
  const rng = createRng(seedFromString(`${state.meta.region}:viking:${at.year}:${at.season}:${turn}`));
  if (rng.chance(chance) && raidAllowed(state)) {
    const call: BattleCall = {
      kind: "raid",
      eventId: `viking:${at.year}:${at.season}`,
      text: table.callText,
      seed: seedFromString(`viking-raid:${at.year}:${at.season}`),
      createdTurn: turn,
    };
    state.battle_call = call;
    out.raid = true;
    out.lines.push(`Viking danger ${now.danger}: a band has come for the villa; the call to arms is open.`);
  }

  // A poisoned camp keeps its secret only so long (scripts: 'secrecy is itself a roll each season').
  if (now.camp && flagTruthy(state, "poisoned_camp") && !flagTruthy(state, "poison_known")) {
    const r2 = createRng(seedFromString(`${state.meta.region}:poison:${at.year}:${at.season}`));
    if (r2.chance(table.poisonDiscoveryChance)) {
      const registry = historyContent().flags;
      applyFlagOp(state, "poison_known", true, registry);
      applyFlagOp(state, "favor_church", "-2", registry);
      const delta = rollRenownBand("-small", `poison:${at.year}`);
      state.player.renown = applyRenown(state.player.renown ?? 1, delta);
      out.lines.push(`The poisoning of the Northmen's stores is known. Renown falls by ${-delta}; the church is cold.`);
      out.beats.push({
        npcId: "chaplain",
        eventId: "vikings:poison_known",
        text: "My lord, it is being said openly that the sickness in the Northmen's camp was put there, and by whose order. I will not pretend I can defend it from the pulpit. Men who fight in the open are praised; this is a thing people whisper about, and they are whispering.",
      });
    }
  }
  return out;
}

/** One line for the prompt when the band is above none. */
export function vikingLine(state: WorldState): string | null {
  const v = state.history.vikings;
  if (v.danger === "none") return null;
  const camp = v.campNear ? " A Viking army is wintering in the region; local defence is every lord's right." : "";
  return `Viking danger in Burgundy this season: ${v.danger}.${camp}`;
}
