import { describe, expect, it } from "vitest";
import {
  FORTIFICATION_TYPES,
  TAGS,
  TERRAIN,
  UNIT_SHEETS,
  WEATHER,
  canonicalTagId,
  fireCadence,
  fortificationType,
  hasTag,
  isArmored,
  makeshiftOf,
  requireUnitSheet,
  unknownTags,
  unlockedOrders,
  unmetTagRequirements,
  volleyCharges,
} from "./registry";
import { TagDefSchema, UnitSheetSchema } from "./schema";

describe("unit roster (§7)", () => {
  it("holds the 18 sheets: 10 troop and 8 siege", () => {
    expect(UNIT_SHEETS).toHaveLength(18);
    expect(UNIT_SHEETS.filter((u) => u.kind === "troop")).toHaveLength(10);
    expect(UNIT_SHEETS.filter((u) => u.kind === "siege")).toHaveLength(8);
    expect(new Set(UNIT_SHEETS.map((u) => u.id)).size).toBe(18);
  });

  it("every tag on every sheet exists in the registry", () => {
    for (const u of UNIT_SHEETS) expect(unknownTags(u.tags), u.id).toEqual([]);
  });

  it("every sheet satisfies its tags' Speed/Range requirements", () => {
    for (const u of UNIT_SHEETS) expect(unmetTagRequirements(u), u.id).toEqual([]);
  });

  it("ranged units carry the ranged tag and melee units do not", () => {
    for (const u of UNIT_SHEETS.filter((x) => x.kind === "troop")) {
      expect(hasTag(u.tags, "ranged"), u.id).toBe(u.range >= 1);
    }
  });

  it("Phase 0 range decision: javelins 1, bows 2, siege 2–3, counterweight trebuchet 4", () => {
    expect(requireUnitSheet("breton_gascon_light_cavalry").range).toBe(1);
    expect(requireUnitSheet("sagittarii").range).toBe(2);
    expect(requireUnitSheet("traction_trebuchet").range).toBe(3);
    expect(requireUnitSheet("onager").range).toBe(3);
    expect(requireUnitSheet("ballista").range).toBe(2);
    expect(requireUnitSheet("cannon").range).toBe(3);
    expect(requireUnitSheet("counterweight_trebuchet").range).toBe(4);
    for (const u of UNIT_SHEETS) expect(u.range, u.id).toBeLessThanOrEqual(4);
  });

  it("Caballarii is the Rank-and-File default: mounted, drilled_spear, shield, no shock/elite/heavy_armor", () => {
    const c = requireUnitSheet("caballarii");
    expect(c.tags).toEqual(["mounted", "drilled_spear", "shield"]);
    expect(unlockedOrders(c)).toContain("hold_formation");
    expect(c.speed).toBe(requireUnitSheet("heavy_horse").speed);
  });

  it("Ship Crew uses the Pedites/Fyrd stat line with a smaller headcount", () => {
    const ship = requireUnitSheet("ship_crew");
    const ped = requireUnitSheet("pedites_fyrd");
    for (const k of ["hp", "atk", "def", "range", "speed", "morale"] as const) expect(ship[k]).toBe(ped[k]);
    expect(ship.damage).toEqual(ped.damage);
    expect(ship.strength).toBeLessThan(ped.strength);
  });

  it("ammo: quiver 24 by default, a dozen javelins via tagParams", () => {
    expect(volleyCharges(requireUnitSheet("sagittarii"))).toBe(24);
    expect(volleyCharges(requireUnitSheet("frankish_horse_archers"))).toBe(24);
    expect(volleyCharges(requireUnitSheet("breton_gascon_light_cavalry"))).toBe(12);
    expect(volleyCharges(requireUnitSheet("heavy_horse"))).toBeUndefined();
  });

  it("fire cadence: crossbow every 2nd round, trebuchets and cannon slower", () => {
    expect(fireCadence(requireUnitSheet("sagittarii"))).toBe(1);
    expect(fireCadence(requireUnitSheet("crossbowmen"))).toBe(2);
    expect(fireCadence(requireUnitSheet("traction_trebuchet"))).toBe(2);
    expect(fireCadence(requireUnitSheet("counterweight_trebuchet"))).toBe(3);
    expect(fireCadence(requireUnitSheet("cannon"))).toBe(3);
  });

  it("anachronistic sheets are flagged, never nerfed", () => {
    const cw = requireUnitSheet("counterweight_trebuchet");
    const tt = requireUnitSheet("traction_trebuchet");
    expect(cw.anachronistic).toBe(true);
    expect(requireUnitSheet("cannon").anachronistic).toBe(true);
    expect(cw.atk).toBeGreaterThan(tt.atk);
    expect(UNIT_SHEETS.filter((u) => u.anachronistic)).toHaveLength(2);
  });

  it("armored vs unarmored for improvised_weapons", () => {
    expect(isArmored(requireUnitSheet("peasant_levy"))).toBe(true);
    expect(isArmored(requireUnitSheet("sagittarii"))).toBe(false);
    expect(isArmored(requireUnitSheet("crossbowmen"))).toBe(false);
  });

  it("rejects a malformed sheet", () => {
    const bad = { ...requireUnitSheet("peasant_levy"), damage: { min: 9, max: 4 } };
    expect(UnitSheetSchema.safeParse(bad).success).toBe(false);
    const extra = { ...requireUnitSheet("peasant_levy"), prowess: 3 };
    expect(UnitSheetSchema.safeParse(extra).success).toBe(false);
  });
});

