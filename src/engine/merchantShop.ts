import type { ApplyResult, CanonicalResource, WorldState } from "./schema";
import { CANONICAL_RESOURCES } from "./schema";
import { clamp, round1 } from "./util";
import { amountPhrase, resourceName } from "../ui/ledgerCopy";

export const MERCHANT_BASE_PURSE = 1000;
export const MERCHANT_PURSE_BONUS = 200;
export const MERCHANT_PURSE_CAP = 2000;
export const MERCHANT_BUY_SPREAD = 1.2;
export const MERCHANT_SELL_SPREAD = 0.8;
export const MERCHANT_SOFTEN_LO = 0.7;
export const MERCHANT_SOFTEN_HI = 0.8;

const GRAIN = new Set(["wheat", "rye", "barley", "oats"]);
const CART_LOADS = new Set(["softwood", "hardwood", "stone", "charcoal"]);
const POUNDS = new Set(["salt", "iron", "copper", "tin", "beeswax", "linen"]);
const LIVESTOCK = new Set(["cattle", "sheep", "pigs", "horses", "poultry", "bees"]);
const SMALL_MEDIUM = new Set(["wine", "hides", "trade_goods", "honey", "cheese", "wool"]);

export type MerchantBuybackLot = { resource: string; amount: number; pricePerUnit: number };

export type MerchantShopBasket = {
  buyStall: Record<string, number>;
  buyBack: Record<string, number>;
  sell: Record<string, number>;
};

export type MerchantShopLine = {
  resource: string;
  amount: number;
  kind: "stall" | "buyback" | "sell";
  unitPrice: number;
  total: number;
};

export type MerchantShopQuote = {
  buyLines: MerchantShopLine[];
  sellLines: MerchantShopLine[];
  buyCost: number;
  sellProceeds: number;
  /** Positive: player receives. Negative: player pays. */
  net: number;
  playerPays: number;
  playerReceives: number;
  canConfirm: boolean;
  reason?: string;
};

export function emptyMerchantBasket(): MerchantShopBasket {
  return { buyStall: {}, buyBack: {}, sell: {} };
}

export function midpointPrice(state: WorldState, resource: string): number {
  const range = state.market[resource];
  if (range) return (range.min + range.max) / 2;
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (custom) return (custom.priceMin + custom.priceMax) / 2;
  return 0;
}

export function visitDemand(state: WorldState): number {
  return clamp(state.merchant.demand ?? 0.5, 0, 1);
}

export function visitSoften(state: WorldState): number {
  const d = visitDemand(state);
  return round1(MERCHANT_SOFTEN_LO + d * (MERCHANT_SOFTEN_HI - MERCHANT_SOFTEN_LO));
}

export function stepSizeFor(resource: string, demand: number): number {
  const t = clamp(demand, 0, 1);
  const lerp = (lo: number, hi: number) => Math.max(1, Math.round(lo + (hi - lo) * t));
  if (GRAIN.has(resource)) return lerp(40, 80);
  if (resource === "charcoal") return lerp(8, 12);
  if (CART_LOADS.has(resource)) return lerp(8, 20);
  if (POUNDS.has(resource)) return lerp(5, 15);
  if (LIVESTOCK.has(resource)) return lerp(1, 3);
  if (SMALL_MEDIUM.has(resource)) return lerp(6, 16);
  return lerp(5, 15);
}

export function stallBuyUnit(state: WorldState, resource: string): number {
  return round1(midpointPrice(state, resource) * MERCHANT_BUY_SPREAD);
}

export function sellUnit(state: WorldState, resource: string): number {
  return round1(midpointPrice(state, resource) * MERCHANT_SELL_SPREAD);
}

function bandUnit(base: number, band: number, soften: number, side: "buy" | "sell"): number {
  const factor = soften ** Math.max(0, band);
  if (side === "sell") return round1(base * factor);
  return round1(base / factor);
}

/** Price the next `amount` units given volume already done this visit. */
export function lotsForAmount(
  base: number,
  already: number,
  amount: number,
  step: number,
  soften: number,
  side: "buy" | "sell",
): { amount: number; pricePerUnit: number }[] {
  const qty = Math.max(0, amount);
  if (qty <= 0) return [];
  const size = Math.max(1, step);
  let remaining = qty;
  let cursor = Math.max(0, already);
  const lots: { amount: number; pricePerUnit: number }[] = [];
  while (remaining > 0.0001) {
    const band = Math.floor(cursor / size);
    const usedInBand = cursor % size;
    const slice = round1(Math.min(remaining, size - usedInBand));
    lots.push({ amount: slice, pricePerUnit: bandUnit(base, band, soften, side) });
    remaining = round1(remaining - slice);
    cursor += slice;
  }
  return lots;
}

