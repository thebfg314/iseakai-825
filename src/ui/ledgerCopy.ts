import type { GameModifier, MechanicalProposal, PendingProposal, WorldState } from "../engine/schema";
import { CANONICAL_RESOURCES, RESOURCE_UNITS, type CanonicalResource } from "../engine/schema";
import { lookupProject } from "../engine/projectCatalog";
import { labourCalledPhrase, resolveActiveProject } from "../engine/labour";
import { matchHireableSpecialist } from "../engine/specialists";
import { quoteRaise } from "../engine/military";

export const BOOKS_TITLE = "The books";

export const CONFIRM_HELP = "Speech does not change the chest. Confirm is Aldric writing it in the books.";

export const HUNGER_LINE = "The households are hungry — grain will not last.";

export const LABOURS_EMPTY = "None underway, and none finished in these books.";
export const CUSTOMS_ORDERS_EMPTY = "No standing order is written.";
export const CUSTOMS_LAWS_EMPTY = "No lasting custom of the hall is written.";
export const CUSTOMS_FORTHCOMING_EMPTY = "No forthcoming order is waiting.";
export const FORTHCOMING_STRIKE = "Strike it";
export const ESTATE_THIS_SEASON_HINT = "These are the books of this season.";
export const ESTATE_NO_HISTORY_HINT = "Earlier seasons are not yet kept.";
export const ESTATE_PAST_HINT = "As the books stood in that season.";
export const ESTATE_PAST_MISSING = "That season's books were not kept.";

export function seasonBooksLabel(season: string, year: number): string {
  const name = season.charAt(0).toUpperCase() + season.slice(1);
  return `${name} ${year}`;
}

export function labourStatusLine(status: "active" | "completed" | "cancelled"): string {
  if (status === "active") return "Underway";
  if (status === "completed") return "Finished";
  return "Stopped";
}

export function seasonsOfWorkPhrase(n: number): string {
  if (n <= 1) return "this season's work";
  if (n === 2) return "two seasons of work";
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  if (n < words.length) return `${words[n]} seasons of work`;
  return `${n} seasons of work`;
}

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
  stone_wall: "stone wall",
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
  mancipia: "unfree (mancipia)",
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
  negotiator: "negotiator",
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
  add_modifier: "A custom of the hall",
  remove_modifier: "A standing custom",
  register_resource: "A new store",
  register_feature: "The land",
  register_npc: "A hire",
  event_effect: "The season",
  start_hunt: "A hunt",
  settle_households: "People at the gate",
  defer_proposal: "A forthcoming order",
  raise_unit: "Men under arms",
  disband_unit: "Men sent home",
  call_to_arms: "A call to arms",
  register_unit_sheet: "A new kind of soldier",
  free_mancipia: "Manumission",
};

const UNIT_SINGULAR: Record<string, string> = {
  souls: "soul",
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

export function workDisplayName(keyOrName: string): string {
  if (!keyOrName) return "the work";
  return lookupProject(keyOrName)?.name ?? FEATURE_NAMES[keyOrName] ?? humanizeKey(keyOrName);
}

export function modifierSourceName(source: string): string {
  if (!source) return "a custom of the hall";
  if (/^event:/i.test(source)) return "a season's change";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(source)) return humanizeKey(source);
  return source;
}

