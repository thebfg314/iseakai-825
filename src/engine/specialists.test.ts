import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "./schema";
import { HOUSEHOLD_SEASON_GRAIN } from "./grain";
import {
  HIREABLE_SPECIALISTS,
  REEVE_HOUSEHOLD_THRESHOLD,
  STARTING_HOUSEHOLDS,
  STARTING_VINEYARD_ACRES,
  hireFulfillReason,
  hireSummary,
  inferHireProposals,
  recommendableHires,
  specialistById,
  specialistHireBlocked,
  specialistUnlocked,
  stewardHirePrompt,
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
      expect(specialistHireBlocked(state, spec)).toMatch(/not yet|still small|old acre|workshop|timber forge|no one for a captain to drill/i);
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

  it("unlocks Hildegard on textile_workshop, Lorenzo on bloomery or mill_forge, Eberhard once there are men of the lord's own to drill", () => {
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

    // Design review, item 12: a wall alone does not call for a captain; men to drill do.
    const wall = boot();
    wall.holdings[0].features.push("palisade", "tower");
    expect(specialistUnlocked(wall, specialistById("captain")!)).toBe(false);
    const levy = boot();
    levy.military.units.push({ id: "u1", sheetId: "peasant_levy", name: "The villa's men", veteran: false, strength: 20, raisedTurn: 1 });
    expect(specialistUnlocked(levy, specialistById("captain")!)).toBe(true);
    const gear = boot();
    gear.custom_resources.push({ id: "crossbow_hardware", name: "crossbow locks and prods", unit: "piece", amount: 3, priceMin: 10, priceMax: 20 });
    expect(specialistUnlocked(gear, specialistById("captain")!)).toBe(true);
  });

  it("lists every expansion person on the closed catalog", () => {
    expect(HIREABLE_SPECIALISTS.filter((s) => s.requiresExpansion).map((s) => s.name).sort()).toEqual(
      ["Ambrosius", "Eberhard", "Hildegard", "Lorenzo", "Otto"].sort(),
    );
  });

  it("stores signed-off notes and copies them onto a hired NPC", () => {
    const haimo = specialistById("carpenter")!;
    expect(haimo.notes).toMatch(/Meticulous/);
    expect(haimo.notes).not.toMatch(/Meticulus/);
    expect(specialistById("copper_smith")!.notes).toMatch(/sycophant/);
    expect(specialistById("copper_smith")!.notes).not.toMatch(/syncophant/);
    expect(specialistById("mason")!.notes).toMatch(/Treats raw stone/);
    expect(specialistById("vinedresser")!.notes).toMatch(/a lot of sensory/);
    const state = boot();
    state.resources.denarii = 110;
    const hired = inferHireProposals(state, "Hire Haimo the carpenter.")[0];
    expect(hired).toMatchObject({ type: "register_npc", npc: { name: "Haimo", notes: haimo.notes } });
  });
});

describe("specialist hire cost ladder", () => {
  it("charges the signed-off denarii for each person and never lists Bernard", () => {
    const costs: Record<string, number> = {
      potter: 80,
      carpenter: 110,
      quarry_master: 150,
      mason: 200,
      village_reeve: 20,
      head_seamstress: 60,
      vinedresser: 90,
      copper_smith: 180,
      captain: 250,
    };
    expect(HIREABLE_SPECIALISTS.map((s) => s.id).sort()).toEqual(Object.keys(costs).sort());
    for (const spec of HIREABLE_SPECIALISTS) {
      expect(spec.hireCostDenarii, spec.id).toBe(costs[spec.id]);
    }
    expect(specialistById("village_reeve")!.hireGrainRation).toBe(HOUSEHOLD_SEASON_GRAIN);
    expect(HIREABLE_SPECIALISTS.some((s) => s.id === "smith" || s.name === "Bernard")).toBe(false);
    expect(hireSummary(specialistById("potter")!)).toMatch(/80 denarii/);
    expect(hireSummary(specialistById("village_reeve")!)).toMatch(/20 denarii.*0\.5 modii/);
    expect(stewardHirePrompt(boot())).not.toMatch(/12 denarii|one solidus/i);
  });

  it("does not name expansion hires until their post is open", () => {
    const prompt = stewardHirePrompt(boot());
    expect(prompt).not.toMatch(/\b(Otto|Ambrosius|Hildegard|Lorenzo|Eberhard)\b/);
    expect(prompt).toMatch(/combat specialist/);
    expect(prompt).toMatch(/captain of the guard/);
    const blocked = specialistHireBlocked(boot(), specialistById("captain")!);
    expect(blocked).toMatch(/No captain of the guard yet/);
    expect(blocked).not.toMatch(/Eberhard/);
    for (const id of EXPANSION_IDS) {
      expect(specialistHireBlocked(boot(), specialistById(id)!)).not.toMatch(
        /\b(Otto|Ambrosius|Hildegard|Lorenzo|Eberhard)\b/,
      );
    }

    const levy = boot();
    levy.military.units.push({ id: "u1", sheetId: "peasant_levy", name: "The villa's men", veteran: false, strength: 20, raisedTurn: 1 });
    expect(stewardHirePrompt(levy)).toMatch(/name Eberhard/);
  });

  it("blocks a thin chest, lets Hugo through on the start chest, and refuses Gerold at boot", () => {
    const state = boot();
    expect(state.resources.denarii).toBe(96);
    expect(specialistHireBlocked(state, specialistById("potter")!)).toBeNull();
    expect(inferHireProposals(state, "Hire Hugo the potter.")).toHaveLength(1);

    expect(specialistHireBlocked(state, specialistById("mason")!)).toMatch(/cannot spare 200 denarii/);
    expect(inferHireProposals(state, "Hire Gerold the mason.")).toEqual([]);

    state.resources.denarii = 79;
    expect(specialistHireBlocked(state, specialistById("potter")!)).toMatch(/cannot spare 80 denarii/);
    expect(inferHireProposals(state, "Hire Hugo the potter.")).toEqual([]);
  });

  it("still requires Otto's unlock, 20 denarii, and the household ration", () => {
    const state = boot();
    const otto = specialistById("village_reeve")!;
    expect(specialistHireBlocked(state, otto)).toMatch(/still small|households/i);

    state.population.households = REEVE_HOUSEHOLD_THRESHOLD;
    state.holdings[0].households = REEVE_HOUSEHOLD_THRESHOLD;
    expect(specialistHireBlocked(state, otto)).toBeNull();

    state.resources.denarii = 19;
    expect(specialistHireBlocked(state, otto)).toMatch(/cannot spare 20 denarii/);
    expect(inferHireProposals(state, "Hire Otto the reeve.")).toEqual([]);

    state.resources.denarii = 20;
    state.resources.rye = 0;
    state.resources.wheat = 0;
    state.resources.barley = 0;
    state.resources.oats = 0;
    expect(specialistHireBlocked(state, otto)).toMatch(/granary cannot spare|household ration/);
    expect(inferHireProposals(state, "Hire Otto the reeve.")).toEqual([]);
  });

  it("does not hire Bernard and speech-only is not a hire", () => {
    const state = boot();
    expect(inferHireProposals(state, "Hire Bernard the smith.")).toEqual([]);
    expect(hireFulfillReason(state, "steward", "Hire Bernard the smith.")).toMatch(/not for hire/);
    expect(inferHireProposals(state, "The rye stands well.")).toEqual([]);
  });
});
