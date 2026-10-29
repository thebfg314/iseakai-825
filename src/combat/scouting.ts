import type { Battlefield, Side } from "./battleTypes";
import { GRID_COLUMNS, GRID_ROWS, SCOUTING_NARROW_TO, SCOUTING_POOL_SIZE } from "./constants";
import { buildFortificationCell } from "./fortification";
import { cellIndex, emptyBattlefield } from "./grid";
import { WEATHER, weatherDef } from "./registry";
import type { Rng } from "./rng";

/** §9.5 Scouting Duel: candidate layouts, narrowing, and finalising. */

export type LayoutOptions = {
  /** A fortification fixed by the campaign state filters the pool to layouts that include it. */
  fortification?: { side: Side; typeId: string; row: number; makeshift?: boolean; pointsPerCell?: number };
  /** Force a weather; otherwise rolled. */
  weather?: string;
  /** 0–1: how much terrain to scatter. 0 = open grassland. */
  roughness?: number;
  /** Terrain weights replacing the generator's own (a campaign's marsh, a river line). Unknown ids are ignored. */
  terrainWeights?: Record<string, number>;
  /** A fixed name for the ground, instead of one rolled from the list. */
  name?: string;
};

const TERRAIN_WEIGHTS: [string, number][] = [
  ["grassland", 10],
  ["hills", 3],
  ["woodland", 3],
  ["heavy_brush", 2],
  ["swamp", 1],
  ["stream", 2],
  ["river", 1],
];

const LAYOUT_NAMES = ["Open meadow", "Broken ground", "Wooded slope", "Riverside flats", "Hill country", "Marsh edge", "Old field", "Forest verge"];

function pickWeighted(rng: Rng, rows: [string, number][]): string {
  const total = rows.reduce((s, [, w]) => s + w, 0);
  let r = rng.float() * total;
  for (const [id, w] of rows) {
    r -= w;
    if (r <= 0) return id;
  }
  return rows[rows.length - 1][0];
}

export function rollWeather(rng: Rng): string {
  return rng.pick(WEATHER.map((w) => w.id));
}

/** One random battlefield. Rivers never land in a side's own deployment rows, so nobody deploys into water. */
export function generateLayout(rng: Rng, opts: LayoutOptions = {}): Battlefield {
  const rough = opts.roughness ?? 0.5;
  const field = emptyBattlefield(opts.name ?? rng.pick(LAYOUT_NAMES), opts.weather ?? rollWeather(rng));
  const known = new Set(TERRAIN_WEIGHTS.map(([id]) => id));
  const custom = opts.terrainWeights ? (Object.entries(opts.terrainWeights).filter(([id, w]) => known.has(id) && w > 0) as [string, number][]) : [];
  const weights = custom.length ? custom : TERRAIN_WEIGHTS;
  for (let row = 1; row <= GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      if (rng.float() > rough) continue;
      const id = pickWeighted(rng, weights);
      if (id === "grassland") continue;
      if (id === "river" && row !== 3) continue;
      const cell = field.cells[cellIndex({ row, col })];
      cell.terrain.push(id);
      if (id === "heavy_brush" && rng.chance(0.4)) cell.terrain.unshift("woodland");
    }
  }
  // §9.1 cliffs: at most one blocked row boundary per column, rolled independently.
  for (let col = 0; col < GRID_COLUMNS; col++) {
    if (rng.chance(rough * 0.25)) {
      const row = rng.int(2, 3); // boundary 2|3 or 3|4 so deployment rows stay connected
      field.cells[cellIndex({ row, col })].cliffBelow = true;
      field.cells[cellIndex({ row, col })].terrain.push("cliffs");
    }
  }
  if (opts.fortification) {
    const f = opts.fortification;
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const cell = field.cells[cellIndex({ row: f.row, col })];
      cell.terrain = cell.terrain.filter((t) => t !== "river");
      cell.fortification = buildFortificationCell(f.typeId, f.side, `${f.row}:${col}`, f.pointsPerCell ?? rng.int(2, 3), f.makeshift);
    }
    field.name = `${field.name} before the ${f.makeshift ? "makeshift " : ""}${f.typeId} wall`;
  }
  return field;
}

/** The candidate pool: 6 layouts, or 4 in fog (§9.2). */
export function generateCandidatePool(rng: Rng, opts: LayoutOptions = {}): Battlefield[] {
  const weather = opts.weather ?? rollWeather(rng);
  const size = weatherDef(weather)?.scoutingPoolSize ?? SCOUTING_POOL_SIZE;
  return Array.from({ length: size }, () => generateLayout(rng, { ...opts, weather }));
}

export type DuelRoles = { narrower: Side; finalizer: Side };

/** §9.5: a plain coin flip decides who chooses; the winner picks whether to Narrow or Finalize. */
export function rollDuelWinner(rng: Rng): Side {
  return rng.chance(0.5) ? "player" : "enemy";
}

export function assignRoles(winner: Side, winnerChooses: "narrower" | "finalizer"): DuelRoles {
  const loser: Side = winner === "player" ? "enemy" : "player";
  return winnerChooses === "narrower" ? { narrower: winner, finalizer: loser } : { narrower: loser, finalizer: winner };
}

export function narrow(pool: readonly Battlefield[], keep: readonly number[]): Battlefield[] {
  const idx = [...new Set(keep)].filter((i) => i >= 0 && i < pool.length).slice(0, SCOUTING_NARROW_TO);
  if (idx.length !== SCOUTING_NARROW_TO) throw new Error(`Narrow to exactly ${SCOUTING_NARROW_TO} layouts.`);
  return idx.map((i) => pool[i]);
}

export function finalize(shortlist: readonly Battlefield[], pick: number): Battlefield {
  const f = shortlist[pick];
  if (!f) throw new Error("Pick one of the shortlisted layouts.");
  return f;
}

/** Script AI's picks in the duel: favour hills/brush for the side that has them on its half, avoid swamp. */
export function aiNarrow(pool: readonly Battlefield[], side: Side): number[] {
  return pool
    .map((f, i) => ({ i, score: layoutScore(f, side) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SCOUTING_NARROW_TO)
    .map((x) => x.i);
}

export function aiFinalize(shortlist: readonly Battlefield[], side: Side): number {
  let best = 0;
  for (let i = 1; i < shortlist.length; i++) if (layoutScore(shortlist[i], side) > layoutScore(shortlist[best], side)) best = i;
  return best;
}

function layoutScore(field: Battlefield, side: Side): number {
  const ownRows = side === "player" ? [1, 2] : [4, 5];
  let score = 0;
  field.cells.forEach((cell, i) => {
    const row = Math.floor(i / GRID_COLUMNS) + 1;
    const own = ownRows.includes(row);
    for (const t of cell.terrain) {
      if (t === "hills") score += own ? 3 : -2;
      if (t === "heavy_brush") score += own ? 1 : -1;
      if (t === "swamp") score += own ? -2 : 1;
    }
    if (cell.fortification) score += cell.fortification.side === side ? 5 : -5;
  });
  return score;
}
