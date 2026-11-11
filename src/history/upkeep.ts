import { createRng, seedFromString } from "../combat/rng";
import { labourDaysFromAssignment, labourRemaining } from "../engine/labour";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import type { CanonicalResource, WorldState } from "../engine/schema";
import { GRAIN_CROPS, type GrainCrop } from "../engine/grain";
import { round1 } from "../engine/util";
import type { HistoryBeat } from "./deliver";
import { seasonRevenue } from "./revenue";
import type { SeasonAt } from "./scheduler";
import { applyGiving, givingLevel } from "./gifts";
import { moveVassalMood } from "./vassals";

/**
 * Household upkeep and the keeping of the works.
 *
 * A lord's receipts are the yield of his land, not a purse. The household and the
 * keeping of halls, walls, mills, bridges and granaries still come off first, a
 * quarter of the year's figure each season, but that quarter is paid the way an
 * estate pays: from the stores, from the tenants' days, and only then from coin.
 *
 * In kind is the bulk — grain, the table, cloth, and fuel. Labour is most of the
 * mending at a villa or a viscount's seat. Coin is what the estate cannot make:
 * iron, salt, a millstone, a specialist's tool. That share grows with rank, because
 * a great household buys what one estate's barns cannot feed.
 *
 * A short chest is an inconvenience. The forge and the tools go wanting, and a mill
 * is patched badly. An empty granary is the crisis, and it is the famine the season
 * already knows. Days that were all spent elsewhere leave the roofs unkept, and the
 * works fail slowly. The Viking tributes are not this bill. Those ask for silver.
 *
 * The shares below are of a typical year's receipts at that rank. Keeping the works
 * then scales with what actually stands. The household cannot be skipped. He may
 * keep it leaner by as many as ten points of that share; the sworn men feel it.
 */

/** Share of gross receipts the household takes, by rank (minor noble through king). */
export const HOUSEHOLD_RATE = [0.25, 0.35, 0.45, 0.55, 0.6] as const;
/** Share the works take at a typical set of roofs for that rank. */
export const MAINTENANCE_RATE = [0.05, 0.06, 0.08, 0.1, 0.12] as const;
/**
 * Of the season's whole keep (household + works), the share that must be coin.
 * The rest is stores and the tenants' days. A villa lord's coin is the small end.
 */
export const COIN_SHARE = [0.15, 0.25, 0.45, 0.6, 0.7] as const;
/**
 * Of that same keep, the share taken as days. At a villa or a viscount's seat this
 * is most of the mending. A count and above buy more of their keeping.
 */
export const LABOUR_SHARE = [0.12, 0.12, 0.08, 0.05, 0.04] as const;
/** A tenant's day, reckoned at a denarius. The days and the coin share use the same scale. */
export const DAY_DENARII = 1;
/** Assignment that reserves the season's mending so other works cannot spend those days. */
export const MAINTENANCE_LABOUR_ID = "household-keeping";
/**
 * Weight of the works a promotion actually leaves standing: a hall and a barn on each
 * villa, and from viscount the seat's palisade. The maintenance share assumes this.
 */
export const TYPICAL_WORKS = [3, 11, 38, 137, 137] as const;
/** How many points of the household share a lean hall may give up. */
export const LEAN_MAX = 10;

const WORK_WEIGHT: Record<string, number> = {
  manor_hall: 2,
  stone_hall: 4,
  barn: 1,
  granary: 2,
  palisade: 2,
  tower: 2,
  gatehouse: 2,
  watch_post: 1,
  stone_wall: 4,
  mill: 2,
  mill_flour: 2,
  mill_fulling: 2,
  mill_forge: 2,
  bridge: 2,
  market: 3,
  fair: 2,
};

const WORK_WORD: Record<string, string> = {
  manor_hall: "hall",
  stone_hall: "stone hall",
  barn: "barn",
  granary: "granary",
  palisade: "palisade",
  tower: "wooden tower",
  gatehouse: "gatehouse",
  watch_post: "watch post",
  stone_wall: "stone wall",
  mill: "mill",
  mill_flour: "flour mill",
  mill_fulling: "fulling mill",
  mill_forge: "mill-forge",
  bridge: "bridge",
  market: "market",
  fair: "fair",
};

type WorkKind = "fort" | "mill" | "granary" | "bridge" | "market";

