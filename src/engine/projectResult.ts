import { isMancipia, mancipiaCount, setMancipia } from "./mancipia";
import {
  CANONICAL_RESOURCES,
  type CanonicalResource,
  type ProjectResultEntry,
  type WorldState,
} from "./schema";
import { round1 } from "./util";

/**
 * The chronicler names what a finished work pays. The books pay that and nothing else.
 * There is no yield table: charcoal, steel, gunpowder, and any other good are the same field.
 */
export const PROJECT_RESULT_RULE = `When you set a work on the books — a catalogue work or a new one with no catalogue entry — reason it yourself. Name what it consumes, what the stores gain once when the days are done, and how many days it takes. Use the units the books already use: cart-loads, pounds, denarii, days of work. There is no yield table for charcoal, steel, gunpowder, or anything else. You judge an honest cost, an honest day count, and an honest one-time result from what the work is. A mound of charcoal is wood burned with little air, measured in cart-loads; you judge how much of that volume the burn keeps. Steel, gunpowder, coppicing, and any other work the lord invents are the same kind of judgment. Put the cost and the days on the proposal (catalogue costs stay as the books already charge; a new design uses customCosts with labourDays, lumber, iron, stone, and charcoal or denarii when you judged them). Put the one-time gain in result: a list of { resource, amount } for a store the books already track, or { resource, amount, name, unit } when the good is new. You may also write result as an object of resource to amount. Confirm takes the costs when the work begins, from what is already in store, and pays result only when the work is finished. Cancelling pays nothing. If both the getting and the using fit in this season, name them in that order in the same proposal pack, with the result on the first and the cost on the second. Confirm then has those goods in the stores before the later work pays its cost. If either the getting or the using runs past this season, do not spend the yield early: the later work waits, and you must not treat goods that are not yet in the barn as if they were already there. Set finishesThisSeason true when you judge the work finishes inside this season, or false when you judge it runs past the season. If you omit it, the books judge from the days against one season of spare labour. A work that does not finish this season does not feed a later cost in that pack. If the lord agrees in speech — confirm, or a word they meant for it — that does not write the books. Do not say the work has begun, and do not say goods were set aside. Put the cost, the days, and the yield you already named on the proposal, and say that Confirm is what writes them. Do not promise a yield you did not put on result. If you name no result, the books add nothing when the work finishes. A catalogue building or a land change still happens; do not put that change in result, and do not replace it with goods. Clearing scrub makes farmland and spends no timber. Name brush or timber on result only when you have reasoned a real amount the books can pay. Do not turn an acre of scrub into timber on your own. Coppicing is not a catalogue work: name the days and any real cost, and the timber it gives back on result. Do not spend timber unless you named timber as a cost. Saws, shovels, and a temporary mound are tools the estate already has, not a new building. In the words the lord hears, do not say result, customCosts, reward, finishesThisSeason, catalogue, proposal, or JSON.`;

const TIMBER_IDS = new Set(["timber", "lumber", "wood", "softwood"]);

export type ResultSpeechTarget = {
  /** Alternation of hall names, already escaped for a regular expression. */
  names: string;
  amount: number;
  phrase: string;
  /** Set when this good is also a begin-cost, so a matching cost figure is left alone. */
  costKey?: "lumber" | "iron" | "stone" | "charcoal" | "denarii";
};

function isCanonical(resource: string): resource is CanonicalResource {
  return (CANONICAL_RESOURCES as readonly string[]).includes(resource);
}

