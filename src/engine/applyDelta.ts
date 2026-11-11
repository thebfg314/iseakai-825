import {
  type ApplyResult,
  type CanonicalResource,
  CANONICAL_RESOURCES,
  type MechanicalProposal,
  type WorldState,
} from "./schema";
import { CHURCH_FEATURES, CHURCH_PROJECT_KEYS, FORGE_FEATURES, FORGE_PROJECT_KEYS, catalogUnits, lookupProject } from "./projectCatalog";
import { autoAssignLeftoverToProject, labourCalledSentence, labourPool, labourRemaining, resolveActiveProject } from "./labour";
import { applyMultiplyAdd, modifiersFor } from "./modifiers";
import { syncTradeFromFeatures } from "./merchant";
import { applyMerchantTransferLine } from "./merchantShop";
import { consumeGrain, grainOnHand } from "./grain";
import { applyMoodModifierToHappiness, applyPeopleHappinessDelta, HAPPINESS_ALMS, looksLikeAlms } from "./peopleHappiness";
import { applySettleHouseholds } from "./peopleMovement";
import { acceptHuntOverage, isNegotiatorId, negotiatorAllowed, startHunt } from "./hunts";
import {
  hireSummary,
  isEstateSmithNpc,
  matchHireableSpecialist,
  specialistAllowed,
  specialistAlreadyPresent,
  specialistById,
  specialistHireBlocked,
  specialistHireGrainRation,
  specialistNpc,
} from "./specialists";
import { stampProjectEnded, stampProjectStart } from "./projectProgress";
import { beginStoreRefusal, projectStoreBill, startProjectResult } from "./projectBegin";
import { resultPayLine } from "./projectResult";
import {
  isSoloSmithProject,
  ownWorkBegunPhrase,
  personalSeasonsForStart,
  smithStartRefusal,
  startForgeDays,
  startIsPersonalSmithing,
  startIsSoloSmithing,
  villageNotCalledReason,
} from "./smithing";
import { IMPROVEMENT_ALREADY, identicalModifierAlready } from "./toolImprovement";
import { newId, round1 } from "./util";
import { parseProposal } from "../llm/parse";
import { parkForthcomingOrder, innerProposalOfDefer } from "./forthcoming";
import { applyHistoryProposal, isHistoryProposal } from "../history/hooks";
import { applyDisbandUnit, applyRaiseUnit, applyRegisterUnitSheet, CALL_TEXT, raiseCallDirect } from "./military";
import { applyFreeMancipia, isMancipia, MANUMISSION_HAPPINESS_CAP, MANUMISSION_HAPPINESS_PER_HEAD, mancipiaCount, setMancipia } from "./mancipia";
import { ensureAgriculture, fieldRotation, sownCapacity, springFieldAcres } from "./agriculture";
import {
  applyCellAlms,
  applyCellSurplusSale,
  applySponsoredFeast,
  isCellAlmsProposal,
  isCellSurplusId,
  noteSundayOrFeastWork,
  noteTakingFromCell,
} from "./church";
import {
  amountPhrase,
  featureName,
  looksLikeEngineKey,
  roleName,
  sowingRotationLine,
  sowingShareLine,
  workDisplayName,
} from "../ui/ledgerCopy";

const SMITH_TRANSFER = new Set([
  "iron",
  "charcoal",
  "copper",
  "tin",
  "hardwood",
  "hides",
  "trade_goods",
]);

const SMITH_FEATURES = new Set(["forge", "mill_forge", "bloomery"]);

const CHAPLAIN_TRANSFER = new Set([
  "denarii",
  "wheat",
  "rye",
  "barley",
  "oats",
  "wine",
  "honey",
  "beeswax",
  "linen",
  "salt",
  "stone",
  "softwood",
  "hardwood",
]);

const CHAPLAIN_NPC_ROLES = new Set(["chaplain", "priest", "monk", "novice", "bishop"]);

function isCanonical(id: string): id is CanonicalResource {
  return (CANONICAL_RESOURCES as readonly string[]).includes(id);
}

function getAmount(state: WorldState, resource: string): number | null {
  if (isCanonical(resource)) return state.resources[resource];
  if (isMancipia(resource)) return mancipiaCount(state);
  const custom = state.custom_resources.find((c) => c.id === resource);
  return custom ? custom.amount : null;
}

function setAmount(state: WorldState, resource: string, amount: number): boolean {
  const v = round1(Math.max(0, amount));
  if (isCanonical(resource)) {
    state.resources[resource] = v;
    return true;
  }
  if (isMancipia(resource)) {
    setMancipia(state, v);
    return true;
  }
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (!custom) return false;
  custom.amount = v;
  return true;
}

function hasForge(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.some((f) => FORGE_FEATURES.has(f)));
}

/**
 * Catalogue forge works (forge, bloomery, trip-hammer) stay his.
 * A free key with its own costs is a design he agreed to, not a stranger's building.
 * A catalogue work that is not forge work — clearing, a carpenter's shop — is not his to order.
 */
