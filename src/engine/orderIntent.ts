import type { MechanicalProposal, WorldState } from "./schema";
import { lookupProject } from "./projectCatalog";
import { huntFulfillReason, inferHuntProposals, isNegotiatorId, looksLikeHuntOrder } from "./hunts";
import { hireFulfillReason, inferHireProposals, looksLikeHireOrder, specialistById } from "./specialists";

const QUESTION_PREFIX = /^(how|what|why|who|where|when|tell me|report|status|explain|describe)\b/i;
const ORDER_VERB =
  /\b(sow|sowing|plant|assign|labour|labor|start|begin|clear|scrub|drain|give|gift|grant|tithe|alms|bless|blessing|mood|morale|buy|sell|build|project|transfer|hire|retain|employ|send (the )?(men|hands|labour|labor)|more barley|more oats|more wheat|more rye)\b/i;
const ORDER_OVERRIDE = /\b(sow|assign|start|give|clear|build|bless|gift|tithe|hire|retain|employ)\b/i;
/** Lord instructions to change rotation / fallow / legumes / manure / seed-keeping — even without sow/plant. */
const HUSBANDRY_ORDER =
  /\b(rotation|fallow|legumes?|peas?\b|manure|muck|seed[- ]?(keep|keeping|selection|saving|kept)|three[- ]field|split (?:our |the )?(?:farming )?fields)\b/i;

export function looksLikeMechanicalOrder(text: string, npcId?: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (npcId && isNegotiatorId(npcId) && looksLikeHuntOrder(t)) return true;
  if (looksLikeHireOrder(t)) return true;
  // Pure questions stay reports — even if they mention manure or peas.
  if (QUESTION_PREFIX.test(t) && !ORDER_OVERRIDE.test(t)) return false;
  return ORDER_VERB.test(t) || HUSBANDRY_ORDER.test(t);
}

function mostPlentifulGrain(state: WorldState): { resource: "wheat" | "rye" | "barley" | "oats"; amount: number } | null {
  const grains = [
    ["rye", state.resources.rye],
    ["wheat", state.resources.wheat],
    ["barley", state.resources.barley],
    ["oats", state.resources.oats],
  ] as const;
  const best = [...grains].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 0.5) return null;
  return { resource: best[0], amount: best[1] };
}

function holdingId(state: WorldState): string {
  return state.holdings[0]?.id ?? "fontenay";
}

/**
 * Conservative engine draft when the model spoke but emitted no valid proposal.
 * These still wait for player Confirm.
 */
