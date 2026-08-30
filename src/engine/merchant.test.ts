import { afterEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "./schema";
import { MERCHANT_NAMES, MERCHANT_VISITORS, applyMerchantRoll } from "./merchant";

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

  it.each(MERCHANT_VISITORS.map((v, idx) => ({ ...v, slot: idx / MERCHANT_VISITORS.length })))(
    "maps index to $name with face $face and that visitor's notes",
    ({ name, face, notes, slot }) => {
      vi.spyOn(Math, "random").mockReturnValue(slot);
      const state = estate();
      applyMerchantRoll(state, { ...visit, arrived: true });
      expect(state.merchant.present).toBe(true);
      expect(state.merchant.name).toBe(name);
      expect(state.merchant.face).toBe(face);
      const npc = state.npcs.find((n) => n.id === "merchant");
      expect(npc?.name).toBe(name);
      expect(npc?.notes).toBe(notes);
    },
  );

  it("keeps the signed-off face order on main", () => {
    expect(MERCHANT_NAMES).toEqual(["Gero", "Odo", "Liutward", "Theudo", "Boso", "Isaac", "Salamon", "Wichard"]);
    expect(MERCHANT_VISITORS.map((v) => v.name)).toEqual([...MERCHANT_NAMES]);
    expect(MERCHANT_VISITORS.map((v) => v.face)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(MERCHANT_VISITORS.find((v) => v.name === "Theudo")?.face).toBe(4);
    expect(MERCHANT_VISITORS.find((v) => v.name === "Isaac")?.notes).toMatch(/Yiddish/);
    expect(MERCHANT_VISITORS.find((v) => v.name === "Wichard")?.voice).toMatch(/cowboy drawl/);
  });

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
