import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { applyEffects } from "./effects";
import { setHistoryContentForTests } from "./load";
import { demoteBy, eligibilityNote, eligibleRank, grantVillas, promoteTo, rankLine } from "./promotion";
import { ranksTable } from "./ranks";
import { seasonRevenue, tickRevenue } from "./revenue";
import { EffectsSchema } from "./schema";
import { runHistorySeasonPass } from "./season";
/** Effects as the data loader would hand them over: parsed, with the defaults filled. */
const fx = (raw: unknown) => EffectsSchema.parse(raw);

/** Rank progression (03_HISTORY §10): eligibility, the generic summons, the grants, the stripping. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;

function clockFor(state: WorldState) {
  const next = () => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    if (state.battle_call?.kind === "history") state.battle_call = null;
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1, { coverUpkeep: true });
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  return { next };
}

/** A calendar with no dated events: only the engine systems run. */
function quiet() {
  setHistoryContentForTests({ events: [], features: { promotions: true, historicalBattles: false } });
}

afterEach(() => setHistoryContentForTests(null));

describe("eligibility and the generic summons", () => {
  it("renown makes him eligible up to Duke; the crown is never generic", () => {
    const s = fresh();
    expect(eligibleRank(s)).toBe(1);
    s.player.renown = 100;
    expect(eligibleRank(s)).toBe(2);
    s.player.renown = 2500;
    expect(eligibleRank(s)).toBe(4);
    expect(eligibilityNote(s)).toContain("Duke");
    s.player.rankLevel = 4;
    expect(eligibilityNote(s)).toBeNull();
  });

  it("the summons comes within two years of crossing the threshold and brings the step", () => {
    quiet();
    const s = fresh();
    const clock = clockFor(s);
    s.player.renown = 120;
    const first = clock.next();
    expect(first.effects.some((l) => l.includes("would bear the rank of Viscount"))).toBe(true);
    expect(s.history.rank.eligibleSince).toBe(2);
    const due = s.history.rank.dueTurn!;
    expect(due - 2).toBeGreaterThanOrEqual(ranksTable().summons.minSeasons);
    expect(due - 2).toBeLessThanOrEqual(ranksTable().summons.maxSeasons);
    let promoted: ReturnType<typeof clock.next> | undefined;
    for (let i = 0; i < 10 && !promoted; i++) {
      const r = clock.next();
      if (r.beats.some((b) => b.eventId === "rank:summons")) promoted = r;
    }
    expect(promoted).toBeDefined();
    expect(s.meta.turn).toBe(due);
    expect(s.player.rankLevel).toBe(2);
    expect(s.player.rank).toBe("viscount");
    expect(s.history.rank.patron).toContain("count of Autun");
    expect(promoted!.beats.find((b) => b.eventId === "rank:summons")?.text).toContain("summoned to court");
    expect(promoted!.refereeLines.some((l) => l.includes("raised to rank 2"))).toBe(true);
    // The step: two villas with their people and stores, the chest, the riders, the vassals, the seat's palisade.
    expect(s.holdings.length).toBe(3);
    expect(s.holdings[1].tenure).toBe("benefice");
    expect(s.population.adult_men).toBe(12 + 24);
    expect(s.population.households).toBe(10 + 22);
    expect(s.resources.denarii).toBeGreaterThanOrEqual(138 + 600);
    expect(s.resources.iron).toBeGreaterThanOrEqual(75);
    expect(s.military.units.map((u) => u.strength)).toEqual([9]);
    expect(s.history.vassals.length).toBe(3);
    expect(s.holdings[0].seat).toBe(true);
    expect(s.holdings[0].features).toContain("palisade");
    expect(s.history.record.at(-1)?.text).toContain("Raised to Viscount");
    // Eligibility clears; a second summons needs the next threshold.
    expect(s.history.rank.eligibleSince).toBeNull();
    clock.next();
    expect(s.player.rankLevel).toBe(2);
  });

  it("a sworn king's man is raised by the king; the summons waits while the lord is away or on the ladder", () => {
    quiet();
    const s = fresh();
    s.history.realm.swornTo = "king";
    s.player.renown = 150;
    s.history.away = { reason: "at court", untilTurn: 30 };
    const clock = clockFor(s);
    for (let i = 0; i < 12; i++) clock.next();
    expect(s.player.rankLevel).toBe(1); // away all the while
    s.history.away = null;
    s.history.ladder.stage = "warning";
    clock.next();
    expect(s.player.rankLevel).toBe(1);
    s.history.ladder.stage = "none";
    clock.next();
    expect(s.player.rankLevel).toBe(2);
    expect(s.history.rank.patron).toBe("Pippin of Aquitaine, the king");
  });

  it("the steps stack: a count's county and office, a duke's four counties and Autun's walls", () => {
    const s = fresh();
    s.meta.year = 870;
    const r = promoteTo(s, 4, { patron: "Charles the Bald, the king", turn: 100 });
    expect(r.promoted).toBe(4);
    expect(r.beats.length).toBe(3); // one account per step
    expect(s.player.rankLevel).toBe(4);
    expect(s.holdings.length).toBe(45);
    expect(new Set(s.holdings.map((h) => h.id)).size).toBe(45);
    expect(new Set(s.holdings.map((h) => h.name)).size).toBe(45);
    expect(s.history.rank.counties.map((c) => c.name)).toEqual(["Beaune", "Avallon", "Chalon", "Autun"]);
    expect(s.history.flags.holds_autun).toBe(true);
    expect(s.holdings[0].features).toContain("stone_wall");
    expect(s.history.rank.mint).toBe(1200); // Chalon's mint, held after 864
    expect(s.history.vassals.filter((v) => !v.group).length).toBe(10);
    expect(s.history.vassals.filter((v) => v.group).length).toBe(4);
    expect(s.military.units.reduce((n, u) => n + u.strength, 0)).toBe(9 + 30 + 100);
    expect(s.resources.denarii).toBe(138 + 600 + 4000 + 30000);
    const rev = seasonRevenue(s);
    expect(rev.tolls).toBe(Math.round((2500 + 2750 * 2 + 2750 * 1.4) / 4));
    expect(rev.mint).toBe(300);
    expect(rev.officers).toBe(Math.round((600 + 900 * 3) / 4));
    expect(rev.net).toBeGreaterThan(8000);
    tickRevenue(s, { year: 870, season: "summer" }, 101);
    expect(s.history.rank.lastRevenue?.net).toBe(rev.net);
    expect(rankLine(s)).toContain("Duke");
    expect(rankLine(s)).toContain("Beaune, Avallon, Chalon, Autun");
  });

  it("trade health scales the tolls and the market dues", () => {
    const s = fresh();
    promoteTo(s, 3, { patron: "the king", turn: 50 });
    const base = seasonRevenue(s);
    s.history.trade.health = 110;
    const boom = seasonRevenue(s);
    expect(boom.tolls).toBe(base.tolls * 1.6);
    expect(boom.market).toBe(base.market * 1.6);
    expect(boom.justice).toBe(base.justice);
    s.history.trade.health = 10;
    expect(seasonRevenue(s).tolls).toBe(base.tolls * 0.4);
  });
});