export function priceForAmount(
  base: number,
  already: number,
  amount: number,
  step: number,
  soften: number,
  side: "buy" | "sell",
): { total: number; avg: number } {
  const lots = lotsForAmount(base, already, amount, step, soften, side);
  const total = round1(lots.reduce((n, lot) => n + lot.amount * lot.pricePerUnit, 0));
  const qty = Math.max(0, amount);
  return { total, avg: qty ? round1(total / qty) : 0 };
}

export function purseForVisit(state: WorldState, name: string | undefined): number {
  const bonus = name ? (state.merchant_purse_bonus?.[name] ?? 0) : 0;
  return round1(Math.min(MERCHANT_PURSE_CAP, MERCHANT_BASE_PURSE + Math.max(0, bonus)));
}

export function addPurseBonus(state: WorldState, name: string): void {
  if (!name) return;
  state.merchant_purse_bonus ??= {};
  const current = Math.max(0, state.merchant_purse_bonus[name] ?? 0);
  const nextPurse = Math.min(MERCHANT_PURSE_CAP, MERCHANT_BASE_PURSE + current + MERCHANT_PURSE_BONUS);
  state.merchant_purse_bonus[name] = round1(nextPurse - MERCHANT_BASE_PURSE);
}

export function noteMerchantPurseSpend(state: WorldState): void {
  const name = state.merchant.name;
  if (!name) return;
  if ((state.merchant.purse ?? 0) > 0) return;
  if (state.merchant.purseDrained) return;
  if ((state.merchant.purseStart ?? 0) <= 0) return;
  state.merchant.purseDrained = true;
  addPurseBonus(state, name);
}

export function persistMerchantPurseOnLeave(state: WorldState, name: string | undefined): void {
  if (!name) return;
  if (state.merchant.purseDrained) return;
  if ((state.merchant.purse ?? 1) > 0) return;
  if ((state.merchant.purseStart ?? 0) <= 0) return;
  state.merchant.purseDrained = true;
  addPurseBonus(state, name);
}

export function ensureMerchantVisitShop(state: WorldState): void {
  if (!state.merchant.present) return;
  state.merchant.buyback ??= [];
  state.merchant.boughtVolume ??= {};
  state.merchant.soldVolume ??= {};
  if (state.merchant.demand == null) state.merchant.demand = 0.5;
  if (state.merchant.purse == null) {
    const purse = purseForVisit(state, state.merchant.name);
    state.merchant.purse = purse;
    state.merchant.purseStart = purse;
  }
  if (state.merchant.purseStart == null) state.merchant.purseStart = state.merchant.purse;
}

export function beginMerchantVisitShop(state: WorldState, name: string | undefined, demand = Math.random()): void {
  const purse = purseForVisit(state, name);
  state.merchant.demand = clamp(demand, 0, 1);
  state.merchant.purse = purse;
  state.merchant.purseStart = purse;
  state.merchant.buyback = [];
  state.merchant.boughtVolume = {};
  state.merchant.soldVolume = {};
  state.merchant.purseDrained = false;
}

function isCanonical(id: string): id is CanonicalResource {
  return (CANONICAL_RESOURCES as readonly string[]).includes(id);
}

export function getAmount(state: WorldState, resource: string): number | null {
  if (isCanonical(resource)) return state.resources[resource];
  const custom = state.custom_resources.find((c) => c.id === resource);
  return custom ? custom.amount : null;
}

export function setAmount(state: WorldState, resource: string, amount: number): boolean {
  const v = round1(Math.max(0, amount));
  if (isCanonical(resource)) {
    state.resources[resource] = v;
    return true;
  }
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (!custom) return false;
  custom.amount = v;
  return true;
}

export function stallAmount(state: WorldState, resource: string): number {
  return state.merchant.stock.find((s) => s.resource === resource)?.amount ?? 0;
}

export function buybackAmount(state: WorldState, resource: string): number {
  return (state.merchant.buyback ?? []).filter((l) => l.resource === resource).reduce((n, l) => n + l.amount, 0);
}

