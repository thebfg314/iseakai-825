import { createRng, seedFromString } from "../combat/rng";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import type { WorldState } from "../engine/schema";
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
 * A lord's receipts are not his to spend. The household (retainers, horses, the table,
 * clothing, the gifts expected of his rank) and the keeping of halls, walls, mills,
 * bridges and granaries come off first, a quarter of the year's figure each season.
 * The books show what is left. The gross is Aldric's to say, in the speech of the hall,
 * if the lord asks.
 *
 * The shares below are of a typical year's receipts at that rank. Keeping the works
 * then scales with what actually stands: fewer roofs than the rank's usual grant costs
 * less, and mills, walls, markets and fortifications the lord has added cost more.
 * The household cannot be skipped. He may keep it leaner by as many as ten points of
 * that share; the sworn men and the people of the hall feel the want of gifts.
 *
 * If the chest cannot cover the works, they fail slowly. The first short season is
 * only a warning. The next, a wooden wall fights as a fence, a mill grinds coarse,
 * a granary lets in the damp. A later season can bring one of them down.
 */

/** Share of gross receipts the household takes, by rank (minor noble through king). */
export const HOUSEHOLD_RATE = [0.25, 0.35, 0.45, 0.55, 0.6] as const;
/** Share the works take at a typical set of roofs for that rank. */
export const MAINTENANCE_RATE = [0.05, 0.06, 0.08, 0.1, 0.12] as const;
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
  return {
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
  };
}

/** What this year costs, and what it leaves, at the receipts and the roofs as they stand. */
export function assessUpkeep(state: WorldState): UpkeepBill {
  const land = state.history.land.yearlyIncome ?? 0;
  const office = seasonRevenue(state).net * 4;
  const lean = state.history.upkeep?.lean ?? 0;
  return applyGiving(billFor(land + office, rankOf(state), structureScale(state), lean), givingLevel(state));
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
  return `My lord, the ${word} at ${villa} has come down. We had let the keeping of it go, and this season finished what the carpenters were not paid to prevent.${extra}`;
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

/** What the estate page calls his income: what a year leaves, not what it brings in. */
export function incomeSentence(state: WorldState): string {
  const b = assessUpkeep(state);
  const u = state.history.upkeep;
  let text = `About ${b.netYear} d a year is free to spend, near ${b.netSeason} d a season, once the household is kept and the roofs are mended.`;
  if (u.lean > 0) text += " The household is kept leaner than the rank expects.";
  if (u.giving === "lean") text += " The giving is lean.";
  if (u.giving === "generous") text += " The giving is generous.";
  if (u.neglect > 0 || u.worn.length > 0) text += " Some of the works are being let go.";
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
    `Receipts this year are about ${b.grossYear} d before the hall is kept.`,
    `The household takes ${b.householdYear} d — retainers, horses, the table, clothing, and the gifts a lord is expected to give${lean} — and the roofs, mills and walls take ${b.maintenanceYear} d.`,
    `About ${b.netYear} d is free, near ${b.netSeason} d a season. The books show only what is free.`,
    `If the lord asks what came in before the household and the roofs, say that larger figure in the speech of the hall, not as a list of shares.`,
    `The household cannot be skipped. A leaner hall, fewer retainers and fewer gifts, may come down by as many as ${LEAN_MAX} points of the household's share: propose household_upkeep {cut: 0-${LEAN_MAX}} for Confirm. The sworn men and the people of the hall feel the want of it, a little at once for each point and again each season if the cut is deep.`,
    `Routine giving is a standing, not a purse each time: propose giving_stance { level: lean | customary | generous }. Lean trims five percent off the household bill and the sworn men cool. Generous adds five percent of the year's receipts and they warm.`,
    behind,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Take the season's quarter. The household is paid first and cannot be waived.
 * What the works do not get, they start to lose — after a season of warning.
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

  const pay = (due: number) => {
    if (opts?.covered) return due;
    const paid = Math.min(state.resources.denarii, due);
    state.resources.denarii = Math.round(state.resources.denarii - paid);
    return paid;
  };
  const householdPaid = pay(bill.householdSeason);
  const maintenancePaid = pay(bill.maintenanceSeason);
  u.last = {
    turn,
    grossYear: bill.grossYear,
    householdYear: bill.householdYear,
    maintenanceYear: bill.maintenanceYear,
    householdPaid,
    maintenancePaid,
    householdDue: bill.householdSeason,
    maintenanceDue: bill.maintenanceSeason,
    netYear: bill.netYear,
  };
  if (bill.householdSeason === 0 && bill.maintenanceSeason === 0) return out;

  const householdShort = householdPaid < bill.householdSeason;
  const maintenanceShort = maintenancePaid < bill.maintenanceSeason;
  const householdBit = householdShort ? `The household took ${householdPaid} d of ${bill.householdSeason} d owed` : `The household took ${householdPaid} d`;
  const worksBit = maintenanceShort ? `the roofs and works ${maintenancePaid} d of ${bill.maintenanceSeason} d owed` : `the roofs and works ${maintenancePaid} d`;
  out.lines.push(`${householdBit}; ${worksBit}.`);

  if (householdShort) {
    applyPeopleHappinessDelta(state, -2);
    out.beats.push({
      npcId: "steward",
      eventId: `upkeep:household:${turn}`,
      text: "My lord, the chest could not meet the household in full. I paid what was there. The rest of the hall went short, and I will not pretend that was a choice — their keep is not a thing we skip.",
    });
  }

  if (!maintenanceShort) {
    u.neglect = 0;
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
      text: `My lord, the household is fed — that I will not let slip — but the keeping of the works was short. I am saying so before anything fails: ${subject} ${singular ? "wants" : "want"} looking at. Nothing is lost yet. If the chest can spare the carpenters next season, it stays a warning.`,
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
