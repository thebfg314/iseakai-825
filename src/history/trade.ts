import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import type { SeasonAt } from "./scheduler";

/**
 * Trade health (rank design 'Trade health'; 03_HISTORY §11.8a). One hidden number
 * for the home region, 0–100, Autun starting at 55. The player never sees it: he
 * sees merchants come or not, what his surplus fetches, what the tolls bring in,
 * and what Gerulf and Aldric say about the roads.
 *
 * Three layers make the number each season:
 *  - `baseline`: the region's resting level, moved for good by abbeys and mints;
 *  - `base`: the slow number — knocked by raids, war, banditry, a lost border — which
 *    drifts back toward baseline + the lord's improvements at +3 a year (+5 in full peace);
 *  - passing conditions and shocks: Viking danger, famine, a hard winter, a levy,
 *    which lift when they lift.
 * `health` is the sum, and is what revenue.ts, the merchant roll and the prices read.
 */

export const TRADE_BASELINE = 55;
const RECOVERY_PER_SEASON = 0.75; // +3 a year
const PEACE_RECOVERY_PER_SEASON = 1.25; // +5 a year when nothing is wrong

/** Trade goods whose bands move with the roads (grain is the famine table's; prices.ts). */
export const TRADE_GOODS = ["wine", "wool", "hides", "honey", "linen", "cheese", "trade_goods", "beeswax"] as const;

const WATCH_FEATURES = ["watch_post", "tower", "gatehouse", "stone_wall"];
const DRAW_FEATURES = ["mill_flour", "mill_fulling", "mill_forge", "forge", "bloomery", "tannery", "textile_workshop", "bakehouse", "pottery_kiln"];
const MAX_DRAWS = 4;

