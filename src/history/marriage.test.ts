import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import dutiesFile from "../../data/history/events/duties.json";
import questFile from "../../data/history/events/quest.json";
import { applyProposal } from "../engine/applyDelta";
import { introSpeechFor } from "../engine/intros";
import { looksLikeMechanicalOrder } from "../engine/orderIntent";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { npcSystemPrompt } from "../llm/prompts";
import { npcPortrait } from "../ui/art";
import { holdingsBook } from "../ui/booksView";
import { proposalBlurb } from "../ui/ledgerCopy";
import { composeQuestSector } from "./battles";
import { endingFacts } from "./ending";
import { lintHistory, lintHistoryStructure } from "./lint";
import { historyContent, setHistoryContentForTests } from "./load";
import { bridePrice, courtWidow, LOCAL_BRIDE_NAMES, marriageBlocked, marry, matchOffers, tickMarriage, WIFE_NPC_ID } from "./marriage";
import { pickNeighbour } from "./neighbours";
import { historyPromptBlock } from "./promptBlocks";
import { promoteTo } from "./promotion";
import { alliesWon } from "./quest";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import { restingMood, type Vassal } from "./vassals";

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
type Season = (typeof ORDER)[number];

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    if (state.battle_call?.kind === "history") state.battle_call = null;
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1, { coverUpkeep: true });
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  const to = (year: number, season: Season): HistoryPassResult[] => {
    const all: HistoryPassResult[] = [];
    while (state.meta.year < year || (state.meta.year === year && ORDER.indexOf(state.meta.season) < ORDER.indexOf(season))) all.push(next());
    return all;
  };
  return { next, to };
}

const hook = (state: WorldState, eventId: string, hookId: string, actor = "steward") => applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, actor);
const wed = (state: WorldState, archetype: "hildegard" | "theoderada" | "gisla" | "linda", actor = "steward") => applyProposal(state, { type: "marriage", summary: "", archetype, action: "marry" }, actor);
const court = (state: WorldState) => applyProposal(state, { type: "marriage", summary: "", archetype: "gisla", action: "court" }, "steward");

function atRank(rank: number): WorldState {
  const state = fresh();
  state.player.renown = [1, 100, 500, 1000, 2000][rank - 1] + 50;
  promoteTo(state, rank, { patron: "the king", turn: 40 });
  state.meta.turn = 40;
  return state;
}

function man(state: WorldState, id: string, mood = 50): Vassal {
  const v: Vassal = { id, name: id, holding: "a villa", men: 3, mood, since: 1, group: false, angrySince: null, lastReason: null, bent: "fighter", gifts: [], grievances: [], snubbed: false };
  state.history.vassals.push(v);
  return v;
}

afterEach(() => setHistoryContentForTests(null));

