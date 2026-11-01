import { huntProgressLine } from "../engine/hunts";
import { SMITH_SEASON_DAYS, smithProgressLine } from "../engine/smithing";
import { levyMenUnderArms, raiseSpecFor, upkeepDue } from "../engine/military";
import { unitSheet } from "../combat/registry";
import { rankTitle } from "../combat/renown";
import { capacity, holdingsRun, overloadTier, overloadWord, stewardTitle, upkeepPerSeason } from "../history/administration";
import { fairnessWord, justiceCase, justiceTable, stanceApplies } from "../history/justice";
import { eligibleRank } from "../history/promotion";
import { seasonRevenue } from "../history/revenue";
import { vassalMoodWord } from "../history/vassals";
import { merchantCartsForBooks } from "../engine/merchantShop";
import { clampEstateOffset, estatePagerFlags, snapshotAtOffset, stepEstateOffset } from "../engine/estateBooks";
import { seasonsBetween } from "../engine/projectProgress";
import type { EstateSeasonSnapshot, GameModifier, Project, Season, StandingOrder, WorldState } from "../engine/schema";
import type { GameView } from "../shared/types";
import {
  CUSTOMS_FORTHCOMING_EMPTY,
  CUSTOMS_LAWS_EMPTY,
  CUSTOMS_ORDERS_EMPTY,
  ESTATE_NO_HISTORY_HINT,
  ESTATE_PAST_HINT,
  ESTATE_PAST_MISSING,
  ESTATE_THIS_SEASON_HINT,
  LABOURS_EMPTY,
  labourOnWorkLine,
  labourStatusLine,
  modifierLine,
  modifierSourceName,
  projectProgressLine,
  seasonBooksLabel,
  seasonsOfWorkPhrase,
} from "./ledgerCopy";

export const BOOKS_TABS = ["estate", "holdings", "labours", "customs", "arms"] as const;
export type BooksTab = (typeof BOOKS_TABS)[number];

export const BOOKS_TAB_LABELS: Record<BooksTab, string> = {
  estate: "Estate",
  holdings: "Holdings",
  labours: "Labours",
  customs: "Customs",
  arms: "Arms",
};

// ---------------------------------------------------------------------------
// Holdings (rank progression doc, "What the books screen shows at each rank")
// ---------------------------------------------------------------------------

export type HoldingsBook = {
  rank: { level: number; title: string; patron: string | null; eligibleTitle: string | null; summonsIn: number | null };
  villas: { id: string; name: string; manses: string; tenure: string; seat: boolean; features: string[] }[];
  patrimony: { villas: number; manses: number };
  vassals: { id: string; name: string; holding: string; men: number; mood: string; group: boolean }[];
  court: string[];
  counties: { name: string; since: string; fisc: string; fiscManses: number; levy: number; yearly: string }[];
  revenue: { last: { tolls: number; market: number; justice: number; fisc: number; mint: number; deputy: number; fines: number; officers: number; net: number } | null; yearly: number };
  officers: string[];
  levy: number;
  mint: number;
  royalFisc: { yearly: number; host: string } | null;
  justice: {
    /** The officers' stance, once a county is held. */
    stance: { id: string; word: string } | null;
    open: { title: string; by: string } | null;
    casesThisYear: number;
    fairness: string;
    verdicts: { title: string; label: string; when: string }[];
    feuds: number;
    missi: number;
  };
  emptyLine?: string;
};

export const HOLDINGS_EMPTY = "One villa, held as a benefice, and no man sworn to you. Vassals, a court and the offices of a county come with rank; renown earns the summons.";

export { vassalMoodWord };

