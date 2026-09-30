import { grainOnHand, HOUSEHOLD_SEASON_GRAIN } from "./grain";
import { resolveActiveProject } from "./labour";
import { captainWanted } from "./military";
import type { MechanicalProposal, Npc, WorldState } from "./schema";

/** Fontenay start: 10 households. A reeve is sought at half again that number. */
export const STARTING_HOUSEHOLDS = 10;
export const REEVE_HOUSEHOLD_THRESHOLD = Math.ceil(STARTING_HOUSEHOLDS * 1.5);

/** Starting demesne already has one vineyard acre; that alone does not unlock a vinedresser. */
export const STARTING_VINEYARD_ACRES = 1;

const METAL_EXPANSION_FEATURES = new Set(["bloomery", "mill_forge"]);

export type HireableSpecialist = {
  id: string;
  name: string;
  role: string;
  notes: string;
  hireCostDenarii: number;
  /** One-time grain taken on Confirm. Otto: a household ration for his house. */
  hireGrainRation?: number;
  /** False for the four craftsmen (hireable from boot). True for expansion hires. */
  requiresExpansion: boolean;
  unlockHint: string;
  recommendSpeech: string;
};

export const HIREABLE_SPECIALISTS: HireableSpecialist[] = [
  {
    id: "quarry_master",
    name: "Colman",
    role: "quarry_master",
    hireCostDenarii: 150,
    requiresExpansion: false,
    unlockHint: "",
    recommendSpeech: "",
    notes:
      "Irish, far from home, used to hard stone and wet weather. Cheerful until a rock face looks wrong, then he stops the whole cut. Talks wedges, packing, and who gets crushed if you rush. Misses the sea more than he admits. Speaks with a light Irish accent.",
  },
  {
    id: "carpenter",
    name: "Haimo",
    role: "carpenter",
    hireCostDenarii: 110,
    requiresExpansion: false,
    unlockHint: "",
    recommendSpeech: "",
    notes:
      "Meticulous. Loves timber more than people, but he is kind to others. Talks of carts, doors, roofs, and wood that was felled too green. Patient with apprentices, impatient with \"good enough.\" Will argue with stone masons about whether stone or oak should hold a thing.",
  },
  {
    id: "mason",
    name: "Gerold",
    role: "mason",
    hireCostDenarii: 200,
    requiresExpansion: false,
    unlockHint: "",
    recommendSpeech: "",
    notes:
      "Older, grey, sure of himself. Thinks a wall is a promise. Speaks of lime, courses, and frost. Slow to start, angry if you pull him off a job halfway. Treats raw stone as unfinished business. Does not joke much. When he does, it is about buildings that fell.",
  },
  {
    id: "potter",
    name: "Hugo",
    role: "potter",
    hireCostDenarii: 80,
    requiresExpansion: false,
    unlockHint: "",
    recommendSpeech: "",
    notes:
      "Quiet. Watches hands. Talks clay, kiln heat, and vessels that crack if you get greedy. Does not care about rank. Will make you a decent bowl and still tell you the clay here is only fair. Remembers what you broke last season.",
  },
  {
    id: "village_reeve",
    name: "Otto",
    role: "village_reeve",
    hireCostDenarii: 20,
    hireGrainRation: HOUSEHOLD_SEASON_GRAIN,
    requiresExpansion: true,
    unlockHint: `The village is still small for a reeve. When the households reach ${REEVE_HOUSEHOLD_THRESHOLD} (half again the start), Otto can be sought.`,
    recommendSpeech:
      "The village has grown, my lord — more hearths than we began with. Otto the reeve would keep the hides and dues, and name who is shirking. He is the peasants' man, loyal to the village more than the hall. 20 denarii from the chest and a household grain ration for his house if you would have him: ask me, and Confirm.",
    notes:
      "The peasants' man. A gentle giant of simple words. Chosen for how hard he works, not for how well he speaks. Speaks of hides, dues, and who is shirking. Initially loyal to the village more than the hall, but treat him and the people well and you will earn his loyalty to hell and back.",
  },
  {
    id: "vinedresser",
    name: "Ambrosius",
    role: "vinedresser",
    hireCostDenarii: 90,
    requiresExpansion: true,
    unlockHint:
      "The old acre of vines is not yet a vintage worth a vinedresser. Expand the vineyard beyond the starting acre, then Ambrosius can be sought.",
    recommendSpeech:
      "The vines are more than the old acre now. Ambrosius the vinedresser would keep the slope and the barrels — a bit learned, a bit vain of the lie of the land, and he will talk weather before grain. 90 denarii hiring gift, if you ask it and Confirm.",
    notes:
      "Vines over grain. A bit learned, a bit vain. Talks weather, barrels, bouquets and aftertastes. Uses flowery words and a lot of sensory descriptions.",
  },
  {
    id: "head_seamstress",
    name: "Hildegard",
    role: "head_seamstress",
    hireCostDenarii: 60,
    requiresExpansion: true,
    unlockHint: "There is no textile workshop yet. When that work stands, Hildegard the head seamstress can be sought.",
    recommendSpeech:
      "The textile workshop stands. Hildegard the head seamstress would keep the cloth as it should be kept — a sharp tongue, and she will notice a torn cuff before you do. She will not waste good linen on a bad idea. 60 denarii, if you will have her: ask me, and Confirm.",
    notes:
      "Sharp tongue, notices a torn cuff before you do. Cloth is status. Very proper and straight laced. Will do as ordered but very conservative in how she runs her business.",
  },
  {
    id: "copper_smith",
    name: "Lorenzo",
    role: "copper_smith",
    hireCostDenarii: 180,
    requiresExpansion: true,
    unlockHint:
      "Bernard's timber forge is not yet a copper shop. When a bloomery or trip-hammer mill stands, Lorenzo can be sought.",
    recommendSpeech:
      "The metal-work has gone beyond Bernard's timber hearth. Lorenzo the copper-smith — a Lombard, and proud of it — thinks copper cleaner work than iron, and will flirt with being indispensable. 180 denarii hiring gift, if you ask and Confirm.",
    notes:
      "Lombard, proud, thinks copper is cleaner work than iron. Always acts overworked and busy no matter what. Still makes time for his employer and a little bit of a sycophant.",
  },
  {
    id: "captain",
    name: "Eberhard",
    role: "captain",
    hireCostDenarii: 250,
    requiresExpansion: true,
    unlockHint:
      "There is no one for a captain to drill. Call up the villa's men as a levy, or begin gathering what a new kind of soldier wants (the arms drawer lists it), and Eberhard can be sought.",
    recommendSpeech:
      "You have men under your own banner now, my lord — or the makings of them — and no one to drill them. Eberhard would be your captain of arms: he wants men, spears, and a reason to march, and he will tell you honestly how few fighters we have. He is the one to turn a levy into spearmen, or something stranger into a file that holds. 250 denarii, should you want him: ask me, and Confirm.",
    notes:
      "A veteran who has seen it all. Content with peaceful duty but doesn't shirk battle either. Cool headed and would rather polish and sharpen his weapons than stand at attention in parade dress. Pragmatic and experienced.",
  },
];

