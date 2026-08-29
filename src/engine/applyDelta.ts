import {
  type ApplyResult,
  type CanonicalResource,
  CANONICAL_RESOURCES,
  type MechanicalProposal,
  type WorldState,
} from "./schema";
import { CHURCH_FEATURES, CHURCH_PROJECT_KEYS, FORGE_FEATURES, FORGE_PROJECT_KEYS, lookupProject } from "./projectCatalog";
import { labourPool, labourRemaining, refreshHarvestRisk } from "./labour";
import { applyMultiplyAdd, modifiersFor } from "./modifiers";
import { syncTradeFromFeatures } from "./merchant";
import {
  hireSummary,
  matchHireableSpecialist,
  specialistAllowed,
  specialistAlreadyPresent,
  specialistById,
  specialistNpc,
} from "./specialists";
import { newId, round1 } from "./util";
import { parseProposal } from "../llm/parse";

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
  const custom = state.custom_resources.find((c) => c.id === resource);
  return custom ? custom.amount : null;
}

function setAmount(state: WorldState, resource: string, amount: number): boolean {
  const v = round1(Math.max(0, amount));
  if (isCanonical(resource)) {
    state.resources[resource] = v;
    return true;
  }
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (!custom) return false;
  custom.amount = v;
  return true;
}

function midpointPrice(state: WorldState, resource: string): number {
  const range = state.market[resource];
  if (range) return (range.min + range.max) / 2;
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (custom) return (custom.priceMin + custom.priceMax) / 2;
  return 0;
}

function hasForge(state: WorldState): boolean {
  return state.holdings.some((h) => h.features.some((f) => FORGE_FEATURES.has(f)));
}