function tenureWord(h: WorldState["holdings"][number], state: WorldState, first: boolean): string {
  if (first) {
    const t = state.history.land.tenure;
    if (t === "owned") return "the lord's own";
    if (t === "precaria") return "held of the church as precaria";
    if (t === "forfeit_claimed") return "claimed as forfeit";
    return `a benefice${state.history.land.charter !== "none" ? `, ${state.history.land.charter}'s charter` : ""}`;
  }
  if (h.tenure === "owned") return "the lord's own";
  if (h.tenure === "precaria") return "held of the church as precaria";
  return `a benefice of ${h.grantedBy ?? "the lord's patron"}`;
}

export function holdingsBook(state: WorldState): HoldingsBook {
  const level = Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
  const rank = state.history.rank;
  const eligible = eligibleRank(state);
  const villas = state.holdings.map((h, i) => ({
    id: h.id,
    name: h.name,
    manses: `${h.manses.free} free, ${h.manses.servile} servile, ${h.manses.vacant} vacant`,
    tenure: tenureWord(h, state, i === 0),
    seat: Boolean(h.seat) || (i === 0 && !state.holdings.some((x) => x.seat)),
    features: h.features,
  }));
  const vassals = state.history.vassals.map((v) => ({ id: v.id, name: v.name, holding: v.holding, men: v.men, mood: vassalMoodWord(v.mood), group: v.group }));
  const court: string[] = [];
  if (level === 2) court.push("The viscount holds the count's court in his district: the deputy's share and the fines of the lesser pleas come to him.");
  if (level >= 3) court.push("The count sits in judgment on the pleas of the county; the fines are his. The stance of the court (lenient, fair, strict, extortionate) is set in conversation with Aldric.");
  const SEASONS_IN_ORDER: Season[] = ["spring", "summer", "autumn", "winter"];
  const turnLabel = (turn: number) => seasonBooksLabel(SEASONS_IN_ORDER[(Math.max(1, turn) - 1) % 4], 825 + Math.floor((Math.max(1, turn) - 1) / 4));
  const j = state.history.justice;
  const openCase = j.open ? justiceCase(j.open.caseId) : undefined;
  const justice: HoldingsBook["justice"] = {
    stance: stanceApplies(state) ? { id: j.stance, word: justiceTable().stances[j.stance]?.word ?? j.stance } : null,
    open: openCase && j.open ? { title: openCase.title, by: state.npcs.find((n) => n.id === j.open?.speaker)?.name ?? (j.open.speaker === "chaplain" ? "Ermenald" : "Aldric") } : null,
    casesThisYear: j.casesThisYear,
    fairness: fairnessWord(j.fairness),
    verdicts: [...j.verdicts].reverse().slice(0, 4).map((v) => ({ title: v.title, label: v.label, when: turnLabel(v.turn) })),
    feuds: j.feuds.length,
    missi: j.missiVisits,
  };
  const counties = rank.counties.map((c) => ({
    name: c.name,
    since: turnLabel(c.since),
    fisc: `${c.fiscManses} manses in ${c.fiscVillas} villas, held by office`,
    fiscManses: c.fiscManses,
    levy: c.levy,
    yearly: `tolls ${c.yearly.tolls}, market ${c.yearly.market}, pleas ${c.yearly.justice}, fisc ${c.yearly.fisc}; officers ${c.yearly.officers}`,
  }));
  const season = seasonRevenue(state);
  const officers: string[] = [];
  const steward = state.npcs.find((n) => n.id === "steward")?.name ?? "Aldric";
  const admin = state.history.administration;
  const tier = overloadTier(state);
  if (level >= 2 || tier > 0 || admin.staff || admin.standing || admin.deputy) {
    officers.push(`${steward}, ${stewardTitle(state)}${admin.staff ? `, with ${admin.staff} ${admin.staff === 1 ? "clerk" : "clerks"} under him` : ""}.`);
    officers.push(`${holdingsRun(state)} ${holdingsRun(state) === 1 ? "villa" : "villas"} in his books against ${capacity(state)} he can hold; the books are ${overloadWord(tier)}.`);
    if (admin.deputy) officers.push(`${admin.deputy.name}, deputy over the outlying villas since ${turnLabel(admin.deputy.since)}.`);
    const pay = upkeepPerSeason(state);
    if (pay) officers.push(`The household's officers cost ${pay} d a season.`);
    if (admin.leaked) officers.push(`${Math.round(admin.leaked)} d have gone uncollected or been kept back over the years.`);
  }
  if (level >= 3) {
    officers.push(`${rank.counties.length} ${rank.counties.length === 1 ? "county" : "counties"} to administer from ${state.holdings.find((h) => h.seat)?.name ?? state.holdings[0]?.name ?? "the seat"}; the fisc's own officers run its villas.`);
  }
  return {
    rank: {
      level,
      title: rankTitle(level as 1 | 2 | 3 | 4 | 5),
      patron: rank.patron,
      eligibleTitle: eligible > level ? rankTitle(eligible as 1 | 2 | 3 | 4 | 5) : null,
      summonsIn: eligible > level && rank.dueTurn !== null ? Math.max(1, rank.dueTurn - state.meta.turn) : null,
    },
    villas,
    patrimony: { villas: state.holdings.length, manses: state.holdings.reduce((n, h) => n + h.manses.free + h.manses.servile, 0) },
    vassals,
    court,
    counties,
    revenue: { last: rank.lastRevenue, yearly: season.net * 4 },
    officers,
    levy: rank.counties.reduce((n, c) => n + c.levy, 0),
    mint: rank.mint,
    royalFisc: rank.royalFisc ? { yearly: rank.royalFisc.yearly, host: `${rank.royalFisc.host.min}–${rank.royalFisc.host.max} men when the host is called` } : null,
    justice,
    emptyLine: level === 1 && state.holdings.length <= 1 && !vassals.length ? HOLDINGS_EMPTY : undefined,
  };
}