describe("the four matches", () => {
  it("lints: the flags are the engine's, and the quest hooks read them", () => {
    expect(lintHistoryStructure(historyContent())).toEqual([]);
    const unset = lintHistory(historyContent()).filter((p) => p.includes("nothing sets it"));
    for (const id of ["married", "wife", "married_great_house", "married_beneath", "kin_quarrel"]) expect(unset.find((p) => p.includes(`'${id}'`)), id).toBeUndefined();
  });

  it("Aldric lays out four matches with their prices; the steward and the player may make one, nobody else", () => {
    const state = fresh();
    const offers = matchOffers(state);
    expect(offers.map((o) => o.archetype)).toEqual(["hildegard", "theoderada", "gisla", "linda"]);
    expect(offers[0].price).toBe(60);
    expect(offers[1].price).toBe(240);
    expect(offers[2].price).toBe(0);
    const line = historyPromptBlock(state, "steward");
    expect(line).toContain("Marriage: the lord is unmarried");
    expect(line).toContain("marriage { archetype");
    expect(historyPromptBlock(state, "chaplain")).toContain("consent and affection");
    expect(proposalBlurb({ type: "marriage", summary: "", archetype: "hildegard", action: "marry" }, state)).toContain("bride-price of 60 d");
    state.resources.denarii = 500;
    expect(wed(state, "linda", "chaplain").ok).toBe(false);
    expect(wed(state, "linda", "smith").ok).toBe(false);
  });

  it("the neighbour's daughter: land next to ours, her father marked kin, the bride-price paid in coin and kind, and a second match is refused", () => {
    const state = fresh();
    state.resources.denarii = 20;
    state.resources.cattle = 10;
    const manses = state.holdings[0].manses.free;
    const r = wed(state, "hildegard");
    expect(r.ok, r.logLine).toBe(true);
    const m = state.history.marriage;
    expect(m.archetype).toBe("hildegard");
    expect(LOCAL_BRIDE_NAMES).toContain(m.name!);
    expect(m.name).not.toBe("Hildegard"); // the seamstress already has the name
    expect(m.tier).toBe(1);
    expect(state.holdings[0].manses.free).toBe(manses + 2);
    expect(state.resources.denarii).toBe(0);
    expect(state.resources.cattle).toBeLessThan(10);
    const father = state.history.neighbours.find((n) => n.id === m.kin?.neighbourId)!;
    expect(father.kin).toBe(true);
    for (let i = 0; i < 12; i++) expect(pickNeighbour(state, `flight:${i}`).id).not.toBe(father.id);
    expect(state.history.flags.married).toBe(true);
    expect(state.history.flags.wife).toBe("hildegard");
    expect(state.history.land.marriedLocal).toBe(true);
    expect(state.npcs.find((n) => n.id === WIFE_NPC_ID)?.name).toBe(m.name);
    expect(marriageBlocked(state, "theoderada")).toContain("married already");
    expect(wed(state, "linda").ok).toBe(false);
    expect(historyPromptBlock(state, "steward")).toContain(`married to ${m.name}`);
    expect(holdingsBook(state).household[0]).toContain(m.name!);
  });

  it("the same archetype is a different woman at each rank: a villa of her own for a viscount, two for a count, dearer each time", () => {
    expect(bridePrice("hildegard", 1)).toBeLessThan(bridePrice("hildegard", 2));
    expect(bridePrice("hildegard", 2)).toBeLessThan(bridePrice("hildegard", 3));
    const viscount = atRank(2);
    viscount.resources.denarii = 5000;
    const before = viscount.holdings.length;
    expect(wed(viscount, "hildegard").ok).toBe(true);
    expect(viscount.holdings.length).toBe(before + 1);
    expect(viscount.holdings[viscount.holdings.length - 1].tenure).toBe("owned");
    expect(viscount.history.marriage.kin?.head).toMatch(/^Viscount /);
    const count = atRank(3);
    count.resources.denarii = 5000;
    const n = count.holdings.length;
    expect(wed(count, "hildegard").ok).toBe(true);
    expect(count.holdings.length).toBe(n + 2);
    expect(count.history.marriage.kin?.head).toMatch(/^Count /);
    expect(count.history.marriage.tier).toBe(3);
  });

  it("the great family's daughter: little land, a house behind her, her enemies ours, and their quarrels at the door", () => {
    const state = fresh();
    state.resources.denarii = 400;
    const renown = state.player.renown;
    const holdings = state.holdings.length;
    const r = wed(state, "theoderada");
    expect(r.ok, r.logLine).toBe(true);
    expect(state.holdings.length).toBe(holdings);
    expect(state.resources.denarii).toBe(160);
    expect(state.player.renown).toBeGreaterThan(renown);
    expect(state.history.marriage.kin?.enemy).toBeTruthy();
    expect(state.history.flags.married_great_house).toBe(true);
    // Her family's quarrels come, now and then, and cost coin.
    const m = state.history.marriage;
    let quarrels = 0;
    for (let turn = (m.since ?? 0) + 1; turn < (m.since ?? 0) + 200; turn++) {
      const r = tickMarriage(state, { year: 830 + Math.floor(turn / 4), season: ORDER[turn % 4] }, turn);
      if (r.beats.some((b) => b.eventId === "marriage:quarrel")) quarrels++;
    }
    expect(quarrels).toBeGreaterThan(0);
    expect(state.history.flags.kin_quarrel).toBe(quarrels);
  });

  it("the widow chooses for herself: she is courted in person, once a season, and marries when she consents, bringing her dower outright", () => {
    const state = fresh();
    state.resources.denarii = 100;
    expect(wed(state, "gisla").ok).toBe(false);
    expect(marriageBlocked(state, "gisla")).toContain("has not said yes");
    const first = court(state);
    expect(first.ok).toBe(true);
    expect(court(state).ok).toBe(false); // once a season
    expect(state.history.marriage.suit.visits).toBe(1);
    // A fixed roll above every chance: she says not yet; below: she says yes.
    const s2 = fresh();
    expect(courtWidow(s2, 0.99).line).toContain("has not said yes");
    expect(s2.history.marriage.suit.consented).toBe(false);
    s2.meta.turn += 1;
    expect(courtWidow(s2, 0.01).line).toContain("has said yes");
    expect(s2.history.marriage.suit.consented).toBe(true);
    const holdings = s2.holdings.length;
    const coin = s2.resources.denarii;
    const r = marry(s2, "gisla");
    expect(r.ok).toBe(true);
    expect(s2.resources.denarii).toBe(coin); // no bride-price
    expect(s2.holdings.length).toBe(holdings + 1);
    const dower = s2.holdings.find((h) => h.id === s2.history.marriage.dower?.holdingId)!;
    expect(dower.tenure).toBe("owned");
    expect(dower.grantedBy).toBe("her dower");
    expect(s2.modifiers.some((x) => x.target === "spoilage" && x.source.includes("Gisla"))).toBe(true);
    expect(s2.npcs.find((n) => n.id === WIFE_NPC_ID)?.name).toBe("Gisla");
  });

  it("the match for herself alone: nothing comes with her, the sworn men rest lower for years, Ermenald approves, and the hall talks", () => {
    const state = fresh();
    const v = man(state, "audoin", 50);
    const favor = Number(state.history.flags.favor_church ?? 50);
    const r = wed(state, "linda");
    expect(r.ok).toBe(true);
    expect(state.resources.denarii).toBe(138);
    expect(v.mood).toBe(42);
    expect(restingMood(state)).toBe(44);
    expect(state.history.flags.married_beneath).toBe(true);
    expect(Number(state.history.flags.favor_church)).toBe(favor + 1);
    expect(historyPromptBlock(state, "chaplain")).toContain("quietly approve");
    // Moods fade toward 44, not 50.
    v.mood = 60;
    const clock = clockFor(state);
    for (let i = 0; i < 30; i++) clock.next();
    expect(v.mood).toBe(44);
    // The remarks come, and stop after a dozen years.
    let remarks = 0;
    const m = state.history.marriage;
    for (let turn = (m.since ?? 0) + 1; turn < (m.since ?? 0) + 48; turn++) {
      if (tickMarriage(state, { year: 826 + Math.floor(turn / 4), season: ORDER[turn % 4] }, turn).beats.some((b) => b.eventId === "marriage:remark")) remarks++;
    }
    expect(remarks).toBeGreaterThan(0);
    const late = tickMarriage(state, { year: 826 + 20, season: "spring" }, (m.since ?? 0) + 80);
    expect(late.beats).toEqual([]);
    expect(endingFacts(state).some((l) => l.includes("heir stands weaker"))).toBe(true);
  });
});