export const SPECIALIST_IDS = new Set(HIREABLE_SPECIALISTS.map((s) => s.id));

const CORE_HOUSEHOLD_IDS = new Set(["steward", "smith", "chaplain", "negotiator", "merchant"]);

export function isCoreHouseholdId(id: string): boolean {
  return CORE_HOUSEHOLD_IDS.has(id);
}

export function specialistById(id: string): HireableSpecialist | undefined {
  return HIREABLE_SPECIALISTS.find((s) => s.id === id);
}

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchHireableSpecialist(query: {
  id?: string;
  name?: string;
  role?: string;
}): HireableSpecialist | undefined {
  const id = query.id ? compact(query.id) : "";
  const name = query.name ? compact(query.name) : "";
  const role = query.role ? compact(query.role) : "";
  return HIREABLE_SPECIALISTS.find((s) => {
    const sid = compact(s.id);
    const sname = compact(s.name);
    const srole = compact(s.role);
    return (
      (id && (id === sid || id === sname || id === srole)) ||
      (name && name === sname) ||
      (role && (role === srole || role === sid || role === `${sname}${srole}`))
    );
  });
}

export function specialistNpc(spec: HireableSpecialist, location = "fontenay"): Npc {
  return {
    id: spec.id,
    name: spec.name,
    role: spec.role,
    location,
    notes: spec.notes,
    memories: [],
    wantsTalk: true,
  };
}