const WORK_KIND: Record<string, WorkKind> = {
  palisade: "fort",
  tower: "fort",
  gatehouse: "fort",
  watch_post: "fort",
  stone_wall: "fort",
  mill: "mill",
  mill_flour: "mill",
  mill_fulling: "mill",
  mill_forge: "mill",
  barn: "granary",
  granary: "granary",
  bridge: "bridge",
  market: "market",
  fair: "market",
};

const FLOUR_MILLS = new Set(["mill", "mill_flour"]);
const KIND_ORDER: WorkKind[] = ["fort", "mill", "granary", "bridge", "market"];
/** From the third short season, a neglected work may come down. */
const COLLAPSE_FROM = 3;
const COLLAPSE_CHANCE = 0.4;
/** Two seasons of paid keeping and a work that was only wearing is sound again. */
const MEND_SEASONS = 2;
const MILL_WASTE = 0.1;
const GRANARY_SPOIL = 0.15;
const COLLAPSE_SPOIL = 0.1;

const POINT_WORD = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;

export type UpkeepBill = {
  grossYear: number;
  householdRate: number;
  maintenanceRate: number;
  scale: number;
  householdYear: number;
  maintenanceYear: number;
  netYear: number;
  netSeason: number;
  householdSeason: number;
  maintenanceSeason: number;
  /** Season quarter split across stores, days, and the chest. They sum to the two seasons above. */
  kindSeason: number;
  labourSeason: number;
  labourDays: number;
  coinSeason: number;
};

export type UpkeepTick = { lines: string[]; beats: HistoryBeat[] };

type WorkRef = { holdingId: string; feature: string; kind: WorkKind };

function rankOf(state: WorldState): number {
  return Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
}

export function structureWeight(state: WorldState): number {
  let weight = 0;
  for (const h of state.holdings) {
    for (const f of h.features) weight += WORK_WEIGHT[f] ?? 0;
  }
  return weight;
}

/** 1 when the lord has the roofs a grant of this rank usually leaves. */
export function structureScale(state: WorldState): number {
  const typical = TYPICAL_WORKS[rankOf(state) - 1];
  if (typical <= 0) return 1;
  return structureWeight(state) / typical;
}

/** The year's bill at a known gross, rank, scale and lean cut. */
export function billFor(grossYear: number, rank: number, scale = 1, lean = 0): UpkeepBill {
  const r = Math.max(1, Math.min(5, Math.round(rank)));
  const cut = Math.max(0, Math.min(LEAN_MAX, lean));
  const householdRate = Math.max(0, HOUSEHOLD_RATE[r - 1] - cut / 100);
  const maintenanceRate = MAINTENANCE_RATE[r - 1] * Math.max(0, scale);
  const gross = Math.max(0, Math.round(grossYear));
  const householdYear = Math.round(gross * householdRate);
  const maintenanceYear = Math.round(gross * maintenanceRate);
  const netYear = gross - householdYear - maintenanceYear;
  return withShares(
    {
      grossYear: gross,
      householdRate,
      maintenanceRate,
      scale,
      householdYear,
      maintenanceYear,
      netYear,
      netSeason: Math.round(netYear / 4),
      householdSeason: Math.round(householdYear / 4),
      maintenanceSeason: Math.round(maintenanceYear / 4),
      kindSeason: 0,
      labourSeason: 0,
      labourDays: 0,
      coinSeason: 0,
    },
    r,
  );
}

/** Split a season's keep into stores, days, and coin. Kind is whatever the other two do not take. */
export function withShares(bill: UpkeepBill, rank: number): UpkeepBill {
  const r = Math.max(1, Math.min(5, Math.round(rank))) - 1;
  const total = Math.max(0, bill.householdSeason + bill.maintenanceSeason);
  let coin = Math.round(total * COIN_SHARE[r]);
  let labour = Math.round(total * LABOUR_SHARE[r]);
  if (coin + labour > total) labour = Math.max(0, total - coin);
  const kind = Math.max(0, total - coin - labour);
  const labourDays = labour <= 0 ? 0 : Math.max(1, Math.round(labour / DAY_DENARII));
  return { ...bill, coinSeason: coin, labourSeason: labour, labourDays, kindSeason: kind };
}

