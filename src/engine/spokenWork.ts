import type { MechanicalProposal } from "./schema";
import { oneSmithSeasonDays } from "./smithing";

const SMALL: Record<string, number> = {
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
};

const COUNT =
  "(?:\\d+(?:\\.\\d+)?|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?)";

/** The lord agreed in talk. That is not the button that writes the books. */
export function looksLikeSpokenAgree(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!t || t.length > 80) return false;
  if (/^(how|what|why|who|where|when|tell me)\b/.test(t)) return false;
  // "Yes" to hearing a case is not "yes" to a price spoken seasons ago.
  if (/^(yes|aye)\b/.test(t)) {
    const rest = t.replace(/^(yes|aye)\b/, "").replace(/^[,.\s]+/, "").trim();
    if (!rest) return true;
    return /^(do it|do so|please|my lord|confirm|that|so)\b/.test(rest);
  }
  if (
    /^(agreed|agree|approved|approve|do it|do so|make them|make it so|go ahead|proceed|so ordered|very well|that will do|please do|let us do it|let's do it)\b/.test(
      t,
    )
  ) {
    return true;
  }
  // "Send me the projects to approve", "put it in the books", "write it down", "draw up the cards".
  if (
    /\b(send|give|bring|show)\s+(me\s+)?(the\s+)?(projects?|proposals?|cards?|plans?)\b/.test(t) ||
    /\b(put|set)\s+(it|that|them|this|the plan|the work)\s+(down\s+)?(in|into|on)\s+the\s+books\b/.test(t) ||
    /\b(write|set)\s+(it|that|them|this)\s+down\b/.test(t) ||
    /\bdraw\s+(it|that|them|this|up)\b.*\b(cards?|books?|proposals?)\b/.test(t) ||
    /\bdraw\s+up\s+(the\s+)?(cards?|proposals?|plans?)\b/.test(t)
  ) {
    return true;
  }
  const word = (t.split(/\s+/)[0] ?? "").replace(/[^a-z]/g, "");
  if (!word) return false;
  if (word === "confirm" || word === "confirmed" || word === "conform" || word === "conformed") return true;
  return word.length >= 6 && word.length <= 12 && editDistance(word, "confirm") <= 2;
}

/** Speech that says the stores already moved or the work already started. */
export function claimsBooksWrote(speech: string): boolean {
  return /\b(have|has|had|i've|we've)\s+begun\b|\b(is|was)\s+begun\b|\bi began\b|\b(have|has)\s+started\b|\b(have|has|had)\s+set aside\b|\b(is|are|was|were)\s+set aside\b/i.test(
    speech,
  );
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j - 1], row[j]) + 1;
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function parseCount(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/-/g, " ");
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return SMALL[parts[0]] ?? null;
  if (parts.length === 2) {
    const tens = SMALL[parts[0]];
    const ones = SMALL[parts[1]];
    if (tens != null && tens >= 20 && ones != null && ones < 10) return tens + ones;
  }
  return null;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isRemainder(sentence: string): boolean {
  if (/\b(want|wants|take|takes|need|needs|cost|costs|set aside|for the)\b/i.test(sentence)) return false;
  return /\b(left|remain(?:s|ing)?|leaves|leaving|spare|we hold|stores hold|in the stores|enough)\b/i.test(sentence);
}

function firstCount(sentence: string, pattern: RegExp): number | null {
  pattern.lastIndex = 0;
  const match = pattern.exec(sentence);
  if (!match) return null;
  const n = parseCount(match[1] ?? "");
  return n != null && n > 0 ? n : null;
}

