import { describe, expect, it } from "vitest";
import { emptyBattlefield, cellIndex } from "./grid";
import { moraleMultipliers, orderMenu, resolveAttackModifiers } from "./tags";
import { spawnUnit } from "./units";

const field = emptyBattlefield();
const hh = spawnUnit("heavy_horse", { id: "hh", side: "player", cell: { row: 3, col: 1 } });
const levy = spawnUnit("peasant_levy", { id: "lv", side: "enemy", cell: { row: 3, col: 1 } });
const archers = spawnUnit("sagittarii", { id: "sg", side: "enemy", cell: { row: 4, col: 1 } });
const xbow = spawnUnit("crossbowmen", { id: "xb", side: "player", cell: { row: 1, col: 1 } });
const pedites = spawnUnit("pedites_fyrd", { id: "pd", side: "enemy", cell: { row: 3, col: 1 } });
const elite = spawnUnit("elite_foot", { id: "ef", side: "enemy", cell: { row: 3, col: 1 } });

describe("§6 modifier order of operations", () => {
  it("no tags in play: sheet numbers pass through (Heavy Horse 18 vs Levy 5)", () => {
    const m = resolveAttackModifiers({ attacker: hh, target: levy, attackKind: "melee", field });
    expect(m.atk.value).toBe(18);
    expect(m.def.value).toBe(5);
    expect(m.atk.notes).toEqual([]);
  });

  it("improvised_weapons: ×0.7 against armor, full ATK against unarmored archers", () => {
    expect(resolveAttackModifiers({ attacker: levy, target: hh, attackKind: "melee", field }).atk.value).toBeCloseTo(5.6);
    expect(resolveAttackModifiers({ attacker: levy, target: archers, attackKind: "melee", field }).atk.value).toBe(8);
  });

  it("armor_piercing halves armor-sourced DEF only: Heavy Horse 15 → 12.5", () => {
    const m = resolveAttackModifiers({ attacker: xbow, target: hh, attackKind: "ranged", field });
    expect(m.def.value).toBe(12.5);
    expect(resolveAttackModifiers({ attacker: xbow, target: archers, attackKind: "ranged", field }).def.value).toBe(3);
  });

  it("shield gives +1 more against ranged; gambison alone does not", () => {
    expect(resolveAttackModifiers({ attacker: archers, target: pedites, attackKind: "ranged", field }).def.value).toBe(9);
    expect(resolveAttackModifiers({ attacker: archers, target: levy, attackKind: "ranged", field }).def.value).toBe(5);
    expect(resolveAttackModifiers({ attacker: hh, target: pedites, attackKind: "melee", field }).def.value).toBe(8);
  });

  it("anti_cavalry_spears: DEF ×1.8 against mounted, counter-damage only against a charge", () => {
    const steady = resolveAttackModifiers({ attacker: hh, target: elite, attackKind: "melee", field });
    expect(steady.def.value).toBeCloseTo(16 * 1.8);
    expect(steady.counterDamage).toBe(false);
    const charge = resolveAttackModifiers({ attacker: hh, target: elite, attackKind: "melee", field, attackerCharging: true });
    expect(charge.counterDamage).toBe(true);
    expect(charge.atk.value).toBeCloseTo(18 * 1.4);
    expect(resolveAttackModifiers({ attacker: pedites, target: elite, attackKind: "melee", field }).def.value).toBe(16);
  });

  it("shock needs Speed ≥ 4: Caballarii charge without shock get no bonus", () => {
    const cab = spawnUnit("caballarii", { id: "cb", side: "player", cell: { row: 3, col: 1 } });
    expect(resolveAttackModifiers({ attacker: cab, target: levy, attackKind: "melee", field, attackerCharging: true }).atk.value).toBe(15);
  });

  it("low_melee bites once engaged; hold_formation adds +2", () => {
    const engagedArchers = { ...archers, engagedWith: ["hh"], engagedSince: { hh: 1 } };
    const m = resolveAttackModifiers({ attacker: engagedArchers, target: hh, attackKind: "melee", field });
    expect(m.atk.value).toBe(4);
    expect(resolveAttackModifiers({ attacker: hh, target: engagedArchers, attackKind: "melee", field }).def.value).toBe(1.5);
    const braced = { ...pedites, holdFormation: true };
    expect(resolveAttackModifiers({ attacker: hh, target: braced, attackKind: "melee", field }).def.value).toBe(10);
  });

  it("gang-up: two attackers → each ×1.15 ATK, defender ×0.9 DEF", () => {
    const m = resolveAttackModifiers({ attacker: hh, target: levy, attackKind: "melee", field, attackersOnTarget: 2 });
    expect(m.atk.value).toBeCloseTo(18 * 1.15);
    expect(m.def.value).toBeCloseTo(4.5);
  });

  it("weather and terrain: rain ×0.85 ranged, brush +5 vs ranged, swamp +3 for Heavy Horse, high ground ×1.5", () => {
    const rainy = { ...field, weather: "rain" };
    expect(resolveAttackModifiers({ attacker: archers, target: levy, attackKind: "ranged", field: rainy }).atk.value).toBeCloseTo(8.5);
    const f = emptyBattlefield();
    f.cells[cellIndex({ row: 3, col: 1 })].terrain = ["heavy_brush"];
    expect(resolveAttackModifiers({ attacker: archers, target: levy, attackKind: "ranged", field: f }).def.value).toBe(10);
    expect(resolveAttackModifiers({ attacker: archers, target: levy, attackKind: "melee", field: f }).def.value).toBe(5);
    f.cells[cellIndex({ row: 3, col: 1 })].terrain = ["swamp"];
    expect(resolveAttackModifiers({ attacker: levy, target: hh, attackKind: "melee", field: f }).def.value).toBe(18);
    f.cells[cellIndex({ row: 3, col: 1 })].terrain = ["hills"];
    expect(resolveAttackModifiers({ attacker: hh, target: levy, attackKind: "melee", field: f, attackerIsDefender: true }).atk.value).toBe(27);
    expect(resolveAttackModifiers({ attacker: hh, target: levy, attackKind: "melee", field: f, targetIsDefender: true }).def.value).toBe(7.5);
  });

  it("siege_weapon halves HP damage vs troops unless precision_bolt or grapeshot", () => {
    const treb = spawnUnit("traction_trebuchet", { id: "tb", side: "player", cell: { row: 1, col: 1 } });
    const ballista = spawnUnit("ballista", { id: "bl", side: "player", cell: { row: 1, col: 1 } });
    const cannon = spawnUnit("cannon", { id: "cn", side: "player", cell: { row: 1, col: 1 } });
    expect(resolveAttackModifiers({ attacker: treb, target: levy, attackKind: "ranged", field }).hpDamageMultiplier).toBe(0.5);
    expect(resolveAttackModifiers({ attacker: ballista, target: levy, attackKind: "ranged", field }).hpDamageMultiplier).toBe(1);
    const grape = resolveAttackModifiers({ attacker: cannon, target: levy, attackKind: "ranged", field, shot: "grape" });
    expect(grape.hpDamageMultiplier).toBe(1);
    expect(grape.bypassesHardenedStructure).toBe(false);
    expect(grape.extraMoraleDelta).toBe(-10);
    const solid = resolveAttackModifiers({ attacker: cannon, target: levy, attackKind: "ranged", field, shot: "solid" });
    expect(solid.hpDamageMultiplier).toBe(0.5);
    expect(solid.bypassesHardenedStructure).toBe(true);
  });

  it("efficient_finisher vs routing: damage ×1.5 and no ammo", () => {
    const ha = spawnUnit("frankish_horse_archers", { id: "ha", side: "player", cell: { row: 3, col: 1 } });
    const m = resolveAttackModifiers({ attacker: ha, target: levy, attackKind: "melee", field, targetRouting: true });
    expect(m.damageMultiplier).toBe(1.5);
    expect(m.bypassesAmmoCost).toBe(true);
    expect(m.atk.value).toBeCloseTo(9 * 1.3);
  });

  it("veteran and undisciplined morale multipliers; veteran also lifts HP and ATK", () => {
    expect(moraleMultipliers(levy)).toEqual({ moraleDamageRatio: 1, moraleLossMultiplier: 1.5 });
    const vet = spawnUnit("pedites_fyrd", { id: "vp", side: "player", extraTags: ["veteran"] });
    expect(vet.maxHp).toBe(79);
    expect(moraleMultipliers(vet).moraleDamageRatio).toBe(0.6);
    expect(resolveAttackModifiers({ attacker: vet, target: levy, attackKind: "melee", field }).atk.value).toBeCloseTo(12.6);
  });

  it("tags generate the order menu", () => {
    expect(orderMenu(pedites)).toContain("hold_formation");
    expect(orderMenu(pedites)).not.toContain("fire");
    const ha = spawnUnit("frankish_horse_archers", { id: "ha2", side: "player" });
    expect(orderMenu(ha)).toEqual(expect.arrayContaining(["fire", "skirmish_and_withdraw", "engage"]));
    const tower = spawnUnit("siege_tower", { id: "tw", side: "player" });
    expect(orderMenu(tower)).not.toContain("engage");
  });
});
