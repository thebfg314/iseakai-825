import { describe, expect, it, vi, afterEach } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "./schema";
import { applyMerchantRoll, generateMerchantStock } from "./merchant";
import { applyProposal } from "./applyDelta";
import {
  MERCHANT_BASE_PURSE,
  MERCHANT_BUY_SPREAD,
  MERCHANT_PURSE_BONUS,
  MERCHANT_PURSE_CAP,
  MERCHANT_SELL_SPREAD,
  applyMerchantBasket,
  beginMerchantVisitShop,
  emptyMerchantBasket,
  midpointPrice,
  priceForAmount,
  purseForVisit,
  quoteMerchantBasket,
  stallBuyUnit,
  sellUnit,
  stepSizeFor,
  visitSoften,
} from "./merchantShop";

function estate() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function present(name = "Isaac", demand = 0.5) {
  const state = estate();
  state.flags.merchant_present = true;
  state.merchant.present = true;
  state.merchant.name = name;
  state.merchant.stock = [{ resource: "salt", amount: 10 }];
  state.npcs.push({ id: "merchant", name, role: "merchant", location: "fontenay", memories: [], wantsTalk: true });
  beginMerchantVisitShop(state, name, demand);
  return state;
}

describe("merchant shop pricing", () => {
  it("keeps buy above mid and sell below, except buyback at the sale price", () => {
    const state = present("Isaac", 0.5);
    const mid = midpointPrice(state, "salt");
    expect(stallBuyUnit(state, "salt")).toBeGreaterThan(mid);
    expect(sellUnit(state, "salt")).toBeLessThan(mid);
    expect(stallBuyUnit(state, "salt")).toBe(Math.round(mid * MERCHANT_BUY_SPREAD * 10) / 10);
    expect(sellUnit(state, "salt")).toBe(Math.round(mid * MERCHANT_SELL_SPREAD * 10) / 10);

    state.resources.salt = 8;
    const sellBasket = emptyMerchantBasket();
    sellBasket.sell.salt = 4;
    const sold = applyMerchantBasket(state, sellBasket);
    expect(sold.ok).toBe(true);
    const salePrice = state.merchant.buyback[0].pricePerUnit;
    expect(salePrice).toBe(sellUnit(state, "salt"));

    const back = emptyMerchantBasket();
    back.buyBack.salt = 4;
    const quote = quoteMerchantBasket(state, back);
    expect(quote.canConfirm).toBe(true);
    expect(quote.buyCost).toBe(Math.round(salePrice * 4 * 10) / 10);
    expect(quote.buyCost).not.toBe(stallBuyUnit(state, "salt") * 4);
  });

  it("moves to a worse band after the demand step", () => {
    expect(stepSizeFor("wheat", 0)).toBe(40);
    expect(stepSizeFor("wheat", 1)).toBe(80);
    expect(stepSizeFor("charcoal", 0)).toBe(8);
    expect(stepSizeFor("charcoal", 1)).toBe(12);
    expect(stepSizeFor("iron", 0)).toBe(5);
    expect(stepSizeFor("cattle", 1)).toBe(3);
    const state = present("Gero", 0);
    const soften = visitSoften(state);
    expect(soften).toBe(0.7);
    const base = sellUnit(state, "wheat");
    const first = priceForAmount(base, 0, 40, 40, soften, "sell");
    const both = priceForAmount(base, 0, 50, 40, soften, "sell");
    const secondBand = priceForAmount(base, 40, 10, 40, soften, "sell");
    expect(first.avg).toBe(base);
    expect(secondBand.avg).toBeLessThan(base);
    expect(secondBand.avg).toBeCloseTo(base * 0.7, 1);
    expect(both.total).toBe(Math.round((first.total + secondBand.total) * 10) / 10);
  });

  it("mirrors bulk steps when buying heavy from the stall", () => {
    const state = present("Gero", 0);
    state.merchant.stock = [{ resource: "wheat", amount: 50 }];
    state.resources.denarii = 500;
    const soften = visitSoften(state);
    const base = stallBuyUnit(state, "wheat");
    const first = priceForAmount(base, 0, 40, 40, soften, "buy");
    const extra = priceForAmount(base, 40, 10, 40, soften, "buy");
    expect(first.avg).toBe(base);
    expect(extra.avg).toBeGreaterThan(base);
    const basket = emptyMerchantBasket();
    basket.buyStall.wheat = 50;
    const quote = quoteMerchantBasket(state, basket);
    expect(quote.buyCost).toBe(Math.round((first.total + extra.total) * 10) / 10);
  });
});

