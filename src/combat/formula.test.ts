import { describe, expect, it } from "vitest";
import {
  averageDamage,
  counterDamageSplit,
  escapeFraction,
  expectedDamage,
  finalDamage,
  flankShock,
  gangUpModifiers,
  hardenedStructureAtk,
  hitMultiplier,
  hitsToBreak,
  isDisordered,
  killFraction,
  overnightMorale,
  resolveHit,
  routHeadcount,
  routSplit,
  splashPortions,
  swampDefBonus,
} from "./formula";
import { createRng, seedFromString } from "./rng";
import { requireUnitSheet, armorDef } from "./registry";

const heavyHorse = requireUnitSheet("heavy_horse");
const levy = requireUnitSheet("peasant_levy");
const pedites = requireUnitSheet("pedites_fyrd");
const caballarii = requireUnitSheet("caballarii");

/** Levy ATK after improvised_weapons ×0.7 against an armored target (§6 worked example). */
const LEVY_EFFECTIVE_ATK = levy.atk * 0.7;

describe("§6 base round formula — worked examples", () => {
  it("Heavy Horse (ATK 18) vs Peasant Levy (DEF 5): multiplier 0.783, 11 rolled → 9 HP and 9 morale", () => {
    const m = hitMultiplier(heavyHorse.atk, levy.def);
    expect(m).toBeCloseTo(0.783, 3);
    const hit = resolveHit({ effectiveAtk: heavyHorse.atk, effectiveDef: levy.def, rolledDamage: 11 });
    expect(hit.hpDamage).toBe(9);
    expect(hit.moraleDamage).toBe(9);
  });

  it("Levy's 35 Morale breaks in roughly 4 solid Heavy Horse hits, well before 60 HP", () => {
    expect(hitsToBreak(levy.morale, heavyHorse.atk, levy.def, heavyHorse.damage)).toBe(4);
    expect(hitsToBreak(levy.hp, heavyHorse.atk, levy.def, heavyHorse.damage)).toBeGreaterThan(4);
  });

  it("Peasant Levy (5.6 effective) vs Heavy Horse (DEF 15): multiplier 0.272, 5 rolled → barely 1 HP", () => {
    expect(LEVY_EFFECTIVE_ATK).toBeCloseTo(5.6, 5);
    expect(hitMultiplier(LEVY_EFFECTIVE_ATK, heavyHorse.def)).toBeCloseTo(0.272, 3);
    const hit = resolveHit({ effectiveAtk: LEVY_EFFECTIVE_ATK, effectiveDef: heavyHorse.def, rolledDamage: 5 });
    expect(hit.hpDamage).toBe(1);
  });

  it("equal ATK and DEF lets half the damage through; a connecting hit never does less than 1", () => {
    expect(hitMultiplier(10, 10)).toBe(0.5);
    expect(finalDamage(1, 0.05)).toBe(1);
    expect(finalDamage(0, 0.9)).toBe(0);
  });

  it("veteran morale_damage_ratio 0.6 and undisciplined 1.5 scale morale but not HP", () => {
    const vet = resolveHit({ effectiveAtk: 18, effectiveDef: 5, rolledDamage: 11, moraleDamageRatio: 0.6 });
    expect(vet.hpDamage).toBe(9);
    expect(vet.moraleDamage).toBe(5);
    const green = resolveHit({ effectiveAtk: 18, effectiveDef: 5, rolledDamage: 11, moraleLossMultiplier: 1.5 });
    expect(green.hpDamage).toBe(9);
    expect(green.moraleDamage).toBe(14);
  });
});

describe("§7.7 Caballarii validation ratios", () => {
  it("Caballarii vs Pedites ≈ 0.65; Heavy Horse vs Caballarii ≈ 0.62", () => {
    expect(hitMultiplier(caballarii.atk, pedites.def)).toBeCloseTo(0.65, 2);
    expect(hitMultiplier(heavyHorse.atk, caballarii.def)).toBeCloseTo(0.62, 2);
  });
});