function smithMayBeginProject(p: Extract<MechanicalProposal, { type: "start_project" }>): boolean {
  const catalog = lookupProject(p.projectKey);
  if (catalog) return FORGE_PROJECT_KEYS.has(catalog.key);
  return Boolean(p.customCosts) || p.tag === "forge";
}

function smithProjectIsHis(key: string, tag?: string): boolean {
  return FORGE_PROJECT_KEYS.has(key) || tag === "forge";
}

function smithAllowed(state: WorldState, p: MechanicalProposal): string | null {
  if (!hasForge(state)) return "No forge on the estate; the smith has no workshop.";
  switch (p.type) {
    case "register_unit_sheet":
      return null; // judged by armsAllowed
    case "transfer_resources": {
      if (SMITH_TRANSFER.has(p.resource)) return null;
      const custom = state.custom_resources.find((c) => c.id === p.resource);
      if (custom?.tags?.some((t) => t === "metal" || t === "craft" || t === "forge")) return null;
      return "npc_not_authorized";
    }
    case "start_project":
      return smithMayBeginProject(p) ? null : "npc_not_authorized";
    case "adjust_project": {
      const proj = resolveActiveProject(state, p.projectId, p.summary);
      if (!proj) return "Unknown project.";
      if (smithProjectIsHis(proj.key, proj.tag)) return null;
      return "npc_not_authorized";
    }
    case "assign_labour": {
      // He may call the village to his own works and workshops; the steward's other work is not his to move.
      if (p.projectId === "unassigned") return "npc_not_authorized";
      const proj = resolveActiveProject(state, p.projectId, p.summary);
      if (!proj) return "Unknown project.";
      if (smithProjectIsHis(proj.key, proj.tag) || proj.smithing) return null;
      return "npc_not_authorized";
    }
    case "add_modifier": {
      if (p.target === "accident_risk" || p.target === "project_speed" || p.target === "specific_resource_output") return null;
      return "npc_not_authorized";
    }
    case "register_resource": {
      const tags = p.tags ?? [];
      if (tags.some((t) => t === "metal" || t === "craft" || t === "forge")) return null;
      return "npc_not_authorized";
    }
    case "register_feature": {
      if (SMITH_FEATURES.has(p.feature)) return null;
      return "npc_not_authorized";
    }
    default:
      return "npc_not_authorized";
  }
}

function chaplainAllowed(state: WorldState, p: MechanicalProposal): string | null {
  if (!state.holdings.some((h) => h.features.some((f) => CHURCH_FEATURES.has(f)))) {
    return "No oratory or cell on the estate; the chaplain has no house.";
  }
  switch (p.type) {
    case "free_mancipia":
      return null; // manumission is a pious act the Church blesses
    case "transfer_resources": {
      if (CHAPLAIN_TRANSFER.has(p.resource) || isCellSurplusId(p.resource)) return null;
      const custom = state.custom_resources.find((c) => c.id === p.resource);
      if (custom?.tags?.some((t) => t === "church" || t === "liturgy" || t === "alms" || t === "cell")) return null;
      return "npc_not_authorized";
    }
    case "start_project": {
      if (CHURCH_PROJECT_KEYS.has(p.projectKey) || p.tag === "church") return null;
      return "npc_not_authorized";
    }
    case "adjust_project": {
      const proj = resolveActiveProject(state, p.projectId, p.summary);
      if (!proj) return "Unknown project.";
      if (CHURCH_PROJECT_KEYS.has(proj.key) || proj.tag === "church") return null;
      return "npc_not_authorized";
    }
    case "assign_labour": {
      if (p.projectId === "unassigned") return "npc_not_authorized";
      const proj = resolveActiveProject(state, p.projectId, p.summary);
      if (!proj) return "Unknown project.";
      if (CHURCH_PROJECT_KEYS.has(proj.key) || proj.tag === "church") return null;
      return "npc_not_authorized";
    }
    case "set_standing_order":
      return null;
    case "add_modifier": {
      if (p.target === "mood" || p.target === "custom" || p.target === "accident_risk") return null;
      return "npc_not_authorized";
    }
    case "register_feature": {
      if (CHURCH_FEATURES.has(p.feature)) return null;
      return "npc_not_authorized";
    }
    case "register_npc": {
      if (CHAPLAIN_NPC_ROLES.has(p.npc.role)) return null;
      return "npc_not_authorized";
    }
    case "sponsor_feast":
      return null;
    default:
      return "npc_not_authorized";
  }
}

function merchantAllowed(state: WorldState, p: MechanicalProposal): string | null {
  if (!state.merchant.present || !state.flags.merchant_present) {
    return "The merchant has already left the district.";
  }
  if (p.type !== "transfer_resources") return "npc_not_authorized";
  if (p.direction !== "buy" && p.direction !== "sell") return "npc_not_authorized";
  return null;
}

function fail(state: WorldState, reason: string, summary: string): ApplyResult {
  return { ok: false, reason, logLine: summary, state };
}