describe("merchant shop confirm", () => {
  it("writes stock and denarii on Confirm", () => {
    const state = present();
    state.resources.denarii = 96;
    const saltBefore = state.resources.salt;
    const basket = emptyMerchantBasket();
    basket.buyStall.salt = 4;
    const quote = quoteMerchantBasket(state, basket);
    expect(quote.canConfirm).toBe(true);
    const result = applyMerchantBasket(state, basket);
    expect(result.ok).toBe(true);
    expect(state.resources.salt).toBe(saltBefore + 4);
    expect(state.merchant.stock.find((s) => s.resource === "salt")?.amount).toBe(6);
    expect(state.resources.denarii).toBe(Math.round((96 - quote.buyCost) * 10) / 10);
  });

  it("refuses a basket the chest cannot pay", () => {
    const state = present();
    state.resources.denarii = 1;
    const basket = emptyMerchantBasket();
    basket.buyStall.salt = 8;
    const quote = quoteMerchantBasket(state, basket);
    expect(quote.canConfirm).toBe(false);
    expect(quote.reason).toMatch(/denarii/i);
    const before = state.resources.salt;
    const result = applyMerchantBasket(state, basket);
    expect(result.ok).toBe(false);
    expect(state.resources.salt).toBe(before);
    expect(state.resources.denarii).toBe(1);
  });

  it("refuses a sale his purse cannot cover", () => {
    const state = present();
    state.merchant.purse = 2;
    state.resources.wool = 20;
    const basket = emptyMerchantBasket();
    basket.sell.wool = 10;
    const quote = quoteMerchantBasket(state, basket);
    expect(quote.canConfirm).toBe(false);
    expect(quote.reason).toMatch(/purse/i);
  });

  it("settles a mixed basket by the net denarii", () => {
    const state = present("Isaac", 0.5);
    state.resources.denarii = 20;
    state.resources.wool = 10;
    const basket = emptyMerchantBasket();
    basket.buyStall.salt = 2;
    basket.sell.wool = 4;
    const quote = quoteMerchantBasket(state, basket);
    expect(quote.canConfirm).toBe(true);
    const result = applyMerchantBasket(state, basket);
    expect(result.ok).toBe(true);
    expect(state.resources.denarii).toBe(Math.round((20 - quote.playerPays + quote.playerReceives) * 10) / 10);
    expect(state.merchant.purse).toBe(Math.round((quote.sellProceeds > 0 ? MERCHANT_BASE_PURSE - quote.sellProceeds : MERCHANT_BASE_PURSE) * 10) / 10);
  });
});

describe("merchant purse bonus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grants +200 on the next visit after the purse is drained, soft-capped near 2000", () => {
    const state = present("Isaac", 1);
    state.merchant.purse = 16;
    state.merchant.purseStart = 16;
    state.resources.salt = 20;
    const unit = sellUnit(state, "salt");
    expect(unit).toBe(1.6);
    const basket = emptyMerchantBasket();
    basket.sell.salt = 10;
    const quote = quoteMerchantBasket(state, basket);
    expect(quote.canConfirm).toBe(true);
    expect(quote.sellProceeds).toBeGreaterThanOrEqual(16 - 0.05);
    const sold = applyMerchantBasket(state, basket);
    expect(sold.ok).toBe(true);
    expect(state.merchant.purse).toBe(0);
    expect(state.merchant.purseDrained).toBe(true);
    expect(state.merchant_purse_bonus.Isaac).toBe(MERCHANT_PURSE_BONUS);

    applyMerchantRoll(state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: false });
    vi.spyOn(Math, "random").mockReturnValue(5 / 8);
    applyMerchantRoll(state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: true });
    expect(state.merchant.name).toBe("Isaac");
    expect(state.merchant.purse).toBe(MERCHANT_BASE_PURSE + MERCHANT_PURSE_BONUS);
    expect(purseForVisit(state, "Isaac")).toBe(1200);

    state.merchant_purse_bonus.Isaac = 1000;
    expect(purseForVisit(state, "Isaac")).toBe(MERCHANT_PURSE_CAP);
  });
});

describe("thin packs", () => {
  it("keeps modest stock lines and amounts", () => {
    for (let i = 0; i < 20; i++) {
      const stock = generateMerchantStock();
      expect(stock.length).toBeGreaterThanOrEqual(3);
      expect(stock.length).toBeLessThanOrEqual(5);
      for (const line of stock) {
        expect(line.amount).toBeGreaterThanOrEqual(1);
        expect(line.amount).toBeLessThanOrEqual(7);
      }
    }
  });
});

describe("transfer_resources still writes the stall", () => {
  it("buys from stock through Confirm language", () => {
    const state = present();
    const denarii = state.resources.denarii;
    const salt = state.resources.salt;
    const result = applyProposal(
      state,
      { type: "transfer_resources", summary: "Buy salt", resource: "salt", amount: 3, direction: "buy" },
      "merchant",
    );
    expect(result.ok).toBe(true);
    expect(state.resources.salt).toBe(salt + 3);
    expect(state.resources.denarii).toBeLessThan(denarii);
    expect(state.merchant.stock.find((s) => s.resource === "salt")?.amount).toBe(7);
  });
});