export function resourceUnit(id: string): string {
  if (id === "trade_goods") return "lots";
  if (id === "mancipia") return "souls";
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

export function sowingRotationLine(rotation?: string): string {
  if (rotation === "three_field") {
    return "The ploughland is kept in three fields — winter seed, spring seed, and a rest.";
  }
  return "The ploughland is kept in two fields — half sown, half fallow.";
}

export function forthcomingWhenLine(trigger: {
  kind: "beat" | "after_seasons";
  beat?: string;
  seasonsRemaining?: number;
}): string {
  if (trigger.kind === "after_seasons") {
    const n = trigger.seasonsRemaining ?? 1;
    if (n <= 1) return "After this season";
    const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    return n < words.length ? `After ${words[n]} seasons` : `After ${n} seasons`;
  }
  if (trigger.beat === "next_spring_sowing") return "At the next spring sowing";
  if (trigger.beat === "next_autumn_sowing") return "At the next autumn sowing";
  return "After this harvest";
}

export function forthcomingInnerBlurb(
  inner: PendingProposal["proposal"] | MechanicalProposal,
  state?: WorldState,
): string {
  if (inner.type === "adjust_sowing" && inner.rotation === "three_field") {
    return "three-field rotation on the ploughland";
  }
  if (inner.type === "adjust_sowing" && inner.rotation === "two_field") {
    return "two-field rotation on the ploughland";
  }
  const blurb = proposalBlurb(inner, state).replace(/\.$/, "");
  if (blurb && !looksLikeEngineKey(blurb)) return blurb.charAt(0).toLowerCase() + blurb.slice(1);
  const summary = inner.summary?.trim();
  if (summary && summary !== inner.type && !looksLikeEngineKey(summary)) {
    return summary.charAt(0).toLowerCase() + summary.slice(1);
  }
  return "the ordered change";
}

export function forthcomingOrderText(
  trigger: { kind: "beat" | "after_seasons"; beat?: string; seasonsRemaining?: number },
  inner: PendingProposal["proposal"] | MechanicalProposal,
  state?: WorldState,
): string {
  return `${forthcomingWhenLine(trigger)}: ${forthcomingInnerBlurb(inner, state)}.`;
}

export function forthcomingWrittenLine(text: string): string {
  return `It is written as a forthcoming order: ${text.replace(/\.$/, "")}.`;
}

export function forthcomingStruckLine(text: string): string {
  return `The forthcoming order is struck from the books: ${text.replace(/\.$/, "")}.`;
}

export function forthcomingKeptLine(logLine: string): string {
  const kept = logLine.replace(/\.$/, "").trim();
  if (!kept || looksLikeEngineKey(kept)) return "The forthcoming order is kept.";
  return `The forthcoming order is kept: ${kept.charAt(0).toLowerCase() + kept.slice(1)}.`;
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

export function labourOnWorkLine(assign?: { men: number; women: number; youths: number } | null): string {
  if (!assign || (!assign.men && !assign.women && !assign.youths)) return "no extra hands called this season";
  return labourCalledPhrase(assign.men, assign.women, assign.youths);
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

export function amountPhrase(resource: string, amount: number): string {
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
      if (p.rotation === "three_field") bits.push(sowingRotationLine("three_field"));
      if (p.rotation === "two_field") bits.push(sowingRotationLine("two_field"));
      if (p.springBarleyShare != null) bits.push(sowingShareLine("spring", p.springBarleyShare));
      if (p.autumnWheatShare != null) bits.push(sowingShareLine("autumn", p.autumnWheatShare));
      if (p.barley != null) bits.push(`${p.barley} acres of barley.`);
      if (p.oats != null) bits.push(`${p.oats} acres of oats.`);
      if (p.wheat != null) bits.push(`${p.wheat} acres of wheat.`);
      if (p.rye != null) bits.push(`${p.rye} acres of rye.`);
      return bits.join(" ") || "Change the sowing mix.";
    }
    case "start_project": {
      const name = p.name ?? workDisplayName(p.projectKey);
      const holding = state?.holdings.find((h) => h.id === p.holdingId)?.name ?? "the holding";
      return `Begin ${name} on ${holding}.`;
    }
    case "adjust_project": {
      const proj = state ? resolveActiveProject(state, p.projectId, p.summary) : undefined;
      const name = proj?.name ?? "the work";
      if (p.cancel) return `Stop ${name}.`;
      if (p.rush) return `Hasten ${name}.`;
      return `Change the labour on ${name}.`;
    }
    case "transfer_resources": {
      const qty = amountPhrase(p.resource, p.amount);
      const reason = p.reason && !looksLikeEngineKey(p.reason) ? ` ${p.reason}.` : "";
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
      return (
        p.customNote ||
        (p.summary && p.summary !== p.type && !looksLikeEngineKey(p.summary) ? p.summary : "") ||
        (p.source && !looksLikeEngineKey(p.source) ? p.source : "A custom of the hall.")
      );
    }
    case "assign_labour": {
      const proj = state ? resolveActiveProject(state, p.projectId, p.summary)?.name ?? "the work" : "the work";
      const dest = proj.replace(/^(the|a|an)\s+/i, "");
      const who = labourCalledPhrase(p.men, p.women, p.youths).replace(" called this season", "") || "no extra hands";
      return `${who} to the ${dest}.`;
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
    case "start_hunt": {
      const seasons = p.durationSeasons === 1 ? "1 season" : `${p.durationSeasons} seasons`;
      return `Gerulf will seek ${p.amount} ${p.goods} for ${formatLedgerNumber(p.quotedDenarii)} denarii over ${seasons}. The purse leaves the chest on Confirm.`;
    }
    case "settle_households": {
      const hh = p.households === 1 ? "one household" : `${p.households} households`;
      return `Take in ${hh} — a man, a woman, and a youth of working age.`;
    }
    case "raise_unit": {
      const quote = quoteRaise(p.sheetId, p.men);
      if (!quote) return `Raise ${p.men} men as ${humanizeKey(p.sheetId)}.`;
      const cost = [quote.denarii ? `${quote.denarii} denarii` : "", quote.iron ? `${quote.iron} lb iron` : "", quote.horses ? `${quote.horses} horses` : ""].filter(Boolean).join(", ");
      const when = quote.seasons === 0 ? "They stand at once." : `${quote.seasons} season${quote.seasons === 1 ? "" : "s"} of drill before they march.`;
      const keep = quote.upkeepPerSeason ? ` Upkeep ${quote.upkeepPerSeason} denarii a season.` : "";
      return `${quote.men} men as ${quote.spec.label.toLowerCase()}${p.name ? ` — ${p.name}` : ""}${cost ? ` for ${cost}` : ", from the villa's own"}. ${when}${keep}`;
    }
    case "disband_unit": {
      const unit = state?.military.units.find((u) => u.id === p.unitId || u.name.toLowerCase() === p.unitId.toLowerCase());
      return unit ? `Send ${unit.name} (${unit.strength} men) home.` : "Send a unit home.";
    }
    case "call_to_arms":
      return p.kind === "raid" ? "Ride down to the river against the Northmen now." : p.kind === "bandits" ? "Ride against the outlaws on the road now." : "Answer the count's muster.";
    case "register_unit_sheet": {
      const sheet = p.sheet as { name?: string; tags?: string[] } | undefined;
      const tags = Array.isArray(sheet?.tags) ? sheet!.tags!.join(", ") : "";
      return `Write ${sheet?.name ?? "a new kind of soldier"} into the muster rolls${tags ? ` (${tags})` : ""}. Stats and tags only; the engine judges what they do.`;
    }
    case "free_mancipia": {
      const have = state?.population.mancipia ?? 0;
      const n = Math.min(p.count, have || p.count);
      return `Free ${n} of the unfree before witnesses. They become free men of the villa; every two take a manse as tenants. The people take heart from it.`;
    }
    case "defer_proposal": {
      if (p.text && p.text.trim() && !looksLikeEngineKey(p.text)) return p.text.trim();
      const inner = p.proposal;
      if (inner && typeof inner === "object" && "type" in inner) {
        return forthcomingOrderText(
          p.seasonsRemaining != null || p.applyAfterSeasons != null
            ? { kind: "after_seasons", seasonsRemaining: p.seasonsRemaining ?? p.applyAfterSeasons }
            : { kind: "beat", beat: typeof p.trigger === "string" ? p.trigger : p.beat ?? (typeof p.trigger === "object" ? p.trigger?.beat : undefined) },
          inner,
          state,
        );
      }
      return p.summary && p.summary !== p.type && !looksLikeEngineKey(p.summary)
        ? p.summary
        : "Write a forthcoming order in the books, to be kept later.";
    }
  }
}

const ENGINE_KEY = /\b(?:proj|mod|prop|so|tech|fo|unit|drill)-[a-z0-9]+|\bnpc_not_authorized\b|\bcustomCosts\b|\bREJECT\b|\bJSON\b|\bAPI\b|\bschema\b|\bassign_labour\b|\bstart_project\b|\bevent_effect\b|\badjust_sowing\b|\btransfer_resources\b|\badd_modifier\b|\bregister_npc\b|\bregister_resource\b|\bregister_feature\b|\bset_standing_order\b|\bsettle_households\b|\bdefer_proposal\b|\bschedule_order\b|\braise_unit\b|\bdisband_unit\b|\bcall_to_arms\b|\bregister_unit_sheet\b|\bfree_mancipia\b/i;
const SNAKE_KEY = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

export function looksLikeEngineKey(text: string): boolean {
  return ENGINE_KEY.test(text) || /^[a-z]+(?:_[a-z0-9]+)+$/.test(text.trim());
}

const EXACT_REASONS: Record<string, string> = {
  npc_not_authorized: "That is not theirs to order.",
  "Unknown project.": "I know no such work on the estate.",
  "No such active project.": "There is no such work underway.",
  "Unknown holding.": "I know no such holding.",
  "Unknown proposal type.": "I cannot write that change into the books.",
  "Unknown modifier.": "I find no such custom in the books.",
  "No such pending proposal.": "That order is no longer before me.",
  "Cannot sell coin.": "Coin is not sold from the chest.",
  "Resource id already exists.": "That store is already written in the books.",
  "NPC id already exists.": "That person is already of this house.",
  "register_resource must declare isNew: true.": "That store is already among the books.",
  "register_feature must declare isNew: true.": "That work already stands on the holding.",
  "register_npc must declare isNew: true.": "That person is already recorded.",
  "adjust_sowing needs a crop mix or acre figures.": "Say how the sowing should be divided, or I cannot change it.",
  "Cleared labour assignments.": "I have sent the extra hands back to their households.",
};

function rewriteSnakeKeys(text: string): string {
  return text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, (key) => {
    if (RESOURCE_NAMES[key] || FEATURE_NAMES[key] || LAND_NAMES[key] || ROLE_NAMES[key] || PROPOSAL_TYPE_NAMES[key]) {
      return resourceName(key) !== humanizeKey(key) && RESOURCE_NAMES[key]
        ? resourceName(key)
        : FEATURE_NAMES[key]
          ? featureName(key)
          : LAND_NAMES[key]
            ? landName(key)
            : ROLE_NAMES[key]
              ? roleName(key)
              : proposalTypeName(key);
    }
    return workDisplayName(key);
  });
}

/** Spoken steward/NPC English for applyDelta reasons and other banner errors. */
export function playerFacingReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return "The books will not take that change.";
  if (EXACT_REASONS[trimmed]) return EXACT_REASONS[trimmed];

  const reject = trimmed.match(/^REJECT\s+\S+\s+\S+:\s*(.+)$/i) ?? trimmed.match(/^REJECT\s+.+:\s*(.+)$/i);
  if (reject) return playerFacingReason(reject[1]);

  if (/customCosts/i.test(trimmed) || /^Unknown project '/i.test(trimmed)) {
    const key = trimmed.match(/'([^']+)'/)?.[1];
    const name = key ? workDisplayName(key) : "that work";
    return `I know no work called ${name}, and no costs were named for it.`;
  }

  if (/^Unknown resource '/i.test(trimmed)) {
    const id = trimmed.match(/'([^']+)'/)?.[1];
    return `I find no store of ${id ? resourceName(id) : "that good"} in the books.`;
  }

  const labour = trimmed.match(/Not enough callable labour \(pool men ([\d.]+), women ([\d.]+), youths ([\d.]+)\)/i);
  if (labour) {
    return `There are not enough extra hands. I can still call ${labour[1]} men, ${labour[2]} women, and ${labour[3]} youths.`;
  }
  if (/Not enough callable labour/i.test(trimmed)) return "There are not enough extra hands left to call.";

  if (/The merchant has no /i.test(trimmed)) return rewriteSnakeKeys(trimmed);
  if (/^Cannot (sell|consume) /i.test(trimmed)) {
    return rewriteSnakeKeys(trimmed).replace(/^Cannot consume/, "I cannot take").replace(/^Cannot sell/, "I cannot sell");
  }
  if (/Sown acres .* (two-field cap|three-field cap|sown share)/i.test(trimmed)) {
    return "That sowing would overfill the sown share of the ploughland.";
  }
  if (/Need .+ denarii; have /i.test(trimmed) || /Need .+ hiring gift/i.test(trimmed)) {
    return rewriteSnakeKeys(trimmed);
  }
  if (/Need .+ (timber|iron|stone)/i.test(trimmed)) return rewriteSnakeKeys(trimmed);

  let out = rewriteSnakeKeys(
    trimmed
      .replace(/\bREJECT\b/g, "")
      .replace(/\bnpc_not_authorized\b/g, "that is not theirs to order")
      .replace(/\bcustomCosts\b/g, "named costs")
      .replace(/\bproj-[a-z0-9]+/gi, "the work")
      .replace(/\bmod-[a-z0-9]+/gi, "the custom")
      .replace(/\bprop-[a-z0-9]+/gi, "the order")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
  if (ENGINE_KEY.test(out)) return "The books will not take that change.";
  return out || "The books will not take that change.";
}

export function playerFacingSummary(proposal: { type: string; summary?: string }): string {
  const raw = proposal.summary?.trim() ?? "";
  if (!raw || raw === proposal.type || looksLikeEngineKey(raw)) return "";
  if (SNAKE_KEY.test(raw) || ENGINE_KEY.test(raw)) return playerFacingReason(raw);
  return raw;
}

/** Success log lines shown in the books after Confirm. */
export function playerFacingLogLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "It is written in the books.";
  if (EXACT_REASONS[trimmed]) return EXACT_REASONS[trimmed];
  if (!ENGINE_KEY.test(trimmed) && !SNAKE_KEY.test(trimmed)) return trimmed;
  return playerFacingReason(trimmed);
}