export function specialistAlreadyPresent(state: WorldState, spec: HireableSpecialist): boolean {
  return state.npcs.some(
    (n) =>
      n.id === spec.id ||
      n.role === spec.role ||
      n.name.toLowerCase() === spec.name.toLowerCase(),
  );
}

export function estateHouseholds(state: WorldState): number {
  const fromHoldings = state.holdings.reduce((m, h) => Math.max(m, h.households), 0);
  return Math.max(state.population.households, fromHoldings);
}

export function vineyardAcres(state: WorldState): number {
  return state.holdings.reduce((s, h) => s + h.land.vineyard, 0);
}

function hasAnyFeature(state: WorldState, features: Set<string> | string[]): boolean {
  const set = features instanceof Set ? features : new Set(features);
  return state.holdings.some((h) => h.features.some((f) => set.has(f)));
}

function hasCompletedProject(state: WorldState, key: string): boolean {
  return state.projects.some((p) => p.key === key && p.status === "completed");
}

export function specialistUnlocked(state: WorldState, spec: HireableSpecialist): boolean {
  if (!spec.requiresExpansion) return true;
  switch (spec.id) {
    case "village_reeve":
      return estateHouseholds(state) >= REEVE_HOUSEHOLD_THRESHOLD;
    case "vinedresser":
      return vineyardAcres(state) > STARTING_VINEYARD_ACRES || hasCompletedProject(state, "expand_vineyard");
    case "head_seamstress":
      return hasAnyFeature(state, ["textile_workshop"]);
    case "copper_smith":
      return hasAnyFeature(state, METAL_EXPANSION_FEATURES);
    case "captain":
      // Design review, item 12: the trigger is training your own unit, not building a wall.
      return captainWanted(state);
    default:
      return false;
  }
}

export function unlockedHireableSpecialists(state: WorldState): HireableSpecialist[] {
  return HIREABLE_SPECIALISTS.filter((s) => specialistUnlocked(state, s));
}

export function recommendableHires(state: WorldState): HireableSpecialist[] {
  return HIREABLE_SPECIALISTS.filter(
    (s) => s.requiresExpansion && specialistUnlocked(state, s) && !specialistAlreadyPresent(state, s),
  );
}

export function newlyUnlockedHires(before: WorldState, after: WorldState): HireableSpecialist[] {
  return HIREABLE_SPECIALISTS.filter((s) => {
    if (!s.requiresExpansion) return false;
    if (specialistAlreadyPresent(after, s)) return false;
    return !specialistUnlocked(before, s) && specialistUnlocked(after, s);
  });
}

export function specialistHireGrainRation(spec: HireableSpecialist): number {
  return spec.hireGrainRation ?? 0;
}

export function hireCostLine(spec: HireableSpecialist): string {
  const ration = specialistHireGrainRation(spec);
  if (ration > 0) {
    return `${spec.hireCostDenarii} denarii and one household grain ration (${ration} modii)`;
  }
  return `${spec.hireCostDenarii} denarii`;
}

export function specialistHireBlocked(state: WorldState, spec: HireableSpecialist): string | null {
  if (specialistAlreadyPresent(state, spec)) {
    return `${spec.name} the ${spec.role.replaceAll("_", " ")} already serves this house.`;
  }
  if (!specialistUnlocked(state, spec)) return spec.unlockHint;
  if (state.resources.denarii < spec.hireCostDenarii) {
    return `The chest cannot spare ${spec.hireCostDenarii} denarii for a hiring gift. Fontenay is thin.`;
  }
  const ration = specialistHireGrainRation(spec);
  if (ration > 0 && grainOnHand(state) < ration) {
    return `The granary cannot spare a household ration (${ration} modii) for ${spec.name}'s house. Fontenay is thin.`;
  }
  return null;
}

export function hireSummary(spec: HireableSpecialist): string {
  const ration = specialistHireGrainRation(spec);
  if (ration > 0) {
    return `Hire ${spec.name} the ${spec.role.replaceAll("_", " ")} — ${spec.hireCostDenarii} denarii from the chest and one household grain ration (${ration} modii) for his house.`;
  }
  return `Hire ${spec.name} the ${spec.role.replaceAll("_", " ")} — ${spec.hireCostDenarii} denarii hiring gift from the chest.`;
}