export type ArmsBook = {
  lord: { renown: number; rankTitle: string; rankLevel: number; strength: string; wounds: string[]; dead: boolean };
  units: { id: string; name: string; kind: string; men: number; veteran: boolean; upkeep: number }[];
  drilling: { id: string; name: string; kind: string; men: number; seasonsLeft: number }[];
  upkeepPerSeason: number;
  levyFree: number;
  invented: string[];
  history: { id: string; when: string; kind: string; outcome: string; renownDelta: number; summary: string }[];
  emptyLine?: string;
};

export const ARMS_EMPTY = "No men stand under your banner. The villa's levy can be called up through Aldric; paid spearmen, archers, and horsemen need a captain of the guard to drill them.";

export function armsBook(state: WorldState): ArmsBook {
  const kindName = (id: string) => raiseSpecFor(id)?.label ?? unitSheet(id)?.name ?? id.replaceAll("_", " ");
  const units = state.military.units.map((u) => ({
    id: u.id,
    name: u.name,
    kind: kindName(u.sheetId),
    men: u.strength,
    veteran: u.veteran,
    upkeep: Math.round(u.strength * (raiseSpecFor(u.sheetId)?.upkeepPerMan ?? 0)),
  }));
  const drilling = state.military.training.map((t) => ({
    id: t.id,
    name: t.name,
    kind: kindName(t.sheetId),
    men: t.men,
    seasonsLeft: Math.max(0, t.seasonsRequired - t.seasonsElapsed),
  }));
  return {
    lord: {
      renown: state.player.renown,
      rankLevel: state.player.rankLevel,
      rankTitle: rankTitle(state.player.rankLevel as 1 | 2 | 3 | 4 | 5),
      strength: `${state.player.personal.hp}/${state.player.personal.maxHp}`,
      wounds: state.player.wounds.map((w) => {
        const state_ = w.permanent ? "will not heal" : w.seasonsHeld === 0 ? "fresh; may close by next season" : "still open; one more season to mend or set";
        return `${w.location}${w.cause ? ` — ${w.cause}` : ""} (${state_})`;
      }),
      dead: state.player.dead || state.player.maimed || state.player.captive,
    },
    units,
    drilling,
    upkeepPerSeason: upkeepDue(state),
    levyFree: Math.max(0, state.population.adult_men - levyMenUnderArms(state)),
    invented: state.military.customSheets.map((s) => s.name),
    history: [...state.battle_history]
      .reverse()
      .slice(0, 8)
      .map((b) => ({
        id: b.id,
        when: `${b.season.charAt(0).toUpperCase()}${b.season.slice(1)} ${b.year}`,
        kind: b.kind,
        outcome: b.outcome.replaceAll("_", " "),
        renownDelta: b.renownDelta,
        summary: b.summary,
      })),
    emptyLine: units.length || drilling.length ? undefined : ARMS_EMPTY,
  };
}

