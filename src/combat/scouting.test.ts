import { describe, expect, it } from "vitest";
import { cellIndex } from "./grid";
import { createRng } from "./rng";
import { aiFinalize, aiNarrow, assignRoles, finalize, generateCandidatePool, generateLayout, narrow } from "./scouting";

describe("§9.5 Scouting Duel", () => {
  it("six candidates in clear weather, four in fog", () => {
    expect(generateCandidatePool(createRng(1), { weather: "sunshine" })).toHaveLength(6);
    expect(generateCandidatePool(createRng(1), { weather: "fog" })).toHaveLength(4);
  });

  it("narrow keeps exactly three, finalize picks one", () => {
    const pool = generateCandidatePool(createRng(2), { weather: "rain" });
    const short = narrow(pool, [0, 2, 4]);
    expect(short).toHaveLength(3);
    expect(() => narrow(pool, [0, 1])).toThrow();
    expect(finalize(short, 1)).toBe(pool[2]);
    expect(assignRoles("enemy", "finalizer")).toEqual({ narrower: "player", finalizer: "enemy" });
  });

  it("a fixed fortification appears on every layout in the pool, spanning all three columns", () => {
    const pool = generateCandidatePool(createRng(3), { fortification: { side: "player", typeId: "wooden", row: 2, pointsPerCell: 3 } });
    for (const f of pool) {
      for (let col = 0; col < 3; col++) {
        const cell = f.cells[cellIndex({ row: 2, col })];
        expect(cell.fortification?.side).toBe("player");
        expect(cell.fortification?.points).toHaveLength(3);
        expect(cell.terrain).not.toContain("river");
      }
    }
  });

  it("rivers never land in deployment rows; cliffs never cut a deployment row off", () => {
    for (let seed = 0; seed < 40; seed++) {
      const f = generateLayout(createRng(seed), { roughness: 1 });
      f.cells.forEach((cell, i) => {
        const row = Math.floor(i / 3) + 1;
        if (cell.terrain.includes("river")) expect(row).toBe(3);
        if (cell.cliffBelow) expect([2, 3]).toContain(row);
      });
    }
  });

  it("the script AI prefers its own high ground", () => {
    const rng = createRng(7);
    const pool = generateCandidatePool(rng, { weather: "sunshine", roughness: 0.9 });
    const picks = aiNarrow(pool, "player");
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
    const idx = aiFinalize(narrow(pool, picks), "enemy");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(3);
  });
});
