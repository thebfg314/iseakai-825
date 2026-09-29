import type { Project, Season, WorldState } from "./schema";

export type ProjectCatalogEntry = {
  key: string;
  name: string;
  labourDays: number;
  lumber: number;
  iron: number;
  stone: number;
  /** Cart-loads taken from the charcoal store when the work begins. */
  charcoal?: number;
  /** Cart-loads of clay dug with the work (wet ground), not a store. */
  clay?: number;
  labourKind: "mostly_men" | "men_women" | "mixed";
  tag?: string;
  completesToFeature?: string;
  completesToLand?: { from: keyof WorldState["holdings"][0]["land"]; to: keyof WorldState["holdings"][0]["land"]; acres?: number };
  specialist?: string;
};

/** Midpoints of Constitution §4.5 ranges. */
export const PROJECT_CATALOG: ProjectCatalogEntry[] = [
  { key: "flour_mill", name: "Flour mill", labourDays: 230, lumber: 11, iron: 60, stone: 4, labourKind: "mostly_men", tag: "mill", completesToFeature: "mill_flour", specialist: "millwright" },
  { key: "fulling_mill", name: "Fulling mill", labourDays: 205, lumber: 9.5, iron: 45, stone: 3.5, labourKind: "mostly_men", tag: "mill", completesToFeature: "mill_fulling", specialist: "millwright" },
  { key: "forge_mill", name: "Trip-hammer / forge mill", labourDays: 260, lumber: 11.5, iron: 90, stone: 5.5, labourKind: "mostly_men", tag: "forge", completesToFeature: "mill_forge", specialist: "millwright" },
  { key: "water_lifting", name: "Water-lifting system", labourDays: 120, lumber: 6, iron: 35, stone: 2.5, labourKind: "mostly_men" },
  { key: "fish_pond", name: "Fish pond", labourDays: 90, lumber: 3.5, iron: 10, stone: 1.5, labourKind: "mixed", completesToFeature: "fish_pond" },
  { key: "mill_leat", name: "Mill leat / small canal", labourDays: 150, lumber: 2.5, iron: 12, stone: 1, labourKind: "mostly_men" },
  { key: "clear_scrub", name: "Clear scrub to arable (1 acre)", labourDays: 35, lumber: 0, iron: 0, stone: 0, labourKind: "mixed", completesToLand: { from: "scrub", to: "fertile_arable", acres: 1 } },
  { key: "drain_swamp", name: "Drain swamp (1 acre)", labourDays: 60, lumber: 2, iron: 6.5, stone: 1, labourKind: "mostly_men", completesToLand: { from: "swamp", to: "fertile_arable", acres: 1 } },
  { key: "improve_waste", name: "Improve waste to meadow (1 acre)", labourDays: 22, lumber: 0.5, iron: 2.5, stone: 0, labourKind: "mixed", completesToLand: { from: "waste", to: "meadow", acres: 1 } },
  { key: "irrigation", name: "Irrigation ditches (100 yards)", labourDays: 30, lumber: 1, iron: 5, stone: 0.5, labourKind: "mostly_men" },
  { key: "expand_vineyard", name: "Expand vineyard (1 acre)", labourDays: 40, lumber: 2, iron: 4, stone: 0, labourKind: "men_women", completesToLand: { from: "fertile_arable", to: "vineyard", acres: 1 } },
  { key: "expand_orchard", name: "Expand orchard (1 acre)", labourDays: 28, lumber: 1, iron: 2.5, stone: 0, labourKind: "mixed", completesToLand: { from: "fertile_arable", to: "orchard", acres: 1 } },
  { key: "terracing", name: "Terracing (1 acre)", labourDays: 75, lumber: 2.5, iron: 10, stone: 5, labourKind: "mostly_men" },
  { key: "marling", name: "Soil improvement / marling (1 acre)", labourDays: 22, lumber: 0, iron: 2, stone: 0, labourKind: "mixed" },
  { key: "timber_hall", name: "Timber manor hall", labourDays: 325, lumber: 20, iron: 60, stone: 4, labourKind: "mostly_men", completesToFeature: "manor_hall" },
  { key: "partial_stone_hall", name: "Partial stone hall", labourDays: 550, lumber: 15, iron: 90, stone: 22, labourKind: "mostly_men", completesToFeature: "manor_hall" },
  { key: "timber_chapel", name: "Simple timber chapel", labourDays: 200, lumber: 11, iron: 30, stone: 4, labourKind: "mostly_men", tag: "church", completesToFeature: "chapel" },
  { key: "stone_chapel", name: "Stone chapel (small)", labourDays: 450, lumber: 9, iron: 60, stone: 30, labourKind: "mostly_men", tag: "church", completesToFeature: "chapel" },
  { key: "small_cell", name: "Small monastic cell (timber)", labourDays: 180, lumber: 10, iron: 25, stone: 4, labourKind: "mostly_men", tag: "church", completesToFeature: "monastery" },
  { key: "large_barn", name: "Large barn", labourDays: 160, lumber: 14, iron: 30, stone: 2.5, labourKind: "mostly_men", completesToFeature: "barn" },
  { key: "stables", name: "Stables", labourDays: 110, lumber: 9, iron: 22, stone: 2, labourKind: "mostly_men", completesToFeature: "stables" },
  { key: "forge", name: "Blacksmith forge & workshop", labourDays: 140, lumber: 7.5, iron: 45, stone: 4, labourKind: "mostly_men", tag: "forge", completesToFeature: "forge" },
  { key: "carpenter_workshop", name: "Carpenter's workshop", labourDays: 80, lumber: 6, iron: 17, stone: 1, labourKind: "mostly_men", completesToFeature: "carpenter_workshop" },
  { key: "textile_workshop", name: "Textile workshop", labourDays: 70, lumber: 5, iron: 10, stone: 1, labourKind: "men_women", completesToFeature: "textile_workshop" },
  { key: "bakehouse", name: "Bakehouse / brewery", labourDays: 95, lumber: 6, iron: 25, stone: 2.5, labourKind: "mostly_men", completesToFeature: "bakehouse" },
  { key: "labourer_housing", name: "Labourer housing (one dwelling)", labourDays: 55, lumber: 4.5, iron: 10, stone: 1, labourKind: "mostly_men", completesToFeature: "labourer_housing" },
  { key: "timber_bridge", name: "Timber bridge (small)", labourDays: 115, lumber: 9, iron: 30, stone: 2.5, labourKind: "mostly_men", completesToFeature: "bridge" },
  { key: "stone_bridge", name: "Simple stone bridge", labourDays: 275, lumber: 5.5, iron: 45, stone: 18, labourKind: "mostly_men", completesToFeature: "bridge" },
  { key: "causeway", name: "Causeway (100 yards)", labourDays: 45, lumber: 2.5, iron: 10, stone: 5, labourKind: "mostly_men" },
  { key: "landing_stage", name: "Landing stage", labourDays: 60, lumber: 5, iron: 17, stone: 2.5, labourKind: "mostly_men", completesToFeature: "landing_stage" },
  { key: "improve_road", name: "Improve local pack-paths (estate roads)", labourDays: 90, lumber: 3, iron: 18, stone: 6, labourKind: "mostly_men", tag: "access", completesToFeature: "improved_road" },
  { key: "palisade", name: "Timber palisade (100 yards)", labourDays: 70, lumber: 9, iron: 22, stone: 1, labourKind: "mostly_men", completesToFeature: "palisade" },
  { key: "wooden_tower", name: "Raised platform + wooden tower", labourDays: 215, lumber: 14, iron: 45, stone: 5, labourKind: "mostly_men", completesToFeature: "tower" },
  { key: "gatehouse", name: "Gatehouse / strong gate", labourDays: 110, lumber: 7.5, iron: 37, stone: 2.5, labourKind: "mostly_men", completesToFeature: "gatehouse" },
  { key: "watch_post", name: "Watch post", labourDays: 45, lumber: 3.5, iron: 10, stone: 1, labourKind: "mixed", completesToFeature: "watch_post" },
  { key: "quarry", name: "Small stone quarry (opening)", labourDays: 115, lumber: 3.5, iron: 30, stone: 0, labourKind: "mostly_men", completesToFeature: "quarry" },
  { key: "clay_pit", name: "Clay pit", labourDays: 45, lumber: 2, iron: 10, stone: 0, labourKind: "mixed", completesToFeature: "clay_pit" },
  { key: "charcoal_burning", name: "Organized charcoal burning", labourDays: 60, lumber: 2, iron: 0, stone: 0, labourKind: "mixed" },
  // Clay shaft and bellows, not an iron-hungry building. About one season of the men's spare days (spring pool is ~180).
  { key: "bloomery", name: "Bloomery", labourDays: 120, lumber: 4, iron: 0, stone: 2, charcoal: 2, clay: 3, labourKind: "mostly_men", tag: "forge", completesToFeature: "bloomery" },
  { key: "tannery", name: "Tannery", labourDays: 85, lumber: 5, iron: 17, stone: 1, labourKind: "mostly_men", completesToFeature: "tannery" },
  { key: "pottery_kiln", name: "Pottery kiln", labourDays: 60, lumber: 3.5, iron: 10, stone: 2, labourKind: "men_women", completesToFeature: "pottery_kiln" },
];