function amountWord(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function joinBits(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export type SpokenStoreFigures = {
  iron?: number;
  lumber?: number;
  stone?: number;
  charcoal?: number;
};

/** A figure the lord is holding the hall to: "40 lb of iron", "20 cart-loads of stone". */
export function spokenStoreFigures(text: string): SpokenStoreFigures | null {
  const figures: SpokenStoreFigures = {};
  const iron = text.match(new RegExp(`\\b(${COUNT})\\s+(?:lb|lbs|pounds?)\\s+of\\s+iron\\b`, "i"));
  const ironN = iron ? parseCount(iron[1] ?? "") : null;
  if (ironN) figures.iron = ironN;
  const loadRe = new RegExp(`\\b(${COUNT})\\s+cart-loads?\\s+of\\s+(charcoal|timber|wood|lumber|stone)\\b`, "gi");
  let load: RegExpExecArray | null;
  while ((load = loadRe.exec(text))) {
    const n = parseCount(load[1] ?? "");
    const kind = (load[2] ?? "").toLowerCase();
    if (n == null || n <= 0) continue;
    if (kind === "charcoal" && figures.charcoal == null) figures.charcoal = n;
    if ((kind === "timber" || kind === "wood" || kind === "lumber") && figures.lumber == null) figures.lumber = n;
    if (kind === "stone" && figures.stone == null) figures.stone = n;
  }
  return figures.iron != null || figures.lumber != null || figures.stone != null || figures.charcoal != null ? figures : null;
}

export type PricedWork = Extract<MechanicalProposal, { type: "start_project" }>;

/**
 * A price already spoken: iron, charcoal, and the sets the work gives back.
 * Remainder talk ("1 lb left") is not a cost. Wooden work named for afterward is not a cost.
 */
export function pricedWorkFromTalk(text: string, holdingId: string): PricedWork | null {
  let iron = 0;
  let charcoal = 0;
  let lumber = 0;
  let stone = 0;
  const ironRe = new RegExp(`\\b(${COUNT})\\s+(?:lb|lbs|pounds?)\\s+of\\s+iron\\b`, "i");
  const loadRe = new RegExp(`\\b(${COUNT})\\s+cart-loads?\\s+of\\s+(charcoal|timber|wood|lumber|stone)\\b`, "i");
  for (const sentence of sentences(text)) {
    if (isRemainder(sentence)) continue;
    if (!iron) {
      const n = firstCount(sentence, ironRe);
      if (n) iron = n;
    }
    loadRe.lastIndex = 0;
    let loadMatch: RegExpExecArray | null;
    const globalLoad = new RegExp(loadRe.source, "gi");
    while ((loadMatch = globalLoad.exec(sentence))) {
      const n = parseCount(loadMatch[1] ?? "");
      const kind = (loadMatch[2] ?? "").toLowerCase();
      if (n == null || n <= 0) continue;
      if (kind === "charcoal" && !charcoal) charcoal = n;
      if ((kind === "timber" || kind === "wood" || kind === "lumber") && !lumber && !/\b(afterward|afterwards|later)\b/i.test(sentence)) {
        lumber = n;
      }
      if (kind === "stone" && !stone) stone = n;
    }
  }
  if (iron <= 0 && charcoal <= 0 && lumber <= 0 && stone <= 0) return null;

  const thisSeason = /\b(season's turn|when the season turns|this season|by the turn of the season)\b/i.test(text);
  const dayMatch = text.match(new RegExp(`\\b(${COUNT})\\s+days\\b`, "i"));
  const namedDays = dayMatch ? parseCount(dayMatch[1] ?? "") : null;
  const forgeDays = namedDays && namedDays > 0 ? namedDays : oneSmithSeasonDays();

  let sets = 0;
  if (/\bboth\s+(?:the\s+)?(?:ironwork\s+)?sets\b/i.test(text)) sets = 2;
  else {
    const named = text.match(new RegExp(`\\b(${COUNT})\\s+(?:ironwork\\s+)?sets\\b`, "i"));
    const n = named ? parseCount(named[1] ?? "") : null;
    if (n && n > 0) sets = n;
  }

  const plough = /\bploughs?\b|\bplows?\b|\bcoulters?\b/i.test(text);
  const name = plough ? "Plough ironwork" : "Ironwork";
  return {
    type: "start_project",
    summary: sets > 1 ? `${amountWord(sets)} sets of ${name.toLowerCase()}.` : name,
    projectKey: plough ? "plough_ironwork" : "forge_ironwork",
    name,
    holdingId,
    tag: "forge",
    customCosts: { labourDays: 0, forgeDays, lumber, iron, stone, charcoal },
    ...(sets > 0 ? { result: [{ resource: "ironwork_sets", amount: sets, name: "ironwork sets" }] } : {}),
    ...(thisSeason ? { finishesThisSeason: true } : {}),
  };
}

/** Hall line for an agreement that has not been written yet. */
export function unconfirmedWorkSpeech(priced: PricedWork | null): string {
  if (!priced?.customCosts) {
    return "The books are unchanged. The work is not begun, and the stores stay as they are until you press Confirm.";
  }
  const parts: string[] = [];
  if (priced.customCosts.iron > 0) parts.push(`${amountWord(priced.customCosts.iron)} lb of iron`);
  if ((priced.customCosts.charcoal ?? 0) > 0) {
    const n = priced.customCosts.charcoal ?? 0;
    parts.push(`${amountWord(n)} cart-load${n === 1 ? "" : "s"} of charcoal`);
  }
  if (priced.customCosts.lumber > 0) {
    parts.push(`${amountWord(priced.customCosts.lumber)} cart-load${priced.customCosts.lumber === 1 ? "" : "s"} of timber`);
  }
  if (priced.customCosts.stone > 0) {
    parts.push(`${amountWord(priced.customCosts.stone)} cart-load${priced.customCosts.stone === 1 ? "" : "s"} of stone`);
  }
  const charge = parts.length ? ` Press Confirm, and the books will set aside ${joinBits(parts)}.` : "";
  const ready = priced.finishesThisSeason ? " Both sets can be ready when the season turns." : "";
  return `Nothing has left the stores, and the work is not begun.${charge}${ready}`;
}

export function samePricedOffer(proposal: MechanicalProposal, priced: PricedWork): boolean {
  if (proposal.type !== "start_project" || !proposal.customCosts || !priced.customCosts) return false;
  return (
    proposal.customCosts.iron === priced.customCosts.iron &&
    (proposal.customCosts.charcoal ?? 0) === (priced.customCosts.charcoal ?? 0) &&
    proposal.customCosts.lumber === priced.customCosts.lumber
  );
}
