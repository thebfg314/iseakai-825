import type { Battlefield, BattleState, Cell, FortPoint, Side, UnitInstance } from "./battleTypes";
import { DEFENDER_OCCUPANCY_LEAD } from "./constants";
import { cellAt, cellFromIndex, sameCell } from "./grid";
import { fortificationType, makeshiftOf, resolveTags } from "./registry";
import { isActive, unitsInCell } from "./units";

/** §9.3 Defender designation and §9.4 Fortification Points. */

export type LocatedPoint = { cell: Cell; side: Side; point: FortPoint };

export function locatePoint(field: Battlefield, pointId: string): LocatedPoint | undefined {
  for (let i = 0; i < field.cells.length; i++) {
    const fort = field.cells[i].fortification;
    if (!fort) continue;
    const point = fort.points.find((p) => p.id === pointId);
    if (point) return { cell: cellFromIndex(i), side: fort.side, point };
  }
  return undefined;
}

export function pointsInCell(field: Battlefield, cell: Cell): FortPoint[] {
  return cellAt(field, cell).fortification?.points ?? [];
}

/** Build 2–3 Fortification Points of a type for one cell (§9.4 "a wall segment, a tower, a gatehouse"). */
export function buildFortificationCell(
  typeId: string,
  side: Side,
  cellKeyForIds: string,
  count: number,
  makeshift = false,
): { side: Side; points: FortPoint[] } {
  const base = fortificationType(typeId);
  if (!base) throw new Error(`Unknown fortification type ${typeId}`);
  const type = makeshift ? makeshiftOf(base) : base;
  const labels = ["wall segment", "tower", "gatehouse"];
  const points: FortPoint[] = [];
  for (let i = 0; i < Math.max(1, Math.min(3, count)); i++) {
    points.push({
      id: `fort:${cellKeyForIds}:${i}`,
      label: labels[i] ?? `point ${i + 1}`,
      typeId: type.id,
      hp: type.pointHp,
      maxHp: type.pointHp,
      structuralDef: type.structuralDef,
      defenderDefBonus: type.defenderDefBonus,
      breached: false,
    });
  }
  return { side, points };
}

/**
 * §9.3: a unit is Defender of its cell's terrain when its consecutive occupancy exceeds every
 * opposing unit's in that cell by at least one round. Uncontested cells are held by default.
 */
export function isTerrainDefender(units: readonly UnitInstance[], unit: UnitInstance): boolean {
  if (!unit.cell || !isActive(unit)) return false;
  const enemiesHere = unitsInCell(units, unit.cell).filter((u) => u.side !== unit.side);
  if (!enemiesHere.length) return true;
  const best = Math.max(...enemiesHere.map((u) => u.occupancyRounds));
  return unit.occupancyRounds - best >= DEFENDER_OCCUPANCY_LEAD;
}

/** An enemy siege tower in the cell negates the Point's height advantage (§7.17). */
export function heightNegated(units: readonly UnitInstance[], cell: Cell, defenderSide: Side): boolean {
  return unitsInCell(units, cell).some(
    (u) => u.side !== defenderSide && resolveTags(u.tags).some((t) => t.wallHeightNegation),
  );
}

/** Defender DEF Bonus the unit currently enjoys from its Point, or 0. */
export function fortDefenderBonus(state: BattleState, unit: UnitInstance): number {
  if (!unit.fort?.presented || !unit.cell) return 0;
  const located = locatePoint(state.battlefield, unit.fort.pointId);
  if (!located || located.point.breached) return 0;
  if (!sameCell(located.cell, unit.cell)) return 0;
  if (!isTerrainDefender(state.units, unit)) return 0;
  if (heightNegated(state.units, unit.cell, unit.side)) return 0;
  return located.point.defenderDefBonus;
}

/** Assign a unit to a Point in its own cell. The first unit there is Presented; later ones are Stored. */
export function assignToPoint(state: BattleState, unitId: string, pointId: string): { ok: boolean; reason?: string } {
  const unit = state.units.find((u) => u.id === unitId);
  const located = locatePoint(state.battlefield, pointId);
  if (!unit || !located) return { ok: false, reason: "no such unit or point" };
  if (located.side !== unit.side) return { ok: false, reason: "that point belongs to the other side" };
  if (!unit.cell || !sameCell(unit.cell, located.cell)) return { ok: false, reason: "unit is not in the point's cell" };
  const alreadyPresented = state.units.some((u) => u.id !== unitId && isActive(u) && u.fort?.pointId === pointId && u.fort.presented);
  unit.fort = { pointId, presented: !alreadyPresented };
  return { ok: true };
}

/** Breach: the structure no longer shelters anyone; everyone at the point is exposed. */
export function breachPoint(state: BattleState, pointId: string): void {
  const located = locatePoint(state.battlefield, pointId);
  if (!located) return;
  located.point.breached = true;
  located.point.hp = 0;
  for (const u of state.units) if (u.fort?.pointId === pointId) u.fort = { pointId, presented: true };
}

export function presentedUnitAt(units: readonly UnitInstance[], pointId: string): UnitInstance | undefined {
  return units.find((u) => isActive(u) && u.fort?.pointId === pointId && u.fort.presented);
}