/** What this year costs, and what it leaves, at the receipts and the roofs as they stand. */
export function assessUpkeep(state: WorldState): UpkeepBill {
  const land = state.history.land.yearlyIncome ?? 0;
  const office = seasonRevenue(state).net * 4;
  const lean = state.history.upkeep?.lean ?? 0;
  const rank = rankOf(state);
  return withShares(applyGiving(billFor(land + office, rank, structureScale(state), lean), givingLevel(state)), rank);
}

export function isWorn(state: WorldState, holdingId: string, feature: string): boolean {
  return (state.history.upkeep?.worn ?? []).some((w) => w.holdingId === holdingId && w.feature === feature && w.stage >= 1);
}

/**
 * A wooden wall that has been let go fights as a fence. Stone still standing,
 * or a palisade that is still sound, is a real face. No such wall is makeshift,
 * which is how an unfortified villa already fights.
 */
export function wallsAreMakeshift(state: WorldState): boolean {
  const sound = (feature: string) => state.holdings.some((h) => h.features.includes(feature) && !isWorn(state, h.id, feature));
  if (sound("stone_wall") || sound("palisade")) return false;
  return true;
}

function keptWorks(state: WorldState): WorkRef[] {
  const out: WorkRef[] = [];
  for (const h of state.holdings) {
    for (const feature of h.features) {
      const kind = WORK_KIND[feature];
      if (kind) out.push({ holdingId: h.id, feature, kind });
    }
  }
  return out;
}

function villaName(state: WorldState, holdingId: string): string {
  return state.holdings.find((h) => h.id === holdingId)?.name ?? "the villa";
}

function workWord(feature: string): string {
  return WORK_WORD[feature] ?? feature.replaceAll("_", " ");
}

function listWorks(state: WorldState, works: WorkRef[]): string {
  if (!works.length) {
    const hall = state.holdings.some((h) => h.features.includes("manor_hall") || h.features.includes("stone_hall"));
    return hall ? "the hall's roof" : "the roofs";
  }
  if (works.length <= 3) return works.map((w) => `the ${workWord(w.feature)} at ${villaName(state, w.holdingId)}`).join("; ");
  const kinds = KIND_ORDER.filter((k) => works.some((w) => w.kind === k)).map((k) => {
    if (k === "fort") return "the walls";
    if (k === "mill") return "the mills";
    if (k === "granary") return "the barns";
    if (k === "bridge") return "the bridges";
    return "the markets";
  });
  return `${kinds.join(", ")} across the villas`;
}

function spoil(state: WorldState, crops: readonly GrainCrop[], share: number): number {
  let lost = 0;
  for (const id of crops) {
    const have = state.resources[id];
    const cut = round1(have * share);
    if (cut <= 0) continue;
    const take = Math.min(have, cut);
    state.resources[id] = round1(have - take);
    lost = round1(lost + take);
  }
  return lost;
}

function markWorn(state: WorldState, works: WorkRef[]): void {
  const worn = state.history.upkeep.worn;
  for (const w of works) {
    if (worn.some((x) => x.holdingId === w.holdingId && x.feature === w.feature)) continue;
    worn.push({ holdingId: w.holdingId, feature: w.feature, stage: 1 });
  }
}

/** Grain lost while a mill grinds coarse, and stores spoiled while a granary is damp. */
function activeDamage(state: WorldState): { mill: number; granary: number } {
  const worn = state.history.upkeep.worn;
  const mill = worn.some((w) => FLOUR_MILLS.has(w.feature)) ? spoil(state, ["wheat", "rye"], MILL_WASTE) : 0;
  const granary = worn.some((w) => WORK_KIND[w.feature] === "granary") ? spoil(state, GRAIN_CROPS, GRANARY_SPOIL) : 0;
  return { mill, granary };
}

function collapseOne(state: WorldState, at: SeasonAt): string | null {
  const worn = state.history.upkeep.worn;
  const next = KIND_ORDER.map((k) => worn.find((w) => WORK_KIND[w.feature] === k)).find(Boolean);
  if (!next) return null;
  const holding = state.holdings.find((h) => h.id === next.holdingId);
  if (holding) holding.features = holding.features.filter((f) => f !== next.feature);
  state.history.upkeep.worn = worn.filter((w) => !(w.holdingId === next.holdingId && w.feature === next.feature));
  const word = workWord(next.feature);
  const villa = villaName(state, next.holdingId);
  let extra = "";
  if (WORK_KIND[next.feature] === "granary") {
    const lost = spoil(state, GRAIN_CROPS, COLLAPSE_SPOIL);
    if (lost > 0) extra = ` ${lost} modii went with the roof.`;
  }
  state.history.record.push({
    year: at.year,
    season: at.season,
    text: `The ${word} at ${villa} failed for want of keeping.`,
    thread: "upkeep",
  });
  return `My lord, the ${word} at ${villa} has come down. We had let the keeping of it go, and this season finished what the tenants' days were not there to prevent.${extra}`;
}

