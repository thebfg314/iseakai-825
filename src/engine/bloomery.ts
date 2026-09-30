import type { MechanicalProposal, WorldState } from "./schema";
import { labourRemaining } from "./labour";
import { lookupProject } from "./projectCatalog";
import { resourceOutputBonus } from "./applyDelta";
import { round1 } from "./util";

/** A purse that can bear the work. Not a hoard. */
export const BLOOMERY_DECENT_PURSE = 120;

/** Opening store is 1 cart-load. Four is a real pile, not a hoard. */
export const BLOOMERY_DECENT_CHARCOAL = 4;

/** One firing: a cart of charcoal and a few days, for a few pounds of bloom iron. */
export const BLOOMERY_SMELT_CHARCOAL = 1;
export const BLOOMERY_SMELT_DAYS = 18;
export const BLOOMERY_SMELT_IRON = 4;

/** Labour row used only while the season resolves, then dropped. Not a project. */
export const BLOOMERY_HEARTH_LABOUR = "bloomery-hearth";

export const BERNARD_BLOOMERY_SUGGESTION =
  "Charcoal enough, and the chest can bear it. I would raise a bloomery — a clay shaft and bellows — and burn bog ore from the wet ground. About a season of work. Clay, stone, timber, and charcoal. The iron comes slow, a few pounds in a season. Bought iron still goes further. If you will have it, Confirm, and I will set the stores aside.";

export const BERNARD_BOG_ORE_SPEECH =
  "Bog ore is the rusty mud in the wet ground, swamp and the low banks. We dry it, then burn it with charcoal in a clay shaft until the iron gathers in a spongy lump. That lump is bloom iron. The shaft is a bloomery. Slow work. It will not fill the forge the way a cart of bought iron does.";

const BOG_ORE_ASK =
  /\bbog[\s-]*ore\b|\bbog[\s-]*iron\b|\b(what|where|explain|tell|how).{0,48}\b(ore|bloomery)\b/i;

const BLOOMERY_ORDER =
  /\b(build|raise|start|begin|make|set up|put up|want|need)\b.{0,48}\bbloomery\b|\bbloomery\b.{0,32}\b(build|raise|start|begin|make)\b|\bsmelt\b/i;

export function estateHasBloomery(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.includes("bloomery"));
}

export function bloomeryUnderway(state: WorldState): boolean {
  return state.projects.some((p) => p.key === "bloomery" && p.status === "active");
}

/** Charcoal-burners at work, or a finished burning, or a decent store. */
export function charcoalSupplyReady(state: WorldState): boolean {
  if (state.resources.charcoal >= BLOOMERY_DECENT_CHARCOAL) return true;
  return state.projects.some(
    (p) => p.key === "charcoal_burning" && (p.status === "active" || p.status === "completed"),
  );
}

export function bloomeryPurseReady(state: WorldState): boolean {
  return state.resources.denarii >= BLOOMERY_DECENT_PURSE;
}

/** Bernard may put a bloomery on the table. False at the opening of the game. */
export function bloomerySuggestReady(state: WorldState): boolean {
  if (estateHasBloomery(state) || bloomeryUnderway(state)) return false;
  return charcoalSupplyReady(state) && bloomeryPurseReady(state);
}

export function asksAboutBogOre(text: string): boolean {
  return BOG_ORE_ASK.test(text.trim());
}

export function looksLikeBloomeryOrder(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (asksAboutBogOre(t) && !/\b(build|raise|start|begin|smelt)\b/i.test(t)) return false;
  return BLOOMERY_ORDER.test(t);
}

export function bloomeryNotReadyReason(state: WorldState): string | null {
  if (estateHasBloomery(state)) return "The bloomery already stands.";
  if (bloomeryUnderway(state)) return "The bloomery is already begun.";
  if (bloomerySuggestReady(state)) return null;
  const charcoal = charcoalSupplyReady(state);
  const purse = bloomeryPurseReady(state);
  if (!charcoal && !purse) return "Not yet. Charcoal is too thin, and the chest is too thin, for a bloomery.";
  if (!charcoal) return "Not yet. I need the charcoal-burners at it, or a decent store of charcoal, before I raise a bloomery.";
  return "The charcoal could bear it, but the chest is too thin. I will not start a bloomery on an empty purse.";
}

export function isBloomeryStart(p: { type: string; projectKey?: string }): boolean {
  return p.type === "start_project" && p.projectKey === "bloomery";
}

export function bloomeryStartProposal(state: WorldState): MechanicalProposal {
  const cat = lookupProject("bloomery");
  const holdingId = state.holdings[0]?.id ?? "fontenay";
  return {
    type: "start_project",
    summary: "Raise a bloomery — a clay shaft and bellows. About a season of work, with clay, stone, timber, and charcoal.",
    projectKey: "bloomery",
    holdingId,
    name: cat?.name ?? "Bloomery",
    notes: "Clay shaft furnace and bellows. Bog ore from the wet ground, burned with charcoal, yields bloom iron.",
  };
}

export function inferSmithProposals(state: WorldState, playerText: string): MechanicalProposal[] {
  if (!looksLikeBloomeryOrder(playerText)) return [];
  if (!bloomerySuggestReady(state)) return [];
  return [bloomeryStartProposal(state)];
}

/**
 * Fire each standing bloomery once a season.
 * Reserves days on a temporary labour row so other works do not also spend them.
 * The season's project pass drops that row; it is not a work in the books.
 */
export function smeltBloomeries(state: WorldState): string[] {
  const notes: string[] = [];
  for (const holding of state.holdings) {
    if (!holding.features.includes("bloomery")) continue;
    if (state.resources.charcoal < BLOOMERY_SMELT_CHARCOAL) {
      notes.push(`The bloomery on ${holding.name} stands cold. There is not charcoal enough to fire it.`);
      continue;
    }
    const menLeft = labourRemaining(state).men;
    if (menLeft < BLOOMERY_SMELT_DAYS) {
      notes.push(`The bloomery on ${holding.name} stands cold. The hands are already at other work.`);
      continue;
    }
    state.labour.assigned.push({
      projectId: BLOOMERY_HEARTH_LABOUR,
      men: BLOOMERY_SMELT_DAYS,
      women: 0,
      youths: 0,
    });
    state.resources.charcoal = round1(state.resources.charcoal - BLOOMERY_SMELT_CHARCOAL);
    const yielded = round1(resourceOutputBonus(state, "iron", BLOOMERY_SMELT_IRON));
    state.resources.iron = round1(state.resources.iron + yielded);
    const pounds = yielded === 1 ? "1 pound" : `${yielded} pounds`;
    const carts =
      BLOOMERY_SMELT_CHARCOAL === 1 ? "1 cart-load" : `${BLOOMERY_SMELT_CHARCOAL} cart-loads`;
    notes.push(
      `The bloomery on ${holding.name} burned ${carts} of charcoal and ${BLOOMERY_SMELT_DAYS} days of work, and yielded ${pounds} of bloom iron.`,
    );
  }
  return notes;
}
