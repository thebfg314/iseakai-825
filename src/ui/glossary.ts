import glossaryData from "../../data/glossary.json";

/**
 * Glossary matching (documented rules):
 *
 * Longest alias first, case-insensitive, word-boundary.
 * Omit list (fulling mill, trip-hammer, forge mill, mill-forge, and spaced variants)
 * is never linked — players discover those ideas themselves.
 *
 * cell — prefer "cell of", "the/a/small/monastic cell", Saint-Martin, chapel/abbey
 *   company. Skip prison/jail/phone senses.
 * hunt — Gerulf/negotiator sense: "a/the/that hunt", mid-hunt, hunt for, hunt UI
 *   context, or Gerulf/purse/road nearby. Skip deer/boar/stag wildlife hunts.
 * hall — prefer "the hall", timber/manor/stone hall. Bare "hall" only with manor
 *   company. Skip hallway / town / concert hall.
 * waste / scrub — land labels ("overgrown …") and holding/acre company. Skip
 *   garbage and "don't waste".
 * leat — always "mill leat"; bare "leat" when mill/millrace/wheel/water is near.
 * Frank — word-boundary only (not frankly / frankincense).
 * hides — default skins/stores sense; skip land-measure "hide of land".
 * prior — "prior of" and monastic company; skip "prior season/year/to".
 * host — the called-out army ("the host", muster/march company). Skip "host a feast".
 * march — the Spanish or Breton frontier. Skip the month ("in March").
 * Boso / Odo — the king and the counts. Skip the wine-merchant and the toll-merchant.
 */
export type GlossaryRule =
  | "default"
  | "monastic_cell"
  | "monastic_prior"
  | "hunt_gerulf"
  | "manor_hall"
  | "land_waste"
  | "land_scrub"
  | "mill_leat"
  | "frank"
  | "hides_skins"
  | "army_host"
  | "frontier_march"
  | "historical_boso"
  | "historical_odo";

export type GlossaryEntry = {
  id: string;
  title: string;
  aliases: string[];
  rule: GlossaryRule;
  definition: string;
};

export type GlossaryScanContext = {
  /** Hunt proposal / labour / Gerulf UI: allow standalone "hunt". */
  hunt?: boolean;
  /** Land ledger labels: allow bare waste/scrub. */
  land?: boolean;
};

export type GlossaryHit = {
  id: string;
  title: string;
  start: number;
  end: number;
  matched: string;
};

type GlossaryFile = {
  omit: string[];
  entries: GlossaryEntry[];
};

const DATA = glossaryData as GlossaryFile;

export const GLOSSARY_OMIT = DATA.omit;
export const GLOSSARY_ENTRIES: GlossaryEntry[] = DATA.entries;

const BY_ID = new Map(GLOSSARY_ENTRIES.map((e) => [e.id, e]));

export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return BY_ID.get(id);
}

export function glossaryDefinitionParagraphs(definition: string): string[] {
  return definition
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

type Pattern = {
  id: string;
  title: string;
  rule: GlossaryRule;
  alias: string;
  re: RegExp;
  /** The same alias with the global flag, for the one-pass candidate scan. */
  global: RegExp;
  length: number;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string): string {
  const parts = alias.trim().split(/\s+/).map((part) => {
    const escaped = escapeRe(part).replace(/'/g, "['’]");
    return escaped;
  });
  return parts.join("\\s+");
}

const PATTERNS: Pattern[] = GLOSSARY_ENTRIES.flatMap((entry) =>
  entry.aliases.map((alias) => ({
    id: entry.id,
    title: entry.title,
    rule: entry.rule,
    alias,
    re: new RegExp(`\\b${aliasPattern(alias)}\\b`, "i"),
    global: new RegExp(`\\b${aliasPattern(alias)}\\b`, "ig"),
    length: alias.length,
  })),
).sort((a, b) => b.length - a.length || a.alias.localeCompare(b.alias));

const OMIT_RES = GLOSSARY_OMIT.map((phrase) => ({
  phrase,
  re: new RegExp(aliasPattern(phrase), "ig"),
}));

export function omitRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const { re } of OMIT_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      ranges.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return ranges;
}

function overlaps(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => start < b && end > a);
}

function windowOf(text: string, start: number, end: number, pad = 44): string {
  return text.slice(Math.max(0, start - pad), Math.min(text.length, end + pad));
}

