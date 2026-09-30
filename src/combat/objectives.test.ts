import { describe, expect, it } from "vitest";
import { attachPlayer, createBattle } from "./battle";
import { emptyBattlefield } from "./grid";
import { candidateObjectives, checkObjective, objectiveBonus } from "./objectives";
import { spawnUnit } from "./units";

function field() {
  const s = createBattle({ id: "o", seed: 1, tier: "sub_command", battlefield: emptyBattlefield(), player: { renown: 40, rank: 1 } });
  s.units.push(spawnUnit("caballarii", { id: "lord", side: "player", owner: "player", cell: { row: 2, col: 1 } }));
  s.units.push(spawnUnit("pedites_fyrd", { id: "mine", side: "player", owner: "player", cell: { row: 2, col: 1 } }));
  s.units.push(spawnUnit("pedites_fyrd", { id: "ally", side: "player", owner: "ally", cell: { row: 2, col: 0 } }));
  s.units.push(spawnUnit("peasant_levy", { id: "weak", side: "enemy", cell: { row: 4, col: 1 } }));
  s.units.push(spawnUnit("heavy_horse", { id: "strong", side: "enemy", cell: { row: 4, col: 2 } }));
  attachPlayer(s, "lord");
  s.phase = "rounds";
  return s;
}

describe("Sub-Command objectives", () => {
  it("proposes feasible objectives from the field, never repeating one already issued", () => {
    const s = field();
    const c = candidateObjectives(s);
    expect(c.map((x) => x.kind)).toEqual(["hold_column", "break_unit", "break_unit", "protect_unit"]);
    expect(c[0].target).toBe("1");
    expect(c[1].target).toBe("weak");
    expect(c[2].difficulty).toBe(3);
    const next = candidateObjectives(s, [{ kind: "hold_column", target: "1", difficulty: 1, issuedRound: 0 }]);
    expect(next.some((x) => x.kind === "hold_column")).toBe(false);
  });

  it("hold_column succeeds when the round is reached and fails when the column is empty", () => {
    const s = field();
    const o = { kind: "hold_column" as const, target: "1", byRound: 6, difficulty: 1, issuedRound: 0 };
    expect(checkObjective(s, o).status).toBe("active");
    s.round = 6;
    expect(checkObjective(s, o).status).toBe("success");
    s.round = 3;
    for (const u of s.units) if (u.owner === "player") u.cell = { row: 2, col: 0 };
    expect(checkObjective(s, o).status).toBe("failed");
  });

  it("break_unit, protect_unit, advance, keep_whole resolve from real unit state", () => {
    const s = field();
    expect(checkObjective(s, { kind: "break_unit", target: "weak", difficulty: 2, issuedRound: 0 }).status).toBe("active");
    s.units.find((u) => u.id === "weak")!.status = "routed";
    expect(checkObjective(s, { kind: "break_unit", target: "weak", difficulty: 2, issuedRound: 0 }).status).toBe("success");
    expect(checkObjective(s, { kind: "protect_unit", target: "ally", difficulty: 2, issuedRound: 0 }).status).toBe("active");
    s.units.find((u) => u.id === "ally")!.status = "destroyed";
    expect(checkObjective(s, { kind: "protect_unit", target: "ally", difficulty: 2, issuedRound: 0 }).status).toBe("failed");
    expect(checkObjective(s, { kind: "advance", byRound: 5, difficulty: 2, issuedRound: 0 }).status).toBe("active");
    s.units.find((u) => u.id === "mine")!.cell = { row: 4, col: 1 };
    expect(checkObjective(s, { kind: "advance", byRound: 5, difficulty: 2, issuedRound: 0 }).status).toBe("success");
    expect(checkObjective(s, { kind: "keep_whole", difficulty: 1, issuedRound: 0 }).status).toBe("active");
    s.phase = "finished";
    expect(checkObjective(s, { kind: "keep_whole", difficulty: 1, issuedRound: 0 }).status).toBe("success");
    s.units.find((u) => u.id === "mine")!.status = "routed";
    expect(checkObjective(s, { kind: "keep_whole", difficulty: 1, issuedRound: 0 }).status).toBe("failed");
  });

  it("the rubric is symmetric and scaled to difficulty", () => {
    expect(objectiveBonus("success", 3)).toBe(30);
    expect(objectiveBonus("failed", 3)).toBe(-30);
    expect(objectiveBonus("success", 1)).toBe(10);
    expect(objectiveBonus("active", 2)).toBe(0);
  });
});
