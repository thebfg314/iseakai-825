import { labourRemaining } from "../engine/labour";
import { memoriesForSpeaker, npcWithoutMemories } from "../engine/memory";
import { FORGE_FEATURES } from "../engine/projectCatalog";
import { CANONICAL_RESOURCES, type MechanicalProposal, type WorldState } from "../engine/schema";

/** Stiff marker. One line, comma-separated drawers, this wrapper only. */
export const TOOL_MARKER_EXAMPLE = "<=-tool: grain, sown, livestock, chest -=>";

export const TOOL_DRAWERS = [
  "grain",
  "sown",
  "land",
  "people",
  "labour",
  "chest",
  "livestock",
  "forge",
  "stores",
  "merchant",
  "hires",
  "customs",
  "my_deals",
  "projects",
  "flags",
] as const;

export type ToolDrawer = (typeof TOOL_DRAWERS)[number];

/** Engine-authored, in the NPC's mouth — not a Books line, not a model call. */
export const CHECK_RECORDS_LINE = "A moment, my lord — let me check the records.";

/** Memory-only tool pull — thinking back, not checking the books. */
export const RECALL_DEALS_LINE = "Hmm… let me think on that, my lord.";

const MEMORY_DRAWERS = new Set<ToolDrawer>(["my_deals"]);

/** True when every requested drawer is a memory recall (my_deals). Empty is not memory-only. */
export function isMemoryOnlyDrawers(drawers: readonly ToolDrawer[]): boolean {
  return drawers.length > 0 && drawers.every((d) => MEMORY_DRAWERS.has(d));
}

/** Records line if any ledger drawer is present; think-line only for a memory-only pull. */
export function holdingLineForDrawers(drawers: readonly ToolDrawer[]): string {
  return isMemoryOnlyDrawers(drawers) ? RECALL_DEALS_LINE : CHECK_RECORDS_LINE;
}

const GRAIN_KEYS = ["wheat", "rye", "barley", "oats"] as const;
const LIVESTOCK_KEYS = ["cattle", "sheep", "pigs", "horses", "poultry", "bees"] as const;
const FORGE_KEYS = ["iron", "charcoal", "copper", "tin"] as const;
const DRAWER_SET = new Set<string>(TOOL_DRAWERS);

const OPEN_TOKEN = "<=-tool:";

function completeMarkerRe(): RegExp {
  return /<=-tool:\s*([\s\S]*?)\s*-=>/gi;
}

export function isToolDrawer(name: string): name is ToolDrawer {
  return DRAWER_SET.has(name);
}

function normalizeDrawerName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function asDrawer(raw: string): ToolDrawer | undefined {
  const n = normalizeDrawerName(raw);
  if (n === "labor") return "labour";
  if (n === "memories" || n === "deals") return "my_deals";
  if (isToolDrawer(n)) return n;
  return undefined;
}

export type ToolRequest = {
  requested: boolean;
  drawers: ToolDrawer[];
  unknown: string[];
  malformed: boolean;
};

/**
 * Complete `<=-tool: … -=>` markers. A leftover `<=-tool:` without a close
 * (chopped output) is malformed — same class as incomplete JSON.
 */
export function parseToolRequest(raw: string): ToolRequest {
  const unknown: string[] = [];
  const found = new Set<ToolDrawer>();
  const re = completeMarkerRe();
  let any = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    any = true;
    const names = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      const drawer = asDrawer(name);
      if (drawer) found.add(drawer);
      else unknown.push(normalizeDrawerName(name));
    }
  }
  const leftover = raw.replace(completeMarkerRe(), "");
  const malformed = leftover.toLowerCase().includes(OPEN_TOKEN);
  return {
    requested: any && !malformed,
    drawers: [...found],
    unknown,
    malformed,
  };
}

export function hasMalformedToolMarker(raw: string): boolean {
  return parseToolRequest(raw).malformed;
}