export const FORGE_PROJECT_KEYS = new Set(
  PROJECT_CATALOG.filter((p) => p.tag === "forge" || p.key === "forge" || p.key === "bloomery" || p.key === "forge_mill").map((p) => p.key),
);

export const FORGE_FEATURES = new Set(["forge", "mill_forge", "bloomery"]);

export const CHURCH_PROJECT_KEYS = new Set(
  PROJECT_CATALOG.filter((p) => p.tag === "church").map((p) => p.key),
);

export const CHURCH_FEATURES = new Set(["chapel", "monastery"]);

export function hasChurch(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.some((f) => CHURCH_FEATURES.has(f)));
}

export function hasMonastery(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.includes("monastery"));
}

export function lookupProject(key: string): ProjectCatalogEntry | undefined {
  return PROJECT_CATALOG.find((p) => p.key === key || p.name.toLowerCase() === key.toLowerCase());
}

export function labourKindFor(project: Project): ProjectCatalogEntry["labourKind"] {
  return lookupProject(project.key)?.labourKind ?? "mostly_men";
}

export const LABOUR_MIDPOINTS: Record<Season, { men: number; women: number; youths: number }> = {
  spring: { men: 15, women: 10, youths: 3 },
  summer: { men: 10, women: 8, youths: 2 },
  autumn: { men: 15, women: 10, youths: 3 },
  winter: { men: 20, women: 12, youths: 4 },
};

export const YIELD_MID: Record<"wheat" | "rye" | "barley" | "oats", number> = {
  wheat: 6,
  rye: 7.5,
  barley: 7.5,
  oats: 5.5,
};
