import type { BattleState, Cell, Order, Side, UnitInstance } from "./battleTypes";
import { GANG_UP_MAX_ATTACKERS } from "./constants";
import { forwardDirection, frontRow, inBounds, manhattan, moveCost, reserveRow, sameCell } from "./grid";
import { hasTag, resolveTags } from "./registry";
import { inRange, nearestEnemies } from "./round";
import { disengageCostMultiplier, isActive, isEngaged, isRanged, isStationary, isStored, isTargetable, sheetFor, unitsInCell } from "./units";

/**
 * Script commander (Phase 0 decision: no LLM in the order loop). Issues one order per
 * unit it controls. Deliberately simple and deterministic given the state.
 */

export type AiPosture = "attack" | "defend";

export type AiOptions = {
  posture?: AiPosture;
  /** Reserves wait this many rounds before committing unless the front needs them. */
  reserveHoldRounds?: number;
  /** Retreat threshold as a fraction of max Morale for unengaged units. */
  retreatBelow?: number;
  /** Per-unit nudges from vignette choices: press = close now regardless of turn; hold = stay put this round. */
  unitBias?: Record<string, "press" | "hold">;
};

const DEFAULTS: Required<Omit<AiOptions, "unitBias">> & { unitBias: Record<string, "press" | "hold"> } = { posture: "attack", reserveHoldRounds: 2, retreatBelow: 0.3, unitBias: {} };

export function aiOrders(state: BattleState, side: Side, unitIds: readonly string[] | "all", opts?: AiOptions): Order[] {
  const o = { ...DEFAULTS, ...opts, unitBias: { ...DEFAULTS.unitBias, ...(opts?.unitBias ?? {}) } };
  const orders: Order[] = [];
  for (const unit of state.units) {
    if (unit.side !== side || !isActive(unit) || !unit.cell) continue;
    if (unitIds !== "all" && !unitIds.includes(unit.id)) continue;
    const order = orderFor(state, unit, o);
    if (order) orders.push(order);
  }
  return orders;
}

type AiResolved = typeof DEFAULTS;

function orderFor(state: BattleState, unit: UnitInstance, o: AiResolved): Order | undefined {
  if (isStored(unit)) return undefined;
  const cell = unit.cell!;
  const bias = o.unitBias[unit.id];
  if (bias === "hold" && !isEngaged(unit)) return { type: "hold", unitId: unit.id };
  const enemiesHere = unitsInCell(state.units, cell).filter((u) => u.side !== unit.side && isTargetable(u));
  const sheet = sheetFor(unit);

  if (isStationary(unit)) {
    const point = enemyFortPointInRange(state, unit);
    if (point) return { type: "attack_structure", unitId: unit.id, pointId: point };
    const target = nearestEnemies(state, unit).find((e) => inRange(state, unit, e.cell!));
    return target ? { type: "fire", unitId: unit.id, targetId: target.id, shot: shotFor(unit, false) } : { type: "hold", unitId: unit.id };
  }

  if (isRanged(unit) && (unit.ammo === undefined || unit.ammo > 0)) {
    if (enemiesHere.length && hasTag(unit.tags, "hit_and_run")) {
      const back = stepBack(state, unit);
      if (back) return { type: "skirmish_and_withdraw", unitId: unit.id, targetId: enemiesHere[0].id, to: back };
    }
    if (enemiesHere.length && !isEngaged(unit) && sheet.atk > 0 && !hasTag(unit.tags, "low_melee") && !hasTag(unit.tags, "light_melee")) {
      return engageWeakest(unit, enemiesHere);
    }
    if (isEngaged(unit)) return undefined;
    const point = enemyFortPointInRange(state, unit);
    if (point && resolveTags(unit.tags).some((t) => t.siege)) return { type: "attack_structure", unitId: unit.id, pointId: point };
    const target = nearestEnemies(state, unit).find((e) => inRange(state, unit, e.cell!));
    if (target) return { type: "fire", unitId: unit.id, targetId: target.id, shot: shotFor(unit, true) };
    if (o.posture === "attack" || cell.row === reserveRow(unit.side)) {
      const step = stepToward(state, unit);
      if (step) return { type: "move", unitId: unit.id, to: step };
    }
    return { type: "hold", unitId: unit.id };
  }

  // Melee (or ranged with empty quivers).
  if (enemiesHere.length) {
    if (!isEngaged(unit) && sheet.atk > 0) return engageWeakest(unit, enemiesHere);
    if (hasTag(unit.tags, "drilled_spear") && !unit.holdFormation && enemiesHere.some((e) => hasTag(e.tags, "mounted") && !e.engagedWith.includes(unit.id))) {
      return { type: "hold_formation", unitId: unit.id };
    }
    return undefined;
  }
  if (unit.morale < unit.maxMorale * o.retreatBelow) {
    const back = stepBack(state, unit);
    if (back) return { type: "move", unitId: unit.id, to: back };
  }
  const point = enemyFortPointInRange(state, unit, true);
  if (point) return { type: "attack_structure", unitId: unit.id, pointId: point };
  if (o.posture === "defend" && cell.row !== reserveRow(unit.side)) {
    return hasTag(unit.tags, "drilled_spear") && !unit.holdFormation ? { type: "hold_formation", unitId: unit.id } : { type: "hold", unitId: unit.id };
  }
  if (cell.row === reserveRow(unit.side) && state.round < o.reserveHoldRounds && !frontNeedsHelp(state, unit)) {
    return { type: "hold", unitId: unit.id };
  }
  const step = stepToward(state, unit, bias === "press");
  return step ? { type: "move", unitId: unit.id, to: step } : { type: "hold", unitId: unit.id };
}