function smithAllowed(state: WorldState, p: MechanicalProposal): string | null {
  if (!hasForge(state)) return "No forge on the estate; the smith has no workshop.";
  switch (p.type) {
    case "transfer_resources": {
      if (SMITH_TRANSFER.has(p.resource)) return null;
      const custom = state.custom_resources.find((c) => c.id === p.resource);
      if (custom?.tags?.some((t) => t === "metal" || t === "craft" || t === "forge")) return null;
      return "npc_not_authorized";
    }
    case "start_project": {
      if (FORGE_PROJECT_KEYS.has(p.projectKey) || p.tag === "forge") return null;
      return "npc_not_authorized";
    }
    case "adjust_project": {
      const proj = state.projects.find((x) => x.id === p.projectId);
      if (!proj) return "Unknown project.";
      if (FORGE_PROJECT_KEYS.has(proj.key) || proj.tag === "forge") return null;
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
    case "transfer_resources": {
      if (CHAPLAIN_TRANSFER.has(p.resource)) return null;
      const custom = state.custom_resources.find((c) => c.id === p.resource);
      if (custom?.tags?.some((t) => t === "church" || t === "liturgy" || t === "alms")) return null;
      return "npc_not_authorized";
    }
    case "start_project": {
      if (CHURCH_PROJECT_KEYS.has(p.projectKey) || p.tag === "church") return null;
      return "npc_not_authorized";
    }
    case "adjust_project": {
      const proj = state.projects.find((x) => x.id === p.projectId);
      if (!proj) return "Unknown project.";
      if (CHURCH_PROJECT_KEYS.has(proj.key) || proj.tag === "church") return null;
      return "npc_not_authorized";
    }
    case "assign_labour": {
      if (p.projectId === "unassigned") return "npc_not_authorized";
      const proj = state.projects.find((x) => x.id === p.projectId);
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

export function applyProposal(
  state: WorldState,
  proposal: MechanicalProposal,
  actor: string,
): ApplyResult {
  if (actor === "smith") {
    const blocked = smithAllowed(state, proposal);
    if (blocked) return fail(state, blocked, `REJECT smith ${proposal.type}: ${blocked}`);
  }
  if (actor === "chaplain") {
    const blocked = chaplainAllowed(state, proposal);
    if (blocked) return fail(state, blocked, `REJECT chaplain ${proposal.type}: ${blocked}`);
  }
  if (actor === "merchant") {
    const blocked = merchantAllowed(state, proposal);
    if (blocked) return fail(state, blocked, `REJECT merchant ${proposal.type}: ${blocked}`);
  }
  const specialistActor = specialistById(actor);
  if (specialistActor) {
    const blocked = specialistAllowed(state, proposal, specialistActor);
    if (blocked) return fail(state, blocked, `REJECT ${actor} ${proposal.type}: ${blocked}`);
  }

  switch (proposal.type) {
    case "assign_labour":
      return assignLabour(state, proposal);
    case "set_standing_order":
      return setStandingOrder(state, proposal);
    case "start_project":
      return startProject(state, proposal);
    case "adjust_project":
      return adjustProject(state, proposal);
    case "adjust_sowing":
      return adjustSowing(state, proposal);
    case "transfer_resources":
      return transferResources(state, proposal);
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
    default:
      return fail(state, "Unknown proposal type.", "REJECT unknown type");
  }
}

function assignLabour(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "assign_labour" }>,
): ApplyResult {
  if (p.projectId !== "unassigned" && !state.projects.some((x) => x.id === p.projectId && x.status === "active")) {
    return fail(state, "No such active project.", p.summary);
  }
  const remaining = labourRemaining(state);
  const existing = state.labour.assigned.find((a) => a.projectId === p.projectId);
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
  if (p.projectId === "unassigned") {
    state.labour.assigned = [];
    refreshHarvestRisk(state);
    return ok(state, "Cleared labour assignments.");
  }
  if (existing) {
    existing.men = p.men;
    existing.women = p.women;
    existing.youths = p.youths;
  } else {
    state.labour.assigned.push({ projectId: p.projectId, men: p.men, women: p.women, youths: p.youths });
  }
  refreshHarvestRisk(state);
  return ok(state, `Assigned labour to ${p.projectId}: ${p.men} men, ${p.women} women, ${p.youths} youths.`);
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
  return ok(state, `Standing order ${p.active ? "set" : "paused"}: ${p.text.slice(0, 80)}`);
}

function startProject(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "start_project" }>,
): ApplyResult {
  const holding = (p.holdingId ? state.holdings.find((h) => h.id === p.holdingId) : undefined) ?? state.holdings[0];
  if (!holding) return fail(state, "Unknown holding.", p.summary);
  const catalog = lookupProject(p.projectKey);
  if (!catalog && !p.customCosts) {
    return fail(state, `Unknown project '${p.projectKey}' and no customCosts declared.`, p.summary);
  }
  const labourDays = p.customCosts?.labourDays ?? catalog!.labourDays;
  const lumber = p.customCosts?.lumber ?? catalog!.lumber;
  const iron = p.customCosts?.iron ?? catalog!.iron;
  const stone = p.customCosts?.stone ?? catalog!.stone;
  const wood = state.resources.softwood + state.resources.hardwood;
  if (wood < lumber) return fail(state, `Need ${lumber} cart-loads of timber; have ${round1(wood)}.`, p.summary);
  if (state.resources.iron < iron) return fail(state, `Need ${iron} lb iron; have ${state.resources.iron}.`, p.summary);
  if (state.resources.stone < stone) return fail(state, `Need ${stone} cart-loads of stone; have ${state.resources.stone}.`, p.summary);

  let remainingLumber = lumber;
  const fromSoft = Math.min(state.resources.softwood, remainingLumber);
  state.resources.softwood -= fromSoft;
  remainingLumber -= fromSoft;
  state.resources.hardwood -= remainingLumber;
  state.resources.iron -= iron;
  state.resources.stone -= stone;

  const id = newId("proj");
  state.projects.push({
    id,
    key: catalog?.key ?? p.projectKey,
    name: p.name ?? catalog?.name ?? p.projectKey,
    holdingId: holding.id,
    labourDaysRequired: labourDays,
    labourDaysDone: 0,
    materials: { lumber, iron, stone },
    materialsReserved: true,
    status: "active",
    tag: p.tag ?? catalog?.tag,
    notes: p.notes,
  });
  return ok(state, `Started project ${p.name ?? catalog?.name ?? p.projectKey} (${id}). Materials reserved.`);
}

function adjustProject(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "adjust_project" }>,
): ApplyResult {
  const proj = state.projects.find((x) => x.id === p.projectId);
  if (!proj) return fail(state, "Unknown project.", p.summary);
  if (p.cancel) {
    if (proj.materialsReserved && proj.status === "active") {
      state.resources.softwood += proj.materials.lumber * 0.5;
      state.resources.iron += proj.materials.iron * 0.5;
      state.resources.stone += proj.materials.stone * 0.5;
    }
    proj.status = "cancelled";
    state.labour.assigned = state.labour.assigned.filter((a) => a.projectId !== proj.id);
    refreshHarvestRisk(state);
    return ok(state, `Cancelled project ${proj.name}; half of unused materials recovered.`);
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
  return ok(state, `Adjusted project ${proj.name}.`);
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
    p.oats == null
  ) {
    return fail(state, "adjust_sowing needs a crop mix or acre figures.", p.summary);
  }

  const notes: string[] = [];
  if (!state.agriculture) {
    state.agriculture = { springBarleyShare: 0.6, autumnWheatShare: 0.45 };
  }
  if (p.springBarleyShare != null) {
    state.agriculture.springBarleyShare = p.springBarleyShare;
    notes.push(`spring barley share ${Math.round(p.springBarleyShare * 100)}% of remaining`);
  }
  if (p.autumnWheatShare != null) {
    state.agriculture.autumnWheatShare = p.autumnWheatShare;
    notes.push(`autumn wheat share ${Math.round(p.autumnWheatShare * 100)}%`);
  }

  const sownCap = holding.land.fertile_arable * 0.5;
  const next = { ...holding.sown };
  if (p.wheat != null) next.wheat = p.wheat;
  if (p.rye != null) next.rye = p.rye;
  if (p.barley != null) next.barley = p.barley;
  if (p.oats != null) next.oats = p.oats;

  if (state.meta.season === "spring" && p.springBarleyShare != null) {
    const already = next.wheat + next.rye;
    const remaining = Math.max(0, sownCap - already);
    next.barley = round1(remaining * state.agriculture.springBarleyShare);
    next.oats = round1(remaining - next.barley);
    notes.push(`this spring: ${next.barley} acres barley, ${next.oats} acres oats on the remaining ${round1(remaining)} acres`);
  }

  const totalSown = next.wheat + next.rye + next.barley + next.oats;
  if (totalSown > sownCap + 0.05) {
    return fail(
      state,
      `Sown acres (${round1(totalSown)}) would exceed the two-field cap (${round1(sownCap)} of ${holding.land.fertile_arable} arable).`,
      p.summary,
    );
  }
  holding.sown = next;
  return ok(state, `Sowing plan: ${notes.join("; ") || p.summary}`);
}

function transferResources(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "transfer_resources" }>,
): ApplyResult {
  const current = getAmount(state, p.resource);
  if (current === null) return fail(state, `Unknown resource '${p.resource}'. Register it first.`, p.summary);
  const amount = Math.abs(p.amount);
  const price = p.pricePerUnit ?? midpointPrice(state, p.resource);
  if (p.direction === "buy") {
    if (!state.flags.merchant_present || !state.merchant.present) {
      return fail(state, "No merchant is in the district this season.", p.summary);
    }
    const stall = state.merchant.stock.find((s) => s.resource === p.resource);
    if (!stall || stall.amount < amount) {
      return fail(state, `The merchant has no ${amount} ${p.resource} on the carts.`, p.summary);
    }
    const cost = amount * price;
    if (state.resources.denarii < cost) return fail(state, `Need ${round1(cost)} denarii; have ${state.resources.denarii}.`, p.summary);
    state.resources.denarii -= cost;
    stall.amount = round1(stall.amount - amount);
    if (stall.amount <= 0) state.merchant.stock = state.merchant.stock.filter((s) => s.resource !== p.resource);
    setAmount(state, p.resource, current + amount);
    return ok(state, `Bought ${amount} ${p.resource} from ${state.merchant.name ?? "the merchant"} for ${round1(cost)} denarii.`);
  }
  if (p.direction === "sell") {
    if (!state.flags.merchant_present || !state.merchant.present) {
      return fail(state, "No merchant is in the district this season.", p.summary);
    }
    if (p.resource === "denarii") return fail(state, "Cannot sell coin.", p.summary);
    if (current < amount) return fail(state, `Cannot sell ${amount} ${p.resource}; have ${current}.`, p.summary);
    setAmount(state, p.resource, current - amount);
    state.resources.denarii += amount * price;
    return ok(state, `Sold ${amount} ${p.resource} to ${state.merchant.name ?? "the merchant"} for ${round1(amount * price)} denarii.`);
  }
  if (p.direction === "consume") {
    if (current < amount) return fail(state, `Cannot consume ${amount} ${p.resource}; have ${current}.`, p.summary);
    setAmount(state, p.resource, current - amount);
    return ok(state, `Consumed ${amount} ${p.resource}${p.reason ? ` (${p.reason})` : ""}.`);
  }
  setAmount(state, p.resource, current + amount);
  return ok(state, `Gained ${amount} ${p.resource}${p.reason ? ` (${p.reason})` : ""}.`);
}