function ok(state: WorldState, summary: string): ApplyResult {
  return { ok: true, logLine: summary, state };
}

/**
 * Arms proposals (Phase 4). Eberhard the captain raises, drills, disbands, sounds the call,
 * and may write an invented unit into the rolls; Aldric may raise or disband the villa's levy
 * and record an invented unit; Bernard may record an invented unit born at his forge.
 * Everyone else is refused. Non-arms proposals pass straight through.
 */
function armsAllowed(state: WorldState, p: MechanicalProposal, actor: string): string | null {
  switch (p.type) {
    case "raise_unit":
      if (actor === "captain" || actor === "referee") return null;
      if (actor === "steward") return p.sheetId === "peasant_levy" ? null : "Aldric can call up the villa's levy; drilling paid men is Eberhard's work.";
      return "npc_not_authorized";
    case "disband_unit":
      return actor === "captain" || actor === "steward" || actor === "referee" ? null : "npc_not_authorized";
    case "call_to_arms":
      return actor === "captain" || actor === "referee" ? null : "Only the captain of the watch sounds the call.";
    case "register_unit_sheet":
      return actor === "captain" || actor === "steward" || actor === "smith" || actor === "referee" ? null : "npc_not_authorized";
    default:
      return null;
  }
}

export function applyProposal(
  state: WorldState,
  proposal: MechanicalProposal,
  actor: string,
  options?: { skipLabourFill?: boolean },
): ApplyResult {
  const authProposal =
    proposal.type === "defer_proposal" ? innerProposalOfDefer(proposal) ?? proposal : proposal;
  // The dated calendar's own cards (03_HISTORY §6.3) carry their own actor rules.
  if (isHistoryProposal(proposal)) return applyHistoryProposal(state, proposal, actor);
  // The lord's wife (marriage.ts) counsels; she keeps no books and gives no orders to them.
  if (actor === "wife") return fail(state, "The lady gives counsel; the books are Aldric's.", "The lady gives counsel; the books are Aldric's.");
  if (actor === "smith") {
    const blocked = smithAllowed(state, authProposal);
    if (blocked) return fail(state, blocked, blocked);
  }
  if (actor === "chaplain") {
    const blocked = chaplainAllowed(state, authProposal);
    if (blocked) return fail(state, blocked, blocked);
  }
  if (actor === "merchant") {
    const blocked = merchantAllowed(state, authProposal);
    if (blocked) return fail(state, blocked, blocked);
  }
  if (isNegotiatorId(actor)) {
    const blocked = negotiatorAllowed(state, authProposal);
    if (blocked) return fail(state, blocked, blocked);
  } else if (authProposal.type === "start_hunt") {
    return fail(state, "Only Gerulf walks the roads for scarce goods.", "Only Gerulf walks the roads for scarce goods.");
  }
  if (authProposal.type === "sponsor_feast" && actor !== "chaplain") {
    return fail(
      state,
      "Only Father Ermenald may order a feast at the cell.",
      "Only Father Ermenald may order a feast at the cell.",
    );
  }
  const specialistActor = specialistById(actor);
  if (specialistActor) {
    const blocked = specialistAllowed(state, authProposal, specialistActor);
    if (blocked) return fail(state, blocked, blocked);
  }
  const armsBlocked = armsAllowed(state, authProposal, actor);
  if (armsBlocked) return fail(state, armsBlocked, armsBlocked);

  switch (proposal.type) {
    case "raise_unit": {
      const r = applyRaiseUnit(state, proposal);
      return r.ok ? ok(state, r.logLine) : fail(state, r.reason, r.reason);
    }
    case "disband_unit": {
      const r = applyDisbandUnit(state, proposal);
      return r.ok ? ok(state, r.logLine) : fail(state, r.reason, r.reason);
    }
    case "call_to_arms": {
      if (state.battle_call || state.battle_session) return fail(state, "A call is already open.", "A call is already open.");
      if (state.player.dead) return fail(state, "The lord is dead.", "The lord is dead.");
      if (state.player.captive) return fail(state, "The lord is in his captors' hands.", "The lord is in his captors' hands.");
      if (proposal.kind === "history") return fail(state, "History battles are raised by the calendar.", "History battles are raised by the calendar.");
      raiseCallDirect(state, proposal.kind);
      return ok(state, `Eberhard sounds the call: ${CALL_TEXT[proposal.kind]}`);
    }
    case "register_unit_sheet": {
      const r = applyRegisterUnitSheet(state, proposal);
      return r.ok ? ok(state, r.logLine) : fail(state, r.reason, r.reason);
    }
    case "free_mancipia": {
      if (actor !== "steward" && actor !== "chaplain" && actor !== "referee") return fail(state, "npc_not_authorized", "npc_not_authorized");
      const r = applyFreeMancipia(state, proposal.count);
      if (!r.ok) return fail(state, r.reason, r.reason);
      applyPeopleHappinessDelta(state, Math.min(MANUMISSION_HAPPINESS_CAP, r.freed * MANUMISSION_HAPPINESS_PER_HEAD));
      return ok(state, r.logLine);
    }
    case "assign_labour":
      return assignLabour(state, proposal);
    case "set_standing_order":
      return setStandingOrder(state, proposal);
    case "start_project":
      if (actor === "smith" && !lookupProject(proposal.projectKey) && proposal.customCosts) {
        proposal.tag = "forge";
      }
      return startProject(state, proposal, options);
    case "adjust_project":
      return adjustProject(state, proposal);
    case "adjust_sowing":
      return adjustSowing(state, proposal);
    case "transfer_resources":
      return transferResources(state, proposal, actor);
    case "add_modifier":
      return addModifier(state, proposal);
    case "remove_modifier":
      return removeModifier(state, proposal);
    case "register_resource":
      return registerResource(state, proposal);
    case "register_feature": {
      const r = registerFeature(state, proposal);
      if (r.ok) syncTradeFromFeatures(state);
      return r;
    }
    case "register_npc":
      return registerNpc(state, proposal);
    case "event_effect":
      return eventEffect(state, proposal, actor);
    case "start_hunt": {
      const r = startHunt(state, proposal);
      if (!r.ok) return fail(state, r.reason, r.logLine);
      return ok(state, r.logLine);
    }
    case "pay_hunt_overage": {
      if (!isNegotiatorId(actor)) {
        return fail(state, "Only Gerulf settles a price he found on the road.", "Only Gerulf settles a price he found on the road.");
      }
      const r = acceptHuntOverage(state, proposal.projectId);
      if (!r.ok) return fail(state, r.reason, r.logLine);
      return ok(state, r.logLine);
    }
    case "settle_households":
      return ok(state, applySettleHouseholds(state, proposal));
    case "sponsor_feast":
      return applySponsoredFeast(state, proposal);
    case "defer_proposal":
      return parkForthcomingOrder(state, proposal, actor);
    default:
      return fail(state, "Unknown proposal type.", "Unknown proposal type.");
  }
}