export function isBooksTab(value: string): value is BooksTab {
  return (BOOKS_TABS as readonly string[]).includes(value);
}

export function selectBooksTab(current: BooksTab, next: string): BooksTab {
  return isBooksTab(next) ? next : current;
}

export type EstateLedgerSource = {
  year: number;
  season: Season;
  turn: number;
  region: string;
  eraNote?: string;
  holdings: WorldState["holdings"];
  resources: WorldState["resources"];
  custom_resources: WorldState["custom_resources"];
  population: WorldState["population"];
  agriculture: { springBarleyShare: number; autumnWheatShare: number; rotation?: "two_field" | "three_field" };
  last_season_deltas: Record<string, number>;
  flags: { merchant_present: boolean; hunger: boolean };
  merchant: { present: boolean; name?: string; stock: { resource: string; amount: number }[] };
  market: WorldState["market"];
  npcs: { name: string; role: string }[];
  known_techniques: { id: string; name: string }[];
  labour?: { pool: { men: number; women: number; youths: number }; remaining: { men: number; women: number; youths: number } };
};

export type EstatePagerView = ReturnType<typeof estatePagerFlags> & {
  label: string;
  hint: string;
  source: EstateLedgerSource | null;
};

export function estateSourceFromLive(view: GameView): EstateLedgerSource {
  const s = view.state;
  return {
    year: s.meta.year,
    season: s.meta.season,
    turn: s.meta.turn,
    region: s.meta.region,
    eraNote: s.meta.eraNote,
    holdings: s.holdings,
    resources: s.resources,
    custom_resources: s.custom_resources,
    population: s.population,
    agriculture: {
      springBarleyShare: s.agriculture?.springBarleyShare ?? 0.6,
      autumnWheatShare: s.agriculture?.autumnWheatShare ?? 0.45,
      rotation: s.agriculture?.rotation ?? "two_field",
    },
    last_season_deltas: s.last_season_deltas ?? {},
    flags: { merchant_present: s.flags.merchant_present, hunger: s.flags.hunger },
    merchant: { present: s.merchant.present, name: s.merchant.name, stock: merchantCartsForBooks(s.merchant) },
    market: s.market,
    npcs: s.npcs.filter((n) => n.id !== "merchant").map((n) => ({ name: n.name, role: n.role })),
    known_techniques: s.known_techniques.map((t) => ({ id: t.id, name: t.name })),
    labour: view.labour,
  };
}

export function estateSourceFromSnapshot(snap: EstateSeasonSnapshot): EstateLedgerSource {
  return {
    year: snap.year,
    season: snap.season,
    turn: snap.turn,
    region: snap.region,
    holdings: snap.holdings,
    resources: snap.resources,
    custom_resources: snap.custom_resources,
    population: snap.population,
    agriculture: snap.agriculture,
    last_season_deltas: snap.last_season_deltas ?? {},
    flags: snap.flags,
    merchant: snap.merchant,
    market: snap.market,
    npcs: snap.npcs,
    known_techniques: snap.known_techniques,
    labour: snap.labour,
  };
}