export function merchantCartsForBooks(state: {
  stock: { resource: string; amount: number }[];
  buyback?: MerchantBuybackLot[];
}): { resource: string; amount: number }[] {
  const merged = new Map<string, number>();
  for (const s of state.stock ?? []) merged.set(s.resource, round1((merged.get(s.resource) ?? 0) + s.amount));
  for (const lot of state.buyback ?? []) merged.set(lot.resource, round1((merged.get(lot.resource) ?? 0) + lot.amount));
  return [...merged.entries()].map(([resource, amount]) => ({ resource, amount }));
}

function nonzeroEntries(map: Record<string, number> | undefined): [string, number][] {
  return Object.entries(map ?? {}).filter(([, n]) => n > 0);
}

export function basketHasLines(basket: MerchantShopBasket): boolean {
  return nonzeroEntries(basket.buyStall).length + nonzeroEntries(basket.buyBack).length + nonzeroEntries(basket.sell).length > 0;
}

function failQuote(reason: string, partial?: Partial<MerchantShopQuote>): MerchantShopQuote {
  return {
    buyLines: partial?.buyLines ?? [],
    sellLines: partial?.sellLines ?? [],
    buyCost: partial?.buyCost ?? 0,
    sellProceeds: partial?.sellProceeds ?? 0,
    net: partial?.net ?? 0,
    playerPays: partial?.playerPays ?? 0,
    playerReceives: partial?.playerReceives ?? 0,
    canConfirm: false,
    reason,
  };
}

export function quoteMerchantBasket(state: WorldState, basket: MerchantShopBasket): MerchantShopQuote {
  ensureMerchantVisitShop(state);
  if (!state.merchant.present || !state.flags.merchant_present) {
    return failQuote("The merchant has already left the district.");
  }
  const demand = visitDemand(state);
  const soften = visitSoften(state);
  const buyLines: MerchantShopLine[] = [];
  const sellLines: MerchantShopLine[] = [];

  for (const [resource, amount] of nonzeroEntries(basket.buyStall)) {
    const have = stallAmount(state, resource);
    if (amount > have + 0.001) {
      return failQuote(`The merchant has no ${amountPhrase(resource, amount)} on the carts.`);
    }
    const already = state.merchant.boughtVolume?.[resource] ?? 0;
    const priced = priceForAmount(stallBuyUnit(state, resource), already, amount, stepSizeFor(resource, demand), soften, "buy");
    buyLines.push({ resource, amount, kind: "stall", unitPrice: priced.avg, total: priced.total });
  }

  for (const [resource, amount] of nonzeroEntries(basket.buyBack)) {
    const have = buybackAmount(state, resource);
    if (amount > have + 0.001) {
      return failQuote(`Those ${resourceName(resource)} are no longer on his carts to buy back.`);
    }
    const raw = takeBuybackCost(state.merchant.buyback ?? [], resource, amount);
    if (!Number.isFinite(raw)) {
      return failQuote(`Those ${resourceName(resource)} are no longer on his carts to buy back.`);
    }
    const total = round1(raw);
    const avg = amount ? round1(total / amount) : 0;
    buyLines.push({ resource, amount, kind: "buyback", unitPrice: avg, total });
  }

  for (const [resource, amount] of nonzeroEntries(basket.sell)) {
    if (resource === "denarii") return failQuote("Cannot sell coin.");
    const current = getAmount(state, resource);
    if (current === null) return failQuote(`Unknown resource '${resource}'. Register it first.`);
    if (current < amount) return failQuote(`Cannot sell ${amountPhrase(resource, amount)}; have ${current}.`);
    const already = state.merchant.soldVolume?.[resource] ?? 0;
    const priced = priceForAmount(sellUnit(state, resource), already, amount, stepSizeFor(resource, demand), soften, "sell");
    sellLines.push({ resource, amount, kind: "sell", unitPrice: priced.avg, total: priced.total });
  }

  const buyCost = round1(buyLines.reduce((n, l) => n + l.total, 0));
  const sellProceeds = round1(sellLines.reduce((n, l) => n + l.total, 0));
  const net = round1(sellProceeds - buyCost);
  const playerPays = round1(Math.max(0, -net));
  const playerReceives = round1(Math.max(0, net));
  const partial = { buyLines, sellLines, buyCost, sellProceeds, net, playerPays, playerReceives };

  if (!buyLines.length && !sellLines.length) return failQuote("Nothing is chosen.", partial);
  if (playerPays > state.resources.denarii + 0.001) {
    return failQuote(`Need ${playerPays} denarii; have ${state.resources.denarii}.`, partial);
  }
  if (sellProceeds > (state.merchant.purse ?? 0) + 0.001) {
    return failQuote(`His purse cannot cover ${sellProceeds} denarii.`, partial);
  }
  return { ...partial, canConfirm: true };
}

