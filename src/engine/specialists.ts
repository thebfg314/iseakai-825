import type { MechanicalProposal, Npc, WorldState } from "./schema";

/** One solidus (12 denarii): a poor villa's hiring gift / earnest, plus board thereafter. */
export const SPECIALIST_HIRE_COST = 12;

export type HireableSpecialist = {
  id: string;
  name: string;
  role: string;
  notes: string;
  hireCostDenarii: number;
};

export const HIREABLE_SPECIALISTS: HireableSpecialist[] = [
  {
    id: "quarry_master",
    name: "Colman",
    role: "quarry_master",
    hireCostDenarii: SPECIALIST_HIRE_COST,
    notes:
      "Quarry master. Knows stone-winning, wedges, packing cart-loads, and the danger of a bad face. Will not pretend to rule the fields.",
  },
  {
    id: "carpenter",
    name: "Haimo",
    role: "carpenter",
    hireCostDenarii: SPECIALIST_HIRE_COST,
    notes:
      "Carpenter. Timber joints, carts, doors, and the carpenter's bench. Will not pretend to rule the fields.",
  },
  {
    id: "mason",
    name: "Gerold",
    role: "mason",
    hireCostDenarii: SPECIALIST_HIRE_COST,
    notes: "Mason. Dressed stone, lime, and walls that stand. Will not pretend to rule the fields.",
  },
  {
    id: "potter",
    name: "Hugo",
    role: "potter",
    hireCostDenarii: SPECIALIST_HIRE_COST,
    notes: "Potter. Clay, wheel, and kiln. Will not pretend to rule the fields.",
  },
];

export const SPECIALIST_IDS = new Set(HIREABLE_SPECIALISTS.map((s) => s.id));

const CORE_HOUSEHOLD_IDS = new Set(["steward", "smith", "chaplain", "merchant"]);

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

export function hireSummary(spec: HireableSpecialist): string {
  return `Hire ${spec.name} the ${spec.role.replaceAll("_", " ")} — ${spec.hireCostDenarii} denarii hiring gift from the chest.`;
}

const CRAFT_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "potter", re: /\b(potter|pottery|kiln|clay)\b/i },
  { id: "carpenter", re: /\b(carpenter|carpentry|woodwright|joinery|woodwork|timber.?wright)\b/i },
  { id: "mason", re: /\b(mason|masonry|stone.?mason|dressed stone|lime.?mortar)\b/i },
  {
    id: "quarry_master",
    re: /\b(quarry|quarryman|stone.?cutter|stone.?master|winning stone)\b|\b(someone|man|hand|specialist).{0,28}\bstone\b|\bstone\b.{0,24}(work|cut|dig|quarry)/i,
  },
];

const HIRE_VERB =
  /\b(hire|retain|employ|engage|take on|bring in|send for|fetch|find|get me|need|want)\b/i;
const HIRE_GENERIC = /\b(specialist|craftsman|craftsmen|a trade)\b/i;

export function looksLikeHireOrder(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!HIRE_VERB.test(t)) return false;
  const explicitHire = /\b(hire|retain|employ|engage|take on|bring in|send for)\b/i.test(t);
  if (/\b(workshop|kiln|project)\b/i.test(t) && !explicitHire) return false;
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
  const location = state.holdings[0]?.id ?? "fontenay";
  for (const spec of specs) {
    if (specialistAlreadyPresent(state, spec)) continue;
    if (state.resources.denarii < reserved + spec.hireCostDenarii) continue;
    reserved += spec.hireCostDenarii;
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
  if (!looksLikeHireOrder(playerText) && specialistsFromHireText(playerText).length === 0) return null;
  if (npcId !== "steward") {
    return "Aldric the steward keeps the household books and seeks craftsmen. Speak to him of hiring.";
  }
  const specs = specialistsFromHireText(playerText);
  if (!specs.length) {
    return "Say which craft — quarry and stone, carpentry, masonry, or pottery — and a named man can be sought.";
  }
  const already = specs.filter((s) => specialistAlreadyPresent(state, s));
  const needed = specs.filter((s) => !specialistAlreadyPresent(state, s));
  if (!needed.length) {
    const first = already[0];
    return `${first.name} the ${first.role.replaceAll("_", " ")} already serves this house.`;
  }
  const cost = needed.reduce((sum, s) => sum + s.hireCostDenarii, 0);
  if (state.resources.denarii < cost) {
    return `The chest cannot spare ${cost} denarii for a hiring gift (one solidus per craftsman). Fontenay is thin.`;
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
  "gatehouse",
  "causeway",
  "terracing",
]);
const POTTER_PROJECTS = new Set(["pottery_kiln", "clay_pit"]);

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
  const keys =
    spec.id === "quarry_master"
      ? QUARRY_PROJECTS
      : spec.id === "carpenter"
        ? CARPENTER_PROJECTS
        : spec.id === "mason"
          ? MASON_PROJECTS
          : POTTER_PROJECTS;
  const tag =
    spec.id === "quarry_master" ? "stone" : spec.id === "potter" ? "pottery" : spec.id === "mason" ? "stone" : "timber";

  switch (p.type) {
    case "transfer_resources": {
      if (spec.id === "quarry_master" && ["stone", "iron", "charcoal"].includes(p.resource)) return null;
      if (spec.id === "carpenter" && ["softwood", "hardwood", "iron"].includes(p.resource)) return null;
      if (spec.id === "mason" && ["stone", "iron"].includes(p.resource)) return null;
      if (spec.id === "potter" && ["trade_goods", "charcoal"].includes(p.resource)) return null;
      const custom = state.custom_resources.find((c) => c.id === p.resource);
      if (custom?.tags?.some((t) => t === tag || t === "craft")) return null;
      return "npc_not_authorized";
    }
    case "start_project":
      return projectAllowed(p, keys, tag) ? null : "npc_not_authorized";
    case "adjust_project": {
      const proj = state.projects.find((x) => x.id === p.projectId);
      if (!proj) return "Unknown project.";
      if (keys.has(proj.key) || proj.tag === tag) return null;
      return "npc_not_authorized";
    }
    case "assign_labour": {
      if (p.projectId === "unassigned") return "npc_not_authorized";
      const proj = state.projects.find((x) => x.id === p.projectId);
      if (!proj) return "Unknown project.";
      if (keys.has(proj.key) || proj.tag === tag) return null;
      return "npc_not_authorized";
    }
    case "add_modifier": {
      if (p.target === "accident_risk" || p.target === "project_speed" || p.target === "specific_resource_output") {
        return null;
      }
      return "npc_not_authorized";
    }
    case "register_resource": {
      const tags = p.tags ?? [];
      if (tags.some((t) => t === tag || t === "craft")) return null;
      return "npc_not_authorized";
    }
    case "register_feature": {
      const features =
        spec.id === "quarry_master"
          ? ["quarry"]
          : spec.id === "carpenter"
            ? ["carpenter_workshop"]
            : spec.id === "mason"
              ? ["quarry"]
              : ["pottery_kiln", "clay_pit"];
      if (features.includes(p.feature)) return null;
      return "npc_not_authorized";
    }
    default:
      return "npc_not_authorized";
  }
}