function assignLabour(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "assign_labour" }>,
): ApplyResult {
  if (p.projectId === "unassigned") {
    state.labour.assigned = [];
    return ok(state, "I have sent the extra hands back to their households.");
  }
  const proj = resolveActiveProject(state, p.projectId, p.summary);
  if (!proj || proj.status !== "active") {
    return fail(state, "No such active project.", p.summary);
  }
  if (isSoloSmithProject(proj)) {
    const reason = villageNotCalledReason(state, proj.name);
    return fail(state, reason, p.summary);
  }
  const projectId = proj.id;
  const remaining = labourRemaining(state);
  const existing = state.labour.assigned.find((a) => a.projectId === projectId);
  const already = existing ?? { men: 0, women: 0, youths: 0 };
  const needMen = p.men - (existing ? already.men : 0);
  const needWomen = p.women - (existing ? already.women : 0);
  const needYouths = p.youths - (existing ? already.youths : 0);
  if (needMen > remaining.men + 0.01 || needWomen > remaining.women + 0.01 || needYouths > remaining.youths + 0.01) {
    const pool = labourPool(state);
    return fail(
      state,
      `Not enough callable labour (pool men ${pool.men}, women ${pool.women}, youths ${pool.youths}).`,
      p.summary,
    );
  }
  if (existing) {
    existing.men = p.men;
    existing.women = p.women;
    existing.youths = p.youths;
  } else {
    state.labour.assigned.push({ projectId, men: p.men, women: p.women, youths: p.youths });
  }
  autoAssignLeftoverToProject(state, projectId);
  const final = state.labour.assigned.find((a) => a.projectId === projectId);
  const work = proj.name;
  const sentence = labourCalledSentence(work, final?.men ?? 0, final?.women ?? 0, final?.youths ?? 0);
  return ok(state, sentence || `Hands set on ${work}.`);
}

function setStandingOrder(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "set_standing_order" }>,
): ApplyResult {
  const id = p.orderId ?? newId("so");
  const existing = state.standing_orders.find((o) => o.id === id);
  if (existing) {
    existing.text = p.text;
    existing.active = p.active;
  } else {
    state.standing_orders.push({ id, text: p.text, active: p.active });
  }
  const base = `Standing order ${p.active ? "set" : "paused"}: ${p.text.slice(0, 80)}.`;
  if (!p.active) return ok(state, base);
  const displeasure = noteSundayOrFeastWork(state, p.text);
  return ok(state, displeasure.length ? `${base} ${displeasure.join(" ")}` : base);
}

function landWorkTitle(catalog: NonNullable<ReturnType<typeof lookupProject>>, labourDays: number, given?: string): string {
  const acres = (catalog.completesToLand?.acres ?? 1) * catalogUnits(catalog, labourDays);
  if (!catalog.completesToLand || acres === 1) return given?.trim() || catalog.name;
  const titled = catalog.name.includes("(1 acre)") ? catalog.name.replace("(1 acre)", `(${acres} acres)`) : `${catalog.name} (${acres} acres)`;
  if (!given?.trim() || given.trim() === catalog.name) return titled;
  return given.trim();
}

