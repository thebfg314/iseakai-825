import tagsFile from "../../data/combat/tags.json";
import unitsFile from "../../data/combat/units.json";
import terrainFile from "../../data/combat/terrain.json";
import fortificationsFile from "../../data/combat/fortifications.json";
import {
  FortificationFileSchema,
  TagRegistryFileSchema,
  TerrainFileSchema,
  UnitRosterFileSchema,
  type FortificationType,
  type TagDef,
  type TerrainDef,
  type UnitSheet,
  type WeatherDef,
} from "./schema";

/**
 * Validated content registry. JSON is parsed once at module load; a malformed
 * data file fails fast with a Zod error rather than a mid-battle NaN.
 */
const tagData = TagRegistryFileSchema.parse(tagsFile);
const unitData = UnitRosterFileSchema.parse(unitsFile);
const terrainData = TerrainFileSchema.parse(terrainFile);
const fortData = FortificationFileSchema.parse(fortificationsFile);

export const TAGS: readonly TagDef[] = tagData.tags;
export const UNIT_SHEETS: readonly UnitSheet[] = unitData.units;
export const TERRAIN: readonly TerrainDef[] = terrainData.terrain;
export const WEATHER: readonly WeatherDef[] = terrainData.weather;
export const FORTIFICATION_TYPES: readonly FortificationType[] = fortData.types;
export const MAKESHIFT = fortData.makeshift;
export const FORTIFICATION_POINTS_PER_CELL = fortData.pointsPerCell;
export const SWAP_PRESENTED_COST = fortData.swapPresentedCost;

const tagById = new Map<string, TagDef>();
for (const tag of TAGS) {
  tagById.set(tag.id, tag);
  for (const alias of tag.aliases ?? []) tagById.set(alias, tag);
}
const unitById = new Map<string, UnitSheet>(UNIT_SHEETS.map((u) => [u.id, u] as const));
const terrainById = new Map(TERRAIN.map((t) => [t.id, t] as const));
const weatherById = new Map(WEATHER.map((w) => [w.id, w] as const));
const fortById = new Map(FORTIFICATION_TYPES.map((f) => [f.id, f] as const));

// ---------------------------------------------------------------------------
// Session overlay: custom sheets and tags (Battle Lab forge, later NPC-proposed units).
// Never persisted here; the caller decides what to keep.
// ---------------------------------------------------------------------------

const customTags = new Map<string, TagDef>();
const customSheets = new Map<string, UnitSheet>();

export function isBuiltinTag(id: string): boolean {
  return TAGS.some((t) => t.id === id || t.aliases?.includes(id));
}

export function isBuiltinSheet(id: string): boolean {
  return UNIT_SHEETS.some((u) => u.id === id);
}

/** Add or replace a session tag. Built-in tags cannot be overridden. */
export function registerCustomTag(tag: TagDef): void {
  if (isBuiltinTag(tag.id)) throw new Error(`Tag ${tag.id} is built in and cannot be replaced.`);
  customTags.set(tag.id, tag);
  tagById.set(tag.id, tag);
  for (const alias of tag.aliases ?? []) if (!tagById.has(alias)) tagById.set(alias, tag);
}

/** Add or replace a session sheet. Built-in sheets cannot be overridden. */
export function registerCustomSheet(sheet: UnitSheet): void {
  if (isBuiltinSheet(sheet.id)) throw new Error(`Sheet ${sheet.id} is built in and cannot be replaced.`);
  customSheets.set(sheet.id, sheet);
  unitById.set(sheet.id, sheet);
}

export function removeCustomSheet(id: string): void {
  if (customSheets.delete(id)) unitById.delete(id);
}

export function clearCustomContent(): void {
  for (const id of customSheets.keys()) unitById.delete(id);
  customSheets.clear();
  for (const tag of customTags.values()) {
    tagById.delete(tag.id);
    for (const alias of tag.aliases ?? []) if (tagById.get(alias) === tag) tagById.delete(alias);
  }
  customTags.clear();
}

export function customSheetList(): UnitSheet[] {
  return [...customSheets.values()];
}

export function customTagList(): TagDef[] {
  return [...customTags.values()];
}

/** Built-in plus session sheets. */
export function allUnitSheets(): UnitSheet[] {
  return [...UNIT_SHEETS, ...customSheets.values()];
}

/** Built-in plus session tags. */
export function allTags(): TagDef[] {
  return [...TAGS, ...customTags.values()];
}

/** Canonical tag id for a name or alias (`cavalry` → `mounted`). Undefined if unknown. */
export function canonicalTagId(name: string): string | undefined {
  return tagById.get(name)?.id;
}

