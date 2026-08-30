import type { GameModifier, MechanicalProposal, PendingProposal, WorldState } from "../engine/schema";
import { CANONICAL_RESOURCES, RESOURCE_UNITS, type CanonicalResource } from "../engine/schema";
import { lookupProject } from "../engine/projectCatalog";
import { matchHireableSpecialist } from "../engine/specialists";

export const BOOKS_TITLE = "The books";

export const CONFIRM_HELP = "Speech does not change the chest. Confirm is Aldric writing it in the books.";

export const HUNGER_LINE = "The households are hungry — grain will not last.";
export const HARVEST_RISK_LINE = "Too many men are drawn off the fields. The harvest is at risk.";

const LAND_NAMES: Record<string, string> = {
  fertile_arable: "good ploughland",
  meadow: "meadow",
  vineyard: "vineyard",
  orchard: "orchard",
  woodland: "woodland",
  scrub: "overgrown scrub",
  waste: "overgrown waste",
  swamp: "swamp",
};

const FEATURE_NAMES: Record<string, string> = {
  manor_hall: "timber hall",
  barn: "barn",
  forge: "forge",
  chapel: "timber oratory",
  monastery: "cell of Saint-Martin",
  mill_flour: "flour mill",
  mill_fulling: "fulling mill",
  mill_forge: "mill-forge",
  bloomery: "bloomery",
  fish_pond: "fish pond",
  stables: "stables",
  carpenter_workshop: "carpenter's workshop",
  textile_workshop: "textile workshop",
  bakehouse: "bakehouse",
  labourer_housing: "labourer housing",
  bridge: "bridge",
  landing_stage: "landing stage",
  improved_road: "improved pack-paths",
  palisade: "palisade",
  tower: "wooden tower",
  wooden_tower: "wooden tower",
  gatehouse: "gatehouse",
  watch_post: "watch post",
  quarry: "quarry",
  clay_pit: "clay pit",
  tannery: "tannery",
  pottery_kiln: "pottery kiln",
};

const RESOURCE_NAMES: Record<string, string> = {
  denarii: "denarii",
  wheat: "wheat",
  rye: "rye",
  barley: "barley",
  oats: "oats",
  cattle: "cattle",
  sheep: "sheep",
  pigs: "pigs",
  horses: "horses",
  poultry: "poultry",
  bees: "bees",
  wine: "wine",
  cheese: "cheese",
  honey: "honey",
  wool: "wool",
  linen: "linen",
  softwood: "softwood",
  hardwood: "hardwood",
  charcoal: "charcoal",
  iron: "iron",
  copper: "copper",
  tin: "tin",
  salt: "salt",
  stone: "stone",
  hides: "hides",
  beeswax: "beeswax",
  trade_goods: "wares",
};

const ROLE_NAMES: Record<string, string> = {
  steward: "steward",
  smith: "smith",
  chaplain: "chaplain",
  merchant: "merchant",
  quarry_master: "quarry master",
  carpenter: "carpenter",
  mason: "mason",
  potter: "potter",
  village_reeve: "village reeve",
  vinedresser: "vinedresser",
  head_seamstress: "head seamstress",
  copper_smith: "copper-smith",
  captain: "captain",
  priest: "priest",
  monk: "monk",
  novice: "novice",
  bishop: "bishop",
};

const PROPOSAL_TYPE_NAMES: Record<string, string> = {
  assign_labour: "Hands",
  set_standing_order: "Standing order",
  start_project: "A work",
  adjust_project: "A work",
  adjust_sowing: "The sowing",
  transfer_resources: "The stores",
  add_modifier: "A custom",
  remove_modifier: "A custom",
  register_resource: "A new store",
  register_feature: "The land",
  register_npc: "A hire",
  event_effect: "The season",
};

const UNIT_SINGULAR: Record<string, string> = {
  denarii: "denarius",
  modii: "modius",
  pounds: "pound",
  head: "head",
  hives: "hive",
  barrels: "barrel",
  "cart-loads": "cart-load",
  pieces: "piece",
  units: "lot",
};

const PLURAL_GOODS = new Set([
  "cattle",
  "sheep",
  "pigs",
  "horses",
  "poultry",
  "bees",
  "hides",
  "trade_goods",
]);

function humanizeKey(id: string): string {
  return id.replaceAll("_", " ");
}

export function landName(id: string): string {
  return LAND_NAMES[id] ?? humanizeKey(id);
}

export function featureName(id: string): string {
  return FEATURE_NAMES[id] ?? humanizeKey(id);
}

export function resourceName(id: string): string {
  return RESOURCE_NAMES[id] ?? humanizeKey(id);
}