/** Strip every complete tool marker. Incomplete leftovers are handled as malformed. */
export function stripToolMarkers(text: string): string {
  return text
    .replace(completeMarkerRe(), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickResources(state: WorldState, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = Number(state.resources[key as keyof typeof state.resources] ?? 0);
  }
  return out;
}

function drawerPayload(state: WorldState, name: ToolDrawer, npcId?: string): unknown {
  switch (name) {
    case "grain":
      return pickResources(state, GRAIN_KEYS);
    case "sown":
      return {
        agriculture: state.agriculture ?? { springBarleyShare: 0.6, autumnWheatShare: 0.45 },
        holdings: state.holdings.map((h) => ({ id: h.id, name: h.name, sown: h.sown })),
      };
    case "land":
      return {
        holdings: state.holdings.map((h) => ({
          id: h.id,
          name: h.name,
          land: h.land,
          features: h.features,
        })),
      };
    case "people":
      return {
        population: state.population,
        households: state.holdings.map((h) => ({ id: h.id, households: h.households })),
      };
    case "labour":
      return {
        remaining: labourRemaining(state),
        assigned: state.labour.assigned,
      };
    case "chest":
      return { denarii: state.resources.denarii };
    case "livestock":
      return pickResources(state, LIVESTOCK_KEYS);
    case "forge":
      return {
        ...pickResources(state, FORGE_KEYS),
        features: state.holdings.flatMap((h) => h.features.filter((f) => FORGE_FEATURES.has(f))),
      };
    case "stores": {
      const skip = new Set<string>([...GRAIN_KEYS, ...LIVESTOCK_KEYS, ...FORGE_KEYS, "denarii"]);
      const resources: Record<string, number> = {};
      for (const key of CANONICAL_RESOURCES) {
        if (skip.has(key)) continue;
        const amount = state.resources[key];
        if (amount !== 0) resources[key] = amount;
      }
      return {
        resources,
        custom_resources: state.custom_resources.filter((c) => c.amount !== 0),
      };
    }
    case "merchant":
      return state.merchant.present
        ? { present: true, name: state.merchant.name, stock: state.merchant.stock }
        : { present: false };
    case "hires":
      return state.npcs.map((n) => {
        const rest = npcWithoutMemories(n);
        return { id: rest.id, name: rest.name, role: rest.role, location: rest.location };
      });
    case "customs":
      return {
        standing_orders: state.standing_orders.filter((o) => o.active).map((o) => ({ id: o.id, text: o.text })),
        forthcoming: (state.forthcoming_orders ?? [])
          .filter((o) => o.status === "waiting")
          .map((o) => ({ id: o.id, text: o.text })),
        known_techniques: state.known_techniques.map((t) => ({ id: t.id, name: t.name })),
        modifiers: state.modifiers,
      };
    case "my_deals":
      return npcId ? memoriesForSpeaker(state, npcId) : [];
    case "projects":
      return state.projects
        .filter((p) => p.status === "active")
        .map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          holdingId: p.holdingId,
          status: p.status,
          labourDaysRequired: p.labourDaysRequired,
          labourDaysDone: p.labourDaysDone,
        }));
    case "flags":
      return state.flags;
  }
}

/** Live WorldState drawers. Unknown names are skipped. */
export function collectDrawers(state: WorldState, names: string[], npcId?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const want = new Set<ToolDrawer>();
  for (const name of names) {
    const drawer = asDrawer(name);
    if (drawer) want.add(drawer);
  }
  for (const name of want) {
    out[name] = drawerPayload(state, name, npcId);
  }
  return out;
}

export function drawerForResource(resource: string): ToolDrawer {
  const r = resource.toLowerCase().trim();
  if ((GRAIN_KEYS as readonly string[]).includes(r)) return "grain";
  if (r === "denarii") return "chest";
  if ((LIVESTOCK_KEYS as readonly string[]).includes(r)) return "livestock";
  if ((FORGE_KEYS as readonly string[]).includes(r)) return "forge";
  return "stores";
}

/** Drawers a proposal would need to have been shown, to avoid invented numbers. */
export function drawersCitedByProposal(p: MechanicalProposal): ToolDrawer[] {
  const cited = new Set<ToolDrawer>();
  const add = (d: ToolDrawer) => cited.add(d);
  switch (p.type) {
    case "transfer_resources":
      add(drawerForResource(p.resource));
      break;
    case "event_effect":
      if (p.resource) add(drawerForResource(p.resource));
      for (const nested of p.nested ?? []) {
        if (nested && typeof nested === "object" && "type" in nested) {
          for (const d of drawersCitedByProposal(nested as MechanicalProposal)) add(d);
        }
      }
      break;
    case "adjust_sowing":
      add("sown");
      add("land");
      break;
    case "assign_labour":
      add("labour");
      add("projects");
      break;
    case "start_project":
    case "adjust_project":
      add("projects");
      add("land");
      break;
    case "start_hunt":
      add("chest");
      add("projects");
      break;
    case "register_feature":
      add("land");
      break;
    case "register_npc":
      add("hires");
      add("chest");
      break;
    case "set_standing_order":
      add("customs");
      break;
    case "defer_proposal":
      add("customs");
      for (const d of drawersCitedByProposal(p.proposal)) add(d);
      break;
    case "register_resource":
      add("stores");
      break;
    default:
      break;
  }
  return [...cited];
}

export function missingCitedDrawers(proposals: MechanicalProposal[], already: Iterable<string>): ToolDrawer[] {
  const have = new Set<string>();
  for (const name of already) {
    const drawer = asDrawer(name);
    if (drawer) have.add(drawer);
  }
  const missing = new Set<ToolDrawer>();
  for (const p of proposals) {
    for (const d of drawersCitedByProposal(p)) {
      if (!have.has(d)) missing.add(d);
    }
  }
  return [...missing];
}