function startProject(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "start_project" }>,
  options?: { skipLabourFill?: boolean },
): ApplyResult {
  const holding = (p.holdingId ? state.holdings.find((h) => h.id === p.holdingId) : undefined) ?? state.holdings[0];
  if (!holding) return fail(state, "Unknown holding.", p.summary);
  const catalog = lookupProject(p.projectKey);
  if (!catalog && !p.customCosts) {
    return fail(state, `Unknown project '${p.projectKey}' and no customCosts declared.`, p.summary);
  }
  if (catalog?.requiresSpecialist && !state.npcs.some((n) => n.id === catalog.requiresSpecialist || n.role === catalog.requiresSpecialist)) {
    return fail(state, `${catalog.name} needs a ${catalog.requiresSpecialist.replaceAll("_", " ")} in the lord's service before the work can begin.`, p.summary);
  }
  const bill = projectStoreBill(p);
  const personal = startIsPersonalSmithing(p);
  const waiting = smithStartRefusal(state, p);
  if (waiting) return fail(state, waiting, p.summary);
  const labourDays = bill.labourDays;
  const lumber = bill.lumber;
  const iron = bill.iron;
  const stone = bill.stone;
  const charcoal = bill.charcoal;
  const clay = bill.clay;
  const denarii = bill.denarii;
  const short = beginStoreRefusal(state, p);
  if (short) return fail(state, short, p.summary);

  let remainingLumber = lumber;
  const fromSoft = Math.min(state.resources.softwood, remainingLumber);
  state.resources.softwood -= fromSoft;
  remainingLumber -= fromSoft;
  state.resources.hardwood -= remainingLumber;
  state.resources.iron -= iron;
  state.resources.stone -= stone;
  if (charcoal > 0) state.resources.charcoal = round1(state.resources.charcoal - charcoal);
  if (denarii > 0) state.resources.denarii = round1(state.resources.denarii - denarii);

  const id = newId("proj");
  const result = startProjectResult(p);
  const workName = catalog ? landWorkTitle(catalog, labourDays, p.name) : p.name ?? workDisplayName(p.projectKey);
  state.projects.push({
    id,
    key: catalog?.key ?? p.projectKey,
    name: workName,
    holdingId: holding.id,
    labourDaysRequired: labourDays,
    labourDaysDone: 0,
    materials: {
      lumber,
      iron,
      stone,
      ...(charcoal > 0 ? { charcoal } : {}),
      ...(clay > 0 ? { clay } : {}),
    },
    materialsReserved: true,
    status: "active",
    tag: p.tag ?? catalog?.tag,
    notes: p.notes,
    ...(result.length ? { result } : {}),
    ...(typeof p.finishesThisSeason === "boolean" ? { finishesThisSeason: p.finishesThisSeason } : {}),
    ...(personal
      ? {
          smithing: {
            durationSeasons: personalSeasonsForStart(p),
            seasonsElapsed: 0,
            ...(p.customCosts?.forgeDays != null ? { forgeDaysRequired: startForgeDays(p), forgeDaysDone: 0 } : {}),
          },
        }
      : {}),
  });
  stampProjectStart(state, state.projects[state.projects.length - 1]);
  const name = workName;
  const solo = personal && startIsSoloSmithing(p);
  const fill = solo || options?.skipLabourFill ? null : autoAssignLeftoverToProject(state, id);
  const clayNote = clay > 0 ? " The clay for the shaft will be dug with the work." : "";
  const coinNote = denarii > 0 ? ` ${amountWord(denarii)} denarii leave the chest.` : "";
  const gainNote = result.length ? ` ${resultPayLine(result)}` : "";
  const started = `${name} is begun.${storesSetAside(lumber, iron, stone, charcoal)}${coinNote}${clayNote}${gainNote}`;
  const own = personal ? ` ${ownWorkBegunPhrase(state, personalSeasonsForStart(p), startForgeDays(p))}` : "";
  const filled = fill?.sentence ? ` ${fill.sentence}` : "";
  return ok(state, `${started}${own}${filled}`);
}