export function estatePagerView(view: GameView, offset: number): EstatePagerView {
  const history = view.state.estate_history ?? [];
  const flags = estatePagerFlags(offset, history.length);
  if (flags.viewingCurrent) {
    const source = estateSourceFromLive(view);
    return {
      ...flags,
      label: seasonBooksLabel(source.season, source.year),
      hint: history.length === 0 ? `${ESTATE_THIS_SEASON_HINT} ${ESTATE_NO_HISTORY_HINT}` : ESTATE_THIS_SEASON_HINT,
      source,
    };
  }
  const snap = snapshotAtOffset(history, flags.offset);
  if (!snap) {
    return {
      ...flags,
      label: "A season not kept",
      hint: ESTATE_PAST_MISSING,
      source: null,
    };
  }
  return {
    ...flags,
    label: seasonBooksLabel(snap.season, snap.year),
    hint: ESTATE_PAST_HINT,
    source: estateSourceFromSnapshot(snap),
  };
}

export { clampEstateOffset, stepEstateOffset };


export type LabourMarkView = {
  label: string;
  progress: string;
};

export type LabourBookEntry = {
  id: string;
  name: string;
  status: Project["status"];
  statusLine: string;
  progressLine: string;
  handsLine?: string;
  spanLine: string;
  marks: LabourMarkView[];
  hunt: boolean;
};

const STATUS_RANK: Record<Project["status"], number> = { active: 0, completed: 1, cancelled: 2 };

export function labourBookEntries(state: WorldState): LabourBookEntry[] {
  const nowSeason = state.meta.season;
  const nowYear = state.meta.year;
  return [...state.projects]
    .sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rank !== 0) return rank;
      const aEnd = a.completedYear ?? nowYear;
      const bEnd = b.completedYear ?? nowYear;
      if (aEnd !== bEnd) return bEnd - aEnd;
      return a.name.localeCompare(b.name);
    })
    .map((proj) => labourBookEntry(proj, nowSeason, nowYear, state));
}

function labourBookEntry(proj: Project, nowSeason: Season, nowYear: number, state: WorldState): LabourBookEntry {
  const assign = state.labour.assigned.find((a) => a.projectId === proj.id);
  const progressLine = proj.hunt
    ? huntProgressLine(proj.hunt.seasonsElapsed, proj.hunt.durationSeasons)
    : proj.smithing
      ? smithProgressLine(proj.smithing.seasonsElapsed, proj.smithing.durationSeasons, {
          done: proj.smithing.forgeDaysDone,
          required: proj.smithing.forgeDaysRequired,
        })
      : projectProgressLine(proj.labourDaysDone, proj.labourDaysRequired);
  const handsLine =
    proj.status === "active" && proj.smithing
      ? "his own hands"
      : proj.status === "active" && !proj.hunt
        ? labourOnWorkLine(assign)
        : undefined;
  return {
    id: proj.id,
    name: proj.name,
    status: proj.status,
    statusLine: labourStatusLine(proj.status),
    progressLine,
    handsLine,
    spanLine: labourSpanLine(proj, nowSeason, nowYear),
    marks: labourMarkViews(proj),
    hunt: Boolean(proj.hunt || proj.tag === "hunt"),
  };
}

function labourSpanLine(proj: Project, nowSeason: Season, nowYear: number): string {
  const start =
    proj.startedSeason && proj.startedYear != null
      ? `Begun ${seasonBooksLabel(proj.startedSeason, proj.startedYear)}`
      : "";
  const endSeason = proj.completedSeason ?? nowSeason;
  const endYear = proj.completedYear ?? nowYear;
  const end =
    proj.status !== "active" && proj.completedSeason && proj.completedYear != null
      ? proj.status === "cancelled"
        ? `stopped ${seasonBooksLabel(proj.completedSeason, proj.completedYear)}`
        : `finished ${seasonBooksLabel(proj.completedSeason, proj.completedYear)}`
      : "";
  const recorded = proj.seasonMarks?.length ?? 0;
  const spanned =
    recorded > 0
      ? recorded
      : proj.startedSeason && proj.startedYear != null
        ? seasonsBetween(proj.startedSeason, proj.startedYear, endSeason, endYear)
        : 0;
  const span = spanned > 0 ? seasonsOfWorkPhrase(spanned) : "";
  const parts = [start, end, span].filter(Boolean);
  if (!parts.length) return "The season this work began is not in these books.";
  return parts.join(" · ");
}

