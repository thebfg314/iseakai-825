import { afterEach, describe, expect, it } from "vitest";
import { clearCustomContent, unitSheet } from "../combat/registry";
import { LabController } from "./lab";

const chariot = {
  sheet: {
    id: "scythed_chariot",
    name: "Scythed War Chariot",
    kind: "troop",
    hp: 70,
    atk: 16,
    def: 8,
    damage: { min: 7, max: 12 },
    range: 0,
    speed: 5,
    morale: 60,
    strength: 40,
    tags: ["mounted", "shock", "scythe_wheels"],
    anachronistic: true,
  },
  newTags: [{ id: "scythe_wheels", summary: "Blades on the axles.", conditional: [{ when: { targetLacksTag: "mounted" }, damageMultiplier: 1.3 }] }],
  rationale: "Anachronistic, but the player asked.",
};

function lab(replies: string[]) {
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const controller = new LabController(async (messages) => {
    calls.push({ messages });
    return replies.shift() ?? "";
  });
  return { controller, calls };
}

afterEach(() => clearCustomContent());

describe("LabController", () => {
  it("builds from config, steps, rewinds, and auto-runs to a result", () => {
    const { controller } = lab([]);
    controller.setConfig({ seed: 7, player: [{ sheetId: "heavy_horse", count: 1 }], enemy: [{ sheetId: "peasant_levy", count: 2 }] });
    let v = controller.build();
    expect(v.battle?.phase).toBe("rounds");
    expect(v.battle?.units).toHaveLength(3);
    expect(v.controlled).toEqual(["p-heavy_horse-1"]);
    v = controller.step();
    expect(v.battle?.round).toBe(1);
    expect(v.snapshotCount).toBe(1);
    v = controller.step();
    expect(v.battle?.round).toBe(2);
    v = controller.rewind();
    expect(v.battle?.round).toBe(1);
    expect(v.snapshotCount).toBe(1);
    v = controller.autoRun();
    expect(v.battle?.phase).toBe("finished");
    expect(v.summary?.outcome).toBe("victory");
  });

  it("rejects unknown sheets and malformed orders without touching the battle", () => {
    const { controller } = lab([]);
    let v = controller.setConfig({ player: [{ sheetId: "war_elephant" }] });
    expect(v.error).toMatch(/Unknown unit sheet/);
    controller.setConfig({ player: [{ sheetId: "pedites_fyrd" }], enemy: [{ sheetId: "pedites_fyrd" }] });
    controller.build();
    v = controller.step([{ type: "teleport", unitId: "p-pedites_fyrd-1" }]);
    expect(v.error).toMatch(/Order rejected/);
    expect(v.battle?.round).toBe(0);
  });

  it("manual orders are honoured; unfilled controlled units get AI orders unless strictly manual", () => {
    const { controller } = lab([]);
    controller.setConfig({ seed: 3, player: [{ sheetId: "pedites_fyrd", count: 2 }], enemy: [{ sheetId: "peasant_levy" }], enemyPosture: "defend" });
    controller.build();
    controller.step([{ type: "hold", unitId: "p-pedites_fyrd-1" }]);
    let v = controller.step([{ type: "hold", unitId: "p-pedites_fyrd-1" }]);
    const moves = v.battle!.log.filter((e) => e.round <= 2 && e.kind === "move").map((e) => e.unitId);
    expect(moves).not.toContain("p-pedites_fyrd-1");
    expect(moves).toContain("p-pedites_fyrd-2"); // AI filled in for the unit left without an order
    controller.setConfig({ manualOrders: true });
    controller.step([]);
    v = controller.step([]);
    expect(v.battle!.log.filter((e) => e.round >= 3 && e.kind === "move" && e.unitId?.startsWith("p-"))).toHaveLength(0);
  });

  it("applies the terrain painter, a fortification face, garrisons the wall, and Address the Troops", () => {
    const { controller } = lab([]);
    controller.setConfig({
      seed: 5,
      renown: 100,
      rank: 2,
      player: [{ sheetId: "pedites_fyrd", count: 2 }],
      enemy: [{ sheetId: "heavy_horse" }],
      fortification: { side: "player", typeId: "wooden", row: 2, makeshift: true, pointsPerCell: 2 },
      addressTroops: { "p-pedites_fyrd-1": 30 },
    });
    controller.paintCell(3, 1, ["swamp"], true);
    const v = controller.build();
    expect(v.error).toBeUndefined();
    const b = v.battle!;
    expect(b.battlefield.cells[7].terrain).toEqual(["swamp"]);
    expect(b.battlefield.cells[7].cliffBelow).toBe(true);
    const wallCell = b.battlefield.cells[3];
    expect(wallCell.fortification?.points).toHaveLength(2);
    expect(wallCell.fortification?.points[0].defenderDefBonus).toBe(6); // makeshift ×0.6
    const garrison = b.units.filter((u) => u.side === "player");
    expect(garrison.every((u) => u.fort)).toBe(true);
    expect(b.units.find((u) => u.id === "p-pedites_fyrd-1")?.shield).toBe(30);
    expect(b.commandPool.remaining).toBe(120);
  });

  it("forge: validates the model's sheet, retries once with the errors, and approves into the session registry", async () => {
    const bad = { ...chariot, newTags: [{ id: "scythe_wheels", summary: "x", shredFactor: 2 }] };
    const { controller, calls } = lab([JSON.stringify(bad), JSON.stringify(chariot)]);
    let v = await controller.forgeUnit("A scythed war chariot like the Persians used.");
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-1)?.content).toMatch(/rejected by the schema validator/);
    expect(v.forge.pending?.sheet.id).toBe("scythed_chariot");
    expect(v.forge.pending?.warnings.join(" ")).toMatch(/anachronistic/);
    expect(unitSheet("scythed_chariot")).toBeUndefined();
    v = controller.approveForge();
    expect(unitSheet("scythed_chariot")?.tags).toContain("scythe_wheels");
    expect(v.registry.customSheetIds).toEqual(["scythed_chariot"]);
    expect(v.registry.customTagIds).toEqual(["scythe_wheels"]);
    // The forged unit fights.
    v = controller.setConfig({ seed: 9, player: [{ sheetId: "scythed_chariot" }], enemy: [{ sheetId: "peasant_levy" }] });
    expect(v.error).toBeUndefined();
    v = controller.build();
    v = controller.autoRun();
    expect(v.summary?.outcome).toBe("victory");
    // Session end forgets it.
    controller.dispose();
    expect(unitSheet("scythed_chariot")).toBeUndefined();
  });

  it("forge: reports failure after the repair pass without leaving a pending card", async () => {
    const { controller } = lab(["not json", "still not json"]);
    const v = await controller.forgeUnit("something");
    expect(v.forge.pending).toBeNull();
    expect(v.forge.error).toMatch(/could not produce/);
    expect(v.forge.busy).toBe(false);
  });

  it("exports and re-imports a scenario including forged content", async () => {
    const { controller } = lab([JSON.stringify(chariot)]);
    await controller.forgeUnit("chariot");
    controller.approveForge();
    controller.setConfig({ seed: 42, player: [{ sheetId: "scythed_chariot", count: 2 }], enemy: [{ sheetId: "elite_foot" }] });
    const text = controller.exportScenario();
    controller.dispose();
    const fresh = new LabController(async () => "");
    const v = fresh.importScenario(text);
    expect(v.error).toBeUndefined();
    expect(v.config.seed).toBe(42);
    expect(v.config.player[0].sheetId).toBe("scythed_chariot");
    expect(unitSheet("scythed_chariot")).toBeDefined();
    expect(fresh.importScenario("{ nope").error).toMatch(/not JSON/);
  });
});
