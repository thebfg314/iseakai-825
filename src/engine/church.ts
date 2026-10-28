import type { ApplyResult, MechanicalProposal, Season, WorldState } from "./schema";
import { consumeGrain, GRAIN_CROPS, grainOnHand, type GrainCrop } from "./grain";
import { appendNpcMemory, stampMemory } from "./memory";
import { applyPeopleHappinessDelta } from "./peopleHappiness";
import { newId, round1 } from "./util";

/**
 * Cell of Saint-Martin: sponsored feasts, neglect, modest surplus, hunger alms.
 *
 * People's happiness is 0–100. A sponsored feast may not push it above
 * {@link FEAST_HAPPINESS_CAP}. Other joys and troubles still use the full scale.
 *
 * TODO: requiem / funeral masses to soften happiness loss when levies die after a muster or war.
 * Not part of this church pack — leave the war hit as it stands until battles exist.
 */

export const FEAST_HAPPINESS_CAP = 80;
export const FEAST_PLAIN_BONUS = 4;
export const FEAST_GRAND_BONUS = 8;
export const FEAST_PLAIN_DENARII = 12;
export const FEAST_GRAND_DENARII = 30;
export const FEAST_BEESWAX_LB = 1;
export const FEAST_WINE_BARRELS = 1;
export const FEAST_MEAL_GRAIN = 2;
export const FEAST_MEAL_CHEESE = 2;

export const NEGLECT_DIP = -2;
export const BISHOP_LETTER_DIP = -5;
/** Slips older than this many seasons fall away. Three inside the window bring the bishop's letter. */
export const NEGLECT_WINDOW_SEASONS = 4;
export const NEGLECT_LETTER_AT = 3;

export const CELL_ALMS_MODEST = 3;
export const CELL_ALMS_SMALL = 1;
/** Seasons the cell will refuse another gift after opening the barn. */
export const CELL_ALMS_COOLDOWN = 8;

export const BISHOP_REPUTATION =
  "The bishop of Autun has written to the count that the lord of Fontenay neglects the cell of Saint-Martin.";

export const BISHOP_LETTER_TEXT =
  "A letter from the bishop of Autun to the count: the lord of Fontenay has neglected the cell of Saint-Martin — tithe, Sunday, or the goods of the house. The bishop asks the count to take notice of this lord's conduct.";

export type FeastTier = "plain" | "grand";
export type NeglectKind = "tithe" | "wool" | "sheep" | "sunday" | "feast_day" | "took_from_cell";

type SurplusGood = {
  id: string;
  name: string;
  max: number;
  minPrice: number;
  maxPrice: number;
  fair: number;
  singular: string;
  plural: string;
  canonical?: boolean;
};

/** Modest cell garden and oratory stores. Not a market cart. */
export const CELL_SURPLUS: readonly SurplusGood[] = [
  { id: "beans", name: "beans", max: 2, minPrice: 2, maxPrice: 4, fair: 3, singular: "modius", plural: "modii" },
  { id: "peas", name: "peas", max: 2, minPrice: 2, maxPrice: 4, fair: 3, singular: "modius", plural: "modii" },
  { id: "beeswax", name: "beeswax", max: 1, minPrice: 3, maxPrice: 8, fair: 5, singular: "pound", plural: "pounds", canonical: true },
  { id: "candles", name: "candles", max: 1, minPrice: 4, maxPrice: 9, fair: 6, singular: "pound", plural: "pounds" },
  { id: "herbs", name: "herbs", max: 1, minPrice: 2, maxPrice: 5, fair: 3, singular: "bundle", plural: "bundles" },
];

const SURPLUS_BY_ID = new Map(CELL_SURPLUS.map((g) => [g.id, g]));

export function suggestedFeastName(season: Season): string {
  switch (season) {
    case "spring":
      return "the Rogation Days";
    case "summer":
      return "St John's Day";
    case "autumn":
      return "Martinmas";
    case "winter":
      return "Christmas";
  }
}

export function feastSeasonKey(state: WorldState): string {
  return `${state.meta.year}-${state.meta.season}`;
}