describe("tag registry (§7.19)", () => {
  it("has unique ids and no retired tags", () => {
    expect(new Set(TAGS.map((t) => t.id)).size).toBe(TAGS.length);
    expect(TAGS.some((t) => t.id === "low_armor")).toBe(false);
  });

  it("cavalry is an alias of mounted, so anti_cavalry_spears fires on mounted attackers", () => {
    expect(canonicalTagId("cavalry")).toBe("mounted");
    expect(hasTag(["mounted"], "cavalry")).toBe(true);
    const acs = TAGS.find((t) => t.id === "anti_cavalry_spears");
    expect(acs?.conditional?.some((c) => c.when.attackerHasTag === "mounted" && c.defMultiplier === 1.8)).toBe(true);
  });

  it("shock uses the registry numbers: ×1.4, −15, Speed ≥ 4", () => {
    const shock = TAGS.find((t) => t.id === "shock");
    expect(shock?.onCharge?.atkMultiplier).toBe(1.4);
    expect(shock?.onChargeStopped?.moraleDelta).toBe(-15);
    expect(shock?.requires?.minSpeed).toBe(4);
  });

  it("every tag referenced inside a conditional or depletion hook exists", () => {
    const ids = new Set(TAGS.map((t) => t.id));
    for (const t of TAGS) {
      for (const c of t.conditional ?? []) {
        for (const ref of [c.when.targetHasTag, c.when.targetLacksTag, c.when.attackerHasTag]) {
          if (ref) expect(ids.has(ref) || canonicalTagId(ref) !== undefined, `${t.id} → ${ref}`).toBe(true);
        }
      }
      for (const ref of [t.onChargesDepleted?.losesTag, t.onChargesDepleted?.gainsTag]) {
        if (ref) expect(ids.has(ref), `${t.id} → ${ref}`).toBe(true);
      }
    }
  });

  it("every introducedOn points at a real sheet that carries the tag", () => {
    for (const t of TAGS) {
      if (!t.introducedOn) continue;
      const sheet = UNIT_SHEETS.find((u) => u.id === t.introducedOn);
      expect(sheet, `${t.id} introduced on ${t.introducedOn}`).toBeDefined();
      expect(sheet?.tags, `${t.id} on ${t.introducedOn}`).toContain(t.id);
    }
  });

  it("rejects a tag that invents a hook outside the closed vocabulary", () => {
    const bad = { id: "war_chariot", summary: "x", scytheDamage: 5 };
    expect(TagDefSchema.safeParse(bad).success).toBe(false);
    const badCondition = { id: "war_chariot", summary: "x", conditional: [{ when: { targetIsPeasant: true }, atkMultiplier: 2 }] };
    expect(TagDefSchema.safeParse(badCondition).success).toBe(false);
    const good = { id: "war_chariot", summary: "x", conditional: [{ when: { targetLacksTag: "mounted" }, atkMultiplier: 1.2 }] };
    expect(TagDefSchema.safeParse(good).success).toBe(true);
  });
});

describe("terrain, weather, fortifications (§9)", () => {
  it("covers the eight terrain types and four weathers", () => {
    expect(TERRAIN.map((t) => t.id).sort()).toEqual(
      ["cliffs", "grassland", "heavy_brush", "hills", "river", "stream", "swamp", "woodland"],
    );
    expect(WEATHER.map((w) => w.id).sort()).toEqual(["fog", "high_winds", "rain", "sunshine"]);
    expect(WEATHER.find((w) => w.id === "rain")?.rangedAtkMultiplier).toBe(0.85);
    expect(WEATHER.find((w) => w.id === "fog")?.scoutingPoolSize).toBe(4);
  });

  it("wooden 80/12/+10, stone 150/20/+20; makeshift ×0.6 lands stone near proper wooden", () => {
    expect(FORTIFICATION_TYPES).toHaveLength(2);
    const wooden = fortificationType("wooden")!;
    const stone = fortificationType("stone")!;
    expect([wooden.pointHp, wooden.structuralDef, wooden.defenderDefBonus]).toEqual([80, 12, 10]);
    expect([stone.pointHp, stone.structuralDef, stone.defenderDefBonus]).toEqual([150, 20, 20]);
    const mw = makeshiftOf(wooden);
    const ms = makeshiftOf(stone);
    expect([mw.pointHp, mw.structuralDef, mw.defenderDefBonus]).toEqual([48, 7, 6]);
    expect([ms.pointHp, ms.structuralDef, ms.defenderDefBonus]).toEqual([90, 12, 12]);
  });
});
