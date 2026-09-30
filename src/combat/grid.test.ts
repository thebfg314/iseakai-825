import { describe, expect, it } from "vitest";
import { cellIndex, emptyBattlefield, legalMoves, manhattan, moveCost, neighbours, rangePenalty } from "./grid";

function fieldWith(terrain: Record<string, string[]>, cliffs: string[] = []) {
  const f = emptyBattlefield();
  for (const [key, ids] of Object.entries(terrain)) {
    const [row, col] = key.split(":").map(Number);
    f.cells[cellIndex({ row, col })].terrain = ids;
  }
  for (const key of cliffs) {
    const [row, col] = key.split(":").map(Number);
    f.cells[cellIndex({ row, col })].cliffBelow = true;
  }
  return f;
}

describe("§8.1 grid geometry", () => {
  it("Manhattan distance: diagonal neighbours are 2 away, like two cells in a line", () => {
    expect(manhattan({ row: 2, col: 0 }, { row: 3, col: 1 })).toBe(2);
    expect(manhattan({ row: 2, col: 0 }, { row: 4, col: 0 })).toBe(2);
    expect(manhattan({ row: 1, col: 0 }, { row: 5, col: 2 })).toBe(6);
  });

  it("orthogonal neighbours only, clipped to the grid", () => {
    expect(neighbours({ row: 1, col: 0 })).toHaveLength(2);
    expect(neighbours({ row: 3, col: 1 })).toHaveLength(4);
  });
});

describe("§8.2 movement costs", () => {
  const open = emptyBattlefield();

  it("2 to enter a cell, 4 to leave a fight, 2 for cavalry leaving a fight", () => {
    expect(moveCost(open, { from: { row: 2, col: 1 }, to: { row: 3, col: 1 }, disengaging: false })).toBe(2);
    expect(moveCost(open, { from: { row: 2, col: 1 }, to: { row: 3, col: 1 }, disengaging: true })).toBe(4);
    expect(moveCost(open, { from: { row: 2, col: 1 }, to: { row: 3, col: 1 }, disengaging: true, disengageCostMultiplier: 0.5 })).toBe(2);
  });

  it("diagonal and distant moves are illegal", () => {
    expect(moveCost(open, { from: { row: 2, col: 0 }, to: { row: 3, col: 1 }, disengaging: false })).toBeNull();
    expect(moveCost(open, { from: { row: 2, col: 0 }, to: { row: 4, col: 0 }, disengaging: false })).toBeNull();
  });

  it("§9.1 terrain: swamp and brush double, stream +1, river blocks, brush-in-woodland stacks", () => {
    const f = fieldWith({ "3:0": ["swamp"], "3:1": ["stream"], "3:2": ["river"], "4:0": ["woodland", "heavy_brush"] });
    expect(moveCost(f, { from: { row: 2, col: 0 }, to: { row: 3, col: 0 }, disengaging: false })).toBe(4);
    expect(moveCost(f, { from: { row: 2, col: 1 }, to: { row: 3, col: 1 }, disengaging: false })).toBe(3);
    expect(moveCost(f, { from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, disengaging: false })).toBeNull();
    expect(moveCost(f, { from: { row: 3, col: 0 }, to: { row: 4, col: 0 }, disengaging: false })).toBe(4);
    expect(moveCost(f, { from: { row: 3, col: 0 }, to: { row: 4, col: 0 }, disengaging: true })).toBe(8);
  });

  it("cliffs block one row boundary in one column, both directions", () => {
    const f = fieldWith({}, ["2:1"]);
    expect(moveCost(f, { from: { row: 2, col: 1 }, to: { row: 3, col: 1 }, disengaging: false })).toBeNull();
    expect(moveCost(f, { from: { row: 3, col: 1 }, to: { row: 2, col: 1 }, disengaging: false })).toBeNull();
    expect(moveCost(f, { from: { row: 2, col: 0 }, to: { row: 3, col: 0 }, disengaging: false })).toBe(2);
    expect(legalMoves(f, { row: 2, col: 1 }, false).map((m) => `${m.to.row}:${m.to.col}`)).toEqual(["1:1", "2:2", "2:0"]);
  });

  it("range penalties: woodland at either end −1 each, high winds −1", () => {
    const f = fieldWith({ "3:1": ["woodland"], "4:1": ["woodland"] });
    expect(rangePenalty(f, { row: 3, col: 1 }, { row: 4, col: 1 })).toBe(2);
    expect(rangePenalty(f, { row: 2, col: 1 }, { row: 4, col: 1 })).toBe(1);
    f.weather = "high_winds";
    expect(rangePenalty(f, { row: 2, col: 1 }, { row: 2, col: 2 })).toBe(1);
  });
});
