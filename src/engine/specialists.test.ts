import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "./schema";
import {
  HIREABLE_SPECIALISTS,
  REEVE_HOUSEHOLD_THRESHOLD,
  STARTING_HOUSEHOLDS,
  STARTING_VINEYARD_ACRES,
  inferHireProposals,
  recommendableHires,
  specialistById,
  specialistHireBlocked,
  specialistUnlocked,
  unlockedHireableSpecialists,
} from "./specialists";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const EXPANSION_IDS = ["village_reeve", "vinedresser", "head_seamstress", "copper_smith", "captain"] as const;

describe("expansion hire unlocks", () => {
  it("keeps the four craftsmen unlocked at boot and the five expansion people locked", () => {
    const state = boot();
    expect(state.population.households).toBe(STARTING_HOUSEHOLDS);
    expect(state.holdings[0].households).toBe(STARTING_HOUSEHOLDS);
    expect(state.holdings[0].land.vineyard).toBe(STARTING_VINEYARD_ACRES);
    expect(state.holdings[0].features).toContain("forge");
    expect(state.holdings[0].features).toContain("manor_hall");
    expect(state.holdings[0].features).not.toContain("textile_workshop");
    expect(state.holdings[0].features).not.toContain("bloomery");
    expect(state.holdings[0].features).not.toContain("mill_forge");
    expect(state.holdings[0].features).not.toContain("palisade");

    expect(unlockedHireableSpecialists(state).map((s) => s.id).sort()).toEqual(
      ["carpenter", "mason", "potter", "quarry_master"].sort(),
    );
    for (const id of EXPANSION_IDS) {
      const spec = specialistById(id)!;
      expect(specialistUnlocked(state, spec)).toBe(false);
      expect(specialistHireBlocked(state, spec)).toMatch(/not yet|still small|old acre|workshop|timber forge|defence|defense/i);
    }
    expect(recommendableHires(state)).toEqual([]);
    expect(inferHireProposals(state, "Hire Otto the reeve.")).toEqual([]);
    expect(inferHireProposals(state, "Hire Ambrosius.")).toEqual([]);
  });

  it("unlocks Otto at 15 households, not at 14", () => {
    const state = boot();
    const otto = specialistById("village_reeve")!;
    state.population.households = REEVE_HOUSEHOLD_THRESHOLD - 1;
    state.holdings[0].households = REEVE_HOUSEHOLD_THRESHOLD - 1;
    expect(specialistUnlocked(state, otto)).toBe(false);

    state.population.households = REEVE_HOUSEHOLD_THRESHOLD;
    expect(specialistUnlocked(state, otto)).toBe(true);
    expect(recommendableHires(state).map((s) => s.id)).toEqual(["village_reeve"]);
    expect(inferHireProposals(state, "Hire Otto the reeve.")[0]).toMatchObject({
      type: "register_npc",
      npc: { id: "village_reeve", name: "Otto" },
    });
  });

  it("unlocks Ambrosius only after the vineyard grows past the starting acre", () => {
    const state = boot();
    const ambrosius = specialistById("vinedresser")!;
    expect(specialistUnlocked(state, ambrosius)).toBe(false);
    state.resources.wine = 20;
    expect(specialistUnlocked(state, ambrosius)).toBe(false);

    state.holdings[0].land.vineyard = STARTING_VINEYARD_ACRES + 1;
    expect(specialistUnlocked(state, ambrosius)).toBe(true);
  });

  it("unlocks Ambrosius when expand_vineyard has completed", () => {
    const state = boot();
    state.projects.push({
      id: "proj-vine",
      key: "expand_vineyard",
      name: "Expand vineyard",
      holdingId: "fontenay",
      labourDaysRequired: 40,
      labourDaysDone: 40,
      materials: { lumber: 0, iron: 0, stone: 0 },
      materialsReserved: true,
      status: "completed",
    });
    expect(specialistUnlocked(state, specialistById("vinedresser")!)).toBe(true);
  });

  it("unlocks Hildegard on textile_workshop, Lorenzo on bloomery or mill_forge, Eberhard on a real defence", () => {
    const state = boot();
    expect(specialistUnlocked(state, specialistById("head_seamstress")!)).toBe(false);
    expect(specialistUnlocked(state, specialistById("copper_smith")!)).toBe(false);
    expect(specialistUnlocked(state, specialistById("captain")!)).toBe(false);

    state.holdings[0].features.push("textile_workshop");
    expect(specialistUnlocked(state, specialistById("head_seamstress")!)).toBe(true);

    state.holdings[0].features.push("bloomery");
    expect(specialistUnlocked(state, specialistById("copper_smith")!)).toBe(true);

    const other = boot();
    other.holdings[0].features.push("mill_forge");
    expect(specialistUnlocked(other, specialistById("copper_smith")!)).toBe(true);

    const hall = boot();
    hall.holdings[0].features.push("tower");
    expect(specialistUnlocked(hall, specialistById("captain")!)).toBe(true);
    const gate = boot();
    gate.holdings[0].features.push("palisade");
    expect(specialistUnlocked(gate, specialistById("captain")!)).toBe(true);
  });

  it("lists every expansion person on the closed catalog", () => {
    expect(HIREABLE_SPECIALISTS.filter((s) => s.requiresExpansion).map((s) => s.name).sort()).toEqual(
      ["Ambrosius", "Eberhard", "Hildegard", "Lorenzo", "Otto"].sort(),
    );
  });
});