export function roleName(id: string): string {
  return ROLE_NAMES[id] ?? humanizeKey(id);
}

export function proposalTypeName(type: string): string {
  return PROPOSAL_TYPE_NAMES[type] ?? humanizeKey(type);
}

export function resourceUnit(id: string): string {
  if (id === "trade_goods") return "lots";
  if ((CANONICAL_RESOURCES as readonly string[]).includes(id)) {
    return RESOURCE_UNITS[id as CanonicalResource];
  }
  return "";
}

export function resourceUnitSingular(id: string): string {
  if (id === "trade_goods") return "lot";
  const unit = resourceUnit(id);
  return UNIT_SINGULAR[unit] ?? unit;
}

export function formatLedgerNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatSignedDelta(n: number): string {
  const body = formatLedgerNumber(n);
  return n > 0 ? `+${body}` : body;
}

export function sowingShareLine(kind: "spring" | "autumn", share: number): string {
  const first = kind === "spring" ? "barley" : "wheat";
  const rest = kind === "spring" ? "oats" : "rye";
  const seed = kind === "spring" ? "spring seed" : "autumn seed";
  const p = Math.round(share * 100);
  if (p >= 95) return `Of the ${seed}, all ${first}.`;
  if (p <= 5) return `Of the ${seed}, all ${rest}.`;
  if (kind === "spring" && p >= 55 && p <= 65) return `Of the spring seed, three parts ${first}, the rest ${rest}.`;
  if (kind === "autumn" && p >= 40 && p <= 50) return `Of the autumn seed, near half ${first}, the rest ${rest}.`;
  if (p === 50) return `Of the ${seed}, half ${first}, the rest ${rest}.`;
  if (p >= 70) return `Of the ${seed}, most ${first}, the rest ${rest}.`;
  if (p <= 30) return `Of the ${seed}, most ${rest}, the rest ${first}.`;
  return `Of the ${seed}, more ${first} than ${rest}.`;
}

export function peopleSentence(pop: WorldState["population"]): string {
  return `${pop.adult_men} men, ${pop.adult_women} women, and ${pop.youths} youths of working age.`;
}

export function labourSentence(
  pool: { men: number; women: number; youths: number },
  remaining: { men: number; women: number; youths: number },
): string {
  return `Of the extra days I can still call, ${remaining.men} of ${pool.men} remain for the men, ${remaining.women} of ${pool.women} for the women, and ${remaining.youths} of ${pool.youths} for the youths.`;
}

export function featuresSentence(features: string[]): string {
  if (!features.length) return "No works stand on the holding yet.";
  const names = features.map(featureName);
  if (names.length === 1) return `On the holding: ${names[0]}.`;
  if (names.length === 2) return `On the holding: ${names[0]} and ${names[1]}.`;
  return `On the holding: ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}.`;
}

export function merchantPresentLine(name?: string): string {
  return name ? `${name} the merchant is in the district.` : "A merchant is in the district.";
}

export function marketLine(resource: string, min: number, max: number): string {
  const name = resourceName(resource);
  const unit = resourceUnitSingular(resource) || "piece";
  const verb = PLURAL_GOODS.has(resource) ? "fetch" : "fetches";
  if (min === max) return `${name} ${verb} ${min} denarii the ${unit}`;
  return `${name} ${verb} ${min}–${max} denarii the ${unit}`;
}

export function projectProgressLine(done: number, required: number): string {
  if (required <= 0) return "finished";
  const frac = done / required;
  const owed = Math.max(0, Math.round((required - done) * 10) / 10);
  const days = owed === 1 ? "1 day still owed" : `${formatLedgerNumber(owed)} days still owed`;
  if (frac >= 1) return "finished";
  if (frac <= 0.02) return `not yet begun · ${days}`;
  if (frac < 0.4) return `begun · ${days}`;
  if (frac < 0.65) return `half raised · ${days}`;
  if (frac < 0.9) return `nearly done · ${days}`;
  return `almost finished · ${days}`;
}

function seasonsYet(n: number | null | undefined, kind: string): string {
  if (kind === "permanent") return "";
  if (n == null) return "";
  return ` (${n} season${n === 1 ? "" : "s"} yet)`;
}

export function modifierLine(m: GameModifier): string {
  if (m.target === "mood") {
    const heart = m.effect.value >= 0 ? "the people are in better heart" : "the people are uneasy";
    return `${heart}${seasonsYet(m.seasons_remaining, m.kind)}`;
  }
  if (m.customNote) return `${m.customNote}${seasonsYet(m.seasons_remaining, m.kind)}`;
  const what: Record<string, string> = {
    grain_yield: "the fields yield differently",
    labour_efficiency: "the hands work differently",
    spoilage: "the stores keep differently",
    project_speed: "the works move differently",
    specific_resource_output: "one store yields differently",
    accident_risk: "the works carry more risk",
    market_price: "prices have shifted",
    livestock_yield: "the herds yield differently",
    harvest_risk: "the harvest is less sure",
    custom: "a custom is in force",
  };
  return `${what[m.target] ?? "a custom is in force"}${seasonsYet(m.seasons_remaining, m.kind)}`;
}

