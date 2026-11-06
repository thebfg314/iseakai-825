import type { WorldState } from "../engine/schema";
import type { HistoryState } from "./schema";
import { hundredValue } from "./standing";
import type { UpkeepBill } from "./upkeep";
import type { Vassal } from "./vassals";

/**
 * Giving.
 *
 * Routine gifts are not managed one by one. They sit inside the household bill.
 * The lord sets a standing, and revisits it rarely: lean spends less and the
 * sworn men cool, customary holds the line, generous spends more and they warm.
 *
 * A targeted gift is a thing, not a purse. It fits the man or it does not, it
 * fades over about four years, and it cannot buy past a grievance or a public snub.
 * Given in the middle of a bargaining it is taken, and remembered as a bribe.
 */

export type GivingLevel = "lean" | "customary" | "generous";
export type GiftKind = "horse" | "mail" | "sword" | "bird" | "cup" | "cloak" | "relic";
export type GiftBent = "fighter" | "devout" | "hunter" | "court";
export type GiftOccasion = "ordinary" | "wedding" | "confirm" | "funeral" | "victory" | "birth" | "negotiation";

/** Years a gift is still "current", in seasons. A bribe cools sooner. */
export const GIFT_SEASONS = 16;
export const BRIBE_SEASONS = 12;
/** Gifts cannot lift a man with an open grievance into contentment. */
export const GRIEVANCE_GIFT_CAP = 55;

type GiftRow = { denarii: number; word: string; fit: Record<GiftBent, number> };

export const GIFT_CATALOG: Record<GiftKind, GiftRow> = {
  horse: { denarii: 40, word: "a good horse", fit: { fighter: 12, devout: 4, hunter: 12, court: 6 } },
  mail: { denarii: 80, word: "a mail shirt", fit: { fighter: 14, devout: 3, hunter: 6, court: 4 } },
  sword: { denarii: 30, word: "a sword", fit: { fighter: 12, devout: 3, hunter: 5, court: 6 } },
  bird: { denarii: 25, word: "a hunting bird", fit: { fighter: 6, devout: 3, hunter: 14, court: 8 } },
  cup: { denarii: 20, word: "a silver cup", fit: { fighter: 4, devout: 8, hunter: 4, court: 12 } },
  cloak: { denarii: 18, word: "a fur-lined cloak", fit: { fighter: 5, devout: 4, hunter: 6, court: 12 } },
  relic: { denarii: 60, word: "a relic", fit: { fighter: 3, devout: 14, hunter: 3, court: 6 } },
};

const OCCASION_WEIGHT: Record<GiftOccasion, number> = {
  ordinary: 1,
  wedding: 1.5,
  confirm: 1.5,
  funeral: 1.5,
  victory: 1.5,
  birth: 1.5,
  negotiation: 1,
};

export function givingLevel(state: WorldState): GivingLevel {
  return state.history.upkeep?.giving ?? "customary";
}

/** Lean trims five percent off the household bill. Generous adds five percent of the gross. */
export function applyGiving(bill: UpkeepBill, level: GivingLevel): UpkeepBill {
  if (level === "customary") return bill;
  const householdYear =
    level === "lean" ? Math.round(bill.householdYear * 0.95) : bill.householdYear + Math.round(bill.grossYear * 0.05);
  const netYear = bill.grossYear - householdYear - bill.maintenanceYear;
  return {
    ...bill,
    householdYear,
    netYear,
    netSeason: Math.round(netYear / 4),
    householdSeason: Math.round(householdYear / 4),
  };
}

export function setGivingLevel(state: WorldState, level: GivingLevel): { ok: true; line: string } | { ok: false; line: string } {
  if (level !== "lean" && level !== "customary" && level !== "generous") {
    return { ok: false, line: "The hall gives leanly, as custom expects, or generously." };
  }
  const prev = givingLevel(state);
  state.history.upkeep.giving = level;
  if (prev === level) return { ok: true, line: "The giving stays as it was." };
  if (level === "lean") return { ok: true, line: "The hall will give leanly. The household costs a little less, and the sworn men will feel the want of it, slowly." };
  if (level === "generous") return { ok: true, line: "The hall will give generously. It costs five parts in a hundred of what the year brings in, and the sworn men will warm, slowly." };
  return { ok: true, line: "The hall will give as a lord of this rank is expected to give. No more drift from the gifts, either way." };
}

