import type { BattleLogEntry, BattleState, Cell, LogKind, Order, UnitInstance } from "../../combat/battleTypes";
import { GRID_COLUMNS, GRID_ROWS } from "../../combat/constants";
import { pointsInCell } from "../../combat/fortification";
import { cellKey, legalMoves, sameCell } from "../../combat/grid";
import { inRange } from "../../combat/round";
import { orderMenu } from "../../combat/tags";
import { disengageCostMultiplier, isActive, isEngaged, isTargetable, sheetFor, unitsInCell } from "../../combat/units";

/** Pure helpers for the Battle Lab screen. No React, no IPC. */

export const ORDER_LABELS: Record<string, string> = {
  hold: "Hold",
  move: "Move",
  engage: "Engage",
  fire: "Fire",
  attack_structure: "Assault wall",
  hold_formation: "Hold formation",
  skirmish_and_withdraw: "Skirmish & withdraw",
  rally: "Rally (lord)",
  swap_presented: "Swap at the wall",
};

export const LOG_KIND_LABELS: Record<LogKind, string> = {
  phase: "Phase",
  deploy: "Deploy",
  move: "Move",
  engage: "Engage",
  fire: "Fire",
  strike: "Strike",
  shock: "Shock",
  morale: "Morale",
  rout: "Rout",
  structure: "Structure",
  rally: "Rally",
  player: "Lord",
  ai: "AI",
  info: "Info",
};

export type TargetOption = { value: string; label: string };

export function allCells(): Cell[] {
  const out: Cell[] = [];
  for (let row = 1; row <= GRID_ROWS; row++) for (let col = 0; col < GRID_COLUMNS; col++) out.push({ row, col });
  return out;
}

export function unitsByCell(battle: BattleState): Map<string, UnitInstance[]> {
  const map = new Map<string, UnitInstance[]>();
  for (const u of battle.units) {
    if (!isActive(u) || !u.cell) continue;
    const key = cellKey(u.cell);
    map.set(key, [...(map.get(key) ?? []), u]);
  }
  return map;
}

export function shortName(u: UnitInstance): string {
  return u.name.replace(/\s*\(.*\)$/, "");
}

/** Orders the lab UI can offer for a unit right now. */
export function availableOrders(battle: BattleState, unit: UnitInstance): string[] {
  const menu = orderMenu(unit);
  const out = menu.filter((o) => o !== "rally");
  if (battle.player.attachedUnitId && unit.side === "player") {
    const lord = battle.units.find((u) => u.id === battle.player.attachedUnitId);
    if (lord && isActive(lord) && sameCell(lord.cell, unit.cell) && battle.commandPool.remaining > 0) out.push("rally");
  }
  if (unit.fort) out.push("swap_presented");
  return out;
}

/** Target / destination options for an order type, or [] if the order needs none. */
export function targetOptions(battle: BattleState, unit: UnitInstance, orderType: string): TargetOption[] {
  if (!unit.cell) return [];
  const enemies = battle.units.filter((u) => u.side !== unit.side && isTargetable(u) && u.cell);
  switch (orderType) {
    case "engage":
      return unitsInCell(battle.units, unit.cell)
        .filter((u) => u.side !== unit.side && isTargetable(u))
        .map((u) => ({ value: u.id, label: `${shortName(u)} [${u.id}] HP ${u.hp} Mor ${u.morale} (${u.engagedWith.length} on it)` }));
    case "fire":
    case "skirmish_and_withdraw":
      return enemies.filter((u) => inRange(battle, unit, u.cell!)).map((u) => ({ value: u.id, label: `${shortName(u)} [${u.id}] r${u.cell!.row}c${u.cell!.col} HP ${u.hp}` }));
    case "move":
      return legalMoves(battle.battlefield, unit.cell, isEngaged(unit), disengageCostMultiplier(unit)).map((m) => ({
        value: `${m.to.row}:${m.to.col}`,
        label: `Row ${m.to.row} / Col ${m.to.col} (cost ${m.cost})`,
      }));
    case "attack_structure": {
      const here = pointsInCell(battle.battlefield, unit.cell).filter((p) => !p.breached);
      const cellSide = battle.battlefield.cells.find((c) => c.fortification && c.fortification.points.some((p) => here.includes(p)))?.fortification?.side;
      if (cellSide && cellSide !== unit.side) return here.map((p) => ({ value: p.id, label: `${p.label} (${p.hp}/${p.maxHp})` }));
      if (sheetFor(unit).range >= 1) {
        const out: TargetOption[] = [];
        for (const cell of allCells()) {
          const fort = battle.battlefield.cells[(cell.row - 1) * GRID_COLUMNS + cell.col].fortification;
          if (!fort || fort.side === unit.side || !inRange(battle, unit, cell)) continue;
          for (const p of fort.points) if (!p.breached) out.push({ value: p.id, label: `${p.label} r${cell.row}c${cell.col} (${p.hp}/${p.maxHp})` });
        }
        return out;
      }
      return [];
    }
    case "rally":
      return unitsInCell(battle.units, unit.cell)
        .filter((u) => u.side === "player")
        .map((u) => ({ value: u.id, label: `${shortName(u)} [${u.id}] shield ${u.shield}/${u.maxMorale}` }));
    case "swap_presented":
      return battle.units
        .filter((u) => u.id !== unit.id && isActive(u) && u.fort && unit.fort && u.fort.pointId === unit.fort.pointId)
        .map((u) => ({ value: u.id, label: `${shortName(u)} [${u.id}] ${u.fort?.presented ? "presented" : "stored"}` }));
    default:
      return [];
  }
}