export function confirmBanner(count: number): string {
  const noun = count === 1 ? "proposed change" : "proposed changes";
  const them = count === 1 ? "it" : "them";
  return `${count} ${noun} — Confirm is Aldric writing ${them} in the books. Advancing the season will lapse unconfirmed orders.`;
}

function amountOf(resource: string, amount: number): string {
  const name = resourceName(resource);
  const unit = resourceUnit(resource);
  if (resource === "denarii") return `${formatLedgerNumber(amount)} denarii`;
  if (unit) return `${formatLedgerNumber(amount)} ${unit} of ${name}`;
  return `${formatLedgerNumber(amount)} ${name}`;
}

export function proposalBlurb(p: PendingProposal["proposal"] | MechanicalProposal, state?: WorldState): string {
  switch (p.type) {
    case "adjust_sowing": {
      const bits: string[] = [];
      if (p.springBarleyShare != null) bits.push(sowingShareLine("spring", p.springBarleyShare));
      if (p.autumnWheatShare != null) bits.push(sowingShareLine("autumn", p.autumnWheatShare));
      if (p.barley != null) bits.push(`${p.barley} acres of barley.`);
      if (p.oats != null) bits.push(`${p.oats} acres of oats.`);
      if (p.wheat != null) bits.push(`${p.wheat} acres of wheat.`);
      if (p.rye != null) bits.push(`${p.rye} acres of rye.`);
      return bits.join(" ") || "Change the sowing mix.";
    }
    case "start_project": {
      const name = p.name ?? lookupProject(p.projectKey)?.name ?? resourceName(p.projectKey);
      const holding = state?.holdings.find((h) => h.id === p.holdingId)?.name ?? "the holding";
      return `Begin ${name} on ${holding}.`;
    }
    case "adjust_project": {
      const proj = state?.projects.find((x) => x.id === p.projectId);
      const name = proj?.name ?? "the work";
      if (p.cancel) return `Stop ${name}.`;
      if (p.rush) return `Hasten ${name}.`;
      return `Change the labour on ${name}.`;
    }
    case "transfer_resources": {
      const qty = amountOf(p.resource, p.amount);
      const reason = p.reason ? ` ${p.reason}.` : "";
      if (p.direction === "buy") return `Buy ${qty} from the merchant.${reason}`;
      if (p.direction === "sell") return `Sell ${qty} from the stores.${reason}`;
      if (p.direction === "consume") return `Take ${qty} from the stores.${reason}`;
      return `Add ${qty} to the stores.${reason}`;
    }
    case "add_modifier": {
      if (p.target === "mood") {
        const heart = p.effect.value >= 0 ? "The people would take heart" : "The people would grow uneasy";
        const n = p.seasonsRemaining;
        const time = n != null ? ` for ${n} season${n === 1 ? "" : "s"}` : "";
        const source = p.source ? ` (${p.source})` : "";
        return `${heart}${time}${source}.`;
      }
      return p.customNote || p.summary || p.source;
    }
    case "assign_labour": {
      const proj = state?.projects.find((x) => x.id === p.projectId)?.name ?? "the work";
      return `${p.men} men, ${p.women} women, and ${p.youths} youths to ${proj}.`;
    }
    case "set_standing_order":
      return p.text;
    case "register_npc": {
      const spec = matchHireableSpecialist(p.npc);
      const gift = spec
        ? spec.hireGrainRation
          ? ` · ${spec.hireCostDenarii} denarii and a household grain ration`
          : ` · ${spec.hireCostDenarii} denarii hiring gift`
        : "";
      return `Record ${p.npc.name} as ${roleName(p.npc.role)}${gift}`;
    }
    case "register_resource":
      return `Record ${p.name} among the stores.`;
    case "register_feature": {
      const holding = state?.holdings.find((h) => h.id === p.holdingId)?.name ?? "the holding";
      return `Record a ${featureName(p.feature)} on ${holding}.`;
    }
    case "remove_modifier":
      return p.summary && p.summary !== p.type ? p.summary : "Lift a custom from the books.";
    case "event_effect":
      return p.summary && p.summary !== p.type && p.summary !== "event_effect" ? p.summary : "A season's change.";
  }
}
