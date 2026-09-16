import { huntProgressLine } from "../engine/hunts";
import { merchantCartsForBooks } from "../engine/merchantShop";
import { clampEstateOffset, estatePagerFlags, snapshotAtOffset, stepEstateOffset } from "../engine/estateBooks";
import { seasonsBetween } from "../engine/projectProgress";
import type { EstateSeasonSnapshot, GameModifier, Project, Season, StandingOrder, WorldState } from "../engine/schema";
import type { GameView } from "../shared/types";
import {
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

export const BOOKS_TABS = ["estate", "labours", "customs"] as const;
export type BooksTab = (typeof BOOKS_TABS)[number];

export const BOOKS_TAB_LABELS: Record<BooksTab, string> = {
  estate: "Estate",
  labours: "Labours",
  customs: "Customs",
};

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
  agriculture: { springBarleyShare: number; autumnWheatShare: number };
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
    : projectProgressLine(proj.labourDaysDone, proj.labourDaysRequired);
  const handsLine =
    proj.status === "active" && !proj.hunt ? labourOnWorkLine(assign) : undefined;
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
      : projectProgressLine(mark.labourDaysDone, proj.labourDaysRequired),
  }));
}

export type CustomBookEntry = {
  id: string;
  kind: "order" | "law";
  title: string;
  body: string;
  lasting: boolean;
};

export function customsBookEntries(state: WorldState): { orders: CustomBookEntry[]; laws: CustomBookEntry[] } {
  const orders = [...state.standing_orders]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map(orderEntry);
  const laws = state.modifiers.map(lawEntry);
  return { orders, laws };
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

export function customsEmptyLines(entries: { orders: CustomBookEntry[]; laws: CustomBookEntry[] }): {
  orders: string | null;
  laws: string | null;
} {
  return {
    orders: entries.orders.length ? null : CUSTOMS_ORDERS_EMPTY,
    laws: entries.laws.length ? null : CUSTOMS_LAWS_EMPTY,
  };
}