/** Cost to buy back `amount` of resource, consuming lots in order (does not mutate). */
export function takeBuybackCost(lots: MerchantBuybackLot[], resource: string, amount: number): number {
  let left = amount;
  let cost = 0;
  for (const lot of lots) {
    if (left <= 0) break;
    if (lot.resource !== resource || lot.amount <= 0) continue;
    const take = Math.min(lot.amount, left);
    cost += take * lot.pricePerUnit;
    left -= take;
  }
  return left > 0.001 ? Number.POSITIVE_INFINITY : cost;
}

function consumeBuyback(state: WorldState, resource: string, amount: number): number {
  let left = amount;
  let cost = 0;
  const next: MerchantBuybackLot[] = [];
  for (const lot of state.merchant.buyback ?? []) {
    if (left <= 0 || lot.resource !== resource || lot.amount <= 0) {
      if (lot.amount > 0) next.push(lot);
      continue;
    }
    const take = Math.min(lot.amount, left);
    cost += take * lot.pricePerUnit;
    left -= take;
    const remain = round1(lot.amount - take);
    if (remain > 0) next.push({ ...lot, amount: remain });
  }
  state.merchant.buyback = next;
  return round1(cost);
}

function reduceStall(state: WorldState, resource: string, amount: number): void {
  const stall = state.merchant.stock.find((s) => s.resource === resource);
  if (!stall) return;
  stall.amount = round1(stall.amount - amount);
  if (stall.amount <= 0) state.merchant.stock = state.merchant.stock.filter((s) => s.resource !== resource);
}

function addBuyback(state: WorldState, resource: string, amount: number, pricePerUnit: number): void {
  state.merchant.buyback ??= [];
  const last = state.merchant.buyback[state.merchant.buyback.length - 1];
  if (last && last.resource === resource && Math.abs(last.pricePerUnit - pricePerUnit) < 0.05) {
    last.amount = round1(last.amount + amount);
    return;
  }
  state.merchant.buyback.push({ resource, amount, pricePerUnit });
}

function bumpVolume(map: Record<string, number> | undefined, resource: string, amount: number): Record<string, number> {
  const next = { ...(map ?? {}) };
  next[resource] = round1((next[resource] ?? 0) + amount);
  return next;
}

function fail(state: WorldState, reason: string, summary: string): ApplyResult {
  return { ok: false, reason, logLine: summary, state };
}

function ok(state: WorldState, summary: string): ApplyResult {
  return { ok: true, logLine: summary, state };
}

export function shopLogLine(state: WorldState, quote: MerchantShopQuote): string {
  const who = state.merchant.name ?? "the merchant";
  const bits: string[] = [];
  for (const line of quote.buyLines) {
    const how = line.kind === "buyback" ? "back" : `from ${who}`;
    bits.push(`Bought ${amountPhrase(line.resource, line.amount)} ${how} for ${round1(line.total)} denarii`);
  }
  for (const line of quote.sellLines) {
    bits.push(`Sold ${amountPhrase(line.resource, line.amount)} to ${who} for ${round1(line.total)} denarii`);
  }
  if (quote.playerPays > 0) bits.push(`the chest paid ${quote.playerPays} denarii`);
  if (quote.playerReceives > 0) bits.push(`the chest received ${quote.playerReceives} denarii`);
  return bits.length ? `${bits.join(". ")}.` : "The stall is settled.";
}

export function applyMerchantBasket(state: WorldState, basket: MerchantShopBasket): ApplyResult {
  const quote = quoteMerchantBasket(state, basket);
  if (!quote.canConfirm) return fail(state, quote.reason ?? "The stall cannot be settled.", quote.reason ?? "The stall cannot be settled.");

  for (const line of quote.buyLines) {
    const current = getAmount(state, line.resource);
    if (current === null) return fail(state, `Unknown resource '${line.resource}'. Register it first.`, line.resource);
    if (line.kind === "stall") {
      reduceStall(state, line.resource, line.amount);
      state.merchant.boughtVolume = bumpVolume(state.merchant.boughtVolume, line.resource, line.amount);
    } else {
      consumeBuyback(state, line.resource, line.amount);
    }
    setAmount(state, line.resource, current + line.amount);
  }

  for (const line of quote.sellLines) {
    const current = getAmount(state, line.resource) ?? 0;
    setAmount(state, line.resource, current - line.amount);
    const already = (state.merchant.soldVolume?.[line.resource] ?? 0);
    const lots = lotsForAmount(
      sellUnit(state, line.resource),
      already,
      line.amount,
      stepSizeFor(line.resource, visitDemand(state)),
      visitSoften(state),
      "sell",
    );
    for (const lot of lots) addBuyback(state, line.resource, lot.amount, lot.pricePerUnit);
    state.merchant.soldVolume = bumpVolume(state.merchant.soldVolume, line.resource, line.amount);
  }

  state.resources.denarii = round1(state.resources.denarii - quote.playerPays + quote.playerReceives);
  state.merchant.purse = round1(Math.max(0, (state.merchant.purse ?? 0) - quote.sellProceeds));
  noteMerchantPurseSpend(state);
  return ok(state, shopLogLine(state, quote));
}