function beforeOf(text: string, start: number, n = 36): string {
  return text.slice(Math.max(0, start - n), start);
}

function afterOf(text: string, end: number, n = 36): string {
  return text.slice(end, end + n);
}

function ruleAllows(
  rule: GlossaryRule,
  text: string,
  start: number,
  end: number,
  ctx?: GlossaryScanContext,
): boolean {
  const matched = text.slice(start, end);
  const before = beforeOf(text, start);
  const after = afterOf(text, end);
  const around = windowOf(text, start, end).toLowerCase();

  switch (rule) {
    case "default":
      return true;
    case "frank":
      // Word-boundary aliases already exclude frankly / frankincense.
      return true;
    case "monastic_cell": {
      if (/cell of|monastic|saint[-\s]?martin/i.test(matched)) return true;
      if (/\b(prison|jail|dungeon|phone|spreadsheet)\b/.test(around) && !/\b(monk|nuns?|abbey|chapel|oratory|prior|saint|monastery|chaplain|ermenald)\b/.test(around)) {
        return false;
      }
      if (/\b(the|a|an|small|monastic|saint[-\s]?martin['’]?s)\s+$/i.test(before)) return true;
      if (/^\s+of\b/i.test(after)) return true;
      return /\b(monk|nuns?|abbey|chapel|oratory|prior|saint|monastery|chaplain|ermenald|fontenay)\b/.test(around);
    }
    case "monastic_prior": {
      if (/^\s+of\b/i.test(after) || /\bprior of\b/i.test(matched + after)) return true;
      if (/\bprior (season|year|to|art)\b/i.test(around) || /\ba priori\b/.test(around)) return false;
      return /\b(cell|saint[-\s]?martin|monk|chaplain|ermenald|abbey|monastery|oratory)\b/.test(around);
    }
    case "hunt_gerulf": {
      if (ctx?.hunt) return true;
      if (/^(a|the|that)\s+hunt$/i.test(matched) || /mid-?\s?hunt/i.test(matched) || /^hunt for$/i.test(matched)) {
        return true;
      }
      if (/\b(deer|boar|stag|wolf|wolves|fox|hare|hart|venison)\b/.test(around)) return false;
      return /\b(gerulf|negotiator|purse|brief|quoted|on the road)\b/.test(around);
    }
    case "manor_hall": {
      if (/the hall|timber hall|manor hall|stone hall/i.test(matched)) return true;
      if (/^halls$/i.test(matched)) return true;
      if (/\b(hallway|concert hall|town hall|city hall|music hall)\b/.test(around)) return false;
      if (/\b(the|timber|manor|stone|estate|fontenay)\s+$/i.test(before)) return true;
      return /\b(waited|authority|custom|books|household|fontenay|villa)\b/.test(around);
    }
    case "land_waste": {
      if (/overgrown/i.test(matched) || ctx?.land) return true;
      if (/\b(garbage|rubbish|trash|waste time|waste money|don't waste|do not waste|wasted)\b/.test(around)) {
        return false;
      }
      return /\b(acre|acres|land|holding|meadow|plough|woodland|swamp|scrub|overgrown|tillage|arable|improve)\b/.test(around);
    }
    case "land_scrub": {
      if (/overgrown/i.test(matched) || ctx?.land) return true;
      if (/\b(scrub the|scrubbed|scrubs)\b/.test(around)) return false;
      return /\b(acre|acres|land|holding|arable|clear|woodland|waste|overgrown|tillage|plough)\b/.test(around);
    }
    case "mill_leat": {
      if (/mill/i.test(matched)) return true;
      return /\b(mill|millrace|wheel|water|canal|race)\b/.test(around);
    }
    case "hides_skins": {
      if (/\bhide of land\b|\bhides of land\b|\bhideage\b/.test(around)) return false;
      if (/^hide$/i.test(matched) && /\b(hide from|hide the|hide in)\b/i.test(around)) return false;
      if (/^hides$/i.test(matched)) return true;
      return /\b(skin|skins|leather|tannery|stores|ox|cattle|pelt)\b/.test(around);
    }
    case "army_host": {
      if (/\b(play host|host a|host the|hosts a|hosts the|hosted|hospitality|hostess)\b/i.test(around)) return false;
      if (/^(the|this|that|his|her|a|an|our|their|royal)\s+host$/i.test(matched)) return true;
      if (/\b(the|this|that|his|her|our|their|royal|emperor's|king's)\s+$/i.test(before)) return true;
      return /\b(muster|marched|march|army|campaign|dissolv|horse|armed|contingent)\b/i.test(around);
    }
    case "frontier_march": {
      if (/spanish|breton/i.test(matched)) return true;
      if (/\b(in|last|next|early|late|mid|this)\s+$/i.test(before)) return false;
      if (/\b(rain|rains|mud|sowing|month|ides)\b/i.test(around)) return false;
      return /\b(barcelona|girona|goth|saracen|frontier|counties|pyrenees)\b/i.test(around);
    }
    case "historical_boso": {
      if (/\b(wine|carts?|price|merchant|toll|deal|peddl)\b/i.test(around)) return false;
      if (/count boso|king boso|bosonid/i.test(matched)) return true;
      return /\b(provence|richard|mantaille|elected|brother|autun|king|dead|dies|dying|vienna|vienne)\b/i.test(around);
    }
    case "historical_odo": {
      if (/\b(wine|carts?|price|merchant|tolls?|deal|peddl|rush)\b/i.test(around)) return false;
      if (/odo of paris|king odo|count odo/i.test(matched)) return true;
      return /\b(paris|chartres|rollo|orléans|orleans|cousin|stripped|crown|seine|king)\b/i.test(around);
    }
  }
}

type Candidate = { order: number; pat: Pattern; end: number; matched: string };

/**
 * Every place each alias matches, keyed by start offset. One global pass per
 * pattern instead of a fresh slice-and-exec at every character, which made the
 * old scan quadratic in the text and visibly slowed typing once a scene held a
 * few seasons of talk. After each match the scan resumes one character on, so
 * overlapping matches of the same alias are still found.
 */
function candidatesByStart(text: string): Map<number, Candidate[]> {
  const byStart = new Map<number, Candidate[]>();
  PATTERNS.forEach((pat, order) => {
    const re = pat.global;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const list = byStart.get(m.index);
      const cand = { order, pat, end: m.index + m[0].length, matched: m[0] };
      if (list) list.push(cand);
      else byStart.set(m.index, [cand]);
      re.lastIndex = m.index + 1;
    }
  });
  for (const list of byStart.values()) list.sort((a, b) => a.order - b.order);
  return byStart;
}

function scanGlossaryHits(text: string, ctx?: GlossaryScanContext): GlossaryHit[] {
  if (!text) return [];
  const byStart = candidatesByStart(text);
  if (byStart.size === 0) return [];
  const omitted = omitRanges(text);
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const hits: GlossaryHit[] = [];
  let cursor = 0;
  for (const start of starts) {
    if (start < cursor) continue;
    for (const cand of byStart.get(start) ?? []) {
      if (overlaps(start, cand.end, omitted)) continue;
      if (!ruleAllows(cand.pat.rule, text, start, cand.end, ctx)) continue;
      hits.push({ id: cand.pat.id, title: cand.pat.title, start, end: cand.end, matched: cand.matched });
      cursor = cand.end;
      break;
    }
  }
  return hits;
}

const HIT_CACHE_LIMIT = 4000;
const hitCache = new Map<string, GlossaryHit[]>();

function cacheKey(text: string, ctx?: GlossaryScanContext): string {
  return `${ctx?.hunt ? "h" : "-"}${ctx?.land ? "l" : "-"}|${text}`;
}

/** Glossary terms in a line, longest alias first, never overlapping. Results are cached per line. */
export function findGlossaryHits(text: string, ctx?: GlossaryScanContext): GlossaryHit[] {
  if (!text) return [];
  const key = cacheKey(text, ctx);
  const cached = hitCache.get(key);
  if (cached) return cached;
  const hits = scanGlossaryHits(text, ctx);
  if (hitCache.size >= HIT_CACHE_LIMIT) {
    const oldest = hitCache.keys().next().value;
    if (oldest !== undefined) hitCache.delete(oldest);
  }
  hitCache.set(key, hits);
  return hits;
}

export function glossaryHasHits(text: string, ctx?: GlossaryScanContext): boolean {
  return findGlossaryHits(text, ctx).length > 0;
}