describe("§8.3 splash shares", () => {
  it("target 2 shares, engaged unit 1 share: 12 rolled → 8 and 4", () => {
    const rows = splashPortions(12, "A", ["Unit1"]);
    expect(rows.find((r) => r.unit === "A")?.portion).toBe(8);
    expect(rows.find((r) => r.unit === "Unit1")?.portion).toBe(4);
  });

  it("§8.5 scrum: a Disordered pair splits the target's 2 shares 1/1; others unaffected", () => {
    const rows = splashPortions(12, "A", ["Unit1", "Reserve"], "Unit1");
    expect(rows.find((r) => r.unit === "A")?.shares).toBe(1);
    expect(rows.find((r) => r.unit === "Unit1")?.shares).toBe(1);
    expect(rows.find((r) => r.unit === "Reserve")?.shares).toBe(1);
    expect(rows.reduce((s, r) => s + r.portion, 0)).toBeCloseTo(12, 9);
  });
});

describe("§8.4 gang-up, counter split, flank shock", () => {
  it("table: 1 → none, 2 → +15%/−10%, 3 → +25%/−20%, 4 → not allowed", () => {
    expect(gangUpModifiers(1)).toEqual({ atkMultiplier: 1, defMultiplier: 1, allowed: true });
    expect(gangUpModifiers(2).atkMultiplier).toBeCloseTo(1.15);
    expect(gangUpModifiers(2).defMultiplier).toBeCloseTo(0.9);
    expect(gangUpModifiers(3).atkMultiplier).toBeCloseTo(1.25);
    expect(gangUpModifiers(3).defMultiplier).toBeCloseTo(0.8);
    expect(gangUpModifiers(4).allowed).toBe(false);
  });

  it("counter-damage is front-loaded to whoever engaged first", () => {
    expect(counterDamageSplit(1)).toEqual([1]);
    expect(counterDamageSplit(2)[0]).toBeCloseTo(2 / 3);
    expect(counterDamageSplit(3)).toEqual([0.5, 0.25, 0.25]);
  });

  it("knights barely notice levy flanking them; levy surrounded by knights are finished", () => {
    const knightsJoinOnLevy = flankShock(averageDamage(heavyHorse.damage), 2, heavyHorse.atk, levy.def);
    const levyJoinOnKnights = flankShock(averageDamage(levy.damage), 2, LEVY_EFFECTIVE_ATK, heavyHorse.def);
    expect(knightsJoinOnLevy).toBeGreaterThanOrEqual(25);
    expect(levyJoinOnKnights).toBeLessThanOrEqual(5);
    expect(flankShock(averageDamage(heavyHorse.damage), 3, heavyHorse.atk, levy.def)).toBe(knightsJoinOnLevy * 2);
  });
});

describe("§8.5 Disordered", () => {
  it("triggers at or below 25% of max Morale", () => {
    expect(isDisordered(8, 35)).toBe(true);
    expect(isDisordered(9, 35)).toBe(false);
    expect(isDisordered(20, 80)).toBe(true);
  });
});

describe("§8.7 rout resolution — worked examples", () => {
  it("Peasant Levy run down by three Heavy Horse: ~5% escape, ~78% killed, ~17% captured", () => {
    const pursuers = [heavyHorse.speed, heavyHorse.speed, heavyHorse.speed];
    expect(escapeFraction(levy.speed, pursuers)).toBe(0.05);
    const kill = killFraction(heavyHorse.atk * 1.3, levy.def);
    expect(kill).toBeCloseTo(0.82, 2);
    const split = routSplit(levy.speed, pursuers, heavyHorse.atk * 1.3, levy.def);
    expect(split.killed).toBeCloseTo(0.78, 2);
    expect(split.captured).toBeCloseTo(0.17, 2);
    const men = routHeadcount(levy.strength, split);
    expect(men.escaped + men.killed + men.captured).toBe(levy.strength);
    expect(men.killed).toBeGreaterThan(men.captured);
  });

  it("Heavy Horse chased by three Peasant Levy: 40% escape, ~16% killed, ~44% captured", () => {
    const pursuers = [levy.speed, levy.speed, levy.speed];
    expect(escapeFraction(heavyHorse.speed, pursuers)).toBeCloseTo(0.4, 9);
    const split = routSplit(heavyHorse.speed, pursuers, LEVY_EFFECTIVE_ATK, heavyHorse.def);
    expect(split.killed).toBeCloseTo(0.16, 2);
    expect(split.captured).toBeCloseTo(0.44, 2);
    expect(split.captured).toBeGreaterThan(split.killed);
  });

  it("only the first three pursuers count toward escape (gang-up cap)", () => {
    expect(escapeFraction(2, [5, 5, 5, 5, 5])).toBe(escapeFraction(2, [5, 5, 5]));
  });
});