/** Single LLM / Confirm line: stall buy or a sell into buyback, using shop bands unless a unit price is named. */
export function applyMerchantTransferLine(
  state: WorldState,
  p: { resource: string; amount: number; direction: "buy" | "sell"; pricePerUnit?: number; summary: string },
): ApplyResult {
  ensureMerchantVisitShop(state);
  const amount = Math.abs(p.amount);
  if (p.direction === "buy") {
    if (p.pricePerUnit != null) {
      const stall = stallAmount(state, p.resource);
      if (stall < amount) {
        return fail(state, `The merchant has no ${amountPhrase(p.resource, amount)} on the carts.`, p.summary);
      }
      const current = getAmount(state, p.resource);
      if (current === null) return fail(state, `Unknown resource '${p.resource}'. Register it first.`, p.summary);
      const cost = round1(amount * p.pricePerUnit);
      if (cost > state.resources.denarii + 0.001) {
        return fail(state, `Need ${cost} denarii; have ${state.resources.denarii}.`, p.summary);
      }
      reduceStall(state, p.resource, amount);
      state.merchant.boughtVolume = bumpVolume(state.merchant.boughtVolume, p.resource, amount);
      setAmount(state, p.resource, current + amount);
      state.resources.denarii = round1(state.resources.denarii - cost);
      return ok(
        state,
        `Bought ${amountPhrase(p.resource, amount)} from ${state.merchant.name ?? "the merchant"} for ${cost} denarii.`,
      );
    }
    const basket = emptyMerchantBasket();
    if (stallAmount(state, p.resource) < amount) {
      return fail(state, `The merchant has no ${amountPhrase(p.resource, amount)} on the carts.`, p.summary);
    }
    basket.buyStall[p.resource] = amount;
    return applyMerchantBasket(state, basket);
  }

  if (p.pricePerUnit != null) {
    const current = getAmount(state, p.resource);
    if (current === null) return fail(state, `Unknown resource '${p.resource}'. Register it first.`, p.summary);
    if (p.resource === "denarii") return fail(state, "Cannot sell coin.", p.summary);
    if (current < amount) return fail(state, `Cannot sell ${amountPhrase(p.resource, amount)}; have ${current}.`, p.summary);
    const proceeds = round1(amount * p.pricePerUnit);
    if (proceeds > (state.merchant.purse ?? 0) + 0.001) {
      return fail(state, `His purse cannot cover ${proceeds} denarii.`, p.summary);
    }
    setAmount(state, p.resource, current - amount);
    addBuyback(state, p.resource, amount, p.pricePerUnit);
    state.merchant.soldVolume = bumpVolume(state.merchant.soldVolume, p.resource, amount);
    state.resources.denarii = round1(state.resources.denarii + proceeds);
    state.merchant.purse = round1(Math.max(0, (state.merchant.purse ?? 0) - proceeds));
    noteMerchantPurseSpend(state);
    return ok(
      state,
      `Sold ${amountPhrase(p.resource, amount)} to ${state.merchant.name ?? "the merchant"} for ${proceeds} denarii.`,
    );
  }
  const basket = emptyMerchantBasket();
  basket.sell[p.resource] = amount;
  return applyMerchantBasket(state, basket);
}

export function tradeableStoreIds(state: WorldState): string[] {
  const ids: string[] = [];
  for (const id of CANONICAL_RESOURCES as readonly string[]) {
    if (id === "denarii") continue;
    ids.push(id);
  }
  for (const custom of state.custom_resources) {
    if (!ids.includes(custom.id)) ids.push(custom.id);
  }
  return ids;
}