export function inferOrderProposals(state: WorldState, npcId: string, playerText: string): MechanicalProposal[] {
  const t = playerText.toLowerCase();
  const hid = holdingId(state);

  if (npcId === "merchant") {
    return [];
  }

  if (isNegotiatorId(npcId)) {
    return inferHuntProposals(state, playerText);
  }

  if (npcId === "smith" || specialistById(npcId)) {
    return [];
  }

  if (looksLikeHireOrder(playerText)) {
    if (npcId !== "steward") return [];
    return inferHireProposals(state, playerText);
  }

  if (npcId === "chaplain") {
    if (/\b(bless|blessing|morale|mood|encourage)\b/.test(t)) {
      return [
        {
          type: "add_modifier",
          summary: "Blessing upon the household (mood).",
          target: "mood",
          kind: "temporary",
          seasonsRemaining: 4,
          effect: { op: "add", value: 1 },
          source: "Ermenald's blessing",
        },
      ];
    }
    if (/\b(give|gift|grant|send|tithe|alms).{0,50}(grain|wheat|rye|barley|oats|modii|cell|chapel|monk|oratory)\b/.test(t)) {
      const grain = mostPlentifulGrain(state);
      if (!grain) return [];
      const amount = Math.min(2, Math.max(0.5, Math.floor(grain.amount * 0.25 * 2) / 2 || 1));
      return [
        {
          type: "transfer_resources",
          summary: `Give ${amount} ${grain.resource} to the cell.`,
          resource: grain.resource,
          amount,
          direction: "consume",
          reason: "Gift to the cell of Saint-Martin",
        },
      ];
    }
    return [];
  }

  if (/\b(clear|clearing).{0,24}(scrub|brush)\b|\bscrub.{0,16}(clear|arable)\b/.test(t)) {
    const catalog = lookupProject("clear_scrub");
    if (!catalog) return [];
    return [
      {
        type: "start_project",
        summary: "Begin clearing one acre of scrub to arable.",
        projectKey: "clear_scrub",
        holdingId: hid,
        name: catalog.name,
      },
    ];
  }

  if (/\b(drain|draining).{0,20}(swamp|marsh)\b/.test(t)) {
    const catalog = lookupProject("drain_swamp");
    if (!catalog) return [];
    return [
      {
        type: "start_project",
        summary: "Begin draining one acre of swamp.",
        projectKey: "drain_swamp",
        holdingId: hid,
        name: catalog.name,
      },
    ];
  }

  if (/\b(sow|sowing|plant|more).{0,28}barley\b|\bbarley.{0,20}(acre|field|sow|more)\b/.test(t)) {
    return [
      {
        type: "adjust_sowing",
        summary: "Sow the remaining spring share as barley (oats only if any is left).",
        holdingId: hid,
        springBarleyShare: 0.85,
      },
    ];
  }

  if (/\b(sow|sowing|plant|more).{0,28}oats\b/.test(t)) {
    return [
      {
        type: "adjust_sowing",
        summary: "Sow more of the remaining spring share as oats.",
        holdingId: hid,
        springBarleyShare: 0.3,
      },
    ];
  }

  if (/\b(give|gift|grant|send|tithe).{0,50}(grain|wheat|rye|barley|oats|modii).{0,40}(cell|chapel|monk|oratory|church)\b|\b(give|gift).{0,30}(cell|chapel|monks)\b/.test(t)) {
    const grain = mostPlentifulGrain(state);
    if (!grain) return [];
    const amount = Math.min(2, Math.max(0.5, Math.floor(grain.amount * 0.25 * 2) / 2 || 1));
    return [
      {
        type: "transfer_resources",
        summary: `Give ${amount} ${grain.resource} to the cell.`,
        resource: grain.resource,
        amount,
        direction: "consume",
        reason: "Gift to the cell of Saint-Martin",
      },
    ];
  }

  if (/\b(bless|blessing|morale|mood)\b/.test(t)) {
    return [
      {
        type: "add_modifier",
        summary: "A word of encouragement (mood).",
        target: "mood",
        kind: "temporary",
        seasonsRemaining: 3,
        effect: { op: "add", value: 1 },
        source: "Lord's encouragement",
      },
    ];
  }

  return [];
}

export function cannotFulfillReason(state: WorldState, npcId: string, playerText: string): string | null {
  const t = playerText.toLowerCase();
  if (isNegotiatorId(npcId)) {
    const huntWhy = huntFulfillReason(state, playerText);
    if (huntWhy) return huntWhy;
  }
  const hireWhy = hireFulfillReason(state, npcId, playerText);
  if (hireWhy) return hireWhy;
  if (npcId === "smith" && looksLikeMechanicalOrder(playerText) && /\b(sow|grain|field|household|labour|labor)\b/.test(t)) {
    return "Bernard does not keep the fields. Speak to Aldric the steward.";
  }
  if (specialistById(npcId) && looksLikeMechanicalOrder(playerText) && /\b(sow|grain|field|household|labour|labor|hire)\b/.test(t)) {
    return "This craft does not keep the household books. Speak to Aldric the steward.";
  }
  if (npcId === "chaplain" && /\b(sow|clear scrub|assign labour|assign labor)\b/.test(t)) {
    return "Father Ermenald does not run the ploughland. Speak to Aldric the steward.";
  }
  if (/\b(give|gift).{0,40}(grain|wheat|rye|barley|oats)\b/.test(t) && !mostPlentifulGrain(state)) {
    return "The granary is too thin to give grain without emptying the household stores.";
  }
  return null;
}
