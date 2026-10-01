import type { MechanicalProposal, WorldState } from "./schema";
import { lookupProject } from "./projectCatalog";
import { labourDaysPhrase, labourRemaining } from "./labour";
import { theWork } from "./proposalPack";
import { round1 } from "./util";

export type ProjectStoreBill = {
  labourDays: number;
  lumber: number;
  iron: number;
  stone: number;
  charcoal: number;
  clay: number;
  denarii: number;
};

type StartProject = Extract<MechanicalProposal, { type: "start_project" }>;
type AssignLabour = Extract<MechanicalProposal, { type: "assign_labour" }>;

const EMPTY_BILL: ProjectStoreBill = {
  labourDays: 0,
  lumber: 0,
  iron: 0,
  stone: 0,
  charcoal: 0,
  clay: 0,
  denarii: 0,
};

/**
 * What Confirm will take to begin this work.
 * A known catalogue key keeps its charcoal (and scrub / charcoal-burning store rules).
 * A new design uses the costs named on the proposal, including charcoal and denarii.
 */
export function projectStoreBill(p: StartProject): ProjectStoreBill {
  const catalog = lookupProject(p.projectKey);
  const custom = p.customCosts;
  if (!catalog && !custom) return { ...EMPTY_BILL };
  const bill: ProjectStoreBill = {
    labourDays: custom?.labourDays ?? catalog?.labourDays ?? 0,
    lumber: custom?.lumber ?? catalog?.lumber ?? 0,
    iron: custom?.iron ?? catalog?.iron ?? 0,
    stone: custom?.stone ?? catalog?.stone ?? 0,
    charcoal: catalog ? (catalog.charcoal ?? 0) : (custom?.charcoal ?? 0),
    clay: catalog?.clay ?? 0,
    denarii: catalog ? 0 : (custom?.denarii ?? 0),
  };
  if (catalog?.key === "clear_scrub") {
    return { ...bill, lumber: 0, iron: 0, stone: 0, charcoal: 0, denarii: 0 };
  }
  if (catalog?.key === "charcoal_burning") {
    return { ...bill, iron: 0, stone: 0, charcoal: 0, denarii: 0 };
  }
  return bill;
}

export type BeginGap = {
  key: "lumber" | "iron" | "stone" | "charcoal" | "denarii" | "men" | "women" | "youths";
  need: number;
  have: number;
  still: number;
  stillPhrase: string;
  fullPhrase: string;
  /** Alternation of hall names, for matching speech. */
  names: string;
};

