import { afterEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "./schema";
import { MERCHANT_NAMES, applyMerchantRoll } from "./merchant";

function estate() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const visit = {
  base: 0.3,
  bonus: 0,
  chance: 0.3,
  notes: [] as string[],
};

describe("merchant visitor face", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows starting estate JSON to omit face", () => {
    const state = estate();
    expect(state.merchant.present).toBe(false);
    expect(state.merchant.face).toBeUndefined();
  });

  it.each(MERCHANT_NAMES.map((name, idx) => ({ name, face: idx + 1, slot: idx / MERCHANT_NAMES.length })))(
    "maps index to $name with face $face",
    ({ name, face, slot }) => {
      vi.spyOn(Math, "random").mockReturnValue(slot);
      const state = estate();
      applyMerchantRoll(state, { ...visit, arrived: true });
      expect(state.merchant.present).toBe(true);
      expect(state.merchant.name).toBe(name);
      expect(state.merchant.face).toBe(face);
      expect(state.npcs.find((n) => n.id === "merchant")?.name).toBe(name);
    },
  );

  it("clears face when no merchant arrives", () => {
    const state = estate();
    state.merchant.present = true;
    state.merchant.name = "Gero";
    state.merchant.face = 1;
    applyMerchantRoll(state, { ...visit, arrived: false });
    expect(state.merchant.present).toBe(false);
    expect(state.merchant.name).toBeUndefined();
    expect(state.merchant.face).toBeUndefined();
    expect(state.npcs.some((n) => n.id === "merchant")).toBe(false);
  });
});
