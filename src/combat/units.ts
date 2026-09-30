import type { Cell, Owner, Side, UnitInstance } from "./battleTypes";
import { hasTag, requireUnitSheet, resolveTags, volleyCharges } from "./registry";
import type { UnitSheet } from "./schema";

/** Building live units from sheets; instance-level helpers used across the engine. */

export type SpawnOptions = {
  id: string;
  side: Side;
  owner?: Owner;
  name?: string;
  /** Extra instance tags: veteran, berserker, or lab overrides. */
  extraTags?: readonly string[];
  /** Lab overrides of sheet numbers; validated upstream. */
  overrides?: Partial<Pick<UnitSheet, "hp" | "atk" | "def" | "damage" | "range" | "speed" | "morale" | "strength">>;
  cell?: Cell | null;
};

/** The registry sheet with the unit's lab overrides applied — the numbers a live unit runs on. */
export function sheetFor(unit: Pick<UnitInstance, "sheetId" | "overrides">): UnitSheet {
  const base = requireUnitSheet(unit.sheetId);
  return unit.overrides ? { ...base, ...unit.overrides } : base;
}

export function spawnUnit(sheetId: string, opts: SpawnOptions): UnitInstance {
  const base = requireUnitSheet(sheetId);
  const sheet: UnitSheet = opts.overrides ? { ...base, ...opts.overrides } : base;
  const tags = [...sheet.tags];
  for (const t of opts.extraTags ?? []) if (!tags.includes(t)) tags.push(t);
  const hpMult = resolveTags(tags).reduce((m, t) => m * (t.hpMultiplier ?? 1), 1);
  const maxHp = Math.round(sheet.hp * hpMult);
  const ammo = volleyCharges({ ...sheet, tags });
  return {
    id: opts.id,
    sheetId,
    name: opts.name ?? sheet.name,
    side: opts.side,
    owner: opts.owner ?? (opts.side === "enemy" ? "enemy" : "player"),
    tags,
    overrides: opts.overrides,
    hp: maxHp,
    maxHp,
    morale: sheet.morale,
    maxMorale: sheet.morale,
    shield: 0,
    strength: sheet.strength,
    initialStrength: sheet.strength,
    ammo,
    cell: opts.cell ?? null,
    status: "active",
    engagedWith: [],
    engagedSince: {},
    occupancyRounds: 0,
    holdFormation: false,
    berserk: false,
    wasEngaged: false,
    moraleDealt: 0,
    moraleTaken: 0,
    casualties: 0,
    captured: 0,
    escaped: 0,
  };
}

export function isActive(unit: UnitInstance): boolean {
  return unit.status === "active" && unit.cell !== null;
}

export function isEngaged(unit: UnitInstance): boolean {
  return unit.engagedWith.length > 0;
}

export function isRanged(unit: UnitInstance): boolean {
  return sheetFor(unit).range >= 1 && hasTag(unit.tags, "ranged");
}

export function isStationary(unit: UnitInstance): boolean {
  return resolveTags(unit.tags).some((t) => t.stationaryEmplacement);
}

/** Stored inside a Fortification Point: safe, not fighting, not targetable (§9.4). */
export function isStored(unit: UnitInstance): boolean {
  return Boolean(unit.fort && !unit.fort.presented);
}

export function isTargetable(unit: UnitInstance): boolean {
  return isActive(unit) && !isStored(unit);
}

/** §8.2 movement points refreshed each round; stationary pieces get one firing action instead. */
export function actionPointsPerRound(unit: UnitInstance): number {
  if (isStationary(unit)) return 1;
  return sheetFor(unit).speed;
}

/** The product of every disengageCostMultiplier the unit carries (mounted, hit_and_run). */
export function disengageCostMultiplier(unit: UnitInstance): number {
  return resolveTags(unit.tags).reduce((m, t) => m * (t.disengageCostMultiplier ?? 1), 1);
}

export function fireCadenceOf(unit: UnitInstance): number {
  return resolveTags(unit.tags).reduce((n, t) => Math.max(n, t.firesEveryNRounds ?? 1), 1);
}

export function canFireThisRound(unit: UnitInstance, round: number): boolean {
  if (unit.lastFiredRound === undefined) return true;
  return round - unit.lastFiredRound >= fireCadenceOf(unit);
}

export function unitsInCell(units: readonly UnitInstance[], cell: Cell): UnitInstance[] {
  return units.filter((u) => isActive(u) && u.cell && u.cell.row === cell.row && u.cell.col === cell.col);
}

export function enemiesOf(units: readonly UnitInstance[], unit: UnitInstance): UnitInstance[] {
  return units.filter((u) => u.side !== unit.side && isActive(u));
}

export function findUnit(units: readonly UnitInstance[], id: string): UnitInstance | undefined {
  return units.find((u) => u.id === id);
}

export function requireUnit(units: readonly UnitInstance[], id: string): UnitInstance {
  const u = findUnit(units, id);
  if (!u) throw new Error(`Unknown unit ${id}`);
  return u;
}

/** Whole men lost for a given HP loss (Phase 0 decision: HP lost × strength × 0.5). */
export function casualtiesForHpLoss(unit: UnitInstance, hpLost: number, fraction: number): number {
  if (hpLost <= 0 || unit.maxHp <= 0) return 0;
  return Math.max(0, Math.min(unit.strength, Math.round((hpLost / unit.maxHp) * unit.initialStrength * fraction)));
}