function amountWord(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function storeParts(lumber: number, iron: number, stone: number, charcoal = 0): string[] {
  const parts: string[] = [];
  if (lumber > 0) parts.push(`${amountWord(lumber)} cart-load${lumber === 1 ? "" : "s"} of timber`);
  if (iron > 0) parts.push(`${amountWord(iron)} lb of iron`);
  if (stone > 0) parts.push(`${amountWord(stone)} cart-load${stone === 1 ? "" : "s"} of stone`);
  if (charcoal > 0) parts.push(`${amountWord(charcoal)} cart-load${charcoal === 1 ? "" : "s"} of charcoal`);
  return parts;
}

function joinStores(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function storesSetAside(lumber: number, iron: number, stone: number, charcoal = 0): string {
  const parts = storeParts(lumber, iron, stone, charcoal);
  if (!parts.length) return "";
  return ` The ${joinStores(parts)} ${parts.length === 1 ? "is" : "are"} set aside.`;
}

function storesReturned(lumber: number, iron: number, stone: number, charcoal = 0): string {
  const parts = storeParts(lumber, iron, stone, charcoal);
  if (!parts.length) return "";
  return ` Half the unused ${joinStores(parts)} comes back to the stores.`;
}

function adjustProject(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "adjust_project" }>,
): ApplyResult {
  const proj = resolveActiveProject(state, p.projectId, p.summary);
  if (!proj) return fail(state, "Unknown project.", p.summary);
  if (p.cancel) {
    const hadCharcoal = (proj.materials.charcoal ?? 0) > 0;
    if (proj.materialsReserved && proj.status === "active") {
      state.resources.softwood += proj.materials.lumber * 0.5;
      state.resources.iron += proj.materials.iron * 0.5;
      state.resources.stone += proj.materials.stone * 0.5;
      if (hadCharcoal) state.resources.charcoal = round1(state.resources.charcoal + (proj.materials.charcoal ?? 0) * 0.5);
    }
    proj.status = "cancelled";
    stampProjectEnded(state, proj);
    state.labour.assigned = state.labour.assigned.filter((a) => a.projectId !== proj.id);
    return ok(
      state,
      `${proj.name} is stopped.${storesReturned(proj.materials.lumber, proj.materials.iron, proj.materials.stone, proj.materials.charcoal ?? 0)}`,
    );
  }
  if (p.rush !== undefined) proj.rush = p.rush;
  if (p.labourThisSeason) {
    return assignLabour(state, {
      type: "assign_labour",
      summary: p.summary,
      projectId: proj.id,
      men: p.labourThisSeason.men,
      women: p.labourThisSeason.women,
      youths: p.labourThisSeason.youths,
    });
  }
  return ok(state, `The labour on ${proj.name} is changed.`);
}

function rewriteRotationStandingOrder(state: WorldState, rotation: "two_field" | "three_field") {
  const order = state.standing_orders.find((o) => o.active && /two-field|three-field|rotation/i.test(o.text));
  if (!order) return;
  if (rotation === "three_field") {
    order.text = order.text
      .replace(/two-field rotation/gi, "three-field rotation")
      .replace(
        /Sow barley and oats in spring on the remaining sown share\./i,
        "Sow wheat and rye in autumn on one third, barley and oats in spring on another, and rest a third.",
      );
  } else {
    order.text = order.text.replace(/three-field rotation/gi, "two-field rotation");
  }
}

function noteThreeFieldTechnique(state: WorldState) {
  if (state.known_techniques.some((t) => t.name === "Three-field rotation")) return;
  state.known_techniques.push({
    id: newId("tech"),
    name: "Three-field rotation",
    discoveredTurn: state.meta.turn,
    notes: "Winter seed, spring seed, and a rest on the ploughland.",
  });
}

function adjustSowing(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "adjust_sowing" }>,
): ApplyResult {
  const holding = state.holdings.find((h) => h.id === p.holdingId) ?? state.holdings[0];
  if (!holding) return fail(state, "Unknown holding.", p.summary);
  if (
    p.springBarleyShare == null &&
    p.autumnWheatShare == null &&
    p.wheat == null &&
    p.rye == null &&
    p.barley == null &&
    p.oats == null &&
    p.rotation == null
  ) {
    return fail(state, "adjust_sowing needs a crop mix or acre figures.", p.summary);
  }

  const notes: string[] = [];
  const agriculture = ensureAgriculture(state);
  if (p.rotation) {
    agriculture.rotation = p.rotation;
    notes.push(sowingRotationLine(p.rotation).replace(/\.$/, ""));
    rewriteRotationStandingOrder(state, p.rotation);
    if (p.rotation === "three_field") noteThreeFieldTechnique(state);
  }
  if (p.springBarleyShare != null) {
    agriculture.springBarleyShare = p.springBarleyShare;
    notes.push(sowingShareLine("spring", p.springBarleyShare).replace(/\.$/, ""));
  }
  if (p.autumnWheatShare != null) {
    agriculture.autumnWheatShare = p.autumnWheatShare;
    notes.push(sowingShareLine("autumn", p.autumnWheatShare).replace(/\.$/, ""));
  }

  const rotation = fieldRotation(state);
  const sownCap = sownCapacity(holding.land.fertile_arable, rotation);
  const next = { ...holding.sown };
  if (p.wheat != null) next.wheat = p.wheat;
  if (p.rye != null) next.rye = p.rye;
  if (p.barley != null) next.barley = p.barley;
  if (p.oats != null) next.oats = p.oats;

  if (state.meta.season === "spring" && p.springBarleyShare != null) {
    const already = next.wheat + next.rye;
    const remaining = springFieldAcres(holding.land.fertile_arable, rotation, already);
    next.barley = round1(remaining * agriculture.springBarleyShare);
    next.oats = round1(remaining - next.barley);
    notes.push(`this spring: ${next.barley} acres barley, ${next.oats} acres oats on the remaining ${round1(remaining)} acres`);
  }

  const totalSown = next.wheat + next.rye + next.barley + next.oats;
  if (totalSown > sownCap + 0.05) {
    const capName = rotation === "three_field" ? "three-field cap" : "two-field cap";
    return fail(
      state,
      `Sown acres (${round1(totalSown)}) would exceed the ${capName} (${round1(sownCap)} of ${holding.land.fertile_arable} arable).`,
      p.summary,
    );
  }
  holding.sown = next;
  return ok(state, notes.length ? notes.join(". ") + "." : "The sowing is changed.");
}

