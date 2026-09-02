import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { HOUSEHOLD_INTROS, MERCHANT_INTROS, introAlreadySpoken, introSpeechFor, markIntroSpoken } from "./intros";
import { applyMerchantRoll } from "./merchant";
import { WorldStateSchema } from "./schema";
import { cloneState } from "./state";

function boot() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("first-meeting intro copy", () => {
  it("keeps the signed-off household and merchant lines", () => {
    expect(HOUSEHOLD_INTROS.steward).toContain("steward of Fontenay");
    expect(HOUSEHOLD_INTROS.smith).toMatch(/^Bernard\./);
    expect(HOUSEHOLD_INTROS.chaplain).toContain("prior of Saint-Martin's cell");
    expect(HOUSEHOLD_INTROS.quarry_master).toContain("out of Ireland");
    expect(HOUSEHOLD_INTROS.carpenter).toContain('"Good enough"');
    expect(HOUSEHOLD_INTROS.mason).toMatch(/^Gerold\./);
    expect(HOUSEHOLD_INTROS.potter).toMatch(/^Hugo\./);
    expect(HOUSEHOLD_INTROS.village_reeve).toMatch(/^Otto\./);
    expect(HOUSEHOLD_INTROS.vinedresser).toMatch(/^Ambrosius/);
    expect(HOUSEHOLD_INTROS.head_seamstress).toMatch(/^Hildegard\./);
    expect(HOUSEHOLD_INTROS.copper_smith).toMatch(/^Lorenzo/);
    expect(HOUSEHOLD_INTROS.captain).toMatch(/^Eberhard\./);
    expect(HOUSEHOLD_INTROS.negotiator).toMatch(/^My name Gerulf, my lord/);
    expect(HOUSEHOLD_INTROS.negotiator).toMatch(/Do not send me for barley/);
    expect(Object.keys(MERCHANT_INTROS)).toEqual([
      "Gero",
      "Odo",
      "Liutward",
      "Theudo",
      "Boso",
      "Isaac",
      "Salamon",
      "Wichard",
    ]);
    expect(MERCHANT_INTROS.Isaac).toContain("nu, let's see the stock");
  });

  it("marks household intros on the npc and merchant intros by visitor name", () => {
    const state = boot();
    expect(introSpeechFor("steward", state)).toBe(HOUSEHOLD_INTROS.steward);
    expect(introAlreadySpoken(state, "steward")).toBe(false);
    markIntroSpoken(state, "steward");
    expect(state.npcs.find((n) => n.id === "steward")?.introSpoken).toBe(true);
    expect(introAlreadySpoken(state, "steward")).toBe(true);

    applyMerchantRoll(state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: true });
    const name = state.merchant.name!;
    expect(introSpeechFor("merchant", state)).toBe(MERCHANT_INTROS[name]);
    expect(introAlreadySpoken(state, "merchant")).toBe(false);
    markIntroSpoken(state, "merchant");
    expect(state.merchant_intro_spoken[name]).toBe(true);
    expect(state.npcs.find((n) => n.id === "merchant")?.introSpoken).toBe(true);

    applyMerchantRoll(state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: false });
    expect(state.merchant_intro_spoken[name]).toBe(true);

    const saved = cloneState(state);
    expect(saved.npcs.find((n) => n.id === "steward")?.introSpoken).toBe(true);
    expect(saved.merchant_intro_spoken[name]).toBe(true);
  });
});