describe("the lord's word on a match", () => {
  it("is an order for Aldric's books; a question about the matches is talk", () => {
    expect(looksLikeMechanicalOrder("I will marry Theoderada.", "steward")).toBe(true);
    expect(looksLikeMechanicalOrder("Make the match with the neighbour's daughter.", "steward")).toBe(true);
    expect(looksLikeMechanicalOrder("I shall ride to the widow myself this season.", "steward")).toBe(true);
    expect(looksLikeMechanicalOrder("Court Gisla for me", "steward")).toBe(true);
    expect(looksLikeMechanicalOrder("What would Theoderada bring, and what would it cost?", "steward")).toBe(false);
    expect(looksLikeMechanicalOrder("Tell me about the widow.", "steward")).toBe(false);
    expect(looksLikeMechanicalOrder("I will marry Theoderada.", "chaplain")).toBe(false);
  });
});

describe("the wife in the hall", () => {
  it("has a portrait by match, an intro in her own voice, a counsel-only prompt, and no hand in the books", () => {
    const state = fresh();
    state.resources.denarii = 500;
    expect(npcPortrait("wife", "neutral", undefined, null)).toBeUndefined();
    wed(state, "theoderada");
    expect(npcPortrait("wife", "neutral", undefined, state.history.marriage.archetype)).toMatch(/Theoderada/);
    expect(introSpeechFor("wife", state)).toContain("three moves");
    const prompt = npcSystemPrompt("wife", state);
    expect(prompt).toContain("You are Theoderada");
    expect(prompt).toContain("WHAT THE LADY KNOWS");
    expect(prompt).toContain("three moves ahead");
    const r = applyProposal(state, { type: "transfer_resources", summary: "", from: "estate", to: "player", resources: { denarii: 1 } } as never, "wife");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("counsel");
  });

  it("each match counsels from a different slice: the widow on stores, the neighbour's daughter on the district, the match for love on right and wrong", () => {
    const gisla = fresh();
    gisla.history.marriage.suit.consented = true;
    marry(gisla, "gisla");
    const gp = npcSystemPrompt("wife", gisla);
    expect(gp).toContain("householder's guess");
    expect(gp).toContain("Counsel: estates, stores, tenants, officers");
    const hild = fresh();
    hild.resources.denarii = 100;
    marry(hild, "hildegard");
    expect(npcSystemPrompt("wife", hild)).toContain("Counsel: the district");
    const linda = fresh();
    marry(linda, "linda");
    const lp = npcSystemPrompt("wife", linda);
    expect(lp).toContain("frequently wrong");
    expect(lp).toContain("Never play this as stupidity");
    expect(lp).toContain("Counsel: speak to the right and wrong");
  });
});