function transferResources(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "transfer_resources" }>,
  actor: string,
): ApplyResult {
  if (actor === "chaplain" && p.direction === "gain" && isCellSurplusId(p.resource)) {
    return applyCellSurplusSale(state, p);
  }
  if (actor === "chaplain" && isCellAlmsProposal(p)) {
    return applyCellAlms(state, p);
  }
  const current = getAmount(state, p.resource);
  if (current === null) return fail(state, `Unknown resource '${p.resource}'. Register it first.`, p.summary);
  const amount = Math.abs(p.amount);
  if (p.direction === "buy" || p.direction === "sell") {
    if (!state.flags.merchant_present || !state.merchant.present) {
      return fail(state, "No merchant is in the district this season.", p.summary);
    }
    const direction = p.direction;
    return applyMerchantTransferLine(state, {
      resource: p.resource,
      amount: p.amount,
      direction,
      pricePerUnit: p.pricePerUnit,
      summary: p.summary,
    });
  }
  if (p.direction === "consume") {
    if (current < amount) return fail(state, `Cannot consume ${amountPhrase(p.resource, amount)}; have ${current}.`, p.summary);
    setAmount(state, p.resource, current - amount);
    const why = p.reason && !looksLikeEngineKey(p.reason) ? ` (${p.reason})` : "";
    if (looksLikeAlms(`${p.summary ?? ""} ${p.reason ?? ""}`)) {
      applyPeopleHappinessDelta(state, HAPPINESS_ALMS);
    }
    return ok(state, `Took ${amountPhrase(p.resource, amount)} from the stores${why}.`);
  }
  setAmount(state, p.resource, current + amount);
  const why = p.reason && !looksLikeEngineKey(p.reason) ? ` (${p.reason})` : "";
  const taken = noteTakingFromCell(state, `${p.summary ?? ""} ${p.reason ?? ""}`);
  const added = `Added ${amountPhrase(p.resource, amount)} to the stores${why}.`;
  return ok(state, taken.length ? `${added} ${taken.join(" ")}` : added);
}

function addModifier(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "add_modifier" }>,
): ApplyResult {
  if (identicalModifierAlready(state, p)) {
    return fail(state, IMPROVEMENT_ALREADY, p.summary);
  }
  const id = newId("mod");
  state.modifiers.push({
    id,
    target: p.target,
    kind: p.kind,
    seasons_remaining: p.kind === "temporary" ? (p.seasonsRemaining ?? 4) : null,
    promote_on_expire: p.promoteOnExpire,
    effect: p.effect,
    source: p.source,
    risks: p.risks,
    holdingId: p.holdingId,
    resourceId: p.resourceId,
    customNote: p.customNote,
  });
  if (p.techniqueName && !state.known_techniques.some((t) => t.name === p.techniqueName)) {
    state.known_techniques.push({
      id: newId("tech"),
      name: p.techniqueName,
      discoveredTurn: state.meta.turn,
      notes: p.source,
    });
  }
  if (p.target === "mood") applyMoodModifierToHappiness(state, p.effect);
  const note = p.customNote || (p.source && !looksLikeEngineKey(p.source) ? p.source : "");
  return ok(state, note ? `A custom is written: ${note}.` : "A custom of the hall is written in the books.");
}

function removeModifier(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "remove_modifier" }>,
): ApplyResult {
  const before = state.modifiers.length;
  state.modifiers = state.modifiers.filter((m) => m.id !== p.modifierId);
  if (state.modifiers.length === before) return fail(state, "Unknown modifier.", p.summary);
  return ok(state, "A custom is lifted from the books.");
}

function registerResource(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "register_resource" }>,
): ApplyResult {
  if (!p.isNew) return fail(state, "register_resource must declare isNew: true.", p.summary);
  if (isCanonical(p.resourceId) || state.custom_resources.some((c) => c.id === p.resourceId)) {
    return fail(state, "Resource id already exists.", p.summary);
  }
  state.custom_resources.push({
    id: p.resourceId,
    name: p.name,
    unit: p.unit,
    amount: p.initialAmount ?? 0,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    notes: p.notes,
    tags: p.tags,
  });
  state.market[p.resourceId] = { min: p.priceMin, max: p.priceMax };
  return ok(state, `Recorded ${p.name} among the stores.`);
}

