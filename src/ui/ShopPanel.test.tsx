import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { labourPool, labourRemaining } from "../engine/labour";
import { WorldStateSchema } from "../engine/schema";
import { beginMerchantVisitShop } from "../engine/merchantShop";
import { emptyMeter } from "../llm/usage";
import type { GameView } from "../shared/types";
import { ShopPanel } from "./ShopPanel";
import { SHOP_CARTS, SHOP_CONFIRM_HELP, SHOP_STORES, SHOP_TALLY, SHOP_TITLE } from "./shopView";

function merchantGame(): GameView {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.flags.merchant_present = true;
  state.merchant.present = true;
  state.merchant.name = "Isaac";
  state.merchant.face = 6;
  state.merchant.stock = [
    { resource: "salt", amount: 6 },
    { resource: "linen", amount: 3 },
  ];
  state.npcs.push({ id: "merchant", name: "Isaac", role: "merchant", location: "fontenay", memories: [], wantsTalk: true });
  beginMerchantVisitShop(state, "Isaac", 0.5);
  return {
    state,
    pending: [],
    messages: [],
    sceneNpcId: "merchant",
    labour: { pool: labourPool(state), remaining: labourRemaining(state) },
    smithAvailable: true,
    chaplainAvailable: true,
    merchantAvailable: true,
    sceneEmotion: "neutral",
    historyTail: [],
    llmMeter: emptyMeter("rfab"),
  };
}

describe("merchant stall window", () => {
  it("paints carts, stores, the tally, and Confirm", () => {
    const html = renderToStaticMarkup(createElement(ShopPanel, { view: merchantGame(), busy: false, onConfirm: () => {} }));
    expect(html).toContain(SHOP_TITLE);
    expect(html).toContain(SHOP_CARTS);
    expect(html).toContain(SHOP_STORES);
    expect(html).toContain(SHOP_TALLY);
    expect(html).toContain(SHOP_CONFIRM_HELP);
    expect(html).toContain("Confirm");
    expect(html).toContain("Speak");
    expect(html).toContain("salt");
    expect(html).toContain("Isaac");
    expect(html).not.toMatch(/transfer_resources|pricePerUnit|JSON/);
  });
});