function labourMarkViews(proj: Project): LabourMarkView[] {
  const marks = proj.seasonMarks ?? [];
  if (!marks.length) return [];
  return marks.map((mark) => ({
    label: seasonBooksLabel(mark.season, mark.year),
    progress: proj.hunt
      ? huntProgressLine(mark.huntSeasonsElapsed ?? proj.hunt.seasonsElapsed, proj.hunt.durationSeasons)
      : proj.smithing
        ? smithProgressLine(mark.smithingSeasonsElapsed ?? proj.smithing.seasonsElapsed, proj.smithing.durationSeasons, {
            done:
              proj.smithing.forgeDaysRequired != null
                ? Math.min(proj.smithing.forgeDaysRequired, (mark.smithingSeasonsElapsed ?? proj.smithing.seasonsElapsed) * SMITH_SEASON_DAYS)
                : undefined,
            required: proj.smithing.forgeDaysRequired,
          })
        : projectProgressLine(mark.labourDaysDone, proj.labourDaysRequired),
  }));
}

export type CustomBookEntry = {
  id: string;
  kind: "order" | "law" | "forthcoming" | "letter";
  title: string;
  body: string;
  lasting: boolean;
};

export function customsBookEntries(state: WorldState): {
  forthcoming: CustomBookEntry[];
  orders: CustomBookEntry[];
  laws: CustomBookEntry[];
  letters: CustomBookEntry[];
} {
  const forthcoming = (state.forthcoming_orders ?? [])
    .filter((o) => o.status === "waiting")
    .map(forthcomingEntry);
  const orders = [...state.standing_orders]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map(orderEntry);
  const laws = state.modifiers.map(lawEntry);
  const letters = (state.church?.letters ?? []).map(letterEntry);
  return { forthcoming, orders, laws, letters };
}

function letterEntry(letter: { id: string; text: string }): CustomBookEntry {
  return {
    id: letter.id,
    kind: "letter",
    title: "A letter from Autun",
    body: letter.text,
    lasting: true,
  };
}

function forthcomingEntry(order: { id: string; text: string }): CustomBookEntry {
  return {
    id: order.id,
    kind: "forthcoming",
    title: "An order yet to be kept",
    body: order.text,
    lasting: false,
  };
}

function orderEntry(order: StandingOrder): CustomBookEntry {
  return {
    id: order.id,
    kind: "order",
    title: order.active ? "Standing order" : "Standing order, lifted",
    body: order.text,
    lasting: order.active,
  };
}

function lawEntry(mod: GameModifier): CustomBookEntry {
  const lasting = mod.kind === "permanent" || mod.target === "custom";
  return {
    id: mod.id,
    kind: "law",
    title: lasting ? "A lasting custom" : "A custom of the hall",
    body: `${modifierSourceName(mod.source)} — ${modifierLine(mod)}`,
    lasting,
  };
}

export function laboursEmptyLine(entries: LabourBookEntry[]): string | null {
  return entries.length ? null : LABOURS_EMPTY;
}

export function customsEmptyLines(entries: {
  forthcoming: CustomBookEntry[];
  orders: CustomBookEntry[];
  laws: CustomBookEntry[];
}): {
  forthcoming: string | null;
  orders: string | null;
  laws: string | null;
} {
  return {
    forthcoming: entries.forthcoming.length ? null : CUSTOMS_FORTHCOMING_EMPTY,
    orders: entries.orders.length ? null : CUSTOMS_ORDERS_EMPTY,
    laws: entries.laws.length ? null : CUSTOMS_LAWS_EMPTY,
  };
}