function addModifier(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "add_modifier" }>,
): ApplyResult {
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
  return ok(state, `Modifier added: ${p.source} → ${p.target} (${p.kind}).`);
}

function removeModifier(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "remove_modifier" }>,
): ApplyResult {
  const before = state.modifiers.length;
  state.modifiers = state.modifiers.filter((m) => m.id !== p.modifierId);
  if (state.modifiers.length === before) return fail(state, "Unknown modifier.", p.summary);
  return ok(state, `Removed modifier ${p.modifierId}.`);
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
  return ok(state, `Registered new resource ${p.name} (${p.resourceId}).`);
}

function registerFeature(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "register_feature" }>,
): ApplyResult {
  if (!p.isNew) return fail(state, "register_feature must declare isNew: true.", p.summary);
  const holding = state.holdings.find((h) => h.id === p.holdingId);
  if (!holding) return fail(state, "Unknown holding.", p.summary);
  if (!holding.features.includes(p.feature)) holding.features.push(p.feature);
  return ok(state, `Feature '${p.feature}' recorded on ${holding.name}.`);
}

function registerNpc(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "register_npc" }>,
): ApplyResult {
  if (!p.isNew) return fail(state, "register_npc must declare isNew: true.", p.summary);
  const spec = matchHireableSpecialist(p.npc);
  const npc = spec ? specialistNpc(spec, p.npc.location || state.holdings[0]?.id || "fontenay") : p.npc;
  if (state.npcs.some((n) => n.id === npc.id)) return fail(state, "NPC id already exists.", p.summary);
  if (spec && specialistAlreadyPresent(state, spec)) {
    return fail(state, `${spec.name} already serves this house.`, p.summary);
  }
  if (spec) {
    const cost = spec.hireCostDenarii;
    if (state.resources.denarii < cost) {
      return fail(
        state,
        `Need ${cost} denarii hiring gift; have ${state.resources.denarii}.`,
        p.summary || hireSummary(spec),
      );
    }
    state.resources.denarii = round1(state.resources.denarii - cost);
    state.npcs.push(npc);
    return ok(
      state,
      `Hired ${npc.name} as ${npc.role.replaceAll("_", " ")}. ${cost} denarii taken from the chest.`,
    );
  }
  state.npcs.push(npc);
  return ok(state, `New person recorded: ${npc.name} (${npc.role}).`);
}

