import { describe, expect, it } from "vitest";
import { attachPlayer, createBattle } from "../../combat/battle";
import { emptyBattlefield } from "../../combat/grid";
import { spawnUnit } from "../../combat/units";
import { availableOrders, buildOrder, describeOrder, filterLog, parseCell, targetOptions, unitsByCell } from "./labView";

function setup() {
  const state = createBattle({ id: "t", seed: 1, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 40, rank: 1 } });
  state.units.push(spawnUnit("caballarii", { id: "cb", side: "player", cell: { row: 3, col: 1 } }));
  state.units.push(spawnUnit("sagittarii", { id: "sg", side: "player", cell: { row: 2, col: 1 } }));
  state.units.push(spawnUnit("pedites_fyrd", { id: "pd", side: "enemy", cell: { row: 3, col: 1 } }));
  state.units.push(spawnUnit("peasant_levy", { id: "far", side: "enemy", cell: { row: 5, col: 0 } }));
  attachPlayer(state, "cb");
  state.phase = "rounds";
  return state;
}

describe("lab view helpers", () => {
  it("offers engage targets in the same cell and fire targets in range", () => {
    const s = setup();
    const cb = s.units[0];
    const sg = s.units[1];
    expect(targetOptions(s, cb, "engage").map((t) => t.value)).toEqual(["pd"]);
    expect(targetOptions(s, sg, "fire").map((t) => t.value)).toEqual(["pd"]); // far is 4 away
    expect(targetOptions(s, cb, "move").length).toBe(4);
    expect(availableOrders(s, cb)).toContain("rally"); // lord rides with cb, pool 40
    expect(availableOrders(s, sg)).not.toContain("rally");
    expect(availableOrders(s, cb)).toContain("hold_formation");
    expect(availableOrders(s, sg)).toContain("fire");
  });

  it("builds orders from form selections and refuses incomplete ones", () => {
    const s = setup();
    const cb = s.units[0];
    expect(buildOrder(cb, "engage", "pd", {})).toEqual({ type: "engage", unitId: "cb", targetId: "pd" });
    expect(buildOrder(cb, "engage", "", {})).toBeNull();
    expect(buildOrder(cb, "move", "4:1", {})).toEqual({ type: "move", unitId: "cb", to: { row: 4, col: 1 } });
    expect(buildOrder(cb, "rally", "cb", { amount: 10 })).toEqual({ type: "rally", unitId: "cb", amount: 10 });
    expect(parseCell("9:9")).toBeNull();
    expect(describeOrder({ type: "fire", unitId: "sg", targetId: "pd", shot: "grape" })).toBe("sg: fire at pd (grape)");
  });

  it("groups units by cell and filters the log", () => {
    const s = setup();
    const map = unitsByCell(s);
    expect(map.get("3:1")?.map((u) => u.id)).toEqual(["cb", "pd"]);
    const rows = filterLog(s.log, { kinds: new Set(["player"]), search: "rides" });
    expect(rows).toHaveLength(1);
    expect(filterLog(s.log, { kinds: new Set(["phase"]), search: "" }).length).toBeGreaterThan(0);
  });
});