/** Closed name list for Aldric / the referee. Marks who is available now. */
export function stewardHirePrompt(state: WorldState): string {
  const lines = HIREABLE_SPECIALISTS.map((s) => {
    const hired = specialistAlreadyPresent(state, s);
    const unlocked = specialistUnlocked(state, s);
    const status = hired ? "already serving" : unlocked ? "available now" : "not yet — estate not ready";
    const craft = s.notes.split(".")[0] ?? s.role;
    return `- id ${s.id}, name ${s.name}, role ${s.role} — ${craft} [${status}] · ${hireCostLine(s)}`;
  });
  const unlockedExpansion = recommendableHires(state);
  const recommend =
    unlockedExpansion.length > 0
      ? `If the lord has not yet hired them, recommend by name (speech only, no register_npc until the lord asks): ${unlockedExpansion.map((s) => s.name).join(", ")}.`
      : "Do not recommend Otto, Ambrosius, Hildegard, Lorenzo, or Eberhard until their line reads available now.";
  return `Closed hire list (never invent another name). Emit register_npc only for a person marked available now, and only when the lord asks to hire:
${lines.join("\n")}
location is the holding id (fontenay). The engine takes that person's listed denarii from the chest on Confirm (and Otto's household grain ration); do NOT also emit transfer_resources for the gift or the ration. Bernard the smith and Gerulf the negotiator already serve and are not for hire. If that person is already on npcs, not yet available, or the chest cannot spare the coin (or the granary Otto's ration), say so in speech and emit no proposal. Speech without register_npc does not hire anyone.
${recommend}`;
}

const CRAFT_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "potter", re: /\b(potter|pottery|kiln|clay)\b/i },
  { id: "carpenter", re: /\b(carpenter|carpentry|woodwright|joinery|woodwork|timber.?wright)\b/i },
  { id: "mason", re: /\b(mason|masonry|stone.?mason|dressed stone|lime.?mortar)\b/i },
  {
    id: "quarry_master",
    re: /\b(quarry|quarryman|stone.?cutter|stone.?master|winning stone)\b|\b(someone|man|hand|specialist).{0,28}\bstone\b|\bstone\b.{0,24}(work|cut|dig|quarry)/i,
  },
  { id: "village_reeve", re: /\b(reeve|headman|village.?man)\b/i },
  { id: "vinedresser", re: /\b(vinedresser|vine.?dresser|vintner|vigneron)\b/i },
  { id: "head_seamstress", re: /\b(seamstress|tailor|clothier)\b/i },
  { id: "copper_smith", re: /\b(copper.?smith|coppersmith)\b/i },
  { id: "captain", re: /\b(captain|watch.?captain)\b/i },
];

const HIRE_VERB =
  /\b(hire|retain|employ|engage|take on|bring in|send for|fetch|find|get me|need|want)\b/i;
const HIRE_GENERIC = /\b(specialist|craftsman|craftsmen|a trade)\b/i;

export function isEstateSmithNpc(npc: { id?: string; name?: string; role?: string }): boolean {
  const id = compact(npc.id ?? "");
  const name = compact(npc.name ?? "");
  const role = compact(npc.role ?? "");
  if (name === "bernard") return true;
  if (id === "smith" || id === "bernard") return true;
  if ((role === "smith" || role === "blacksmith") && !role.includes("copper")) return true;
  return false;
}

export function looksLikeEstateSmithHire(text: string): boolean {
  const t = text.trim();
  if (!HIRE_VERB.test(t)) return false;
  if (/\bbernard\b/i.test(t)) return true;
  if (/\bblacksmith\b/i.test(t)) return true;
  if (/\bcopper/.test(t)) return false;
  return /\b(the |a |estate )?smith\b/i.test(t);
}

export function looksLikeHireOrder(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!HIRE_VERB.test(t)) return false;
  const explicitHire = /\b(hire|retain|employ|engage|take on|bring in|send for)\b/i.test(t);
  if (/\b(workshop|kiln|project)\b/i.test(t) && !explicitHire) return false;
  if (looksLikeEstateSmithHire(t)) return true;
  if (HIREABLE_SPECIALISTS.some((s) => new RegExp(`\\b${s.name}\\b`, "i").test(t))) return true;
  return CRAFT_PATTERNS.some((p) => p.re.test(t)) || HIRE_GENERIC.test(t);
}

