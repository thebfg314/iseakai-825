import type { WorldState } from "../engine/schema";
import { createRng, seedFromString } from "../combat/rng";
import table from "../../data/history/tables/supply-check.json";
import type { HistoryBeat } from "./deliver";
import { flagTruthy } from "./flags";
import { landIsConspicuous } from "./land";
import type { HistoryEvent } from "./schema";

/**
 * Army supply and looting (scripts appendix; 03_HISTORY §11.4). Events tagged
 * with a supply check roll here at the start of the season they fire.
 */

type Situation = keyof typeof table.situations;

export type SupplyRoll = {
  situation: Situation;
  happened: boolean;
  share: number;
  militiaWon: boolean;
  lost: Record<string, number>;
  coinLost: number;
};

export function menUnderArms(state: WorldState): number {
  return (state.military?.units ?? []).reduce((n, u) => n + ((u as { men?: number }).men ?? 0), 0);
}

function hasHiddenStores(state: WorldState): boolean {
  const names = table.countermeasures.hidden_stores.features;
  return state.holdings.some((h) => h.features.some((f) => names.includes(f))) || flagTruthy(state, "hidden_stores");
}

/** Roll one situation. Deterministic for the same state seed, event, and turn. */
export function rollSupply(state: WorldState, situation: Situation, seedKey: string): SupplyRoll {
  const rng = createRng(seedFromString(`${state.meta.region}:${state.meta.year}:supply:${seedKey}`));
  const row = table.situations[situation];
  const out: SupplyRoll = { situation, happened: false, share: 0, militiaWon: false, lost: {}, coinLost: 0 };

  let chance = row.chance;
  if (situation === "friendly_main" && flagTruthy(state, table.countermeasures.letter_of_protection.flag)) {
    chance = table.countermeasures.letter_of_protection.friendlyChance;
  }
  if (landIsConspicuous(state)) chance += table.prosperousBonus;
  if (!rng.chance(chance)) return out;
  out.happened = true;

  if (flagTruthy(state, table.countermeasures.paid_off.flag)) {
    out.share = table.countermeasures.paid_off.flatLoss;
  } else {
    if (row.militiaFights && menUnderArms(state) >= table.countermeasures.militia.minMenUnderArms) {
      // A drilled band meets foragers or deserters in the lanes; the better-armed side usually wins.
      const edge = Math.min(0.85, 0.45 + menUnderArms(state) / 100);
      if (rng.chance(edge)) {
        out.militiaWon = true;
        return out;
      }
    }
    const [lo, hi] = row.lost;
    out.share = rng.between(lo, hi);
    if (hasHiddenStores(state)) out.share /= 2;
  }

  const res = state.resources as Record<string, number>;
  for (const id of table.stores) {
    const have = res[id] ?? 0;
    if (have <= 0) continue;
    const taken = Math.floor(have * out.share);
    if (taken > 0) {
      res[id] = have - taken;
      out.lost[id] = taken;
    }
  }
  if ("takesCoin" in row && row.takesCoin && !out.militiaWon) {
    const coin = state.resources.denarii ?? 0;
    const taken = Math.floor(coin * out.share);
    if (taken > 0) {
      state.resources.denarii = coin - taken;
      out.coinLost = taken;
    }
  }
  return out;
}

/** Aldric reports the roll in his own words; the engine writes this line, not the scripts. */
export function supplyBeat(roll: SupplyRoll, eventId: string): HistoryBeat | null {
  if (!roll.happened) return null;
  if (roll.militiaWon) {
    return {
      npcId: "steward",
      eventId,
      text:
        roll.situation === "deserters"
          ? "There were men in the lanes last night, my lord, stragglers from the fighting with no captain and empty bellies. Our own men met them at the ford and they thought better of it. Nothing taken."
          : "Foragers came down the valley road with carts, my lord, looking for grain. Our men were under arms and stood across the lane, and the foragers went on to easier pickings. The stores are whole.",
    };
  }
  const items = Object.entries(roll.lost)
    .map(([id, n]) => `${n} ${id}`)
    .join(", ");
  const coin = roll.coinLost ? `, and ${roll.coinLost} denarii besides` : "";
  const who =
    roll.situation === "enemy_main"
      ? "The army is camped within a day's march and it is living off us. They came with a captain and a writ of requisition and did not wait for an answer."
      : roll.situation === "friendly_main"
        ? "Our own side's army is camped within a day's march, and an army eats whatever is nearest. Their quartermasters came with a tally and took what they called the king's due."
        : roll.situation === "foraging"
          ? "Foraging parties came down the valley road with carts. We could not stop them."
          : "Men from the broken army came through in the night, deserters with no captain, and took what they could carry.";
  return {
    npcId: "steward",
    eventId,
    text: `${who} The count of it, my lord: ${items || "little enough that mattered"}${coin}. I have it written down. ${roll.share >= 0.5 ? "It will be a thin year unless we buy." : "We will feel it, but we will not starve for it."}`,
  };
}

/** Run an event's supply check once; later seasons of a multi-season check are driven by `state.history.supply`. */
export function runSupplyCheck(state: WorldState, event: HistoryEvent, turn: number): { beats: HistoryBeat[]; lines: string[] } {
  const check = event.supplyCheck;
  if (!check) return { beats: [], lines: [] };
  const roll = rollSupply(state, check.situation, `${event.id}:${turn}`);
  state.history.supply.lastRoll = { turn, situation: check.situation, lost: roll.share };
  const beat = supplyBeat(roll, event.id);
  const lines: string[] = [];
  if (roll.happened && !roll.militiaWon) lines.push(`Supply check (${check.situation}): about ${Math.round(roll.share * 100)}% of stores lost.`);
  if (roll.militiaWon) lines.push(`Supply check (${check.situation}): the militia drove them off.`);
  return { beats: beat ? [beat] : [], lines };
}