function loyaltyDrift(lean: number): number {
  return Math.round(lean / 5);
}

/**
 * Set how lean the household is kept. Raising the cut thins gifts at once;
 * lowering it gives half of that warmth back. The seasonal want is the tick's.
 */
export function setHouseholdLean(state: WorldState, cut: number, turn: number): { ok: true; line: string } | { ok: false; line: string } {
  if (!Number.isInteger(cut) || cut < 0 || cut > LEAN_MAX) {
    return { ok: false, line: `The household can be trimmed by as many as ${LEAN_MAX} points of its share, and no further.` };
  }
  const u = state.history.upkeep;
  const prev = u.lean;
  if (prev === cut) {
    return {
      ok: true,
      line: cut === 0 ? "The household stays as a lord of this rank is expected to keep it." : "The household stays as lean as it was.",
    };
  }
  const delta = cut - prev;
  u.lean = cut;
  if (delta > 0) {
    moveVassalMood(state, -delta, "the lord keeps a leaner household, and the gifts have thinned", turn);
    applyPeopleHappinessDelta(state, -delta);
  } else {
    const back = Math.round(-delta / 2);
    if (back > 0) {
      moveVassalMood(state, back, "the lord's table is open again", turn);
      applyPeopleHappinessDelta(state, back);
    }
  }
  const word = POINT_WORD[cut] ?? String(cut);
  if (cut === 0) return { ok: true, line: "The household will be kept as a lord of this rank is expected to keep it: the open table, the gifts, and the full retinue." };
  return {
    ok: true,
    line: `The household will be kept ${word} ${cut === 1 ? "point" : "points"} leaner. Fewer retainers, a shorter table, fewer gifts. The sworn men and the people of the hall will feel the want of it.`,
  };
}

const FOOD_GOODS: CanonicalResource[] = ["wheat", "rye", "barley", "oats", "cheese", "honey", "wine"];
const STORE_GOODS: CanonicalResource[] = ["wool", "linen", "softwood", "hardwood", "charcoal"];
const MEAT: { id: CanonicalResource; keep: number }[] = [
  { id: "poultry", keep: 0 },
  { id: "pigs", keep: 1 },
  { id: "sheep", keep: 2 },
];

function unitPrice(state: WorldState, id: CanonicalResource): number {
  const min = state.market[id]?.min;
  return min && min > 0 ? min : 1;
}

function takeGood(
  state: WorldState,
  id: CanonicalResource,
  valueNeed: number,
  opts?: { whole?: boolean; keep?: number; cap?: number },
): number {
  if (valueNeed <= 0.05) return 0;
  const price = unitPrice(state, id);
  const have = state.resources[id] ?? 0;
  const keep = opts?.keep ?? 0;
  const available = opts?.whole ? Math.max(0, Math.floor(have - keep)) : Math.max(0, have - keep);
  if (available <= 0) return 0;
  const capped = opts?.cap != null ? Math.min(available, opts.cap) : available;
  const amount = opts?.whole
    ? Math.min(capped, Math.floor(valueNeed / price))
    : Math.min(capped, round1(valueNeed / price));
  if (amount <= 0) return 0;
  state.resources[id] = round1(have - amount);
  return round1(amount * price);
}

/** Draw the hall's keep from what the estate already has. Grain first; a breeding herd is left standing. */
function drawKind(state: WorldState, due: number): number {
  let left = due;
  const foodCap = round1(due * 0.8);
  let foodTaken = 0;
  for (const id of FOOD_GOODS) {
    if (foodTaken >= foodCap - 0.05) break;
    const got = takeGood(state, id, Math.min(left, round1(foodCap - foodTaken)));
    foodTaken = round1(foodTaken + got);
    left = round1(left - got);
  }
  for (const id of STORE_GOODS) {
    const got = takeGood(state, id, left, { cap: 2 });
    left = round1(left - got);
  }
  for (const id of FOOD_GOODS) {
    const got = takeGood(state, id, left);
    left = round1(left - got);
  }
  for (const meat of MEAT) {
    if (left < unitPrice(state, meat.id)) break;
    const got = takeGood(state, meat.id, left, { whole: true, keep: meat.keep, cap: 1 });
    left = round1(left - got);
    if (got > 0) break;
  }
  return round1(Math.max(0, due - left));
}