function clampMood(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** How many points this gift is worth to this man, before a grievance or a snub cuts it. */
export function giftFit(kind: GiftKind, bent: GiftBent, occasion: GiftOccasion): number {
  const row = GIFT_CATALOG[kind];
  return Math.round(row.fit[bent] * OCCASION_WEIGHT[occasion]);
}

export type GiftResult = { ok: true; line: string; mood: number } | { ok: false; line: string };

/**
 * Pay for a thing and give it. The mood that lands is what fit, the occasion,
 * and his grievances allow. A bargaining gift is marked as a bribe and cools in three years.
 */
export function giveGift(state: WorldState, vassalId: string, kind: GiftKind, occasion: GiftOccasion = "ordinary"): GiftResult {
  const row = GIFT_CATALOG[kind];
  if (!row) return { ok: false, line: "That is not a gift the hall gives." };
  const v = (state.history.vassals ?? []).find((x) => x.id === vassalId && !x.group);
  if (!v) return { ok: false, line: "He is not one of the sworn men." };
  v.gifts ??= [];
  v.grievances ??= [];
  v.snubbed ??= false;
  v.bent ??= "court";
  if (state.resources.denarii < row.denarii) return { ok: false, line: `The chest has not the ${row.denarii} denarii for ${row.word}.` };
  state.resources.denarii = Math.round(state.resources.denarii - row.denarii);

  const bribe = occasion === "negotiation";
  const raw = giftFit(kind, v.bent ?? "court", occasion);
  const before = v.mood;
  let landed = raw;
  let cold = "";
  if (v.snubbed) {
    landed = 0;
    cold = " He was snubbed in public, and a gift does not unsay that.";
  } else if (v.grievances.length) {
    const capped = Math.min(before + raw, GRIEVANCE_GIFT_CAP);
    landed = Math.max(0, capped - before);
    if (landed < raw) cold = " It does not wipe what is still between you.";
  }
  v.mood = clampMood(before + landed);
  const seasons = bribe ? BRIBE_SEASONS : GIFT_SEASONS;
  if (landed > 0) {
    v.gifts.push({ kind, turn: state.meta.turn, left: landed, perSeason: landed / seasons, bribe });
  }
  v.lastReason = bribe ? `took ${row.word} as a bribe` : `given ${row.word}`;
  const bribeNote = bribe ? " He knows it was a bribe, and so will anyone who heard." : "";
  const fitNote = raw >= 12 ? "It was the right gift." : raw <= 4 ? "It was the wrong gift for him." : "";
  return {
    ok: true,
    mood: v.mood,
    line: `${v.name} was given ${row.word} (${row.denarii} d). ${fitNote}${cold}${bribeNote}`.replace(/\s+/g, " ").trim(),
  };
}

/** Take back the warmth of gifts as the years pass. Called from the vassal season. */
export function decayGifts(state: WorldState): void {
  for (const v of state.history.vassals ?? []) {
    if (!v.gifts?.length) continue;
    let drop = 0;
    for (const g of v.gifts) {
      const was = Math.round(g.left);
      const step = Math.min(g.left, g.perSeason);
      g.left = Math.max(0, g.left - step);
      drop += was - Math.round(g.left);
    }
    v.gifts = v.gifts.filter((g) => g.left > 0.05);
    if (drop > 0) v.mood = clampMood(v.mood - drop);
  }
}

/** After the ordinary fade: lean giving cools them, generous giving warms them, one point a season. */
export function driftForGiving(state: WorldState): void {
  const level = givingLevel(state);
  const delta = level === "lean" ? -1 : level === "generous" ? 1 : 0;
  if (!delta) return;
  for (const v of state.history.vassals ?? []) v.mood = clampMood(v.mood + delta);
}

export function giftWord(kind: GiftKind): string {
  return GIFT_CATALOG[kind].word;
}

export function vassalGiftLine(state: WorldState): string | null {
  const men = (state.history.vassals ?? []).filter((v) => !v.group);
  if (!men.length) return null;
  const level = givingLevel(state);
  const stance =
    level === "lean"
      ? "The hall is giving leanly: the household costs five parts in a hundred less, and the sworn men cool a little each season."
      : level === "generous"
        ? "The hall is giving generously: five parts in a hundred of the year's receipts, and the sworn men warm a little each season."
        : "The hall gives as custom expects.";
  const open = men
    .filter((v) => v.snubbed || v.grievances.length)
    .map((v) => `${v.name}${v.snubbed ? " (snubbed)" : ` (${v.grievances.join(", ")})`}`);
  const blocked = open.length ? ` Gifts will not buy past this: ${open.join("; ")}.` : "";
  return `${stance} A particular gift is a thing, not coin: horse, mail, sword, bird, cup, cloak, relic. Propose vassal_gift { vassalId, kind, occasion } for Confirm. occasion is ordinary, wedding, confirm, funeral, victory, birth, or negotiation. A negotiation gift works and is remembered as a bribe. The warmth fades in about four years.${blocked}`;
}

export function churchWordForChaplain(state: WorldState): string {
  const church = hundredValue(state, "church");
  const word = church >= 60 ? "a friend of the church" : church < 40 ? "slighting the church" : "neither warm nor cold with the church";
  return `Ermenald's own mind: the lord is ${word}. Say so when he asks, in a priest's words.`;
}

export type VassalGift = HistoryState["vassals"][number]["gifts"][number];