/** Build a concrete Order from the form's selections. Returns null if incomplete. */
export function buildOrder(unit: UnitInstance, orderType: string, target: string, extra: { amount?: number; secondary?: string; shot?: "solid" | "grape" }): Order | null {
  switch (orderType) {
    case "hold":
      return { type: "hold", unitId: unit.id };
    case "hold_formation":
      return { type: "hold_formation", unitId: unit.id };
    case "engage":
      return target ? { type: "engage", unitId: unit.id, targetId: target } : null;
    case "fire":
      return target ? { type: "fire", unitId: unit.id, targetId: target, shot: extra.shot } : null;
    case "attack_structure":
      return target ? { type: "attack_structure", unitId: unit.id, pointId: target } : null;
    case "move": {
      const cell = parseCell(target);
      return cell ? { type: "move", unitId: unit.id, to: cell } : null;
    }
    case "skirmish_and_withdraw": {
      const cell = parseCell(extra.secondary ?? "");
      return target && cell ? { type: "skirmish_and_withdraw", unitId: unit.id, targetId: target, to: cell } : null;
    }
    case "rally":
      return target && extra.amount && extra.amount > 0 ? { type: "rally", unitId: target, amount: extra.amount } : null;
    case "swap_presented":
      return target ? { type: "swap_presented", unitId: unit.id, withUnitId: target } : null;
    default:
      return null;
  }
}

export function parseCell(text: string): Cell | null {
  const m = /^(\d+):(\d+)$/.exec(text);
  if (!m) return null;
  const cell = { row: Number(m[1]), col: Number(m[2]) };
  return cell.row >= 1 && cell.row <= GRID_ROWS && cell.col >= 0 && cell.col < GRID_COLUMNS ? cell : null;
}

export function describeOrder(o: Order): string {
  switch (o.type) {
    case "move":
      return `${o.unitId}: move → r${o.to.row}c${o.to.col}`;
    case "engage":
      return `${o.unitId}: engage ${o.targetId}`;
    case "fire":
      return `${o.unitId}: fire at ${o.targetId}${o.shot ? ` (${o.shot})` : ""}`;
    case "attack_structure":
      return `${o.unitId}: assault ${o.pointId}`;
    case "skirmish_and_withdraw":
      return `${o.unitId}: skirmish ${o.targetId} → r${o.to.row}c${o.to.col}`;
    case "rally":
      return `lord: rally ${o.unitId} +${o.amount}`;
    case "swap_presented":
      return `${o.unitId}: swap with ${o.withUnitId}`;
    default:
      return `${o.unitId}: ${o.type.replace("_", " ")}`;
  }
}

export type LogFilter = { kinds: Set<LogKind>; search: string; round?: number };

export function filterLog(log: readonly BattleLogEntry[], filter: LogFilter): BattleLogEntry[] {
  const q = filter.search.trim().toLowerCase();
  return log.filter((e) => {
    if (!filter.kinds.has(e.kind)) return false;
    if (filter.round !== undefined && e.round !== filter.round) return false;
    if (q && !e.text.toLowerCase().includes(q) && !(e.unitId ?? "").toLowerCase().includes(q) && !(e.targetId ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
}

export function formatLogData(data: BattleLogEntry["data"]): string {
  if (!data) return "";
  return Object.entries(data)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "number" ? Math.round(v * 1000) / 1000 : v}`)
    .join("  ");
}

export function logToText(log: readonly BattleLogEntry[]): string {
  return log.map((e) => `d${e.day} r${e.round} [${e.kind}] ${e.text}${e.data ? `  {${formatLogData(e.data)}}` : ""}`).join("\n");
}

export function phaseLabel(battle: BattleState | null): string {
  if (!battle) return "No battle built";
  switch (battle.phase) {
    case "deployment":
      return "Deployment";
    case "rounds":
      return `Day ${battle.day}, round ${battle.round}`;
    case "day_end":
      return `Nightfall after day ${battle.day}`;
    case "finished":
      return `Finished — ${battle.outcome ?? "?"} after ${battle.round} rounds`;
  }
}

export function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}