function registerFeature(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "register_feature" }>,
): ApplyResult {
  if (!p.isNew) return fail(state, "register_feature must declare isNew: true.", p.summary);
  const holding = state.holdings.find((h) => h.id === p.holdingId);
  if (!holding) return fail(state, "Unknown holding.", p.summary);
  if (!holding.features.includes(p.feature)) holding.features.push(p.feature);
  return ok(state, `A ${featureName(p.feature)} is recorded on ${holding.name}.`);
}

function registerNpc(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "register_npc" }>,
): ApplyResult {
  if (!p.isNew) return fail(state, "register_npc must declare isNew: true.", p.summary);
  const spec = matchHireableSpecialist(p.npc);
  const npc = spec ? specialistNpc(spec, p.npc.location || state.holdings[0]?.id || "fontenay") : p.npc;
  if (!spec && isEstateSmithNpc(npc)) {
    return fail(state, "Bernard already keeps the forge. He is not for hire.", p.summary);
  }
  if (state.npcs.some((n) => n.id === npc.id)) return fail(state, "NPC id already exists.", p.summary);
  if (spec && specialistAlreadyPresent(state, spec)) {
    return fail(state, `${spec.name} already serves this house.`, p.summary);
  }
  if (spec) {
    const blocked = specialistHireBlocked(state, spec);
    if (blocked && !specialistAlreadyPresent(state, spec)) {
      return fail(state, blocked, p.summary || hireSummary(spec));
    }
  }
  if (spec) {
    const cost = spec.hireCostDenarii;
    const ration = specialistHireGrainRation(spec);
    if (state.resources.denarii < cost) {
      return fail(
        state,
        `Need ${cost} denarii hiring gift; have ${state.resources.denarii}.`,
        p.summary || hireSummary(spec),
      );
    }
    if (ration > 0 && grainOnHand(state) < ration) {
      return fail(
        state,
        `Need ${ration} modii grain for ${spec.name}'s house; granary is thin.`,
        p.summary || hireSummary(spec),
      );
    }
    state.resources.denarii = round1(state.resources.denarii - cost);
    const rationNote = ration > 0 ? ` ${consumeGrain(state, ration, `${spec.name}'s house`)}` : "";
    npc.wantsTalk = true;
    state.npcs.push(npc);
    return ok(
      state,
      `Hired ${npc.name} as ${roleName(npc.role)}. ${cost} denarii taken from the chest.${rationNote}`,
    );
  }
  npc.wantsTalk = true;
  state.npcs.push(npc);
  return ok(state, `Recorded ${npc.name} as ${roleName(npc.role)}.`);
}

function eventEffect(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "event_effect" }>,
  actor: string,
): ApplyResult {
  const lines: string[] = [];
  if (p.summary && p.summary !== p.type && p.summary !== "event_effect" && !looksLikeEngineKey(p.summary)) {
    lines.push(p.summary.replace(/\.$/, ""));
  }
  if (p.resource && p.amount && p.direction) {
    const inner = transferResources(
      state,
      {
        type: "transfer_resources",
        summary: p.summary,
        resource: p.resource,
        amount: p.amount,
        direction: p.direction,
      },
      actor,
    );
    if (inner.ok) lines.push(inner.logLine.replace(/\.$/, ""));
  }
  if (p.moodDelta) {
    const existing = state.modifiers.find((m) => m.source === `event:${p.eventId}:mood`);
    if (!existing) {
      state.modifiers.push({
        id: newId("mod"),
        target: "mood",
        kind: "temporary",
        seasons_remaining: 2,
        effect: { op: "add", value: p.moodDelta },
        source: `event:${p.eventId}:mood`,
      });
      lines.push(p.moodDelta > 0 ? "The people take heart" : "The people grow uneasy");
    }
  }
  if (p.nested) {
    for (const raw of p.nested) {
      const parsed = parseProposal(raw);
      if (!parsed.proposal) continue;
      if (parsed.proposal.type === "event_effect" || parsed.proposal.type === "defer_proposal") continue;
      const r = applyProposal(state, parsed.proposal, actor);
      if (r.ok) lines.push(r.logLine.replace(/\.$/, ""));
    }
  }
  return ok(state, lines.length ? `${lines.join(". ")}.` : "A season's change is written.");
}

/** Apply specific_resource_output as a factor (capped 0.4–2.5), not as a cap on the pile itself. */
export function resourceOutputBonus(state: WorldState, resource: string, base: number): number {
  const factor = applyMultiplyAdd(1, modifiersFor(state, "specific_resource_output", { resourceId: resource }), {
    lo: 0.4,
    hi: 2.5,
  });
  return base * factor;
}

export function projectSpeed(state: WorldState, extra?: number): number {
  const rush = extra ?? 1;
  return applyMultiplyAdd(rush, modifiersFor(state, "project_speed"), { lo: 0.4, hi: 2.5 });
}
