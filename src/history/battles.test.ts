import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { addUnit, beginRounds, createBattle, playRound } from "../combat/battle";
import type { UnitInstance } from "../combat/battleTypes";
import { autoDeploy } from "../combat/scenario";
import { spawnUnit } from "../combat/units";
import { generateLayout } from "../combat/scouting";
import { createRng } from "../combat/rng";
import {
  applyAbstractLayer,
  applyHistoricalResults,
  applyLineMorale,
  composeAllies,
  composeQuestSector,
  forcesForEvent,
  historicalEncounter,
  historicalTier,
  historyForces,
  historyRideMode,
  openHistoricalBattle,
  refuseHistoricalBattle,
  resultClass,
  rowForRank,
} from "./battles";
import { historyContent } from "./load";

/** The battle pass (03_HISTORY §9) against the shipped Battle Force Tables. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function at(year: number, season: "spring" | "summer" | "autumn" | "winter" = "summer") {
  return { year, season } as const;
}

const event = (id: string) => historyContent().byId.get(id)!;

describe("the forces tables", () => {
  it("every deferred battle in the calendar has a forces entry; supply entries are home defences", () => {
    const content = historyContent();
    for (const e of content.events) {
      if (e.deferred !== "battle") continue;
      expect(content.battles.some((b) => b.event === e.id && !b.supply), e.id).toBe(true);
    }
    for (const b of content.battles) {
      if (b.supply) expect(b.home, b.id).toBe(true);
      if (b.home) expect(Object.keys(b.rows), b.id).toEqual([]);
    }
  });

  it("picks the entry whose `when` holds: Fontenoy on Charles's side is Warin's column, otherwise the main line", () => {
    const s = fresh();
    expect(forcesForEvent(s, "841-02", at(841))?.id).toBe("fontenoy_main");
    s.history.flags.fontenoy_charles = true;
    expect(forcesForEvent(s, "841-02", at(841))?.id).toBe("fontenoy_relief");
    // Supply entries never answer a plain lookup, and vice versa.
    expect(forcesForEvent(s, "841-02", at(841), { supply: true })?.id).toBe("foragers_841_host");
    expect(forcesForEvent(s, "834-03", at(834))).toBeUndefined();
    expect(forcesForEvent(s, "834-03", at(834), { supply: true })?.id).toBe("foragers_834");
  });

  it("rows fall back to the highest defined at or below the rank, else the lowest", () => {
    const f = historyForces("deserters_830")!; // rows 1 and 2 only
    expect(rowForRank(f, 1)?.slots).toBe(0);
    expect(rowForRank(f, 2)?.slots).toBe(1);
    expect(rowForRank(f, 4)?.slots).toBe(1);
    expect(rowForRank(f, 0)?.slots).toBe(0);
    const g = historyForces("saint_florentin_888")!; // has a king row
    expect(rowForRank(g, 5)?.slots).toBe(4);
  });
});

describe("composing the sector", () => {
  const chalon = () => historyForces("chalon_834")!;

  it("a villa lord with nothing brings the row as written", () => {
    const allies = composeAllies(chalon(), 1, 0);
    expect(allies).toHaveLength(5);
    expect(allies[0]).toMatchObject({ sheetId: "elite_foot", lineId: "gaucelm", fixed: true, lord: true, owner: "ally" });
  });

  it("fewer files than the row expects are made up from `fill`; more displace allied files from the end, never fixed ones", () => {
    const f = chalon();
    // Rank 2 expects one file: bringing none fills one of Warin's spearmen.
    const none = composeAllies(f, 2, 0);
    expect(none).toHaveLength(5);
    expect(none.at(-1)?.name).toBe("Warin's spearmen");
    // Bringing one matches the row.
    expect(composeAllies(f, 2, 1)).toHaveLength(4);
    // Bringing two displaces the townsfolk (the last non-fixed line).
    const two = composeAllies(f, 2, 2);
    expect(two).toHaveLength(3);
    expect(two.some((l) => l.name === "The townsfolk")).toBe(false);
    // Bringing ten displaces everything but Gaucelm.
    const ten = composeAllies(f, 2, 10);
    expect(ten.map((l) => l.lineId)).toEqual(["gaucelm"]);
  });

  it("the default fill alternates horse and spear when a row names none", () => {
    const f = historyForces("fontenoy_main")!;
    const row = rowForRank(f, 4)!;
    expect(row.fill ?? []).toEqual([]);
    const allies = composeAllies(f, 4, 0);
    expect(allies).toHaveLength(row.allies.reduce((n, l) => n + l.count, 0) + row.slots);
    const filled = allies.slice(-row.slots).map((l) => l.sheetId);
    expect(filled[0]).toBe("caballarii");
    expect(filled[1]).toBe("pedites_fyrd");
  });

  it("home defences have no allies at any rank", () => {
    expect(composeAllies(historyForces("foragers_834")!, 4, 0)).toEqual([]);
  });

  it("the tier: one horseman with nothing, Sub-Command with a file, Full Command by right or by table", () => {
    const s = fresh();
    const f = chalon();
    expect(historicalTier(s, f, 0, "attached")).toBe("rank_and_file");
    expect(historicalTier(s, f, 0, "unattached")).toBe("sub_command");
    expect(historicalTier(s, f, 1, "attached")).toBe("sub_command");
    s.player.rankLevel = 3;
    expect(historicalTier(s, f, 2, "attached")).toBe("sub_command");
    expect(historicalTier(s, f, 3, "attached")).toBe("full_command");
    s.player.rankLevel = 4;
    expect(historicalTier(s, f, 1, "attached")).toBe("full_command");
    const q = fresh();
    expect(historicalTier(q, historyForces("field_against_the_king")!, 1, "attached")).toBe("full_command");
  });

  it("at Rank-and-File the encounter always has a file for the lord to ride in", () => {
    const s = fresh();
    const call = { kind: "history" as const, eventId: "841-02", text: "", seed: 1, createdTurn: 1, historyId: "fontenoy_main", mode: "attached" as const };
    const enc = historicalEncounter(s, call, 0)!;
    expect(enc.tier).toBe("rank_and_file");
    expect(enc.allies.filter((a) => a.lord)).toHaveLength(1);
    expect(enc.enemy.length).toBeGreaterThan(0);
  });

  it("the king-quest sector: the supporters' contingents, the household, one betrayer; the king grows with every noble lost", () => {
    const s = fresh();
    s.history.quest.nobles = [
      { motive: "grievance", name: "Count A", status: "won" },
      { motive: "fear", name: "Count B", status: "betrayer" },
      { motive: "money", name: "Count C", status: "won" },
      { motive: "land", name: "Count D", status: "won" },
      { motive: "office", name: "Count E", status: "refused" },
    ];
    const q = composeQuestSector(s);
    expect(q.allies[0]).toMatchObject({ sheetId: "elite_foot", lord: true, fixed: true });
    expect(q.allies.filter((a) => a.lineId === "betrayer")).toHaveLength(2);
    expect(q.betrayerUnits).toBe(2);
    expect(q.allies.every((a) => a.owner === "ally")).toBe(true);
    expect(q.enemy).toHaveLength(7); // four won → seven files
    expect(q.enemy.slice(0, 3).map((e) => e.sheetId)).toEqual(["heavy_horse", "heavy_horse", "elite_foot"]);
    for (const n of s.history.quest.nobles) if (n.motive === "office") n.status = "won";
    s.history.quest.nobles.push({ motive: "debt", name: "F", status: "won" }, { motive: "divine", name: "G", status: "won" }, { motive: "protection", name: "H", status: "won" });
    expect(composeQuestSector(s).enemy).toHaveLength(5); // eight → the king's five
  });
});

describe("raising and refusing the call", () => {
  it("the mode: in a file while young, from behind the line at 65, by letter when men were sent", () => {
    const s = fresh();
    expect(historyRideMode(s, event("830-B1"), at(830))).toBe("attached");
    expect(historyRideMode(s, event("888-B1"), at(888))).toBe("unattached"); // born 808 → 80
    const sent = fresh();
    sent.history.flags.saint_florentin_888 = "sent_men";
    expect(historyRideMode(sent, event("888-B1"), at(888))).toBe("captain");
    const maimed = fresh();
    maimed.player.wounds.push({ location: "leg", cause: "x", statEffect: {}, renownEffect: 0, narrativeFlags: [], seasonsHeld: 0, permanent: true });
    expect(historyRideMode(maimed, event("830-B1"), at(830))).toBe("unattached");
  });

  it("opens one history call with the table's text, a seed, the mode and the note; nothing for the dead or while a fight is open", () => {
    const s = fresh();
    s.meta.year = 830;
    s.meta.season = "spring";
    const r = openHistoricalBattle(s, event("830-B1"), at(830, "spring"), 21);
    expect(r.call).not.toBeNull();
    expect(s.battle_call).toMatchObject({ kind: "history", eventId: "830-B1", historyId: "deserters_830", mode: "attached", createdTurn: 21 });
    expect(s.battle_call?.text).toContain("deserters from the broken host");
    expect(s.battle_call?.note).toContain("one horseman in an allied file");
    expect(r.beats[0]).toMatchObject({ npcId: "steward", eventId: "830-B1" });
    expect(r.beats[0].text).toContain("The muster waits on you");
    // A second history battle the same season gives way.
    const again = openHistoricalBattle(s, event("841-02"), at(841), 22);
    expect(again.call).toBeNull();
    expect(s.battle_call?.historyId).toBe("deserters_830");
    // The same seed for the same place and turn.
    const t = fresh();
    openHistoricalBattle(t, event("830-B1"), at(830, "spring"), 21);
    expect(t.battle_call?.seed).toBe(s.battle_call?.seed);

    const dead = fresh();
    dead.player.dead = true;
    expect(openHistoricalBattle(dead, event("830-B1"), at(830, "spring"), 21).call).toBeNull();
    const fighting = fresh();
    fighting.battle_session = { phase: "muster" } as never;
    expect(openHistoricalBattle(fighting, event("830-B1"), at(830, "spring"), 21).call).toBeNull();
  });

  it("a home defence raised by the supply check carries the pre-rolled share and asks about the gate", () => {
    const s = fresh();
    const r = openHistoricalBattle(s, event("834-03"), at(834, "autumn"), 40, { supply: { situation: "foraging", share: 0.25 } });
    expect(r.call?.historyId).toBe("foragers_834");
    expect(r.call?.supply).toEqual({ situation: "foraging", share: 0.25 });
    expect(r.beats[0].text).toContain("ride out or bar the hall");
    expect(r.call?.note).toContain("Home defence");
  });

  it("turning back costs the count's opinion and renown and writes a record line; the hall barred loses the stores", () => {
    const s = fresh();
    s.player.renown = 50;
    s.history.flags.count_opinion = 3;
    s.history.away = { reason: "x", untilTurn: 99 };
    openHistoricalBattle(s, event("830-B1"), at(830, "spring"), 21);
    const lines = refuseHistoricalBattle(s, s.battle_call!);
    expect(lines.length).toBeGreaterThan(0);
    expect(s.history.flags.count_opinion).toBe(1);
    expect(s.player.renown).toBeLessThan(50);
    expect(s.history.record.at(-1)?.text).toContain("Turned back from");
    expect(s.history.away).toBeNull();

    const gate = fresh();
    const wheat = gate.resources.wheat;
    openHistoricalBattle(gate, event("834-03"), at(834, "autumn"), 40, { supply: { situation: "foraging", share: 0.3 } });
    const l2 = refuseHistoricalBattle(gate, gate.battle_call!);
    expect(l2[0]).toContain("the hall was barred");
    expect(gate.resources.wheat).toBeLessThan(wheat);

    const quest = fresh();
    quest.history.quest.phase = "battle";
    openHistoricalBattle(quest, event("Q-002"), at(900), 300);
    refuseHistoricalBattle(quest, quest.battle_call!);
    expect(quest.history.quest.phase).toBe("failed");
  });
});

describe("on the field", () => {
  function sectorBattle(id: string, enemyMorale?: { disordered?: boolean; moraleFraction?: number }, extra: UnitInstance[] = []) {
    const s = fresh();
    const battle = createBattle({
      id: "b",
      seed: 7,
      tier: "sub_command",
      battlefield: generateLayout(createRng(7), { roughness: 0.3 }),
      player: { renown: 50, rank: 1 },
    });
    const a1 = spawnUnit("pedites_fyrd", { id: "a-gaucelm-1", side: "player", owner: "ally", name: "Gaucelm" });
    const a2 = spawnUnit("peasant_levy", { id: "a-peasant_levy-2", side: "player", owner: "ally", name: "Townsfolk" });
    const e1 = spawnUnit("pedites_fyrd", { id: "e-pedites_fyrd-1", side: "enemy", name: "Foe" });
    if (enemyMorale) applyLineMorale(e1, enemyMorale);
    addUnit(battle, a1);
    addUnit(battle, a2);
    addUnit(battle, e1);
    for (const u of extra) addUnit(battle, u);
    autoDeploy(battle, "enemy");
    autoDeploy(battle, "player");
    beginRounds(battle);
    s.battle = battle;
    s.battle_session = {
      phase: "fighting",
      tier: "sub_command",
      callKind: "history",
      encounterSeed: 7,
      historical: { id, eventId: historyForces(id)!.event, mode: "attached", abstractApplied: [], betrayed: false },
    } as never;
    return { s, battle, a1, a2, e1 };
  }

  it("line morale: Disordered is a fifth of the heart, a fraction is a fraction", () => {
    const u = spawnUnit("pedites_fyrd", { id: "x", side: "enemy", name: "x" });
    const max = u.maxMorale;
    applyLineMorale(u, { disordered: true });
    expect(u.morale).toBe(Math.max(1, Math.floor(max * 0.2)));
    const v = spawnUnit("pedites_fyrd", { id: "y", side: "enemy", name: "y" });
    applyLineMorale(v, { moraleFraction: 0.6 });
    expect(v.morale).toBe(Math.round(max * 0.6));
  });

  it("the abstract layer lands each morale event once at its round; the undisciplined feel it harder", () => {
    const { s, battle, a1, a2 } = sectorBattle("chalon_834"); // round 4: −8 ours; round 8: −10 ours
    const m1 = a1.morale;
    const m2 = a2.morale;
    expect(applyAbstractLayer(s)).toEqual([]); // round 0 → nothing due yet
    battle.round = 3; // the layer is applied before round 4 is played
    const texts = applyAbstractLayer(s);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Another stretch of the wall");
    expect(a1.morale).toBe(m1 - 8);
    expect(a2.tags).toContain("undisciplined");
    expect(a2.morale).toBe(m2 - 12);
    expect(applyAbstractLayer(s)).toEqual([]); // not twice
    battle.round = 20;
    expect(applyAbstractLayer(s)).toHaveLength(1); // the second lands; the first does not repeat
    expect(s.battle_session?.historical?.abstractApplied).toEqual([0, 1]);
    expect(battle.log.filter((l) => l.kind === "morale")).toHaveLength(2);
  });

  it("results: the class of the outcome, the table's flags and renown, the survivor's flags only while he stands", () => {
    expect(resultClass("victory")).toBe("won");
    expect(resultClass("enemy_withdrew")).toBe("won");
    expect(resultClass("defeat")).toBe("lost");
    expect(resultClass("draw")).toBe("held");
    expect(resultClass("withdrawn")).toBe("held");
    expect(resultClass(null)).toBe("held");

    const won = sectorBattle("chalon_834");
    won.battle.outcome = "victory";
    const before = won.s.player.renown;
    applyHistoricalResults(won.s, won.battle, won.s.battle_session!);
    expect(won.s.history.flags.chalon_834).toBe("saved_city");
    expect(won.s.history.flags.saved_gaucelm).toBe(true);
    expect(won.s.history.flags.saved_gerberga).toBe(true);
    expect(won.s.player.renown).toBeGreaterThan(before);
    expect(won.s.history.record.at(-1)?.text).toContain("Gaucelm and Gerberga lived");

    const lost = sectorBattle("chalon_834");
    lost.battle.outcome = "defeat";
    lost.a1.status = "routed";
    applyHistoricalResults(lost.s, lost.battle, lost.s.battle_session!);
    expect(lost.s.history.flags.chalon_834).toBe("fell");
    expect(lost.s.history.flags.oath_under_duress_834).toBe(true);
    expect(lost.s.history.flags.saved_gaucelm).toBeUndefined(); // Gaucelm's file broke

    const lostButStanding = sectorBattle("chalon_834");
    lostButStanding.battle.outcome = "defeat";
    applyHistoricalResults(lostButStanding.s, lostButStanding.battle, lostButStanding.s.battle_session!);
    expect(lostButStanding.s.history.flags.saved_gaucelm).toBe(true); // got him away even so
  });

  it("a home defence settles the stores by the result: nothing won, half held, all lost; a plain record line when the table has none", () => {
    for (const [outcome, fraction] of [
      ["victory", 0],
      ["draw", 0.5],
      ["defeat", 1],
    ] as const) {
      const { s, battle } = sectorBattle("foragers_834");
      s.battle_session!.historical!.supply = { situation: "foraging", share: 0.4 };
      const wheat = s.resources.wheat;
      battle.outcome = outcome;
      const lines = applyHistoricalResults(s, battle, s.battle_session!);
      expect(lines.some((l) => l.startsWith("Supply check (foraging)"))).toBe(true);
      if (fraction === 0) expect(s.resources.wheat).toBe(wheat);
      else expect(s.resources.wheat).toBeLessThan(wheat);
      if (fraction === 0.5) expect(lines.some((l) => l.includes("20% of stores"))).toBe(true);
    }
    const { s, battle } = sectorBattle("deserters_830"); // no `held` entry in the table
    battle.outcome = "draw";
    applyHistoricalResults(s, battle, s.battle_session!);
    expect(s.history.record.at(-1)?.text).toMatch(/^The lord held his ground at /);
  });

  it("the king-quest field: the betrayer's files cross over at round three and the quest fails on a loss", () => {
    const turncoat = spawnUnit("heavy_horse", { id: "a-betrayer-1", side: "player", owner: "ally", name: "Count B's household horse" });
    const { s, battle } = sectorBattle("field_against_the_king", undefined, [turncoat]);
    battle.round = 2;
    const texts = applyAbstractLayer(s);
    expect(texts.some((t) => t.includes("Count B has turned"))).toBe(true);
    expect(turncoat.status).toBe("withdrawn");
    const copy = battle.units.find((u) => u.id === "e-turncoat-1")!;
    expect(copy.side).toBe("enemy");
    expect(copy.name).toBe("Count B's household horse");
    expect(s.battle_session?.historical?.betrayed).toBe(true);
    expect(applyAbstractLayer(s)).toEqual([]);
    s.history.quest.phase = "battle";
    battle.outcome = "defeat";
    applyHistoricalResults(s, battle, s.battle_session!);
    expect(s.history.quest.phase).toBe("failed");
  });

  it("a built sector plays rounds to an end", () => {
    const { s, battle } = sectorBattle("deserters_830", { disordered: true });
    let guard = 0;
    while (!battle.outcome && guard++ < 60) {
      applyAbstractLayer(s);
      playRound(battle, [], { allyAi: { posture: "attack" }, enemyAi: { posture: "attack" } });
    }
    expect(battle.outcome).not.toBeNull();
  });
});