/** How much of a feast's joy may land without crossing the feast ceiling. Already full: nothing, and never a loss. */
export function feastHappinessGrant(current: number, nominal: number): number {
  const heart = Math.round(current);
  if (heart >= FEAST_HAPPINESS_CAP) return 0;
  return Math.max(0, Math.min(nominal, FEAST_HAPPINESS_CAP - heart));
}

/** Half the joy that was actually given fades next season; the other half stays. Odd points stay with the people. */
export function feastFadeShare(applied: number): number {
  if (applied <= 0) return 0;
  return Math.floor(applied / 2);
}

export function isCellSurplusId(id: string): boolean {
  return SURPLUS_BY_ID.has(id);
}

function hasChurchHouse(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.includes("chapel") || h.features.includes("monastery"));
}

function hasMonastery(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.includes("monastery"));
}

function activeOrderText(state: WorldState): string[] {
  return state.standing_orders.filter((o) => o.active).map((o) => o.text);
}

function sentenceWithholds(sentence: string, thing: RegExp): boolean {
  if (!thing.test(sentence)) return false;
  return /\b(do not|don't|do not|never|withhold|withholds|refuse|refuses|stop|hold back|keep back|no longer)\b/i.test(sentence);
}

function ordersWithhold(state: WorldState, thing: RegExp): boolean {
  for (const text of activeOrderText(state)) {
    for (const sentence of text.split(/[.]/)) {
      if (sentenceWithholds(sentence, thing)) return true;
    }
  }
  return false;
}

export function ordersWithholdGrainTithe(state: WorldState): boolean {
  return ordersWithhold(state, /\b(grain )?tithe\b/i);
}

export function ordersWithholdWool(state: WorldState): boolean {
  return ordersWithhold(state, /\bwool\b/i);
}

export function ordersWithholdSheep(state: WorldState): boolean {
  return ordersWithhold(state, /\bsheep\b/i);
}

/** Work ordered on Sunday. "Keep Sundays" is the duty, not an offence. */
export function standingOrderIsSundayWork(text: string): boolean {
  return /\b(sunday (?:labour|labor|work)|work on (?:the )?(?:sabbath|sunday))\b/i.test(text);
}

export function standingOrderIsFeastDayWork(text: string): boolean {
  return /\bwork on (?:the )?(?:feast days?|holy days?)\b/i.test(text);
}

export function looksLikeTakingFromCell(text: string): boolean {
  const place = /\b(cell|chapel|monks|monk's|oratory|saint-martin|saint martin)\b/i.test(text);
  if (!place) return false;
  return /\b(take|taken|taking|seize|seized|seizing|confiscat|strip(?:ped)?|rob(?:bed)?|stole|stolen)\b/i.test(text);
}

export function looksLikeSponsoredFeastOrder(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(how|what|why|who|where|when|tell me|report)\b/i.test(t) && !/\b(make|hold|sponsor|keep|give)\b/i.test(t)) {
    return false;
  }
  return (
    /\b(sponsor|special|solemn|grand|plain)\b.{0,48}\b(feast|holy day|mass)\b/i.test(t) ||
    /\b(make|hold|keep|give)\b.{0,48}\b(easter|rogation|martinmas|christmas|st\.? john'?s?|saint john'?s?|holy day)\b/i.test(t) ||
    /\b(procession|sung mass|church play)\b/i.test(t) ||
    /\bfeast\b.{0,40}\b(cell|chapel|saint-martin|saint martin)\b/i.test(t)
  );
}

function feastTierFromSpeech(text: string): FeastTier {
  return /\b(grand|great|splendid)\b/i.test(text) ? "grand" : "plain";
}

export function inferSponsoredFeast(text: string): Extract<MechanicalProposal, { type: "sponsor_feast" }> {
  const tier = feastTierFromSpeech(text);
  const named = text.match(/\b(easter|rogation days|the rogation days|st\.? john'?s? day|saint john'?s? day|martinmas|christmas)\b/i);
  return {
    type: "sponsor_feast",
    tier,
    feastName: named?.[0],
    summary: tier === "grand" ? "A grand feast at the cell." : "A plain feast at the cell.",
  };
}

function hallFeastName(state: WorldState, proposed?: string): string {
  const named = proposed?.trim();
  if (named && named.length <= 48 && !/[{}[\]"]/.test(named) && !/\b(json|modifier|buff|tier)\b/i.test(named)) {
    return named;
  }
  return suggestedFeastName(state.meta.season);
}

function heartLine(grant: number, nominal: number): string {
  if (grant <= 0) return "The people's hearts were already full; the feast does not lift them further.";
  if (grant < nominal) return "The people take heart, though they were already near as glad as a feast can make them.";
  return "The people take heart.";
}

function payFeast(state: WorldState, tier: FeastTier): { ok: true; paid: string } | { ok: false; reason: string } {
  const denarii = tier === "plain" ? FEAST_PLAIN_DENARII : FEAST_GRAND_DENARII;
  const missing: string[] = [];
  if (state.resources.denarii < denarii) missing.push(`the chest has not ${denarii} denarii`);
  if (state.resources.beeswax < FEAST_BEESWAX_LB) missing.push("there is no beeswax for the candles");
  let meal: "grain" | "cheese" | null = null;
  if (tier === "grand") {
    if (state.resources.wine < FEAST_WINE_BARRELS) missing.push("there is no wine for the feast");
    if (grainOnHand(state) >= FEAST_MEAL_GRAIN) meal = "grain";
    else if (state.resources.cheese >= FEAST_MEAL_CHEESE) meal = "cheese";
    else missing.push("there is neither grain nor cheese enough for the households' meal");
  }
  if (missing.length) {
    const first = missing[0].charAt(0).toUpperCase() + missing[0].slice(1);
    const rest = missing.slice(1);
    return { ok: false, reason: rest.length ? `${first}, and ${rest.join(", and ")}.` : `${first}.` };
  }

  state.resources.denarii = round1(state.resources.denarii - denarii);
  state.resources.beeswax = round1(state.resources.beeswax - FEAST_BEESWAX_LB);
  const bits = [`${denarii} denarii`, "a pound of beeswax"];
  if (tier === "grand") {
    state.resources.wine = round1(state.resources.wine - FEAST_WINE_BARRELS);
    bits.push("a barrel of wine");
    if (meal === "grain") bits.push(`${drawMealGrain(state)} for the households' meal`);
    else {
      state.resources.cheese = round1(state.resources.cheese - FEAST_MEAL_CHEESE);
      bits.push(`${FEAST_MEAL_CHEESE} pounds of cheese for the households' meal`);
    }
  }
  return { ok: true, paid: joinAnd(bits) };
}

function joinAnd(bits: string[]): string {
  if (bits.length <= 1) return bits[0] ?? "";
  if (bits.length === 2) return `${bits[0]} and ${bits[1]}`;
  return `${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}`;
}

function drawMealGrain(state: WorldState): string {
  let left = FEAST_MEAL_GRAIN;
  const parts: string[] = [];
  for (const crop of GRAIN_CROPS) {
    if (left <= 0) break;
    const use = Math.min(state.resources[crop], left);
    if (use <= 0) continue;
    state.resources[crop] = round1(state.resources[crop] - use);
    left = round1(left - use);
    const unit = use === 1 ? "modius" : "modii";
    parts.push(`${use} ${unit} of ${crop}`);
  }
  return parts.join(" and ");
}

export function applySponsoredFeast(
  state: WorldState,
  proposal: Extract<MechanicalProposal, { type: "sponsor_feast" }>,
): ApplyResult {
  if (!hasChurchHouse(state)) {
    return { ok: false, reason: "There is no cell or oratory here to keep the feast.", logLine: proposal.summary, state };
  }
  if (state.church.feastHeldKey === feastSeasonKey(state)) {
    return {
      ok: false,
      reason: "The cell has already kept a feast this season.",
      logLine: proposal.summary,
      state,
    };
  }
  const paid = payFeast(state, proposal.tier);
  if (!paid.ok) return { ok: false, reason: paid.reason, logLine: proposal.summary, state };

  const nominal = proposal.tier === "grand" ? FEAST_GRAND_BONUS : FEAST_PLAIN_BONUS;
  const current = state.peopleHappiness ?? 50;
  const grant = feastHappinessGrant(current, nominal);
  if (grant > 0) state.peopleHappiness = Math.round(current) + grant;
  state.church.feastFade = feastFadeShare(grant);
  state.church.feastHeldKey = feastSeasonKey(state);
  // The history layer counts feasts kept (flag `feast_sponsored`, engine-set).
  const kept = state.history.flags.feast_sponsored;
  state.history.flags.feast_sponsored = (typeof kept === "number" ? kept : 0) + 1;

  const name = hallFeastName(state, proposal.feastName);
  const scale = proposal.tier === "grand" ? "A grand feast" : "A plain feast";
  const logLine = `${scale} for ${name}: ${paid.paid}. ${heartLine(grant, nominal)}`;
  return { ok: true, logLine, state };
}

function neglectInWindow(state: WorldState) {
  const turn = state.meta.turn;
  return state.church.neglect.filter((s) => s.turn > turn - NEGLECT_WINDOW_SEASONS);
}

function letterAlreadyCoversWindow(state: WorldState): boolean {
  const sent = state.church.bishopLetterTurn;
  if (sent == null) return false;
  return sent > state.meta.turn - NEGLECT_WINDOW_SEASONS;
}

/**
 * One observable slip. Same kind does not count twice in the same season.
 * Three slips inside about a year bring the bishop's letter.
 */
export function recordChurchNeglect(state: WorldState, kind: NeglectKind, note: string): string[] {
  const turn = state.meta.turn;
  if (state.church.neglect.some((s) => s.turn === turn && s.kind === kind)) return [];

  state.church.neglect = neglectInWindow(state);
  state.church.neglect.push({
    turn,
    year: state.meta.year,
    season: state.meta.season,
    kind,
    note,
  });
  applyPeopleHappinessDelta(state, NEGLECT_DIP);
  appendNpcMemory(state, "chaplain", stampMemory(state, note));

  const lines = [note];
  if (neglectInWindow(state).length >= NEGLECT_LETTER_AT && !letterAlreadyCoversWindow(state)) {
    applyPeopleHappinessDelta(state, BISHOP_LETTER_DIP);
    state.church.bishopLetterTurn = turn;
    state.church.reputation = BISHOP_REPUTATION;
    state.church.letters.push({
      id: newId("letter"),
      year: state.meta.year,
      season: state.meta.season,
      turn,
      text: BISHOP_LETTER_TEXT,
    });
    appendNpcMemory(state, "chaplain", stampMemory(state, BISHOP_REPUTATION));
    lines.push(BISHOP_LETTER_TEXT);
  }
  return lines;
}

/** A season kept well: old slips age out, and one remaining slip is forgiven. */
export function closeChurchSeason(state: WorldState): void {
  const turn = state.meta.turn;
  state.church.neglect = state.church.neglect.filter((s) => s.turn > turn - NEGLECT_WINDOW_SEASONS);
  if (state.church.neglect.some((s) => s.turn === turn)) return;
  if (!state.church.neglect.length) return;
  const oldest = state.church.neglect.reduce((a, b) => (a.turn <= b.turn ? a : b));
  state.church.neglect = state.church.neglect.filter((s) => s !== oldest);
}

export function noteSundayOrFeastWork(state: WorldState, text: string): string[] {
  const lines: string[] = [];
  if (standingOrderIsSundayWork(text)) {
    lines.push(...recordChurchNeglect(state, "sunday", "Ermenald is displeased: work was ordered on Sunday."));
  }
  if (standingOrderIsFeastDayWork(text)) {
    lines.push(...recordChurchNeglect(state, "feast_day", "Ermenald is displeased: work was ordered on a feast day."));
  }
  return lines;
}

export function auditChurchLabourOrders(state: WorldState): string[] {
  const lines: string[] = [];
  for (const text of activeOrderText(state)) {
    lines.push(...noteSundayOrFeastWork(state, text));
  }
  return lines;
}

/** Grain tithe and the wool render. A withheld render is neglect only when the stores could pay. */
export function resolveChurchGrainAndWool(state: WorldState): string[] {
  if (!hasChurchHouse(state)) return [];
  const lines: string[] = [];
  const house = hasMonastery(state) ? "cell" : "oratory";
  const owed = round1(state.population.households * 0.15);
  if (ordersWithholdGrainTithe(state)) {
    if (owed > 0 && grainOnHand(state) + 1e-6 >= owed) {
      lines.push(
        ...recordChurchNeglect(
          state,
          "tithe",
          `The grain tithe was not rendered to the ${house}, though the stores could bear it. Ermenald is displeased.`,
        ),
      );
    } else {
      lines.push(`The grain tithe was not rendered to the ${house}; the stores were too thin.`);
    }
  } else if (owed > 0) {
    lines.push(consumeGrain(state, owed, `Tithe to the ${house}`));
  }

  if (ordersWithholdWool(state)) {
    if (state.resources.wool >= 1) {
      lines.push(
        ...recordChurchNeglect(
          state,
          "wool",
          `The pound of wool was not rendered to the ${house}, though wool was on hand. Ermenald is displeased.`,
        ),
      );
    }
  } else if (state.resources.wool >= 1) {
    state.resources.wool = round1(state.resources.wool - 1);
    lines.push(`Tithe: 1 lb wool to the ${house}.`);
  }
  return lines;
}

/** Autumn sheep, after the herd increase. Skip quietly when the flock cannot spare one. */
export function resolveChurchSheep(state: WorldState): string[] {
  if (state.meta.season !== "autumn") return [];
  if (!hasMonastery(state)) return [];
  if (ordersWithholdSheep(state)) {
    if (state.resources.sheep >= 1) {
      return recordChurchNeglect(
        state,
        "sheep",
        "The year's sheep was kept back from the cell, though the flock could spare it. Ermenald is displeased.",
      );
    }
    return [];
  }
  if (state.resources.sheep >= 1) {
    state.resources.sheep -= 1;
    return ["Tithe: 1 sheep to the cell (the year's increase)."];
  }
  return [];
}

export function noteTakingFromCell(state: WorldState, text: string): string[] {
  if (!looksLikeTakingFromCell(text)) return [];
  return recordChurchNeglect(state, "took_from_cell", "Goods were taken from the cell of Saint-Martin. Ermenald is displeased.");
}

function isGrainId(id: string): id is GrainCrop {
  return (GRAIN_CROPS as readonly string[]).includes(id);
}

export function isCellAlmsProposal(p: Extract<MechanicalProposal, { type: "transfer_resources" }>): boolean {
  if (p.direction !== "gain") return false;
  return (GRAIN_CROPS as readonly string[]).includes(p.resource);
}

export function applyCellAlms(
  state: WorldState,
  proposal: Extract<MechanicalProposal, { type: "transfer_resources" }>,
): ApplyResult {
  if (!state.flags.hunger) {
    return {
      ok: false,
      reason: "The households are not hungry. The cell will not open its barn.",
      logLine: proposal.summary,
      state,
    };
  }
  if (state.flags.regional_famine) {
    return {
      ok: false,
      reason: "The dearth is across the pagus. The cell can spare nothing.",
      logLine: proposal.summary,
      state,
    };
  }
  const since = state.church.almsTurn == null ? null : state.meta.turn - state.church.almsTurn;
  if (since != null && since < CELL_ALMS_COOLDOWN) {
    return {
      ok: false,
      reason: "The cell opened its barn for you once. It will not do so again for a long while.",
      logLine: proposal.summary,
      state,
    };
  }
  const amount = state.church.almsTurn == null ? CELL_ALMS_MODEST : CELL_ALMS_SMALL;
  const crop: GrainCrop = isGrainId(proposal.resource) ? proposal.resource : "rye";
  state.resources[crop] = round1(state.resources[crop] + amount);
  state.church.almsTurn = state.meta.turn;
  const grudge = amount < CELL_ALMS_MODEST ? "a smaller measure than before" : "not gladly";
  const logLine = `Ermenald opens the cell's barn, ${grudge}: ${amount} ${amount === 1 ? "modius" : "modii"} of ${crop} for the hungry. He will remember this.`;
  appendNpcMemory(state, "chaplain", stampMemory(state, logLine));
  return { ok: true, logLine, state };
}

function qtyPhrase(amount: number, singular: string, plural: string): string {
  const n = Number.isInteger(amount) ? String(amount) : round1(amount).toFixed(1);
  return `${n} ${amount === 1 ? singular : plural}`;
}

export function applyCellSurplusSale(
  state: WorldState,
  proposal: Extract<MechanicalProposal, { type: "transfer_resources" }>,
): ApplyResult {
  const good = SURPLUS_BY_ID.get(proposal.resource);
  if (!good || proposal.direction !== "gain") {
    return { ok: false, reason: "The cell does not sell that.", logLine: proposal.summary, state };
  }
  const amount = Math.abs(proposal.amount);
  if (!(amount > 0)) {
    return { ok: false, reason: "Name how much the cell should sell.", logLine: proposal.summary, state };
  }
  const key = feastSeasonKey(state);
  if (state.church.surplusSeasonKey !== key) {
    state.church.surplusSeasonKey = key;
    state.church.surplusSold = {};
  }
  const already = state.church.surplusSold[good.id] ?? 0;
  if (amount > good.max || already + amount > good.max + 1e-6) {
    return {
      ok: false,
      reason: `The cell has only a little ${good.name} to spare this season, not a bulk sale.`,
      logLine: proposal.summary,
      state,
    };
  }
  const price = proposal.pricePerUnit == null ? good.fair : proposal.pricePerUnit;
  if (price < good.minPrice || price > good.maxPrice) {
    return {
      ok: false,
      reason: `That is not a fair price for the cell's ${good.name}.`,
      logLine: proposal.summary,
      state,
    };
  }
  const cost = round1(amount * price);
  if (state.resources.denarii < cost) {
    return {
      ok: false,
      reason: `The chest has not ${cost} denarii for the cell's ${good.name}.`,
      logLine: proposal.summary,
      state,
    };
  }
  state.resources.denarii = round1(state.resources.denarii - cost);
  if (good.canonical) {
    state.resources.beeswax = round1(state.resources.beeswax + amount);
  } else {
    const existing = state.custom_resources.find((c) => c.id === good.id);
    if (existing) existing.amount = round1(existing.amount + amount);
    else {
      state.custom_resources.push({
        id: good.id,
        name: good.name,
        unit: good.plural,
        amount,
        priceMin: good.minPrice,
        priceMax: good.maxPrice,
        notes: "A little surplus from the cell of Saint-Martin.",
        tags: ["church", "cell"],
      });
    }
    state.market[good.id] = { min: good.minPrice, max: good.maxPrice };
  }
  state.church.surplusSold[good.id] = round1(already + amount);
  const logLine = `The cell sells ${qtyPhrase(amount, good.singular, good.plural)} of ${good.name} for ${cost} denarii.`;
  return { ok: true, logLine, state };
}

/** Facts Ermenald should speak when they matter. Hall language only. */
export function churchCounselBlock(state: WorldState): string {
  const lines: string[] = [];
  if (state.church.reputation) lines.push(state.church.reputation);
  for (const slip of neglectInWindow(state)) lines.push(slip.note);
  if (state.church.almsTurn != null && state.meta.turn - state.church.almsTurn < CELL_ALMS_COOLDOWN) {
    lines.push(
      "You already opened the cell's barn once for this lord's hungry households. You remember it, and you will not do it again for a long while.",
    );
  }
  if (state.flags.regional_famine) {
    lines.push("The dearth is across the pagus. The cell can spare little or nothing from its barn.");
  }
  if (state.church.feastHeldKey === feastSeasonKey(state)) {
    lines.push("A feast has already been kept at the cell this season. Refuse another until the season turns.");
  }
  if (!lines.length) return "";
  return `\nWhat you know of this lord and the cell (say it in your own voice if it matters; never mention a list, a meter, or the books' machinery):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
