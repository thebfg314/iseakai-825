import type { MechanicalProposal, StartHuntProposal } from "./schema";
import { lookupProject } from "./projectCatalog";

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sameName(a?: string, b?: string): boolean {
  const left = compact(a ?? "");
  const right = compact(b ?? "");
  return Boolean(left && right && left === right);
}

function sameHuntTarget(a: StartHuntProposal, b: StartHuntProposal): boolean {
  const ar = compact(a.resource || "");
  const br = compact(b.resource || "");
  const ag = compact(a.goods || "");
  const bg = compact(b.goods || "");
  const close = (x: string, y: string) => Boolean(x && y && (x === y || x.startsWith(y) || y.startsWith(x)));
  return close(ar, br) || close(ag, bg) || close(ar, bg) || close(br, ag);
}

/** True when `next` is clearly a revision of the asked-about offer, not a second order. */
export function isRevisionOf(asked: MechanicalProposal, next: MechanicalProposal): boolean {
  switch (asked.type) {
    case "start_project":
      return (
        next.type === "start_project" &&
        (asked.projectKey === next.projectKey ||
          sameName(asked.name, next.name) ||
          sameName(asked.projectKey, next.name) ||
          sameName(asked.name, next.projectKey))
      );
    case "start_hunt":
      return next.type === "start_hunt" && sameHuntTarget(asked, next);
    case "set_standing_order":
      return (
        next.type === "set_standing_order" &&
        Boolean((asked.orderId && asked.orderId === next.orderId) || sameName(asked.text, next.text))
      );
    case "adjust_project":
      return next.type === "adjust_project" && asked.projectId === next.projectId;
    case "assign_labour":
      return next.type === "assign_labour" && asked.projectId === next.projectId;
    case "register_npc":
      return next.type === "register_npc" && (asked.npc.id === next.npc.id || sameName(asked.npc.name, next.npc.name));
    case "adjust_sowing":
      return next.type === "adjust_sowing" && (!asked.holdingId || !next.holdingId || asked.holdingId === next.holdingId);
    case "transfer_resources":
      return next.type === "transfer_resources" && asked.resource === next.resource && asked.direction === next.direction;
    case "add_modifier":
      return next.type === "add_modifier" && asked.target === next.target && compact(asked.source) === compact(next.source);
    case "remove_modifier":
      return next.type === "remove_modifier" && asked.modifierId === next.modifierId;
    case "register_resource":
      return (
        next.type === "register_resource" && (asked.resourceId === next.resourceId || sameName(asked.name, next.name))
      );
    case "register_feature":
      return next.type === "register_feature" && asked.feature === next.feature && asked.holdingId === next.holdingId;
    default:
      return false;
  }
}

function projectLabel(p: Extract<MechanicalProposal, { type: "start_project" }>): string {
  return p.name ?? lookupProject(p.projectKey)?.name ?? p.projectKey.replaceAll("_", " ");
}

/** One-line, in-world cue — not a player line and not ledger jargon. */
export function askAboutCue(npcName: string, proposal: MechanicalProposal): string {
  const who = npcName || "they";
  switch (proposal.type) {
    case "start_hunt":
      return `The lord would speak of the hunt for ${proposal.goods}, and the purse ${who} named.`;
    case "start_project": {
      const name = projectLabel(proposal);
      if (/mill/i.test(name) || /mill/i.test(proposal.projectKey)) {
        return `The lord would speak of the mill work ${who} just proposed.`;
      }
      return `The lord would speak of the ${name} ${who} just proposed.`;
    }
    case "register_npc":
      return `The lord would speak of taking ${proposal.npc.name} into the household.`;
    case "set_standing_order":
      return `The lord would speak of the standing order ${who} just proposed.`;
    case "adjust_project":
      return `The lord would speak of the change to the work ${who} just proposed.`;
    case "adjust_sowing":
      return `The lord would speak of the sowing ${who} just proposed.`;
    case "transfer_resources":
      return `The lord would speak of the stores ${who} just proposed to move.`;
    case "assign_labour":
      return `The lord would speak of the hands ${who} just proposed to send.`;
    case "add_modifier":
      return `The lord would speak of the custom ${who} just proposed.`;
    default:
      return `The lord would speak of the matter ${who} just proposed.`;
  }
}

/** Compact, game-owned line for the chat pack — not a full proposal dump. */
export function compactOfferLine(proposal: MechanicalProposal): string {
  switch (proposal.type) {
    case "start_project": {
      const name = projectLabel(proposal);
      const costs = proposal.customCosts ?? lookupProject(proposal.projectKey);
      const costBit = costs
        ? `${costs.labourDays} days, ${costs.lumber} timber, ${costs.iron} iron, ${costs.stone} stone`
        : "";
      return `start_project ${name} (${proposal.projectKey}): ${proposal.summary}${costBit ? ` — ${costBit}` : ""}`;
    }
    case "start_hunt": {
      const seasons = proposal.durationSeasons === 1 ? "1 season" : `${proposal.durationSeasons} seasons`;
      return `start_hunt ${proposal.goods}: ${proposal.summary} — ${proposal.quotedDenarii} denarii, ${seasons}`;
    }
    case "set_standing_order":
      return `set_standing_order: ${proposal.summary} — ${proposal.text}`;
    case "adjust_project":
      return `adjust_project ${proposal.projectId}: ${proposal.summary}`;
    case "assign_labour":
      return `assign_labour ${proposal.projectId}: ${proposal.summary} — ${proposal.men} men, ${proposal.women} women, ${proposal.youths} youths`;
    case "register_npc":
      return `hire ${proposal.npc.name} (${proposal.npc.role}): ${proposal.summary}`;
    case "adjust_sowing":
      return `adjust_sowing: ${proposal.summary}`;
    case "transfer_resources":
      return `transfer_resources ${proposal.direction} ${proposal.amount} ${proposal.resource}: ${proposal.summary}`;
    case "add_modifier":
      return `add_modifier ${proposal.target} (${proposal.source}): ${proposal.summary}`;
    default:
      return `${proposal.type}: ${proposal.summary}`;
  }
}

export function pendingOfferScrap(proposal: MechanicalProposal): string {
  return `PENDING OFFER UNDER DISCUSSION (the lord asked about this unconfirmed offer; if they change terms, revise this same offer — do not stack a second copy, and do not treat it as already Confirmed):\n${compactOfferLine(proposal)}`;
}