export function specialistsFromHireText(text: string): HireableSpecialist[] {
  const found: HireableSpecialist[] = [];
  for (const p of CRAFT_PATTERNS) {
    if (!p.re.test(text)) continue;
    const spec = specialistById(p.id);
    if (spec && !found.some((s) => s.id === spec.id)) found.push(spec);
  }
  for (const spec of HIREABLE_SPECIALISTS) {
    if (!new RegExp(`\\b${spec.name}\\b`, "i").test(text)) continue;
    if (!found.some((s) => s.id === spec.id)) found.push(spec);
  }
  return found;
}

export function inferHireProposals(state: WorldState, playerText: string): MechanicalProposal[] {
  const specs = specialistsFromHireText(playerText);
  const proposals: MechanicalProposal[] = [];
  let reserved = 0;
  let reservedGrain = 0;
  const location = state.holdings[0]?.id ?? "fontenay";
  for (const spec of specs) {
    if (specialistHireBlocked(state, spec)) continue;
    if (state.resources.denarii < reserved + spec.hireCostDenarii) continue;
    const ration = specialistHireGrainRation(spec);
    if (grainOnHand(state) < reservedGrain + ration) continue;
    reserved += spec.hireCostDenarii;
    reservedGrain += ration;
    proposals.push({
      type: "register_npc",
      summary: hireSummary(spec),
      npc: specialistNpc(spec, location),
      isNew: true,
    });
  }
  return proposals;
}

export function hireFulfillReason(state: WorldState, npcId: string, playerText: string): string | null {
  if (looksLikeEstateSmithHire(playerText) && specialistsFromHireText(playerText).length === 0) {
    if (npcId !== "steward") {
      return "Aldric the steward keeps the household books and seeks craftsmen. Speak to him of hiring.";
    }
    return "Bernard already keeps the forge. He is not for hire.";
  }
  if (!looksLikeHireOrder(playerText) && specialistsFromHireText(playerText).length === 0) return null;
  if (npcId !== "steward") {
    return "Aldric the steward keeps the household books and seeks craftsmen. Speak to him of hiring.";
  }
  const specs = specialistsFromHireText(playerText);
  if (!specs.length) {
    return "Say which craft or person — quarry and stone, carpentry, masonry, pottery, or a named hire from the closed list — and they can be sought if the estate is ready.";
  }
  const blocked = specs.map((s) => specialistHireBlocked(state, s)).filter((x): x is string => Boolean(x));
  const needed = specs.filter((s) => !specialistHireBlocked(state, s));
  if (!needed.length) {
    return blocked[0] ?? `${specs[0].name} cannot be hired yet.`;
  }
  return null;
}

const QUARRY_PROJECTS = new Set(["quarry", "causeway", "terracing"]);
const CARPENTER_PROJECTS = new Set([
  "carpenter_workshop",
  "timber_hall",
  "timber_chapel",
  "large_barn",
  "stables",
  "timber_bridge",
  "palisade",
  "wooden_tower",
  "labourer_housing",
  "watch_post",
  "landing_stage",
]);
const MASON_PROJECTS = new Set([
  "stone_chapel",
  "stone_bridge",
  "partial_stone_hall",
  "stone_wall",
  "gatehouse",
  "causeway",
  "terracing",
]);
const POTTER_PROJECTS = new Set(["pottery_kiln", "clay_pit"]);
const REEVE_PROJECTS = new Set(["labourer_housing", "improve_waste", "clear_scrub"]);
const VINEDRESSER_PROJECTS = new Set(["expand_vineyard"]);
const SEAMSTRESS_PROJECTS = new Set(["textile_workshop", "fulling_mill"]);
const COPPER_PROJECTS = new Set(["bloomery", "forge_mill"]);
const CAPTAIN_PROJECTS = new Set(["palisade", "wooden_tower", "gatehouse", "watch_post"]);

type CraftScope = {
  projects: Set<string>;
  tag?: string;
  transfer: string[];
  features: string[];
};

