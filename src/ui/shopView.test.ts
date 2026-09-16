import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { beginMerchantVisitShop } from "../engine/merchantShop";
import { shopNetLine, shopPurseLine, stallRows, sellRows } from "./shopView";
import { quoteMerchantBasket, emptyMerchantBasket } from "../engine/merchantShop";

function merchantView() {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.flags.merchant_present = true;
  state.merchant.present = true;
  state.merchant.name = "Isaac";
  state.merchant.stock = [{ resource: "salt", amount: 6 }];
  beginMerchantVisitShop(state, "Isaac", 0.5);
  return state;
}

describe("shop copy", () => {
  it("names the purse and the net in hall language", () => {
    const state = merchantView();
    expect(shopPurseLine("Isaac", 1000)).toBe("Isaac's purse holds 1000 denarii.");
    expect(shopNetLine(quoteMerchantBasket(state, emptyMerchantBasket()))).toBe("Nothing is chosen.");
    const buy = emptyMerchantBasket();
    buy.buyStall.salt = 2;
    const bought = quoteMerchantBasket(state, buy);
    expect(shopNetLine(bought)).toMatch(/^You pay .+ denarii\.$/);
    const sell = emptyMerchantBasket();
    sell.sell.wool = 2;
    const sold = quoteMerchantBasket(state, sell);
    expect(shopNetLine(sold)).toMatch(/^You receive .+ denarii\.$/);
  });

  it("lists stall stock and player stores separately", () => {
    const state = merchantView();
    expect(stallRows(state).some((r) => r.resource === "salt" && r.kind === "stall")).toBe(true);
    expect(sellRows(state).some((r) => r.resource === "wool" && r.amount > 0)).toBe(true);
  });
});