describe("§9.4 fortifications", () => {
  it("Pedites (ATK 12) vs a proper Wooden wall (Structural DEF 12): ~1 damage a hit, ~80 hits to breach", () => {
    const reduced = hardenedStructureAtk(pedites.atk, 12, false);
    expect(reduced).toBe(1);
    expect(hitMultiplier(reduced, 12)).toBeCloseTo(0.077, 3);
    expect(hitsToBreak(80, reduced, 12, pedites.damage)).toBe(80);
  });

  it("Heavy Horse (ATK 18) vs the same wall: ~4 damage a hit, ~20 hits", () => {
    const reduced = hardenedStructureAtk(heavyHorse.atk, 12, false);
    expect(reduced).toBe(6);
    expect(hitMultiplier(reduced, 12)).toBeCloseTo(0.333, 3);
    expect(expectedDamage(reduced, 12, heavyHorse.damage)).toBe(4);
    expect(hitsToBreak(80, reduced, 12, heavyHorse.damage)).toBe(20);
  });

  it("a siege_weapon (ATK 30, 10–15) bypasses the reduction: ~9 a hit, ~9 hits", () => {
    const atk = hardenedStructureAtk(30, 12, true);
    expect(atk).toBe(30);
    expect(hitMultiplier(atk, 12)).toBeCloseTo(0.714, 3);
    expect(expectedDamage(atk, 12, { min: 10, max: 15 })).toBe(9);
    expect(hitsToBreak(80, atk, 12, { min: 10, max: 15 })).toBe(9);
  });

  it("siege engine vs Pedites: HP loss halved (5) but morale takes the full 9", () => {
    const hit = resolveHit({ effectiveAtk: 30, effectiveDef: pedites.def, rolledDamage: 12, hpDamageMultiplier: 0.5 });
    expect(hit.hitMultiplier).toBeCloseTo(0.79, 2);
    expect(hit.fullDamage).toBe(9);
    expect(hit.hpDamage).toBe(5);
    expect(hit.moraleDamage).toBe(9);
  });
});

describe("§9.1 swamp and §8.6 overnight", () => {
  it("swamp rewards heavy armor less than expected: +1 DEF per 5 base DEF", () => {
    expect(swampDefBonus(levy.def)).toBe(1);
    expect(swampDefBonus(heavyHorse.def)).toBe(3);
    expect(swampDefBonus(4)).toBe(0);
  });

  it("overnight recovers 15–20% of max Morale and never exceeds max", () => {
    const rng = createRng(7);
    for (let i = 0; i < 50; i++) {
      const next = overnightMorale(20, 80, rng);
      expect(next).toBeGreaterThanOrEqual(32);
      expect(next).toBeLessThanOrEqual(36);
    }
    expect(overnightMorale(78, 80, rng)).toBe(80);
  });
});

describe("armor-sourced DEF for armor_piercing", () => {
  it("levy 3 (gambison), pedites 5 (gambison+shield), heavy horse 5, elite foot 7, penthouse ram 10", () => {
    expect(armorDef(levy)).toBe(3);
    expect(armorDef(pedites)).toBe(5);
    expect(armorDef(heavyHorse)).toBe(5);
    expect(armorDef(requireUnitSheet("elite_foot"))).toBe(7);
    expect(armorDef(requireUnitSheet("battering_ram_penthouse"))).toBe(10);
    expect(armorDef(requireUnitSheet("sagittarii"))).toBe(0);
  });
});

describe("seeded rng", () => {
  it("is reproducible from a seed and stays inside bounds", () => {
    const a = createRng(seedFromString("fontenay"));
    const b = createRng(seedFromString("fontenay"));
    const seqA = Array.from({ length: 20 }, () => a.int(4, 7));
    const seqB = Array.from({ length: 20 }, () => b.int(4, 7));
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 4 && v <= 7)).toBe(true);
    expect(new Set(seqA).size).toBeGreaterThan(1);
  });

  it("chance(0) never fires and chance(1) always fires", () => {
    const rng = createRng(1);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
  });
});