/** Reserve mending days from what this season has not already given to a work. Returns days covered. */
function reserveMaintenanceDays(state: WorldState, days: number): number {
  state.labour.assigned = state.labour.assigned.filter((a) => a.projectId !== MAINTENANCE_LABOUR_ID);
  if (days <= 0) return 0;
  const rem = labourRemaining(state);
  let left = days;
  const men = Math.min(rem.men, left);
  left -= men;
  const women = Math.min(rem.women, left);
  left -= women;
  const youths = left > 0 ? Math.min(rem.youths, Math.ceil(left / 0.4)) : 0;
  const covered = labourDaysFromAssignment("mixed", men, women, youths);
  if (men > 0 || women > 0 || youths > 0) {
    state.labour.assigned.push({ projectId: MAINTENANCE_LABOUR_ID, men, women, youths });
  }
  return round1(Math.min(days, covered));
}

/**
 * A short chest wears the bought things slowly. It does not bring a roof down.
 * The second season, a mill grinds coarse. From the third, the forge spends a pound it could not replace.
 */
function coinInconvenience(state: WorldState, seasonsShort: number, labourAlsoShort: boolean): string | null {
  if (seasonsShort < 2) return null;
  const bits: string[] = [];
  const mill = state.holdings.some((h) => h.features.some((f) => FLOUR_MILLS.has(f)));
  if (mill && !labourAlsoShort) {
    const lost = spoil(state, ["wheat", "rye"], MILL_WASTE / 2);
    if (lost > 0) bits.push(`the mill was patched with what we had and grinds coarse; ${lost} modii were lost in the stones`);
  } else if (mill) {
    bits.push("the mill cannot be repaired properly without what we buy");
  }
  const forge = state.holdings.some((h) => h.features.includes("forge"));
  if (forge && seasonsShort >= 3 && state.resources.iron >= 1) {
    state.resources.iron = round1(state.resources.iron - 1);
    bits.push("the forge used a pound of iron, and none was bought to replace it");
  } else if (forge && seasonsShort >= 2) {
    bits.push("the forge is short of what it does not make");
  }
  if (!bits.length) bits.push("tools will wear until the chest can buy what we do not make");
  return bits.join("; ");
}

/** What the estate page calls his income: the chest's small share, not the whole keep. */
export function incomeSentence(state: WorldState): string {
  const b = assessUpkeep(state);
  const u = state.history.upkeep;
  const yearCoin = b.coinSeason * 4;
  let text = `The household is kept from the stores and the tenants' days. The chest owes about ${yearCoin} d a year, near ${b.coinSeason} d a season, for iron, salt, and what the estate cannot make.`;
  if (u.lean > 0) text += " The household is kept leaner than the rank expects.";
  if (u.giving === "lean") text += " The giving is lean.";
  if (u.giving === "generous") text += " The giving is generous.";
  if (u.neglect > 0 || u.worn.length > 0) text += " Some of the works are being let go.";
  if (u.coinShort > 0) text += " The chest has been short of what must be bought.";
  return text;
}

