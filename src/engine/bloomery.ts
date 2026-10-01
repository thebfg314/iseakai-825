import type { MechanicalProposal, WorldState } from "./schema";
import { labourRemaining } from "./labour";
import { lookupProject } from "./projectCatalog";
import { resourceOutputBonus } from "./applyDelta";
import { beginCostLine, beginStoreGaps, projectStoreBill, stillNeededSentence } from "./projectBegin";
import { round1 } from "./util";

/** One firing: a cart of charcoal and a few days, for a few pounds of bloom iron. */
export const BLOOMERY_SMELT_CHARCOAL = 1;
export const BLOOMERY_SMELT_DAYS = 18;
export const BLOOMERY_SMELT_IRON = 4;

/** Labour row used only while the season resolves, then dropped. Not a project. */
export const BLOOMERY_HEARTH_LABOUR = "bloomery-hearth";

/** Said once, in Bernard's own talk, when the stores can bear the work. No card yet. */
export const BERNARD_BLOOMERY_MENTION =
  "A bloomery could keep a steady supply of iron for this hearth. Ask me, if you would hear more.";

/** Aldric sends the lord to the forge. He does not quote Bernard or queue the work. */
export const ALDRIC_BLOOMERY_REFERRAL =
  "A bloomery is Bernard's work at the forge. I do not raise it, and I will not set the stores aside for it. Speak to him if you would hear more.";

function bloomeryBillProposal(): Extract<MechanicalProposal, { type: "start_project" }> {
  return {
    type: "start_project",
    summary: "Raise a bloomery",
    projectKey: "bloomery",
  };
}

/** The explanation he gives only after the lord asks. Costs are the ones Confirm takes. */
export function bernardBloomeryPitch(): string {
  const cost = beginCostLine(projectStoreBill(bloomeryBillProposal()));
  return `I would raise a bloomery — a clay shaft and bellows — and burn bog ore from the wet ground. ${cost} The iron comes slow, a few pounds in a season. Bought iron still goes further. If you will have it, Confirm, and I will set the stores aside.`;
}

export const BERNARD_BLOOMERY_SUGGESTION = bernardBloomeryPitch();

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

/**
 * The estate holds every store Confirm will set aside for a bloomery.
 * Timber, stone, charcoal, and any coin on that bill. Clay is dug with the work, not taken from a store.
 * A burning mound or a fat purse does not stand in for those stores.
 */
export function bloomerySuggestReady(state: WorldState): boolean {
  if (estateHasBloomery(state) || bloomeryUnderway(state)) return false;
  return beginStoreGaps(state, bloomeryBillProposal()).length === 0;
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

const HEAR_MORE =
  /\b(tell me more|hear more|i would hear|say on|go on|explain that|what would it take|what does it take|speak of it)\b/i;

/**
 * The lord asked Bernard to explain or begin a bloomery.
 * After he has already mentioned it, "tell me more" counts. A question about bog ore alone does not.
 */
export function playerAskedBloomery(text: string, alreadyMentioned = false): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeBloomeryOrder(t)) return true;
  if (/\bbloomery\b/i.test(t) && /\b(what|how|tell|explain|hear|more|about|describe|speak|raise|build|want|need)\b/i.test(t)) {
    return true;
  }
  return alreadyMentioned && HEAR_MORE.test(t);
}

export function isBernardBloomeryPitch(text: string): boolean {
  return /bloomery/i.test(text) && /clay shaft/i.test(text);
}

export function bloomeryNotReadyReason(state: WorldState): string | null {
  if (estateHasBloomery(state)) return "The bloomery already stands.";
  if (bloomeryUnderway(state)) return "The bloomery is already begun.";
  if (bloomerySuggestReady(state)) return null;
  const gaps = beginStoreGaps(state, bloomeryBillProposal());
  if (!gaps.length) return null;
  return `Not yet. ${stillNeededSentence("Bloomery", gaps)}`;
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

export function inferSmithProposals(state: WorldState, playerText: string, alreadyMentioned = false): MechanicalProposal[] {
  if (!playerAskedBloomery(playerText, alreadyMentioned)) return [];
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
