import type { WorldState } from "../engine/schema";
import {
  buybackAmount,
  emptyMerchantBasket,
  stallAmount,
  stallBuyUnit,
  sellUnit,
  tradeableStoreIds,
  type MerchantShopBasket,
  type MerchantShopQuote,
} from "../engine/merchantShop";
import { formatLedgerNumber, resourceName, resourceUnitSingular } from "./ledgerCopy";

export const SHOP_TITLE = "The stall";
export const SHOP_CARTS = "On the carts";
export const SHOP_STORES = "Your stores";
export const SHOP_TALLY = "The tally";
export const SHOP_CONFIRM_HELP = "Confirm is Aldric writing the stall in the books.";
export const SHOP_SPEAK_HINT = "Speak below for gossip of the roads. The stall does not wait on speech.";

export function shopPurseLine(name: string | undefined, purse: number): string {
  const who = name ? `${name}'s purse` : "His purse";
  return `${who} holds ${formatLedgerNumber(purse)} denarii.`;
}

export function shopNetLine(quote: MerchantShopQuote): string {
  if (!quote.buyLines.length && !quote.sellLines.length) return "Nothing is chosen.";
  if (quote.playerPays > 0) return `You pay ${formatLedgerNumber(quote.playerPays)} denarii.`;
  if (quote.playerReceives > 0) return `You receive ${formatLedgerNumber(quote.playerReceives)} denarii.`;
  return "Even — no coin moves.";
}

export function shopUnitLine(resource: string, unitPrice: number, kind: "stall" | "buyback" | "sell"): string {
  const unit = resourceUnitSingular(resource) || "piece";
  if (kind === "buyback") return `buy back at ${formatLedgerNumber(unitPrice)} denarii the ${unit}`;
  if (kind === "sell") return `he pays ${formatLedgerNumber(unitPrice)} denarii the ${unit}`;
  return `${formatLedgerNumber(unitPrice)} denarii the ${unit}`;
}

export function shopLineLabel(resource: string, kind: "stall" | "buyback"): string {
  const name = resourceName(resource);
  return kind === "buyback" ? `${name} (your sale)` : name;
}

export function clampShopQty(n: number, max: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.max(0, Math.round(n)), Math.max(0, Math.floor(max)));
}

export function basketFromQtys(
  buyStall: Record<string, number>,
  buyBack: Record<string, number>,
  sell: Record<string, number>,
): MerchantShopBasket {
  const basket = emptyMerchantBasket();
  for (const [resource, amount] of Object.entries(buyStall)) {
    if (amount > 0) basket.buyStall[resource] = amount;
  }
  for (const [resource, amount] of Object.entries(buyBack)) {
    if (amount > 0) basket.buyBack[resource] = amount;
  }
  for (const [resource, amount] of Object.entries(sell)) {
    if (amount > 0) basket.sell[resource] = amount;
  }
  return basket;
}

export function stallRows(state: WorldState): { resource: string; amount: number; kind: "stall" | "buyback"; unitPrice: number }[] {
  const rows: { resource: string; amount: number; kind: "stall" | "buyback"; unitPrice: number }[] = [];
  for (const line of state.merchant.stock ?? []) {
    if (line.amount <= 0) continue;
    rows.push({ resource: line.resource, amount: line.amount, kind: "stall", unitPrice: stallBuyUnit(state, line.resource) });
  }
  const seen = new Set<string>();
  for (const lot of state.merchant.buyback ?? []) {
    if (lot.amount <= 0 || seen.has(lot.resource)) continue;
    seen.add(lot.resource);
    const amount = buybackAmount(state, lot.resource);
    if (amount <= 0) continue;
    rows.push({ resource: lot.resource, amount, kind: "buyback", unitPrice: lot.pricePerUnit });
  }
  return rows;
}

export function sellRows(state: WorldState): { resource: string; amount: number; unitPrice: number }[] {
  const rows: { resource: string; amount: number; unitPrice: number }[] = [];
  for (const resource of tradeableStoreIds(state)) {
    const amount = resource in state.resources ? state.resources[resource as keyof typeof state.resources] : (state.custom_resources.find((c) => c.id === resource)?.amount ?? 0);
    if (amount <= 0) continue;
    rows.push({ resource, amount, unitPrice: sellUnit(state, resource) });
  }
  return rows;
}

export function shopHave(state: WorldState, resource: string, kind: "stall" | "buyback" | "sell"): number {
  if (kind === "stall") return stallAmount(state, resource);
  if (kind === "buyback") return buybackAmount(state, resource);
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (custom) return custom.amount;
  return (state.resources as Record<string, number>)[resource] ?? 0;
}