function shotFor(unit: UnitInstance, troops: boolean): "solid" | "grape" | undefined {
  if (!resolveTags(unit.tags).some((t) => t.dualShotType)) return undefined;
  return troops ? "grape" : "solid";
}

function engageWeakest(unit: UnitInstance, enemies: UnitInstance[]): Order | undefined {
  const open = enemies.filter((e) => e.engagedWith.length < GANG_UP_MAX_ATTACKERS || e.engagedWith.includes(unit.id));
  if (!open.length) return { type: "hold", unitId: unit.id };
  open.sort((a, b) => a.morale / a.maxMorale - b.morale / b.maxMorale);
  return { type: "engage", unitId: unit.id, targetId: open[0].id };
}

function enemyFortPointInRange(state: BattleState, unit: UnitInstance, meleeOnly = false): string | undefined {
  if (!unit.cell) return undefined;
  for (let i = 0; i < state.battlefield.cells.length; i++) {
    const fort = state.battlefield.cells[i].fortification;
    if (!fort || fort.side === unit.side) continue;
    const cell: Cell = { row: Math.floor(i / 3) + 1, col: i % 3 };
    const point = fort.points.find((p) => !p.breached);
    if (!point) continue;
    if (meleeOnly ? sameCell(cell, unit.cell) : sameCell(cell, unit.cell) || (isRanged(unit) && inRange(state, unit, cell))) return point.id;
  }
  return undefined;
}

function frontNeedsHelp(state: BattleState, unit: UnitInstance): boolean {
  const front: Cell = { row: frontRow(unit.side), col: unit.cell!.col };
  const friends = unitsInCell(state.units, front).filter((u) => u.side === unit.side);
  if (!friends.length) return true;
  return friends.some((f) => f.morale < f.maxMorale * 0.5);
}

function tryStep(state: BattleState, unit: UnitInstance, to: Cell): Cell | undefined {
  if (!inBounds(to) || !unit.cell) return undefined;
  const cost = moveCost(state.battlefield, { from: unit.cell, to, disengaging: isEngaged(unit), disengageCostMultiplier: disengageCostMultiplier(unit) });
  return cost === null ? undefined : to;
}

/**
 * First step of the shortest legal path to the nearest enemy (BFS over passable moves, so
 * cliffs and rivers are walked around). Once the enemy is within two cells only one side
 * closes per round (enemy on even rounds, player on odd): two units that both step at once can
 * trade places forever, but with one standing still the distance falls every second round.
 */
function stepToward(state: BattleState, unit: UnitInstance, press = false): Cell | undefined {
  const cell = unit.cell!;
  const target = nearestEnemies(state, unit)[0];
  const d = forwardDirection(unit.side);
  if (!target?.cell) return tryStep(state, unit, { row: cell.row + d, col: cell.col });
  const myTurn = (state.round % 2 === 0) === (unit.side === "enemy");
  if (manhattan(cell, target.cell) <= 3 && !myTurn && !press) return undefined;
  return firstStepOnPath(state, unit, target.cell);
}

function firstStepOnPath(state: BattleState, unit: UnitInstance, goal: Cell): Cell | undefined {
  const start = unit.cell!;
  const key = (c: Cell) => `${c.row}:${c.col}`;
  const prev = new Map<string, Cell | null>([[key(start), null]]);
  const queue: Cell[] = [start];
  const passable = (from: Cell, to: Cell) =>
    moveCost(state.battlefield, { from, to, disengaging: false }) !== null;
  while (queue.length) {
    const cur = queue.shift()!;
    if (sameCell(cur, goal)) break;
    // Expand the neighbour that closes the most distance first; on ties close the LARGER gap first.
    // Closing a gap of 1 while the other gap stays open is how two units pass each other on one axis.
    const rowGap = Math.abs(goal.row - cur.row);
    const colGap = Math.abs(goal.col - cur.col);
    const rowFirst = rowGap >= colGap;
    const options: Cell[] = rowFirst
      ? [
          { row: cur.row + 1, col: cur.col },
          { row: cur.row - 1, col: cur.col },
          { row: cur.row, col: cur.col + 1 },
          { row: cur.row, col: cur.col - 1 },
        ]
      : [
          { row: cur.row, col: cur.col + 1 },
          { row: cur.row, col: cur.col - 1 },
          { row: cur.row + 1, col: cur.col },
          { row: cur.row - 1, col: cur.col },
        ];
    options.sort((a, b) => manhattan(a, goal) - manhattan(b, goal));
    for (const next of options) {
      if (!inBounds(next) || prev.has(key(next)) || !passable(cur, next)) continue;
      prev.set(key(next), cur);
      queue.push(next);
    }
  }
  if (!prev.has(key(goal))) return undefined;
  let step: Cell = goal;
  for (;;) {
    const p = prev.get(key(step));
    if (!p) return undefined;
    if (sameCell(p, start)) return tryStep(state, unit, step);
    step = p;
  }
}

function stepBack(state: BattleState, unit: UnitInstance): Cell | undefined {
  const cell = unit.cell!;
  return tryStep(state, unit, { row: cell.row - forwardDirection(unit.side), col: cell.col });
}