/** Aldric's HISTORY line. The gross is here so he can say it if asked; the books do not show it. */
export function upkeepLine(state: WorldState): string {
  const b = assessUpkeep(state);
  const u = state.history.upkeep;
  const lean = u.lean ? `, already ${u.lean} ${u.lean === 1 ? "point" : "points"} leaner than the rank` : "";
  const behind =
    u.neglect > 0 || u.worn.length > 0
      ? ` The keeping of the works is behind${u.worn.length ? ` (${listWorks(state, u.worn.map((w) => ({ ...w, kind: WORK_KIND[w.feature] ?? "fort" })))})` : ""}. Speak of it if he asks, and do not pretend they are sound.`
      : "";
  return [
    `Receipts this year are about ${b.grossYear} d before the hall is kept. That figure is the yield of the land, not coin in the chest.`,
    `The household's keep is ${b.householdYear} d and the roofs, mills and walls are ${b.maintenanceYear} d${lean}.`,
    `Each season that quarter is paid in three ways: about ${b.kindSeason} d from the stores (grain, the table, cloth, and fuel), ${b.labourDays} days of the tenants' work on the roofs, and ${b.coinSeason} d from the chest for iron, salt, and what the estate cannot make.`,
    `A short chest is an inconvenience: the forge runs short, tools wear, a mill is mended poorly. Say it that way. It is not a crisis and it does not go unpaid as a household.`,
    `An empty granary is the crisis. Days already given to other work leave the roofs unkept, and the works then fail slowly.`,
    `The Viking tributes, when they come, are silver. Grain and labour do not pay them. Do not offer to.`,
    `If the lord asks what came in before the household and the roofs, say the larger figure in the speech of the hall, not as a list of shares.`,
    `The household cannot be skipped. A leaner hall, fewer retainers and fewer gifts, may come down by as many as ${LEAN_MAX} points of the household's share: propose household_upkeep {cut: 0-${LEAN_MAX}} for Confirm. The sworn men and the people of the hall feel the want of it, a little at once for each point and again each season if the cut is deep.`,
    `Routine giving is a standing, not a purse each time: propose giving_stance { level: lean | customary | generous }. Lean trims five percent off the household bill and the sworn men cool. Generous adds five percent of the year's receipts and they warm.`,
    behind,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Take the season's quarter. Stores first, then the tenants' days, then the chest's small share.
 * What the days do not cover, the works start to lose — after a season of warning.
 * A short chest does not do that. It leaves the bought things wanting.
 * `collapseRoll` in [0, 1) forces the later failure (tests); omitted, the season seeds it.
 */
export function tickUpkeep(state: WorldState, at: SeasonAt, turn: number, opts?: { collapseRoll?: number; covered?: boolean }): UpkeepTick {
  const out: UpkeepTick = { lines: [], beats: [] };
  if (state.history.dead) return out;
  const u = state.history.upkeep;
  if (u.paidTurn === turn) return out;
  u.paidTurn = turn;

  const bill = assessUpkeep(state);
  const drift = loyaltyDrift(u.lean);
  if (drift > 0) {
    moveVassalMood(state, -drift, "a lean household, and few gifts", turn);
    applyPeopleHappinessDelta(state, -drift);
    out.lines.push("The household is kept lean; the sworn men feel the want of gifts.");
  }

  const covered = opts?.covered === true;
  const coinPaid = covered ? bill.coinSeason : Math.min(state.resources.denarii, bill.coinSeason);
  if (!covered) state.resources.denarii = Math.round(state.resources.denarii - coinPaid);
  const kindPaid = covered || bill.kindSeason <= 0 ? bill.kindSeason : drawKind(state, bill.kindSeason);
  const daysPaid = covered || bill.labourDays <= 0 ? bill.labourDays : reserveMaintenanceDays(state, bill.labourDays);
  const labourValuePaid = Math.min(bill.labourSeason, Math.round(daysPaid * DAY_DENARII));
  // The household obligation is the stores. The works obligation is the days. Coin is recorded and is not either.
  const householdPaid = kindPaid;
  const maintenancePaid = labourValuePaid;
  u.last = {
    turn,
    grossYear: bill.grossYear,
    householdYear: bill.householdYear,
    maintenanceYear: bill.maintenanceYear,
    householdPaid,
    maintenancePaid,
    householdDue: bill.kindSeason,
    maintenanceDue: bill.labourSeason,
    coinDue: bill.coinSeason,
    coinPaid,
    netYear: bill.netYear,
  };
  if (bill.householdSeason === 0 && bill.maintenanceSeason === 0) return out;

  const householdShort = householdPaid + 0.05 < bill.kindSeason;
  const maintenanceShort = daysPaid + 0.05 < bill.labourDays;
  const coinShort = coinPaid + 0.05 < bill.coinSeason;
  const kindBit = householdShort
    ? `the stores covered ${householdPaid} d of ${bill.kindSeason} d of the hall's keep`
    : `the stores covered ${householdPaid} d of the hall's keep`;
  const daysBit = maintenanceShort
    ? `the tenants gave ${daysPaid} of ${bill.labourDays} days to the roofs`
    : `the tenants gave ${daysPaid} days to the roofs`;
  const coinBit = coinShort ? `the chest paid ${coinPaid} d of ${bill.coinSeason} d` : `the chest paid ${coinPaid} d`;
  out.lines.push(`The household took its keep from the stores: ${kindBit}; ${daysBit}; ${coinBit}.`);

  if (householdShort) {
    applyPeopleHappinessDelta(state, -2);
    out.beats.push({
      npcId: "steward",
      eventId: `upkeep:household:${turn}`,
      text: "My lord, the granary and the stores could not feed the hall in full. I set out what there was. The rest of the household went short, and I will not pretend that was a choice — their keep is not a thing we skip.",
    });
  }

  if (coinShort) {
    u.coinShort += 1;
    const wear = coinInconvenience(state, u.coinShort, maintenanceShort);
    out.beats.push({
      npcId: "steward",
      eventId: `upkeep:coin:${turn}`,
      text: wear
        ? `My lord, the chest could not buy what we do not make. ${wear.charAt(0).toUpperCase()}${wear.slice(1)}. The hall is fed from the stores. This is an inconvenience, not a crisis.`
        : "My lord, the chest could not buy what we do not make — iron, salt, a millstone, a specialist's tool. Those wait. The hall is fed from the stores. This is an inconvenience, not a crisis.",
    });
  } else {
    u.coinShort = 0;
  }

  if (!maintenanceShort) {
    u.neglect = 0;
    if (u.worn.length && coinShort) {
      u.mended = 0;
      return out;
    }
    if (u.worn.length) {
      u.mended += 1;
      if (u.mended >= MEND_SEASONS) {
        u.worn = [];
        u.mended = 0;
        out.beats.push({
          npcId: "steward",
          eventId: `upkeep:mended:${turn}`,
          text: "The works are sound again, my lord. The roofs are kept, and I have written them so.",
        });
      }
    } else {
      u.mended = 0;
    }
    return out;
  }

  u.mended = 0;
  u.neglect += 1;
  const targets = keptWorks(state);
  if (u.neglect === 1) {
    const subject = listWorks(state, targets);
    const singular = targets.length === 1 || (targets.length === 0 && !subject.endsWith("roofs"));
    out.beats.push({
      npcId: "steward",
      eventId: `upkeep:warn:${turn}`,
      text: `My lord, the household is fed — that I will not let slip — but the tenants' days were already spoken for. I am saying so before anything fails: ${subject} ${singular ? "wants" : "want"} looking at. Nothing is lost yet. If next season can spare the days, it stays a warning.`,
    });
    return out;
  }

  markWorn(state, targets);
  const damage = activeDamage(state);
  const losses: string[] = [];
  if (damage.mill > 0) losses.push(`the mill ground coarse, and ${damage.mill} modii were lost in the stones`);
  if (damage.granary > 0) losses.push(`the damp took ${damage.granary} modii from the stores`);
  const fort = u.worn.some((w) => WORK_KIND[w.feature] === "fort");
  if (fort) losses.push("a wooden wall will not stop a determined man until it is faced again; for a fight it is little more than a fence");
  const described = losses.length ? ` ${losses[0].charAt(0).toUpperCase()}${losses[0].slice(1)}${losses.slice(1).map((s) => `; ${s}`).join("")}.` : "";

  let collapsed: string | null = null;
  if (u.neglect >= COLLAPSE_FROM && u.worn.length) {
    const roll = opts?.collapseRoll ?? createRng(seedFromString(`upkeep:${state.holdings[0]?.id ?? "villa"}:${at.year}:${at.season}`)).float();
    if (roll < COLLAPSE_CHANCE) collapsed = collapseOne(state, at);
  }
  if (collapsed) {
    out.beats.push({ npcId: "steward", eventId: `upkeep:lost:${turn}`, text: collapsed });
  } else if (u.neglect === 2) {
    out.beats.push({
      npcId: "steward",
      eventId: `upkeep:wear:${turn}`,
      text: `It has gone past a warning, my lord.${described} I would rather tell you now than after a wall comes down.`,
    });
  } else {
    out.beats.push({
      npcId: "steward",
      eventId: `upkeep:still:${turn}`,
      text: `The works are still going unkept, my lord.${described} Another season of this and something will come down.`,
    });
  }
  return out;
}
