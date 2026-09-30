import type { Battlefield, BattleCell, Cell, Side } from "./battleTypes";
import { DISENGAGE_MOVE_COST, GRID_COLUMNS, GRID_ROWS, MOVE_COST } from "./constants";
import { terrainDef, weatherDef } from "./registry";

/** §8.1 the 3×5 grid; §8.2 movement costs; §9.1 terrain; §9.2 weather. */

export const COLUMN_NAMES = ["Left", "Center", "Right"] as const;
export const ROW_NAMES: Record<number, string> = {
  1: "Own Reserve",
  2: "Own Front",
  3: "No Man's Land",
  4: "Enemy Front",
  5: "Enemy Reserve",
};

export function cellIndex(cell: Cell): number {
  return (cell.row - 1) * GRID_COLUMNS + cell.col;
}

export function cellFromIndex(index: number): Cell {
  return { row: Math.floor(index / GRID_COLUMNS) + 1, col: index % GRID_COLUMNS };
}

export function cellKey(cell: Cell): string {
  return `${cell.row}:${cell.col}`;
}

export function cellLabel(cell: Cell, perspective: Side = "player"): string {
  const row = perspective === "player" ? cell.row : GRID_ROWS + 1 - cell.row;
  return `${ROW_NAMES[row]} / ${COLUMN_NAMES[cell.col]}`;
}

export function sameCell(a: Cell | null | undefined, b: Cell | null | undefined): boolean {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

/** §8.3 Manhattan distance, consistent with no diagonal movement. */
export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export function isAdjacent(a: Cell, b: Cell): boolean {
  return manhattan(a, b) === 1;
}

export function inBounds(cell: Cell): boolean {
  return cell.row >= 1 && cell.row <= GRID_ROWS && cell.col >= 0 && cell.col < GRID_COLUMNS;
}

/** Orthogonal neighbours inside the grid. */
export function neighbours(cell: Cell): Cell[] {
  const out: Cell[] = [];
  for (const [dr, dc] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const next = { row: cell.row + dr, col: cell.col + dc };
    if (inBounds(next)) out.push(next);
  }
  return out;
}

/** Deployment rows per side (§8.1): player 1–2, enemy 4–5. */
export function deploymentRows(side: Side): readonly number[] {
  return side === "player" ? [1, 2] : [4, 5];
}

export function isDeploymentCell(side: Side, cell: Cell): boolean {
  return deploymentRows(side).includes(cell.row);
}

/** +1 for the player advancing toward row 5, −1 for the enemy. */
export function forwardDirection(side: Side): 1 | -1 {
  return side === "player" ? 1 : -1;
}

export function reserveRow(side: Side): number {
  return side === "player" ? 1 : 5;
}

export function frontRow(side: Side): number {
  return side === "player" ? 2 : 4;
}

export function cellAt(field: Battlefield, cell: Cell): BattleCell {
  return field.cells[cellIndex(cell)];
}

export function terrainIdsAt(field: Battlefield, cell: Cell): readonly string[] {
  return cellAt(field, cell).terrain;
}

export function hasTerrain(field: Battlefield, cell: Cell, terrainId: string): boolean {
  return terrainIdsAt(field, cell).includes(terrainId);
}

/** True if a cliff boundary blocks moving between two vertically adjacent cells in the same column. */
export function cliffBlocks(field: Battlefield, from: Cell, to: Cell): boolean {
  if (from.col !== to.col || Math.abs(from.row - to.row) !== 1) return false;
  const upper = from.row < to.row ? from : to;
  return cellAt(field, upper).cliffBelow;
}

export type MoveCostInput = {
  from: Cell;
  to: Cell;
  /** The mover currently has enemies engaged against it (§8.2 double cost to leave a fight). */
  disengaging: boolean;
  /** mounted / hit_and_run halve the disengage cost (Phase 0 decision). 1 = no change. */
  disengageCostMultiplier?: number;
};

/**
 * §8.2 + §9.1: cost in movement points to enter `to` from `from`, or null if the move is illegal
 * (not adjacent, impassable river, cliff boundary).
 */
export function moveCost(field: Battlefield, input: MoveCostInput): number | null {
  if (!inBounds(input.to) || !isAdjacent(input.from, input.to)) return null;
  if (cliffBlocks(field, input.from, input.to)) return null;
  const dest = cellAt(field, input.to);
  let base = input.disengaging ? DISENGAGE_MOVE_COST * (input.disengageCostMultiplier ?? 1) : MOVE_COST;
  let multiplier = 1;
  let add = 0;
  for (const id of dest.terrain) {
    const t = terrainDef(id);
    if (!t) continue;
    if (t.impassable) return null;
    if (t.moveCostMultiplier) multiplier *= t.moveCostMultiplier;
    if (t.moveCostAdd) add += t.moveCostAdd;
  }
  return Math.round(base * multiplier + add);
}

/** Sum of Range reductions from woodland (either end) and high winds; the hills defender bonus is added by the caller. */
export function rangePenalty(field: Battlefield, from: Cell, to: Cell): number {
  let penalty = 0;
  const seen = new Set<string>();
  for (const cell of [from, to]) {
    for (const id of terrainIdsAt(field, cell)) {
      const t = terrainDef(id);
      if (t?.rangeReduction && !seen.has(`${cellKey(cell)}:${id}`)) {
        seen.add(`${cellKey(cell)}:${id}`);
        penalty += t.rangeReduction;
      }
    }
  }
  const w = weatherDef(field.weather);
  if (w?.rangeReduction) penalty += w.rangeReduction;
  return penalty;
}

/** §9.2 rain: ranged ATK ×0.85. */
export function weatherRangedAtkMultiplier(field: Battlefield): number {
  return weatherDef(field.weather)?.rangedAtkMultiplier ?? 1;
}

/** §9.1 heavy brush: +5 DEF against ranged attacks for units inside. */
export function rangedDefBonusAt(field: Battlefield, cell: Cell): number {
  return terrainIdsAt(field, cell).reduce((sum, id) => sum + (terrainDef(id)?.rangedDefBonus ?? 0), 0);
}

/** The defender-only multipliers of any high ground in the cell. */
export function defenderTerrainBonus(field: Battlefield, cell: Cell): { atkMultiplier: number; defMultiplier: number; rangeBonus: number } {
  let atk = 1;
  let def = 1;
  let range = 0;
  for (const id of terrainIdsAt(field, cell)) {
    const t = terrainDef(id)?.defenderOnly;
    if (!t) continue;
    atk *= t.atkMultiplier ?? 1;
    def *= t.defMultiplier ?? 1;
    range += t.rangeBonus ?? 0;
  }
  return { atkMultiplier: atk, defMultiplier: def, rangeBonus: range };
}

/** Cells the mover can legally step into this round, with their costs. */
export function legalMoves(field: Battlefield, from: Cell, disengaging: boolean, disengageCostMultiplier = 1): { to: Cell; cost: number }[] {
  const out: { to: Cell; cost: number }[] = [];
  for (const to of neighbours(from)) {
    const cost = moveCost(field, { from, to, disengaging, disengageCostMultiplier });
    if (cost !== null) out.push({ to, cost });
  }
  return out;
}

export function emptyBattlefield(name = "Open field", weather = "sunshine"): Battlefield {
  return {
    name,
    weather,
    cells: Array.from({ length: GRID_ROWS * GRID_COLUMNS }, () => ({ terrain: [], cliffBelow: false })),
  };
}