export type TradeImprovement = { what: string; bonus: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function tradeState(state: WorldState) {
  return state.history.trade;
}

/** What the roads carry this season (the hidden number). 55 when the history block is missing. */
export function tradeHealth(state: WorldState): number {
  return state.history?.trade?.health ?? TRADE_BASELINE;
}

/** Works that have started to fail no longer draw the roads or keep a watch. */
function allFeatures(state: WorldState): string[] {
  const worn = new Set((state.history?.upkeep?.worn ?? []).filter((w) => w.stage >= 1).map((w) => `${w.holdingId}:${w.feature}`));
  return state.holdings.flatMap((h) => h.features.filter((f) => !worn.has(`${h.id}:${f}`)));
}

/** The lord's own works that draw trade, from the features standing on his villas (cumulative, mostly permanent). */
export function tradeImprovements(state: WorldState): TradeImprovement[] {
  const features = allFeatures(state);
  const has = (f: string) => features.includes(f);
  const out: TradeImprovement[] = [];
  if (has("improved_road")) out.push({ what: "the road kept up", bonus: 3 });
  if (has("bridge")) out.push({ what: "the bridge", bonus: 5 });
  if (has("landing_stage")) out.push({ what: "the landing stage", bonus: 3 });
  if (WATCH_FEATURES.some(has)) out.push({ what: "a watch kept on the road", bonus: 5 });
  if (has("market")) out.push({ what: "the market", bonus: 10 });
  if (has("fair")) out.push({ what: "the yearly fair", bonus: 8 });
  const draws = features.filter((f) => DRAW_FEATURES.includes(f)).length;
  if (draws) out.push({ what: draws === 1 ? "a mill or forge people come to" : "mills and workshops people come to", bonus: 3 * Math.min(MAX_DRAWS, draws) });
  if (has("stables") || has("guesthouse")) out.push({ what: "lodging for travellers", bonus: 2 });
  const vines = state.holdings.reduce((n, h) => n + (h.land.vineyard ?? 0), 0);
  if (vines >= 30) out.push({ what: "wine worth the journey", bonus: 6 });
  else if (vines >= 12) out.push({ what: "wine worth the journey", bonus: 4 });
  else if (vines >= 4) out.push({ what: "a little wine to sell", bonus: 2 });
  if (state.player.rankLevel >= 3) {
    const stance = tradeState(state).tollStance;
    if (stance === "low") out.push({ what: "tolls kept low", bonus: 5 });
    if (stance === "greedy") out.push({ what: "greedy tolls", bonus: -10 });
  }
  return out;
}

/** Where the slow number rests when nothing knocks it. */
export function tradeTarget(state: WorldState): number {
  const t = tradeState(state);
  const bonus = tradeImprovements(state).reduce((n, i) => n + i.bonus, 0);
  return clamp(t.baseline + bonus, 0, 100);
}

/** Passing conditions for the incoming season, not written into the slow number. */
export function tradeConditions(state: WorldState): { what: string; amount: number }[] {
  const out: { what: string; amount: number }[] = [];
  const danger = state.history.vikings.danger;
  if (danger === "high") out.push({ what: "the Northmen on the rivers", amount: -30 });
  else if (danger === "moderate") out.push({ what: "Northmen about in the country", amount: -15 });
  else if (danger === "low") out.push({ what: "Northmen on the Seine and the Loire", amount: -5 });
  const severity = state.history.prices.severity;
  if (severity === "famine" || severity === "severe") out.push({ what: "the famine", amount: -15 });
  else if (severity === "shortage") out.push({ what: "the dearth", amount: -7 });
  return out;
}

/** Recompute `health` from the layers; call after any knock. */
export function recomputeTradeHealth(state: WorldState, turn: number): number {
  const t = tradeState(state);
  t.shocks = t.shocks.filter((s) => s.untilTurn >= turn);
  const shocks = t.shocks.reduce((n, s) => n + s.amount, 0);
  const conditions = tradeConditions(state).reduce((n, c) => n + c.amount, 0);
  t.health = clamp(Math.round((t.base + shocks + conditions) * 100) / 100, 0, 100);
  return t.health;
}

/** Knock (or lift) the slow number; it recovers toward the target over the years. */
export function shiftTrade(state: WorldState, amount: number, reason: string, turn: number): void {
  const t = tradeState(state);
  t.base = clamp(t.base + amount, 0, 100);
  if (amount < 0) t.lastCause = reason;
  recomputeTradeHealth(state, turn);
}

/** A passing shock for `seasons` seasons from `turn` (a hard winter: 1; a levy: 4). */
export function shockTrade(state: WorldState, amount: number, reason: string, turn: number, seasons: number): void {
  const t = tradeState(state);
  t.shocks.push({ reason, amount, untilTurn: turn + seasons - 1 });
  if (amount < 0) t.lastCause = reason;
  recomputeTradeHealth(state, turn);
}

/** Move the regional baseline for good (an abbey founded, a mint opened, a border drawn). */
export function shiftTradeBaseline(state: WorldState, amount: number, reason: string, turn: number): void {
  const t = tradeState(state);
  t.baseline = clamp(t.baseline + amount, 0, 100);
  if (amount < 0) t.lastCause = reason;
  recomputeTradeHealth(state, turn);
}

/** Apply a `trade` effect from the data (effects.ts). */
export function applyTradeEffect(state: WorldState, fx: { shift?: number; seasons?: number; baseline?: number; reason: string }, turn: number): string | null {
  if (fx.baseline) shiftTradeBaseline(state, fx.baseline, fx.reason, turn);
  if (fx.shift && fx.seasons) shockTrade(state, fx.shift, fx.reason, turn, fx.seasons);
  else if (fx.shift) shiftTrade(state, fx.shift, fx.reason, turn);
  const total = (fx.baseline ?? 0) + (fx.shift ?? 0);
  if (!total) return null;
  return total < 0 ? `Trade on the roads suffers: ${fx.reason}.` : `Trade on the roads picks up: ${fx.reason}.`;
}

/** The merchant's reading of the roads, in his words. */
export function tradeWord(health: number): string {
  if (health >= 75) return "busy";
  if (health >= 60) return "fair";
  if (health >= 45) return "steady";
  if (health >= 30) return "thin";
  if (health >= 15) return "very thin";
  return "empty";
}

/** Multiplier on the chance a merchant reaches the villa this season: none below 20, 1 at 55, 1.6 at 76+. */
export function merchantTradeFactor(health: number): number {
  if (health < 20) return 0;
  return clamp((health - 20) / 35, 0, 1.6);
}

/** Multiplier on what the trade goods fetch: 0.7 at 10, 1 at 55, 1.2 at 85+. */
export function tradeGoodsPriceFactor(health: number): number {
  return clamp(1 + (health - TRADE_BASELINE) / 150, 0.7, 1.2);
}

function shiftTradeGoodsBands(state: WorldState): void {
  const t = tradeState(state);
  const factor = tradeGoodsPriceFactor(t.health);
  if (Math.abs(factor - 1) < 0.025) {
    // Ordinary roads (within a few points of the baseline): the bands stand as the books have them.
    for (const [id, band] of Object.entries(t.marketBase)) if (state.market[id]) state.market[id] = { ...band };
    t.marketBase = {};
    return;
  }
  for (const id of TRADE_GOODS) {
    const band = state.market[id];
    if (!band) continue;
    if (!t.marketBase[id]) t.marketBase[id] = { ...band };
    const b = t.marketBase[id];
    state.market[id] = { min: Math.max(1, Math.round(b.min * factor)), max: Math.max(1, Math.round(b.max * factor)) };
  }
}

export type TradeTick = { beats: HistoryBeat[]; lines: string[] };

/**
 * The season tick: lasting knocks from the season's conditions (a raid at the gate, an army
 * fed at the villa), the drift toward the target, the sum, the trade goods' bands, and one
 * Aldric line when the roads change for the household to notice.
 */
export function tickTrade(state: WorldState, at: SeasonAt, turn: number, opts: { raid?: boolean; armyAtHome?: boolean } = {}): TradeTick {
  const out: TradeTick = { beats: [], lines: [] };
  const t = tradeState(state);
  if (at.season === "spring") t.lastYear = t.health;

  if (opts.raid) shiftTrade(state, -10, "the Northmen at the gate", turn);
  if (opts.armyAtHome) shiftTrade(state, -10, "an army fed off the country", turn);

  const target = tradeTarget(state);
  const quiet = !opts.raid && !opts.armyAtHome && tradeConditions(state).length === 0 && t.shocks.every((s) => s.untilTurn < turn);
  if (t.base < target) t.base = Math.min(target, t.base + (quiet ? PEACE_RECOVERY_PER_SEASON : RECOVERY_PER_SEASON));
  else if (t.base > target) t.base = Math.max(target, t.base - RECOVERY_PER_SEASON);
  t.base = Math.round(t.base * 100) / 100;

  recomputeTradeHealth(state, turn);
  shiftTradeGoodsBands(state);

  const word = tradeWord(t.health);
  if (t.lastWord === null) t.lastWord = word;
  else if (word !== t.lastWord) {
    const worse = t.health < (t.lastYear ?? t.health);
    const cause = worse && t.lastCause ? ` since ${t.lastCause}` : "";
    out.lines.push(`Trade on the roads is ${word} now.`);
    out.beats.push({
      npcId: "steward",
      eventId: "trade:change",
      text: worse
        ? `My lord, the roads are ${word}${cause}. Fewer carts come by, and what we have to sell fetches less.`
        : `My lord, the roads are ${word} again. More carts come by than did, and our surplus is asked for.`,
    });
    t.lastWord = word;
  }
  return out;
}

/** Rolled catalog events that move the roads (game.ts, after the season roll, before the merchant roll). */
export function noteRolledEventsForTrade(state: WorldState, ids: string[], turn: number): string[] {
  const t = tradeState(state);
  if (t.countedTurn === turn) return [];
  t.countedTurn = turn;
  const lines: string[] = [];
  const watched = WATCH_FEATURES.some((f) => allFeatures(state).includes(f));
  for (const id of ids) {
    if (id === "th-bandits" || id === "th-armed" || id === "th-theft") {
      if (watched) lines.push("The watch on the road kept the merchants coming despite the trouble.");
      else {
        shiftTrade(state, -10, "bandits on the road", turn);
        lines.push("Word of bandits keeps the carts away.");
      }
    } else if (id === "pol-muster" || id === "th-muster") {
      shiftTrade(state, -10, "the host on the roads", turn);
    } else if (id === "mkt-road") {
      shiftTrade(state, -5, "the road cut", turn);
    } else if (id === "win-snow" || id === "win-cold") {
      shockTrade(state, -8, "the hard winter", turn, 1);
    } else if (id === "mkt-demand" || id === "mkt-exotic" || id === "mkt-distant") {
      shiftTrade(state, 3, "merchants finding the place", turn);
    }
  }
  if (lines.length || ids.length) shiftTradeGoodsBands(state);
  return lines;
}

/** Set how the tolls are taken once the lord holds a county (Count+). */
export function setTollStance(state: WorldState, stance: "low" | "customary" | "greedy", turn: number): void {
  tradeState(state).tollStance = stance;
  recomputeTradeHealth(state, turn);
}

/**
 * The roads in words for Gerulf's and Aldric's prompts: the band, the trend against last
 * year, the latest cause, and what the lord's own works are doing. Never a number.
 */
export function tradeLine(state: WorldState): string {
  const t = tradeState(state);
  const word = tradeWord(t.health);
  let trend = "";
  if (t.lastYear !== null) {
    if (t.health <= t.lastYear - 5) trend = ", thinner than last year";
    else if (t.health >= t.lastYear + 5) trend = ", better than last year";
    else trend = ", much as last year";
  }
  const cause = t.lastCause && t.health < t.baseline ? ` The roads have been poorer since ${t.lastCause}.` : "";
  const works = tradeImprovements(state).filter((i) => i.bonus > 0).map((i) => i.what);
  const helps = works.length ? ` What draws trade here: ${works.join(", ")}.` : " Nothing of the lord's own yet draws trade here.";
  const conditions = tradeConditions(state).map((c) => c.what);
  const now = conditions.length ? ` This season: ${conditions.join("; ")}.` : "";
  return `The roads (Gerulf's reading; speak in these words, never a figure): trade is ${word}${trend}.${cause}${now}${helps}`;
}