describe("stripping and forfeiture", () => {
  it("a stripping takes the office and the stripping hand's benefices, keeps owned land and the men, and cools the summons", () => {
    const s = fresh();
    promoteTo(s, 3, { patron: "Charles the Bald, the king", turn: 40 });
    grantVillas(s, 1, { patron: "the abbey of Flavigny", tenure: "owned", turn: 41 });
    const units = s.military.units.length;
    const r = demoteBy(s, 1, { by: "Charles the Bald, the king", turn: 60 });
    expect(r.lines[0]).toContain("Benefices lost");
    expect(s.player.rankLevel).toBe(2);
    expect(s.player.rank).toBe("viscount");
    expect(s.history.rank.counties).toEqual([]);
    expect(s.holdings.length).toBe(2); // Fontenay and the abbey's villa, owned
    expect(s.holdings[1].grantedBy).toBe("the abbey of Flavigny");
    expect(s.military.units.length).toBe(units);
    expect(s.history.vassals.filter((v) => !v.group).length).toBe(3);
    expect(s.history.rank.cooldownUntil).toBe(60 + ranksTable().summons.cooldownSeasons);
    expect(s.history.record.at(-1)?.text).toContain("Stripped to Viscount");
    // No generic summons during the cooldown, whatever the renown.
    quiet();
    s.player.renown = 900;
    const clock = clockFor(s);
    for (let i = 0; i < 8; i++) clock.next();
    expect(s.player.rankLevel).toBe(2);
  });

  it("the forfeit and grant effects work from data", () => {
    const s = fresh();
    const r = applyEffects(s, fx({ grant: { patron: "Pippin II, king of Aquitaine", villas: 2 } }), "test:grant");
    expect(r.lines[0]).toContain("Granted the villas");
    expect(s.holdings.length).toBe(3);
    const none = applyEffects(s, fx({ forfeit: { patron: "nobody" } }), "test:none");
    expect(none.lines).toEqual([]);
    const lost = applyEffects(s, fx({ forfeit: { patron: "Pippin II, king of Aquitaine" } }), "test:forfeit");
    expect(lost.lines[0]).toContain("are lost");
    expect(s.holdings.length).toBe(1);
    const county = applyEffects(s, fx({ grant: { patron: "the king", county: "Autun" } }), "test:county");
    expect(county.lines[0]).toContain("county of Autun");
    expect(s.history.flags.holds_autun).toBe(true);
  });

  it("a promote effect below the threshold is thanks; at it the step and onPromote follow", () => {
    const s = fresh();
    const thanks = applyEffects(s, fx({ promote: { patron: "the count", cap: 3, onThanks: { gain: { denarii: 60 } } } }), "W-1:onFire");
    expect(thanks.lines).toEqual(["60 denarii received."]);
    expect(s.history.rank.windows["W-1"]).toBe("thanks");
    s.player.renown = 100;
    const raised = applyEffects(s, fx({ promote: { patron: "the count", cap: 3, onPromote: { gain: { horses: 1 } } } }), "W-2:onFire");
    expect(raised.beats.length).toBe(1);
    expect(raised.lines).toContain("Raised to Viscount by the count.");
    expect(raised.lines).toContain("1 horses received.");
    expect(s.history.rank.windows["W-2"]).toBe("promoted");
    // The cap holds: a patron who cannot make dukes.
    s.player.renown = 5000;
    s.player.rankLevel = 3;
    applyEffects(s, fx({ promote: { patron: "Pippin", cap: 3 } }), "W-3:onFire");
    expect(s.player.rankLevel).toBe(3);
    expect(s.history.rank.windows["W-3"]).toBe("thanks");
  });

  it("old saves get the rank block, the vassals and the trade health by default", () => {
    const raw = structuredClone(startingEstate) as { history?: unknown };
    delete raw.history;
    const s = WorldStateSchema.parse(raw);
    expect(s.history.rank.counties).toEqual([]);
    expect(s.history.rank.eligibleSince).toBeNull();
    expect(s.history.vassals).toEqual([]);
    expect(s.history.trade.health).toBe(55);
    expect(s.holdings[0].tenure).toBeUndefined();
  });
});