function eventEffect(
  state: WorldState,
  p: Extract<MechanicalProposal, { type: "event_effect" }>,
  actor: string,
): ApplyResult {
  const lines: string[] = [`Event ${p.eventId}`];
  if (p.resource && p.amount && p.direction) {
    const inner = transferResources(state, {
      type: "transfer_resources",
      summary: p.summary,
      resource: p.resource,
      amount: p.amount,
      direction: p.direction,
      reason: p.eventId,
    });
    if (inner.ok) lines.push(inner.logLine);
    else lines.push(`resource skipped: ${inner.reason}`);
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
      lines.push(`Mood ${p.moodDelta > 0 ? "+" : ""}${p.moodDelta}`);
    }
  }
  if (p.nested) {
    for (const raw of p.nested) {
      const parsed = parseProposal(raw);
      if (!parsed.proposal) {
        lines.push(`nested dropped: ${parsed.error}`);
        continue;
      }
      if (parsed.proposal.type === "event_effect") continue;
      const r = applyProposal(state, parsed.proposal, actor);
      lines.push(r.ok ? r.logLine : `nested reject: ${r.reason}`);
    }
  }
  return ok(state, lines.join("; "));
}

export function resourceOutputBonus(state: WorldState, resource: string, base: number): number {
  return applyMultiplyAdd(base, modifiersFor(state, "specific_resource_output", { resourceId: resource }), {
    lo: 0.4,
    hi: 2.5,
  });
}

export function projectSpeed(state: WorldState, extra?: number): number {
  const rush = extra ?? 1;
  return applyMultiplyAdd(rush, modifiersFor(state, "project_speed"), { lo: 0.4, hi: 2.5 });
}