function amountWord(n: number): string {
  const rounded = round1(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function loads(n: number, what: string): string {
  const unit = n === 1 ? "cart-load" : "cart-loads";
  return `${amountWord(n)} ${unit} of ${what}`;
}

function ironPhrase(n: number): string {
  return `${amountWord(n)} lb of iron`;
}

function coinPhrase(n: number): string {
  return `${amountWord(n)} denarii`;
}

function fullPhraseFor(key: BeginGap["key"], need: number): string {
  if (key === "iron") return ironPhrase(need);
  if (key === "denarii") return coinPhrase(need);
  if (key === "charcoal") return loads(need, "charcoal");
  if (key === "stone") return loads(need, "stone");
  if (key === "lumber") return loads(need, "timber");
  return "";
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function shortOf(need: number, have: number): number {
  return round1(Math.max(0, need - have));
}

function materialGaps(state: WorldState, bill: ProjectStoreBill): BeginGap[] {
  const wood = state.resources.softwood + state.resources.hardwood;
  const rows: BeginGap[] = [];
  const push = (gap: BeginGap) => {
    if (gap.still > 0.001) rows.push(gap);
  };
  push({
    key: "lumber",
    need: bill.lumber,
    have: wood,
    still: shortOf(bill.lumber, wood),
    stillPhrase: loads(shortOf(bill.lumber, wood), "timber"),
    fullPhrase: loads(bill.lumber, "timber"),
    names: "timber|lumber|wood",
  });
  push({
    key: "iron",
    need: bill.iron,
    have: state.resources.iron,
    still: shortOf(bill.iron, state.resources.iron),
    stillPhrase: ironPhrase(shortOf(bill.iron, state.resources.iron)),
    fullPhrase: ironPhrase(bill.iron),
    names: "iron",
  });
  push({
    key: "stone",
    need: bill.stone,
    have: state.resources.stone,
    still: shortOf(bill.stone, state.resources.stone),
    stillPhrase: loads(shortOf(bill.stone, state.resources.stone), "stone"),
    fullPhrase: loads(bill.stone, "stone"),
    names: "stone",
  });
  push({
    key: "charcoal",
    need: bill.charcoal,
    have: state.resources.charcoal,
    still: shortOf(bill.charcoal, state.resources.charcoal),
    stillPhrase: loads(shortOf(bill.charcoal, state.resources.charcoal), "charcoal"),
    fullPhrase: loads(bill.charcoal, "charcoal"),
    names: "charcoal",
  });
  push({
    key: "denarii",
    need: bill.denarii,
    have: state.resources.denarii,
    still: shortOf(bill.denarii, state.resources.denarii),
    stillPhrase: coinPhrase(shortOf(bill.denarii, state.resources.denarii)),
    fullPhrase: coinPhrase(bill.denarii),
    names: "denarii|denarius",
  });
  return rows;
}

/** Hall line for the card: the full charge Confirm will take, not the gap. */
export function beginCostLine(bill: ProjectStoreBill): string {
  const stores: string[] = [];
  if (bill.lumber > 0) stores.push(loads(bill.lumber, "timber"));
  if (bill.iron > 0) stores.push(ironPhrase(bill.iron));
  if (bill.stone > 0) stores.push(loads(bill.stone, "stone"));
  if (bill.charcoal > 0) stores.push(loads(bill.charcoal, "charcoal"));
  const bits: string[] = [];
  if (stores.length) bits.push(`The books set aside ${joinPhrases(stores)}.`);
  if (bill.denarii > 0) bits.push(`${coinPhrase(bill.denarii)} leave the chest.`);
  if (bill.labourDays > 0) bits.push(`The work asks ${amountWord(bill.labourDays)} days of work.`);
  if (bill.clay > 0) bits.push("The clay is dug with the work.");
  return bits.join(" ");
}

export function stillNeededSentence(workName: string, gaps: BeginGap[]): string {
  if (!gaps.length) return "";
  return `Before ${theWork(workName)} can begin, we still need ${joinPhrases(gaps.map((g) => g.stillPhrase))}.`;
}

/** Stores the books will take that are not yet on hand. Clay is dug with the work and is not a store. */
export function beginStoreGaps(state: WorldState, p: StartProject): BeginGap[] {
  return materialGaps(state, projectStoreBill(p));
}

/**
 * One books line for every store still short.
 * The wording is the one Confirm already uses: the full charge, and what is on hand.
 */
export function beginStoreRefusal(state: WorldState, p: StartProject): string | null {
  const bill = projectStoreBill(p);
  const wood = state.resources.softwood + state.resources.hardwood;
  const parts: string[] = [];
  if (wood < bill.lumber) parts.push(`Need ${bill.lumber} cart-loads of timber; have ${round1(wood)}.`);
  if (state.resources.iron < bill.iron) parts.push(`Need ${bill.iron} lb iron; have ${state.resources.iron}.`);
  if (state.resources.stone < bill.stone) parts.push(`Need ${bill.stone} cart-loads of stone; have ${state.resources.stone}.`);
  if (state.resources.charcoal < bill.charcoal) {
    parts.push(`Need ${bill.charcoal} cart-loads of charcoal; have ${state.resources.charcoal}.`);
  }
  if (state.resources.denarii < bill.denarii) parts.push(`Need ${bill.denarii} denarii; have ${state.resources.denarii}.`);
  return parts.length ? parts.join(" ") : null;
}

const DELAY =
  /\b(more charcoal|more iron|more timber|more stone|more coin|more denarii|more hands|short of|not enough (?:charcoal|iron|timber|stone|coin|denarii|hands|labour|labor|days)|cannot begin|can't begin|before [\w\s']{0,32} can begin)\b/i;

/** The reply puts off a work for want of something, without yet naming a figure. */
export function speechDelaysWorkForShortage(speech: string): boolean {
  return DELAY.test(speech);
}

/** A question about what a work still wants, not a question about the rye pile. */
export function asksBeginAmount(playerText: string): boolean {
  if (!/\bhow (?:much|many)\b/i.test(playerText)) return false;
  return /\b(charcoal|iron|timber|stone|denarii|coin|labour|labor|days|hands|to begin|to start|the work|plough|plow|project)\b/i.test(
    playerText,
  );
}

const NUM_WORD =
  "a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred";

const NUM_TOKEN = `(?:\\d+(?:\\.\\d+)?|${NUM_WORD})`;

const WORD_TO_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

function parseNum(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return WORD_TO_NUM[t] ?? null;
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.051;
}

function projectOffers(proposals: MechanicalProposal[]): StartProject[] {
  const out: StartProject[] = [];
  for (const p of proposals) {
    if (p.type === "start_project") out.push(p);
    else if (p.type === "defer_proposal" && p.proposal?.type === "start_project") out.push(p.proposal);
  }
  return out;
}

function workNameOf(p: StartProject): string {
  return p.name?.trim() || lookupProject(p.projectKey)?.name || p.projectKey.replaceAll("_", " ");
}

function assignMatches(assign: AssignLabour, offer: StartProject): boolean {
  const ref = assign.projectId.trim().toLowerCase();
  const keys = [offer.id, offer.projectKey, offer.name, lookupProject(offer.projectKey)?.key, lookupProject(offer.projectKey)?.name]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().toLowerCase());
  return keys.some((k) => k === ref || k.replace(/ /g, "_") === ref.replace(/ /g, "_"));
}

function labourGap(state: WorldState, assigns: AssignLabour[]): BeginGap | null {
  if (!assigns.length) return null;
  const left = labourRemaining(state);
  const asked = { men: 0, women: 0, youths: 0 };
  for (const a of assigns) {
    asked.men += a.men;
    asked.women += a.women;
    asked.youths += a.youths;
  }
  const men = shortOf(asked.men, left.men);
  const women = shortOf(asked.women, left.women);
  const youths = shortOf(asked.youths, left.youths);
  if (men + women + youths <= 0.001) return null;
  const stillPhrase = labourDaysPhrase(men, women, youths);
  const fullPhrase = labourDaysPhrase(asked.men, asked.women, asked.youths);
  return {
    key: "men",
    need: asked.men + asked.women + asked.youths,
    have: left.men + left.women + left.youths,
    still: men + women + youths,
    stillPhrase,
    fullPhrase,
    names: "days of the men's work|days of the women's work|days of the youths' work|days of work",
  };
}

type Group = { workName: string; bill: ProjectStoreBill; gaps: BeginGap[] };

function groupsFor(state: WorldState, offers: StartProject[], proposals: MechanicalProposal[]): Group[] {
  const assigns = proposals.filter((p): p is AssignLabour => p.type === "assign_labour");
  const used = new Set<AssignLabour>();
  const groups: Group[] = offers.map((offer) => {
    const related = assigns.filter((a) => {
      if (!assignMatches(a, offer) || used.has(a)) return false;
      used.add(a);
      return true;
    });
    const bill = projectStoreBill(offer);
    const gaps = materialGaps(state, bill);
    const hands = labourGap(state, related);
    if (hands) gaps.push(hands);
    return { workName: workNameOf(offer), bill, gaps };
  });
  const leftover = assigns.filter((a) => !used.has(a));
  const hands = labourGap(state, leftover);
  if (hands) groups.push({ workName: "that work", bill: { ...EMPTY_BILL }, gaps: [hands] });
  return groups;
}

const TRACKED: { key: BeginGap["key"]; names: string; bares: string[] }[] = [
  { key: "charcoal", names: "charcoal", bares: ["charcoal"] },
  { key: "iron", names: "iron", bares: ["iron"] },
  { key: "lumber", names: "timber|lumber|wood", bares: ["timber", "lumber", "wood"] },
  { key: "stone", names: "stone", bares: ["stone"] },
  { key: "denarii", names: "denarii|denarius", bares: ["denarii", "coin"] },
];

function quantityPattern(names: string): RegExp {
  return new RegExp(`\\b(${NUM_TOKEN})\\s+(?:cart-loads?|loads?|lb|lbs|pounds?)\\s+of\\s+(?:${names})\\b`, "gi");
}

function coinPattern(): RegExp {
  return new RegExp(`\\b(${NUM_TOKEN})\\s+denarii\\b`, "gi");
}

function phraseCovers(speech: string, gap: BeginGap): boolean {
  return speech.toLowerCase().includes(gap.stillPhrase.toLowerCase());
}

function stripBareShortage(speech: string, bare: string): string {
  let s = speech;
  const patterns = [
    new RegExp(`\\bmore\\s+${bare}\\b`, "gi"),
    new RegExp(`\\bshort(?:age)?\\s+of\\s+${bare}\\b`, "gi"),
    new RegExp(`\\bnot enough\\s+${bare}\\b`, "gi"),
    new RegExp(`\\b${bare}\\s+(?:is|are)\\s+short\\b`, "gi"),
    new RegExp(`\\bneed(?:s|ed)?\\s+more\\s+${bare}\\b`, "gi"),
    new RegExp(`\\b(?:and|or)\\s+${bare}\\b`, "gi"),
  ];
  for (const re of patterns) s = s.replace(re, "");
  return s;
}

function alignQuantities(speech: string, groups: Group[]): string {
  const gaps = groups.flatMap((g) => g.gaps);
  let s = speech;
  for (const tracked of TRACKED) {
    const gap = gaps.find((g) => g.key === tracked.key);
    const fullNeeds = groups
      .map((g) => {
        if (tracked.key === "lumber") return g.bill.lumber;
        if (tracked.key === "iron") return g.bill.iron;
        if (tracked.key === "stone") return g.bill.stone;
        if (tracked.key === "charcoal") return g.bill.charcoal;
        if (tracked.key === "denarii") return g.bill.denarii;
        return 0;
      })
      .filter((n) => n > 0);
    if (tracked.key === "denarii" && !gap && fullNeeds.length === 0) continue;
    const re = tracked.key === "denarii" ? coinPattern() : quantityPattern(tracked.names);
    s = s.replace(re, (full, numTok: string) => {
      const n = parseNum(numTok);
      if (n == null) return full;
      if (gap && (approx(n, gap.still) || approx(n, gap.need))) return full;
      if (!gap && fullNeeds.some((need) => approx(n, need))) return full;
      if (gap) return gap.stillPhrase;
      if (fullNeeds.length) return fullPhraseFor(tracked.key, fullNeeds[0]);
      return "";
    });
    if (!gap) {
      for (const bare of tracked.bares) s = stripBareShortage(s, bare);
    }
  }
  const loadGaps = gaps.filter((g) => g.key === "charcoal" || g.key === "lumber" || g.key === "stone");
  if (loadGaps.length === 1) {
    const only = loadGaps[0];
    const bareLoads = new RegExp(`\\b(${NUM_TOKEN})\\s+(?:cart-loads?|loads?)\\b(?!\\s+of\\b)`, "gi");
    s = s.replace(bareLoads, (full, numTok: string) => {
      const n = parseNum(numTok);
      if (n != null && (approx(n, only.still) || approx(n, only.need))) return full;
      return only.stillPhrase;
    });
  }
  const ironGap = gaps.find((g) => g.key === "iron");
  if (ironGap) {
    const barePounds = new RegExp(`\\b(${NUM_TOKEN})\\s+(?:lb|lbs|pounds?)\\b(?!\\s+of\\b)`, "gi");
    s = s.replace(barePounds, (full, numTok: string) => {
      const n = parseNum(numTok);
      if (n != null && (approx(n, ironGap.still) || approx(n, ironGap.need))) return full;
      return ironGap.stillPhrase;
    });
  }
  const labourDays = groups.map((g) => g.bill.labourDays).find((n) => n > 0);
  if (labourDays) {
    const daysRe = new RegExp(`\\b(${NUM_TOKEN})\\s+days of work\\b`, "gi");
    s = s.replace(daysRe, (full, numTok: string) => {
      const n = parseNum(numTok);
      if (n != null && approx(n, labourDays)) return full;
      return `${amountWord(labourDays)} days of work`;
    });
  }
  return s;
}

function tidy(speech: string): string {
  return speech
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/,\s*,+/g, ",")
    .replace(/\b(?:and|or)\s+(?:and|or)\b/gi, "and")
    .replace(/\b(?:need|needs|needed)\s+more\s*(?=[.,]|$)/gi, "")
    .replace(/\bmore\s*(?=[.,]|$)/gi, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

/**
 * Make a refusal or delay name each short thing and the amount still wanted.
 * Figures are the begin-cost the books will take, minus what is already on hand.
 * A thing the estate already holds is not called short. A spoken "twenty loads"
 * that the card will not take is rewritten to the book figure.
 */
export function withBeginShortfalls(
  speech: string,
  state: WorldState,
  proposals: MechanicalProposal[],
  opts?: { pending?: MechanicalProposal[]; playerText?: string },
): string {
  const fresh = projectOffers(proposals);
  const pending = projectOffers(opts?.pending ?? []);
  const asking = speechDelaysWorkForShortage(speech) || asksBeginAmount(opts?.playerText ?? "");
  const offers = fresh.length ? fresh : asking ? pending : [];
  const proposalPool = fresh.length ? proposals : asking ? [...proposals, ...pending] : proposals;
  if (!offers.length && !proposalPool.some((p) => p.type === "assign_labour")) return speech;

  const groups = groupsFor(state, offers, proposalPool);
  if (!groups.length) return speech;

  let out = alignQuantities(speech, groups);
  const gaps = groups.flatMap((g) => g.gaps);
  if (gaps.length) {
    out = out.replace(/\b(?:i |we )?(?:cannot|can't|can not)\s+(?:give|name|say)\s+(?:you\s+)?a figure\b[^.?!]*/gi, "");
  }
  if (gaps.length) {
    const missing = groups.filter((g) => g.gaps.some((gap) => !phraseCovers(out, gap)));
    if (missing.length) {
      const sentences = missing
        .map((g) => stillNeededSentence(g.workName, g.gaps.filter((gap) => !phraseCovers(out, gap))))
        .filter(Boolean);
      out = `${out} ${sentences.join(" ")}`.trim();
    }
  } else if (asking && offers.length) {
    const costs = offers
      .map((offer) => {
        const line = beginCostLine(projectStoreBill(offer));
        return line ? `${theWork(workNameOf(offer))} can begin. ${line}` : "";
      })
      .filter(Boolean);
    if (costs.length && !/\bthe books set aside\b/i.test(out)) {
      out = `${out} The stores already hold what is asked. ${costs.join(" ")}`.trim();
    }
  }
  return tidy(out);
}