function slug(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function amountWord(n: number): string {
  const rounded = round1(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function loads(n: number, what: string): string {
  const unit = n === 1 ? "cart-load" : "cart-loads";
  return `${amountWord(n)} ${unit} of ${what}`;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** The figure Confirm will keep: known stores by their book id, new goods by the name given. */
export function proposalResult(p: { result?: ProjectResultEntry[] | null }): ProjectResultEntry[] {
  const merged = new Map<string, ProjectResultEntry>();
  for (const row of p.result ?? []) {
    const amount = round1(Number(row.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const raw = slug(row.resource ?? "");
    if (!raw) continue;
    const resource = TIMBER_IDS.has(raw) ? "softwood" : raw;
    const name = row.name?.trim() || undefined;
    const unit = row.unit?.trim() || undefined;
    const prev = merged.get(resource);
    if (prev) {
      prev.amount = round1(prev.amount + amount);
      if (!prev.name && name) prev.name = name;
      if (!prev.unit && unit) prev.unit = unit;
    } else {
      merged.set(resource, {
        resource,
        amount,
        ...(name ? { name } : {}),
        ...(unit ? { unit } : {}),
      });
    }
  }
  return [...merged.values()];
}

function hallUnit(unit: string, n: number): string {
  const u = unit.toLowerCase();
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return n === 1 ? "pound" : "pounds";
  if (u === "cart-load" || u === "cart-loads" || u === "load" || u === "loads") {
    return n === 1 ? "cart-load" : "cart-loads";
  }
  if (n === 1 && u.endsWith("s") && !u.endsWith("ss")) return u.slice(0, -1);
  return unit;
}

/** Hall line for one named gain. Known stores use the unit the books already keep. */
export function resultPhrase(entry: ProjectResultEntry): string {
  const n = entry.amount;
  if (entry.resource === "softwood") return loads(n, "timber");
  if (entry.resource === "hardwood") return loads(n, "hardwood");
  if (entry.resource === "charcoal") return loads(n, "charcoal");
  if (entry.resource === "stone") return loads(n, "stone");
  if (entry.resource === "iron") return `${amountWord(n)} lb of iron`;
  if (entry.resource === "denarii") return `${amountWord(n)} denarii`;
  if (isMancipia(entry.resource)) {
    const word = n === 1 ? "soul" : "souls";
    return `${amountWord(n)} ${word} of the unfree`;
  }
  const name = entry.name?.trim() || entry.resource.replaceAll("_", " ");
  if (isCanonical(entry.resource)) {
    const unit = hallUnit(entry.unit || canonicalUnit(entry.resource), n);
    if (!unit) return `${amountWord(n)} ${name}`;
    if (entry.resource === "denarii") return `${amountWord(n)} denarii`;
    return `${amountWord(n)} ${unit} of ${name}`;
  }
  const unit = entry.unit?.trim() ? hallUnit(entry.unit, n) : "";
  if (!unit) return `${amountWord(n)} ${name}`;
  return `${amountWord(n)} ${unit} of ${name}`;
}

function canonicalUnit(resource: CanonicalResource): string {
  if (resource === "denarii") return "denarii";
  if (resource === "iron" || resource === "copper" || resource === "tin" || resource === "salt") return "pounds";
  if (resource === "wool" || resource === "linen" || resource === "cheese" || resource === "honey" || resource === "beeswax") {
    return "pounds";
  }
  if (resource === "softwood" || resource === "hardwood" || resource === "charcoal" || resource === "stone") return "cart-loads";
  if (resource === "wine") return "barrels";
  if (resource === "bees") return "hives";
  if (resource === "wheat" || resource === "rye" || resource === "barley" || resource === "oats") return "modii";
  if (resource === "hides") return "pieces";
  if (resource === "trade_goods") return "lots";
  return "head";
}

export function resultPayLine(entries: ProjectResultEntry[]): string {
  if (!entries.length) return "";
  return `When the work is finished, the stores gain ${joinPhrases(entries.map(resultPhrase))}.`;
}

function costKeyFor(resource: string): ResultSpeechTarget["costKey"] {
  if (resource === "softwood") return "lumber";
  if (resource === "iron" || resource === "stone" || resource === "charcoal" || resource === "denarii") return resource;
  return undefined;
}

function speechNames(entry: ProjectResultEntry): string[] {
  const names = new Set<string>();
  const add = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) names.add(trimmed);
  };
  if (entry.resource === "softwood") {
    add("timber");
    add("lumber");
    add("wood");
    add("softwood");
  } else {
    add(entry.resource.replaceAll("_", " "));
    add(entry.name);
  }
  return [...names];
}

export function resultSpeechTargets(entries: ProjectResultEntry[]): ResultSpeechTarget[] {
  return entries.map((entry) => ({
    names: speechNames(entry).map(escapeRe).join("|"),
    amount: entry.amount,
    phrase: resultPhrase(entry),
    costKey: costKeyFor(entry.resource),
  }));
}

function addToStores(state: WorldState, entry: ProjectResultEntry): void {
  const amount = round1(entry.amount);
  if (amount <= 0) return;
  if (isCanonical(entry.resource)) {
    state.resources[entry.resource] = round1(state.resources[entry.resource] + amount);
    return;
  }
  if (isMancipia(entry.resource)) {
    setMancipia(state, mancipiaCount(state) + amount);
    return;
  }
  let custom = state.custom_resources.find((c) => c.id === entry.resource);
  if (!custom) {
    custom = {
      id: entry.resource,
      name: entry.name?.trim() || entry.resource.replaceAll("_", " "),
      unit: entry.unit?.trim() || "units",
      amount: 0,
      priceMin: 0,
      priceMax: 0,
    };
    state.custom_resources.push(custom);
  }
  custom.amount = round1(custom.amount + amount);
}

function takeFromStores(state: WorldState, entry: ProjectResultEntry): void {
  const amount = round1(entry.amount);
  if (amount <= 0) return;
  if (isCanonical(entry.resource)) {
    state.resources[entry.resource] = round1(Math.max(0, state.resources[entry.resource] - amount));
    return;
  }
  if (isMancipia(entry.resource)) {
    setMancipia(state, Math.max(0, mancipiaCount(state) - amount));
    return;
  }
  const custom = state.custom_resources.find((c) => c.id === entry.resource);
  if (!custom) return;
  custom.amount = round1(Math.max(0, custom.amount - amount));
  if (custom.amount <= 0) state.custom_resources = state.custom_resources.filter((c) => c !== custom);
}

type PayableProject = { result?: ProjectResultEntry[] | null; resultPaid?: boolean };

/**
 * Pay the one-time result named on this work. Call when it is marked finished,
 * or when a same-season Confirm pack spends that yield before the season turns.
 * A missing result adds nothing. A result already paid is not paid again.
 */
export function payFinishedProjectResult(state: WorldState, project: PayableProject): string | null {
  if (project.resultPaid) return null;
  const entries = proposalResult(project);
  if (!entries.length) return null;
  for (const entry of entries) addToStores(state, entry);
  project.resultPaid = true;
  return `The stores gain ${joinPhrases(entries.map(resultPhrase))}.`;
}

/** Take back a result that was paid early, when the later work in the pack did not begin. */
export function undoPaidProjectResult(state: WorldState, project: PayableProject): void {
  if (!project.resultPaid) return;
  for (const entry of proposalResult(project)) takeFromStores(state, entry);
  project.resultPaid = false;
}