export function tagDef(name: string): TagDef | undefined {
  return tagById.get(name);
}

export function requireTag(name: string): TagDef {
  const tag = tagById.get(name);
  if (!tag) throw new Error(`Unknown combat tag: ${name}`);
  return tag;
}

export function unitSheet(id: string): UnitSheet | undefined {
  return unitById.get(id);
}

export function requireUnitSheet(id: string): UnitSheet {
  const sheet = unitById.get(id);
  if (!sheet) throw new Error(`Unknown unit sheet: ${id}`);
  return sheet;
}

export function terrainDef(id: string): TerrainDef | undefined {
  return terrainById.get(id);
}

export function weatherDef(id: string): WeatherDef | undefined {
  return weatherById.get(id);
}

export function fortificationType(id: string): FortificationType | undefined {
  return fortById.get(id);
}

/** Makeshift variant of a fortification type (§9.4), rounded to whole points. */
export function makeshiftOf(type: FortificationType): FortificationType {
  return {
    ...type,
    id: `${type.id}_makeshift`,
    name: `Makeshift ${type.name}`,
    pointHp: Math.round(type.pointHp * MAKESHIFT.pointHpMultiplier),
    structuralDef: Math.round(type.structuralDef * MAKESHIFT.structuralDefMultiplier),
    defenderDefBonus: Math.round(type.defenderDefBonus * MAKESHIFT.defenderDefBonusMultiplier),
  };
}

/** Tag definitions for a list of names, aliases resolved, unknown names dropped. */
export function resolveTags(names: readonly string[]): TagDef[] {
  const seen = new Set<string>();
  const out: TagDef[] = [];
  for (const name of names) {
    const tag = tagById.get(name);
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    out.push(tag);
  }
  return out;
}

export function hasTag(names: readonly string[], tag: string): boolean {
  const want = canonicalTagId(tag) ?? tag;
  return names.some((n) => (canonicalTagId(n) ?? n) === want);
}

/**
 * Armor-sourced portion of a unit's DEF (gambison, shield, heavy_armor, mobile_fortification).
 * Clamped to the sheet DEF so a badly tuned sheet can never yield negative base DEF.
 */
export function armorDef(sheet: Pick<UnitSheet, "def" | "tags">): number {
  const armor = resolveTags(sheet.tags).reduce((sum, t) => sum + (t.armorSource?.defBonus ?? 0), 0);
  return Math.min(armor, sheet.def);
}

/** "Unarmored" for improvised_weapons: no armor-sourced DEF at all. */
export function isArmored(sheet: Pick<UnitSheet, "def" | "tags">): boolean {
  return armorDef(sheet) > 0;
}

/** Tag requirements (shock needs Speed ≥ 4, ranged needs Range ≥ 1) a sheet fails to meet. */
export function unmetTagRequirements(sheet: UnitSheet): { tag: string; reason: string }[] {
  const out: { tag: string; reason: string }[] = [];
  for (const tag of resolveTags(sheet.tags)) {
    const req = tag.requires;
    if (!req) continue;
    if (req.minSpeed !== undefined && sheet.speed < req.minSpeed) {
      out.push({ tag: tag.id, reason: `needs Speed >= ${req.minSpeed}, sheet has ${sheet.speed}` });
    }
    if (req.minRange !== undefined && sheet.range < req.minRange) {
      out.push({ tag: tag.id, reason: `needs Range >= ${req.minRange}, sheet has ${sheet.range}` });
    }
  }
  return out;
}

/** Tag names on a sheet that resolve to nothing in the registry. */
export function unknownTags(names: readonly string[]): string[] {
  return names.filter((n) => !tagById.has(n));
}

/** Effective volley charges for a sheet (tagParams override the registry default). */
export function volleyCharges(sheet: UnitSheet): number | undefined {
  const tag = resolveTags(sheet.tags).find((t) => t.volleyCharges !== undefined);
  if (!tag) return undefined;
  return sheet.tagParams?.[tag.id]?.volleyCharges ?? tag.volleyCharges;
}

/** Orders a sheet's tags unlock beyond the universal ones. */
export function unlockedOrders(sheet: Pick<UnitSheet, "tags">): string[] {
  const out = new Set<string>();
  for (const tag of resolveTags(sheet.tags)) for (const o of tag.unlocksOrders ?? []) out.add(o);
  return [...out];
}

/** How often the unit may fire: 1 = every round, 2 = every 2nd, 3 = every 3rd. */
export function fireCadence(sheet: Pick<UnitSheet, "tags">): number {
  return resolveTags(sheet.tags).reduce((n, t) => Math.max(n, t.firesEveryNRounds ?? 1), 1);
}