describe("the 830 land crisis", () => {
  it("the second way out is the neighbour's daughter: the hook makes the match, and a thin chest pays in cattle", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "autumn");
    expect(state.history.land.tenure).toBe("forfeit_claimed");
    state.resources.denarii = 10;
    state.resources.cattle = 12;
    const r = hook(state, "830-L1", "marry_local");
    expect(r.ok, r.logLine).toBe(true);
    expect(state.history.land.tenure).toBe("benefice");
    expect(state.history.marriage.archetype).toBe("hildegard");
    expect(state.history.flags.married_local).toBe(true);
    expect(state.npcs.some((n) => n.id === WIFE_NPC_ID)).toBe(true);
    expect(r.logLine).toContain("Bride-price paid");
  });

  it("a lord married already cannot take that door; a match with kin made through Aldric lifts the claim by itself", () => {
    const a = fresh();
    const ca = clockFor(a);
    ca.to(830, "autumn");
    marry(a, "linda");
    expect(hook(a, "830-L1", "marry_local").ok).toBe(false);
    expect(a.history.land.tenure).toBe("forfeit_claimed");
    const b = fresh();
    const cb = clockFor(b);
    cb.to(830, "autumn");
    b.resources.denarii = 500;
    expect(wed(b, "theoderada").ok).toBe(true);
    expect(b.history.land.tenure).toBe("benefice");
    expect(b.history.land.claimDeadlineTurn).toBeNull();
    expect(b.history.hooksTaken["830-L1"]).toContain("marry_local");
    const c = fresh();
    const cc = clockFor(c);
    cc.to(830, "autumn");
    c.history.marriage.suit.consented = true;
    expect(marry(c, "gisla").ok).toBe(true);
    expect(c.history.land.tenure).toBe("forfeit_claimed"); // the widow's dower answers nothing at the count's court
  });
});

describe("the king quest", () => {
  function quiet() {
    setHistoryContentForTests({ events: [...dutiesFile.events, ...questFile.events], features: { ladder: true, quest: true, promotions: false } });
  }
  function dangerous(): WorldState {
    const state = fresh();
    state.player.renown = 900;
    state.player.rankLevel = 3;
    state.peopleHappiness = 70;
    state.history.flags.favor_church = 55;
    state.history.flags.saint_florentin_888 = true;
    state.resources.denarii = 20000;
    return state;
  }
  function gathering(state: WorldState) {
    const clock = clockFor(state);
    for (let i = 0; i < 6; i++) clock.next();
    expect(state.history.quest.phase).toBe("gathering");
    return clock;
  }

  it("married into a great house, her brother is the marriage seat: near-certain, and his price is what he brings", () => {
    quiet();
    const state = dangerous();
    expect(marry(state, "theoderada").ok).toBe(true);
    const clock = gathering(state);
    const seat = state.history.quest.nobles.find((n) => n.motive === "marriage")!;
    expect(seat.name).toBe(state.history.marriage.kin?.head);
    expect(seat.status).toBe("unknown");
    expect(historyPromptBlock(state, "steward")).toContain("the lady's brother");
    expect(hook(state, "Q-001", "approach_marriage").ok).toBe(true);
    clock.next();
    expect(seat.status).toBe("won");
    expect(alliesWon(state)).toBe(1);
    const want = state.history.marriage.kinWant;
    expect(want).toBeTruthy();
    const horseOnly = composeQuestSector(state).allies.filter((l) => (l.name ?? "").startsWith(seat.name));
    if (want === "none") {
      expect(horseOnly).toHaveLength(2);
    } else {
      expect(horseOnly).toHaveLength(1);
      const other = want === "office" ? "kin_guarantee" : "kin_office";
      expect(hook(state, "Q-001", other).ok).toBe(true); // the wrong pledge: well meant, not what he asked
      clock.next();
      expect(state.history.marriage.kinPledged).toBe(false);
      expect(hook(state, "Q-001", `kin_${want}`).ok).toBe(true);
      clock.next();
      expect(state.history.marriage.kinPledged).toBe(true);
      expect(composeQuestSector(state).allies.filter((l) => (l.name ?? "").startsWith(seat.name))).toHaveLength(2);
    }
  });

  it("married to anyone else, the marriage seat is shut; unmarried, it is open and the kin hooks are not", () => {
    quiet();
    const state = dangerous();
    expect(marry(state, "linda").ok).toBe(true);
    gathering(state);
    expect(state.history.quest.nobles.find((n) => n.motive === "marriage")?.status).toBe("refused");
    expect(hook(state, "Q-001", "approach_marriage").ok).toBe(false);
    expect(hook(state, "Q-001", "kin_office").ok).toBe(false);
    expect(historyPromptBlock(state, "steward")).toContain("the match is shut");
    const single = dangerous();
    gathering(single);
    expect(single.history.quest.nobles.find((n) => n.motive === "marriage")?.status).toBe("unknown");
    expect(hook(single, "Q-001", "kin_office").ok).toBe(false);
    expect(hook(single, "Q-001", "approach_marriage").ok).toBe(true);
  });
});