const CRAFT_SCOPES: Record<string, CraftScope> = {
  quarry_master: { projects: QUARRY_PROJECTS, tag: "stone", transfer: ["stone", "iron", "charcoal"], features: ["quarry"] },
  carpenter: {
    projects: CARPENTER_PROJECTS,
    tag: "timber",
    transfer: ["softwood", "hardwood", "iron"],
    features: ["carpenter_workshop"],
  },
  mason: { projects: MASON_PROJECTS, tag: "stone", transfer: ["stone", "iron"], features: ["quarry", "stone_wall"] },
  potter: { projects: POTTER_PROJECTS, tag: "pottery", transfer: ["trade_goods", "charcoal"], features: ["pottery_kiln", "clay_pit"] },
  village_reeve: { projects: REEVE_PROJECTS, tag: "village", transfer: ["hides", "wool"], features: ["labourer_housing"] },
  vinedresser: { projects: VINEDRESSER_PROJECTS, tag: "wine", transfer: ["wine"], features: [] },
  head_seamstress: {
    projects: SEAMSTRESS_PROJECTS,
    tag: "textile",
    transfer: ["linen", "wool"],
    features: ["textile_workshop", "mill_fulling"],
  },
  copper_smith: {
    projects: COPPER_PROJECTS,
    tag: "forge",
    transfer: ["copper", "tin", "charcoal", "iron"],
    features: ["bloomery", "mill_forge"],
  },
  captain: {
    projects: CAPTAIN_PROJECTS,
    tag: "defense",
    transfer: ["iron"],
    features: ["palisade", "tower", "gatehouse", "watch_post"],
  },
};

/** Hired specialist present whose craft list or tag covers this project. */
export function hiredSpecialistMatchingProject(
  state: WorldState,
  project: { key: string; tag?: string },
  by: "key" | "tag",
): string | undefined {
  for (const spec of HIREABLE_SPECIALISTS) {
    if (!specialistAlreadyPresent(state, spec)) continue;
    const scope = CRAFT_SCOPES[spec.id];
    if (!scope) continue;
    if (by === "key" && scope.projects.has(project.key)) return spec.id;
    if (by === "tag" && scope.tag && project.tag === scope.tag) return spec.id;
  }
  return undefined;
}

function projectAllowed(p: MechanicalProposal, keys: Set<string>, tag?: string): boolean {
  if (p.type === "start_project") return keys.has(p.projectKey) || (tag != null && p.tag === tag);
  if (p.type === "adjust_project" || p.type === "assign_labour") return true;
  return false;
}

/**
 * Hired specialists may speak of their craft. They do not run the demesne.
 * adjust_project / assign_labour are checked against the live project in applyDelta.
 */
export function specialistAllowed(
  state: WorldState,
  p: MechanicalProposal,
  spec: HireableSpecialist,
): string | null {
  const scope = CRAFT_SCOPES[spec.id];
  if (!scope) return "npc_not_authorized";
  const { projects: keys, tag, transfer, features } = scope;

  // Arms proposals are judged by applyDelta's armsAllowed (the captain's remit), not by craft scope.
  if (p.type === "raise_unit" || p.type === "disband_unit" || p.type === "call_to_arms" || p.type === "register_unit_sheet") return null;

  switch (p.type) {
    case "transfer_resources": {
      if (transfer.includes(p.resource)) return null;
      const custom = state.custom_resources.find((c) => c.id === p.resource);
      if (custom?.tags?.some((t) => t === tag || t === "craft")) return null;
      return "npc_not_authorized";
    }
    case "start_project":
      return projectAllowed(p, keys, tag) ? null : "npc_not_authorized";
    case "adjust_project": {
      const proj = resolveActiveProject(state, p.projectId, p.summary);
      if (!proj) return "Unknown project.";
      if (keys.has(proj.key) || proj.tag === tag) return null;
      return "npc_not_authorized";
    }
    case "assign_labour": {
      if (p.projectId === "unassigned") return "npc_not_authorized";
      const proj = resolveActiveProject(state, p.projectId, p.summary);
      if (!proj) return "Unknown project.";
      if (keys.has(proj.key) || proj.tag === tag) return null;
      return "npc_not_authorized";
    }
    case "add_modifier": {
      if (p.target === "accident_risk" || p.target === "project_speed" || p.target === "specific_resource_output") {
        return null;
      }
      if (spec.id === "village_reeve" && (p.target === "mood" || p.target === "harvest_risk")) return null;
      return "npc_not_authorized";
    }
    case "register_resource": {
      const tags = p.tags ?? [];
      if (tags.some((t) => t === tag || t === "craft")) return null;
      return "npc_not_authorized";
    }
    case "register_feature": {
      if (features.includes(p.feature)) return null;
      return "npc_not_authorized";
    }
    default:
      return "npc_not_authorized";
  }
}
