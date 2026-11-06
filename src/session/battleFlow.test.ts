import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { createRng } from "../combat/rng";
import { openHistoricalBattle } from "../history/battles";
import { historyContent } from "../history/load";
import { promoteTo } from "../history/promotion";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";
import {
  acceptCall,
  addressFile,
  beforeRound,
  contributionShare,
  soloFateOdds,
  spoilsPool,
  battleChoose,
  battleCommandRound,
  battleContinue,
  beginBattle,
  dayEndChoice,
  deployFile,
  deployRest,
  finishBattle,
  musterAndRide,
  raiseBattleCall,
  raiseCallDirect,
  refuseCall,
  scoutChooseRole,
  scoutFinalize,
  scoutNarrow,
  type BattleDeps,
} from "./battle";

function freshState(): WorldState {
  return WorldStateSchema.parse(JSON.parse(JSON.stringify(startingEstate)));
}

function deps(reply = "The horns sound and the lines go forward across the wet grass.", fail = false): BattleDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chat: async (messages) => {
      calls.push(messages[messages.length - 1].content);
      if (fail) throw new Error("no key");
      return reply;
    },
    log: () => {},
  };
}

async function playToEnd(state: WorldState, d: BattleDeps, pick: (i: number) => "A" | "B" = () => "A") {
  let choices = 0;
  for (let guard = 0; guard < 200 && state.battle_session?.phase === "fighting"; guard++) {
    const s = state.battle_session!;
    if (s.pendingCard || s.pendingRout) {
      await battleChoose(state, d, pick(choices++));
    } else {
      const err = await battleContinue(state, d);
      if (err) throw new Error(err);
    }
  }
  return choices;
}

describe("old saves and schema defaults", () => {
  it("the starting estate parses with the new player and battle fields defaulted", () => {
    const s = freshState();
    expect(s.player.rankLevel).toBe(1);
    expect(s.player.renown).toBe(1);
    expect(s.player.personal.hp).toBe(20);
    expect(s.player.wounds).toEqual([]);
    expect(s.military.units).toEqual([]);
    expect(s.battle).toBeNull();
    expect(s.battle_session).toBeNull();
    expect(s.battle_call).toBeNull();
    expect(s.battle_history).toEqual([]);
  });
});

describe("calls to arms", () => {
  it("a muster event raises a summons; unrelated events do not; one call at a time", () => {
    const s = freshState();
    expect(raiseBattleCall(s, ["w-frost", "pop-unrest"])).toBeNull();
    const call = raiseBattleCall(s, ["w-rain", "pol-muster"]);
    expect(call?.kind).toBe("summons");
    expect(s.battle_call?.eventId).toBe("pol-muster");
    expect(raiseBattleCall(s, ["th-bandits"])).toBeNull();
  });

  it("refusing a raid marks the district troubled; refusing a summons does not", () => {
    const s = freshState();
    raiseCallDirect(s, "raid", 1);
    refuseCall(s, deps());
    expect(s.battle_call).toBeNull();
    expect(s.flags.active_threat).toBe(true);
    const t = freshState();
    raiseCallDirect(t, "summons", 1);
    refuseCall(t, deps());
    expect(t.flags.active_threat).toBe(false);
  });

  it("solo rule: a raid with no units and no allies is a narrated loss, not a battle", () => {
    const s = freshState();
    const denarii = s.resources.denarii;
    raiseCallDirect(s, "raid", 3);
    const r = acceptCall(s, deps());
    expect(r.started).toBe(false);
    expect(s.battle_session).toBeNull();
    expect(s.battle_call).toBeNull();
    expect(s.resources.denarii).toBeLessThan(denarii);
    expect(s.flags.active_threat).toBe(true);
    expect(s.battle_history).toHaveLength(1);
    expect(s.battle_history[0].outcome).toBe("solo_loss");
    expect(s.battle_history[0].renownDelta).toBe(0); // failure to hold is narrative, not Renown
    expect(s.battle_history[0].summary).toMatch(/escape \d+%, death \d+%, capture \d+%/);
  });

  it("solo fate uses the rout math: a mounted lord mostly outruns foot raiders, less so when horse are among them", () => {
    // Northmen are ship crews on foot (Speed 2): three of them total 6 vs the lord's 5 → escape 0.5 + (5−6)×0.1 = 0.4 at worst,
    // one or two crews → 0.6–0.8. Foot pursuers never make death the likeliest outcome.
    let escapedSum = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const odds = soloFateOdds("raid", seed);
      expect(odds.escaped).toBeGreaterThanOrEqual(0.4);
      expect(odds.escaped + odds.killed + odds.captured).toBeCloseTo(1, 9);
      escapedSum += odds.escaped;
    }
    expect(escapedSum / 20).toBeGreaterThan(0.5);
    // Over many seeds the lord dies sometimes and is taken sometimes; the roll is against those odds.
    const fates = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = freshState();
      raiseCallDirect(s, "raid", seed);
      acceptCall(s, deps());
      const summary = s.battle_history[0].summary;
      fates.add(s.player.dead ? "killed" : /ransomed/.test(summary) ? "captured" : "escaped");
    }
    expect(fates.has("escaped")).toBe(true);
    expect(fates.size).toBeGreaterThan(1);
  });
});

describe("spoils", () => {
  it("pools loot from the dead, common ransoms, and any noble captive, and shares by contribution", () => {
    const s = freshState();
    s.player.fullCommandGranted = false;
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 8);
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, ["u1"]);
    const b = s.battle!;
    // Alone on the field: the whole pool is his, and the captives too.
    expect(contributionShare(s, b, "sub_command")).toBe(1);
    // Fake a finished victory ledger to check the pool arithmetic directly.
    for (const u of b.units.filter((x) => x.side === "enemy")) {
      u.status = "routed";
      u.casualties = 10;
      u.captured = 6;
    }
    const pool = spoilsPool(b, "victory", createRng(1));
    const enemies = b.units.filter((x) => x.side === "enemy").length;
    expect(pool.lootFromDead).toBe(Math.round(10 * enemies * 0.5));
    expect(pool.commonPrisoners + pool.nobles.length).toBe(6 * enemies);
    expect(pool.pool).toBe(pool.lootFromDead + pool.commonRansom + pool.nobleRansom);
    expect(spoilsPool(b, "defeat", createRng(1)).pool).toBe(0);
    expect(spoilsPool(b, "draw", createRng(1)).lootFromDead).toBe(0);
  });

  it("at a summons the lord's share is one horseman's cut, and captives are never his", () => {
    const s = freshState();
    raiseCallDirect(s, "summons", 13);
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, []);
    const share = contributionShare(s, s.battle!, "rank_and_file");
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.05);
  });

  it("a noble captive is rolled from the 10/6/3/1 table and worth 50/100/200/500", () => {
    // Force the chance with a rigged rng: always a noble, rank roll cycling through the table.
    const s = freshState();
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 2);
    acceptCall(s, deps("", true));
    musterAndRide(s, deps("", true), ["u1"]);
    const b = s.battle!;
    const foe = b.units.find((u) => u.side === "enemy")!;
    foe.captured = 4;
    let calls = 0;
    const rigged = { chance: () => true, int: () => [1, 11, 17, 20][calls++ % 4], float: () => 0, between: () => 0, pick: <T,>(a: readonly T[]) => a[0], state: () => 0 };
    const pool = spoilsPool(b, "victory", rigged as unknown as ReturnType<typeof createRng>);
    expect(pool.nobles.map((n) => n.title)).toEqual(["minor noble", "viscount", "count", "magnate"]);
    expect(pool.nobleRansom).toBe(850);
    expect(pool.commonPrisoners).toBe(0);
  });

  it("captives held are settled as mancipia or sold on finishing", () => {
    const s = freshState();
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 5);
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, ["u1"]);
    s.battle_session!.phase = "aftermath";
    s.battle_session!.prisonersHeld = 7;
    s.battle_history.push({ id: "x", turn: 1, year: 825, season: "spring", kind: "bandits", tier: "sub_command", outcome: "victory", rounds: 3, renownDelta: 0, summary: "won" });
    expect(finishBattle(s)).toMatch(/captives/);
    expect(finishBattle(s, "settle")).toBeUndefined();
    expect(s.population.mancipia).toBe(7);
    expect(s.battle_history.at(-1)!.summary).toMatch(/settled on the land as unfree/);
  });
});

describe("Sub-Command battle flow", () => {
  function withUnit(): WorldState {
    const s = freshState();
    s.player.renown = 60;
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    return s;
  }

  /** A marshal who always picks the first feasible objective and phrases it. */
  function marshal(): BattleDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      chat: async (messages) => {
        const last = messages[messages.length - 1].content;
        calls.push(last);
        if (/Objectives the engine can measure/.test(last)) return JSON.stringify({ pick: 0, order: "Hold the centre with your spears until I send word. Do not follow the horse if they go forward." });
        return "The lines are drawn up on the wet grass and the horns sound.";
      },
      log: () => {},
    };
  }

  it("bringing a unit puts the lord in Sub-Command: scene, the marshal's first order, orders each exchange, replacement on resolution", async () => {
    const s = withUnit();
    raiseCallDirect(s, "summons", 41);
    const d = marshal();
    acceptCall(s, d);
    expect(musterAndRide(s, d, ["u1"])).toBeUndefined();
    const sess = s.battle_session!;
    expect(sess.tier).toBe("sub_command");
    expect(s.battle!.player.deferFate).toBe(false);
    // Opening: scene + first objective, no vignette cards at this tier.
    expect(await battleContinue(s, d)).toBeUndefined();
    expect(sess.openingDone).toBe(true);
    expect(sess.pendingCard).toBeNull();
    expect(sess.objectives).toHaveLength(1);
    expect(sess.objectives[0].kind).toBe("hold_column");
    expect(sess.objectives[0].text).toMatch(/Hold the centre/);
    expect(sess.narration.map((n) => n.kind)).toEqual(["scene", "orders"]);
    expect(d.calls.some((c) => /Give him his first order/.test(c))).toBe(true);
    // Orders are validated.
    expect(await battleCommandRound(s, d, [{ type: "teleport", unitId: "p-u1" }])).toMatch(/Order rejected/);
    // Give a hold order to the spears every exchange until the hold objective resolves.
    let guard = 0;
    while (sess.phase === "fighting" && sess.objectives.every((o) => o.status === "active") && guard++ < 12) {
      const err = await battleCommandRound(s, d, [{ type: "hold", unitId: "p-u1" }]);
      expect(err).toBeUndefined();
    }
    const first = sess.objectives[0];
    expect(["success", "failed"]).toContain(first.status);
    expect(first.bonus).toBe(first.status === "success" ? 10 : -10);
    expect(sess.narration.some((n) => n.kind === "result" && n.ref === first.id)).toBe(true);
    if (sess.phase === "fighting" && s.battle!.units.some((u) => u.id === s.battle!.player.attachedUnitId && u.status === "active")) {
      // A replacement order followed, acknowledging the last one.
      expect(sess.objectives.length).toBeGreaterThanOrEqual(2);
      expect(d.calls.some((c) => /Your last order to him was/.test(c))).toBe(true);
    }
    // Run to the end under AI-filled orders; aftermath carries the objective bonus into Renown.
    guard = 0;
    while (sess.phase === "fighting" && guard++ < 80) await battleCommandRound(s, d, []);
    expect(sess.phase).toBe("aftermath");
    expect(sess.objectives.every((o) => o.status !== "active")).toBe(true);
    const bonus = sess.objectives.reduce((sum, o) => sum + (o.bonus ?? 0), 0);
    expect(sess.objectiveBonus).toBe(bonus);
    const rec = s.battle_history.at(-1)!;
    expect(rec.tier).toBe("sub_command");
    expect(rec.summary).toMatch(/the marshal's orders count/);
    const b = s.battle!;
    const dealt = b.units.filter((u) => u.owner === "player").reduce((x, u) => x + u.moraleDealt, 0);
    const taken = b.units.filter((u) => u.owner === "player").reduce((x, u) => x + u.moraleTaken, 0);
    expect(rec.renownDelta).toBe(Math.round(dealt - taken) + Math.round(bonus));
    // Owned unit written back.
    const owned = s.military.units.find((u) => u.id === "u1")!;
    const fought = b.units.find((u) => u.id === "p-u1")!;
    expect(owned.strength).toBe(fought.status === "active" ? fought.strength : fought.escaped);
  });

  it("the marshal falls back to the engine's own words when the model is unavailable", async () => {
    const s = withUnit();
    raiseCallDirect(s, "bandits", 43);
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, ["u1"]);
    await battleContinue(s, d);
    const sess = s.battle_session!;
    expect(sess.objectives).toHaveLength(1);
    expect(sess.objectives[0].text).toMatch(/Hold the (Left|Center|Right)/);
  });
});

describe("Full Command battle flow", () => {
  function granted(seed: number): WorldState {
    const s = freshState();
    s.player.fullCommandGranted = true;
    s.player.renown = 100;
    s.player.rankLevel = 2;
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "summons", seed);
    acceptCall(s, deps("", true));
    musterAndRide(s, deps("", true), ["u1"]);
    return s;
  }

  it("Full Command needs the grant and at least one unit of his own; then the duel opens instead of the fight", () => {
    const noGrant = freshState();
    noGrant.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "x", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(noGrant, "summons", 1);
    acceptCall(noGrant, deps("", true));
    musterAndRide(noGrant, deps("", true), ["u1"]);
    expect(noGrant.battle_session?.tier).toBe("sub_command");
    expect(noGrant.battle_session?.phase).toBe("fighting");

    const alone = freshState();
    alone.player.fullCommandGranted = true;
    raiseCallDirect(alone, "summons", 1);
    acceptCall(alone, deps("", true));
    musterAndRide(alone, deps("", true), []);
    expect(alone.battle_session?.tier).toBe("rank_and_file"); // grant alone is not enough

    const s = granted(2);
    expect(s.battle_session?.tier).toBe("full_command");
    expect(s.battle_session?.phase).toBe("scouting");
    expect(s.battle).toBeNull();
    const sc = s.battle_session!.scouting!;
    expect([4, 6]).toContain(sc.pool.length);
    if (sc.winner === "player") expect(sc.stage).toBe("choose_role");
    else expect(["narrow", "finalize"]).toContain(sc.stage);
  });

  it("the duel resolves both ways and hands a field to deployment; deployment enforces rows and the pool cap", async () => {
    // Find a seed where the lord wins the toss and one where he loses, so both branches run.
    let won: WorldState | undefined;
    let lost: WorldState | undefined;
    for (let seed = 10; seed < 60 && !(won && lost); seed++) {
      const s = granted(seed);
      if (s.battle_session!.scouting!.winner === "player") won ??= s;
      else lost ??= s;
    }
    expect(won && lost).toBeTruthy();

    // Winner chooses to finalize: the enemy narrows for him.
    expect(scoutChooseRole(won!, "finalizer")).toBeUndefined();
    expect(won!.battle_session!.scouting!.stage).toBe("finalize");
    expect(won!.battle_session!.scouting!.shortlist).toHaveLength(3);
    expect(scoutFinalize(won!, 5)).toMatch(/Choose one/);
    expect(scoutFinalize(won!, 1)).toBeUndefined();
    expect(won!.battle_session!.phase).toBe("deployment");
    expect(won!.battle!.battlefield).toEqual(won!.battle_session!.scouting!.shortlist[1]);

    // Loser: role assigned by the enemy; whichever it is, the duel completes.
    const lsc = lost!.battle_session!.scouting!;
    expect(lsc.role).not.toBeNull();
    expect(scoutChooseRole(lost!, "narrower")).toMatch(/no choice of role|not yours/);
    if (lsc.stage === "narrow") {
      expect(scoutNarrow(lost!, [0, 1])).toMatch(/exactly 3/);
      expect(scoutNarrow(lost!, [0, 2, 3])).toBeUndefined();
    } else {
      expect(scoutFinalize(lost!, 0)).toBeUndefined();
    }
    expect(lost!.battle_session!.phase).toBe("deployment");

    // Deployment: enemy already placed, player's side not; rows enforced; Address the Troops capped.
    const s = won!;
    const b = s.battle!;
    expect(b.units.filter((u) => u.side === "enemy").every((u) => u.cell)).toBe(true);
    expect(b.units.filter((u) => u.side === "player").every((u) => !u.cell)).toBe(true);
    expect(beginBattle(s)).toMatch(/undeployed/);
    expect(deployFile(s, "p-u1", { row: 3, col: 1 })).toMatch(/deployment rows/);
    expect(deployFile(s, "e-pedites_fyrd-1", { row: 2, col: 1 })).toMatch(/not yours/);
    expect(deployFile(s, "p-u1", { row: 2, col: 1 })).toBeUndefined();
    expect(b.commandPool.total).toBe(150);
    expect(addressFile(s, "p-u1", 100)).toBeUndefined();
    expect(b.units.find((u) => u.id === "p-u1")!.shield).toBe(55); // capped at base Morale
    expect(b.commandPool.remaining).toBe(95);
    expect(deployRest(s)).toBeUndefined();
    expect(b.units.filter((u) => u.side === "player").every((u) => u.cell && u.cell.row <= 2)).toBe(true);
    expect(beginBattle(s)).toBeUndefined();
    expect(s.battle_session!.phase).toBe("fighting");
    // Opening: a scene, no marshal.
    await battleContinue(s, deps("", true));
    expect(s.battle_session!.openingDone).toBe(true);
    expect(s.battle_session!.objectives).toHaveLength(0);
    expect(s.battle_session!.narration.map((n) => n.kind)).toContain("scene");
  });

  it("nightfall waits for the lord: hold recovers heart, reposition offers three grounds, withdraw ends the day inconclusive", async () => {
    const s = granted(3);
    const d = deps("", true);
    // Skip the duel with the engine's own picks and deploy.
    const sc = s.battle_session!.scouting!;
    if (sc.stage === "choose_role") scoutChooseRole(s, "narrower");
    if (s.battle_session!.scouting!.stage === "narrow") scoutNarrow(s, [0, 1, 2]);
    else scoutFinalize(s, 0);
    deployRest(s);
    beginBattle(s);
    await battleContinue(s, d);
    const b = s.battle!;
    const holdAll = () => b.units.filter((u) => u.side === "player" && u.status === "active").map((u) => ({ type: "hold", unitId: u.id }));
    // Jump to the last exchange of the day so one round of holding brings nightfall before anything is decided.
    b.round = 9;
    await battleCommandRound(s, d, holdAll());
    expect(b.phase).toBe("day_end");
    expect(s.battle_session!.dayEndPending).toBe(true);
    expect(await battleCommandRound(s, d, [])).toMatch(/Night has fallen/);
    // Reposition: first call offers a pool, second picks.
    expect(await dayEndChoice(s, d, "reposition")).toBeUndefined();
    expect(s.battle_session!.repositionPool).toHaveLength(3);
    expect(await dayEndChoice(s, d, "reposition", 9)).toMatch(/Choose one/);
    const chosen = s.battle_session!.repositionPool[2];
    expect(await dayEndChoice(s, d, "reposition", 2)).toBeUndefined();
    expect(b.battlefield.name).toBe(chosen.name);
    expect(b.day).toBe(2);
    expect(b.phase).toBe("rounds");
    expect(s.battle_session!.dayEndPending).toBe(false);
    // Withdraw at the next nightfall.
    b.round = 19;
    await battleCommandRound(s, d, holdAll());
    expect(b.phase).toBe("day_end");
    expect(await dayEndChoice(s, d, "withdraw")).toBeUndefined();
    expect(b.outcome).toBe("withdrawn");
    expect(s.battle_session!.phase).toBe("aftermath");
    expect(s.battle_history.at(-1)?.outcome).toBe("withdrawn");
  });
});

describe("Rank-and-File battle flow", () => {
  it("summons → muster → opening card → crisis cards → aftermath → ledger, with the narrator answering", async () => {
    const s = freshState();
    s.player.renown = 40;
    raiseCallDirect(s, "summons", 11);
    const d = deps();
    expect(acceptCall(s, d).started).toBe(true);
    expect(s.battle_session?.phase).toBe("muster");
    expect(musterAndRide(s, d, [])).toBeUndefined();
    expect(s.battle?.tier).toBe("rank_and_file");
    expect(s.battle_session?.tier).toBe("rank_and_file");
    expect(s.battle?.player.attachedUnitId).toBe("p-lord-file");
    expect(s.battle?.player.deferFate).toBe(true);
    expect(s.battle_call).toBeNull();
    // Allies present at a summons; the lord's file is NPC-led.
    expect(s.battle!.units.some((u) => u.owner === "ally" && u.id !== "p-lord-file")).toBe(true);

    await battleContinue(s, d);
    const sess = s.battle_session!;
    expect(sess.openingDone).toBe(true);
    expect(sess.pendingCard).not.toBeNull();
    expect(sess.narration.map((n) => n.kind)).toEqual(["scene", "card"]);
    expect(d.calls[0]).toMatch(/Open the battle/);
    const openingId = sess.pendingCard!.vignetteId;
    expect(await battleContinue(s, d)).toMatch(/waits on your choice/);

    const choices = await playToEnd(s, d, (i) => (i % 2 === 0 ? "A" : "B"));
    expect(choices).toBeGreaterThanOrEqual(1);
    expect(sess.drawn[0]).toBe(openingId);
    expect(new Set(sess.drawn).size).toBe(sess.drawn.length); // no repeats
    expect(sess.crisisDraws).toBeLessThanOrEqual(6);
    expect(sess.phase).toBe("aftermath");
    expect(sess.aftermathText).toBeTruthy();
    expect(s.battle_history).toHaveLength(1);
    const rec = s.battle_history[0];
    expect(["victory", "defeat", "draw"]).toContain(rec.outcome);
    expect(s.player.renown).toBeGreaterThanOrEqual(1);
    expect(s.player.personal.hp).toBe(s.battle!.player.hp);
    // Narrator was asked for bridges and the aftermath.
    expect(d.calls.some((c) => /carries the story/.test(c))).toBe(true);
    expect(d.calls.some((c) => /The battle is over/.test(c))).toBe(true);
    expect(finishBattle(s)).toBeUndefined();
    expect(s.battle).toBeNull();
    expect(s.battle_session).toBeNull();
  });

  it("runs entirely on engine fallbacks when the narrator is unavailable", async () => {
    const s = freshState();
    raiseCallDirect(s, "summons", 5);
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, []);
    await playToEnd(s, d, () => "B");
    const sess = s.battle_session!;
    expect(sess.phase).toBe("aftermath");
    expect(sess.narration.find((n) => n.kind === "scene")?.text).toMatch(/one rider among the rest/);
    expect(sess.aftermathText).toMatch(/Outcome for the host/);
  });

  it("card choices move the ledger: Renown tiers, unit morale, character flags", async () => {
    const s = freshState();
    raiseCallDirect(s, "summons", 7);
    const d = deps();
    acceptCall(s, d);
    musterAndRide(s, d, []);
    await battleContinue(s, d);
    const sess = s.battle_session!;
    // Force a known card to make the effect legible.
    sess.pendingCard = { vignetteId: "first_blood", bridge: "x" };
    const mine = s.battle!.units.find((u) => u.id === "p-lord-file")!;
    mine.morale = 50;
    await battleChoose(s, d, "A");
    expect(mine.morale).toBe(53);
    expect(sess.narration.at(-1)?.kind).toBe("result");
    sess.pendingCard = { vignetteId: "your_own_colors", bridge: "x" };
    await battleChoose(s, d, "A");
    expect(sess.cardRenown).toBe(3);
    sess.pendingCard = { vignetteId: "man_surrenders", bridge: "x" };
    await battleChoose(s, d, "A");
    expect(sess.characterFlags).toContain("took_prisoner");
    sess.pendingCard = { vignetteId: "bogged_in_swamp", bridge: "x" };
    await battleChoose(s, d, "A");
    expect(s.battle!.player.dismounted).toBe(true);
  });

  it("card draws never repeat and crisis draws never exceed six across many seeds", async () => {
    for (let seed = 30; seed < 36; seed++) {
      const s = freshState();
      raiseCallDirect(s, "summons", seed);
      const d = deps("", true);
      acceptCall(s, d);
      musterAndRide(s, d, []);
      await playToEnd(s, d, (i) => (i % 3 === 0 ? "B" : "A"));
      const sess = s.battle_session!;
      expect(new Set(sess.drawn).size).toBe(sess.drawn.length);
      expect(sess.crisisDraws).toBeLessThanOrEqual(6);
    }
  });

  it("the season cannot turn mid-battle and the state round-trips through the schema", async () => {
    const s = freshState();
    raiseCallDirect(s, "summons", 9);
    const d = deps();
    acceptCall(s, d);
    musterAndRide(s, d, []);
    await battleContinue(s, d);
    const parsed = WorldStateSchema.parse(JSON.parse(JSON.stringify(s)));
    expect(parsed.battle?.round).toBe(s.battle?.round);
    expect(parsed.battle_session?.pendingCard?.vignetteId).toBe(s.battle_session?.pendingCard?.vignetteId);
  });
});

describe("History battle flow (03_HISTORY §9, Battle Force Tables)", () => {
  const ev = (id: string) => historyContent().byId.get(id)!;
  const at830 = { year: 830, season: "spring" } as const;

  function called(id: string, year = 830, season: "spring" | "summer" | "autumn" | "winter" = "spring", prep?: (s: WorldState) => void): WorldState {
    const s = freshState();
    s.meta.year = year;
    s.meta.season = season;
    prep?.(s);
    const r = openHistoricalBattle(s, ev(id), { year, season }, 30);
    expect(r.call).not.toBeNull();
    return s;
  }

  it("a history call is raised by the calendar, not by hand, and the season waits on it", () => {
    const s = freshState();
    expect(() => raiseCallDirect(s, "history" as never, 1)).toThrow();
    const game = new GameController(called("830-B1"), fs.mkdtempSync(path.join(os.tmpdir(), "isekai-hist-")), defaultAppSettings());
    const err = game.raiseCall("history" as never);
    expect(err.error).toBeTruthy();
    return game.advanceSeason().then((r) => {
      expect(r.error).toMatch(/Ride out or turn back/);
      expect(game.view().state.battle_call?.kind).toBe("history");
    });
  });

  it("turning back clears the call and takes the penalty; barring the hall loses the stores", () => {
    const s = called("830-B1");
    s.history.flags.count_opinion = 50;
    s.player.renown = 50;
    const renown = s.player.renown;
    const text = refuseCall(s, deps());
    expect(text).toMatch(/^You turn back/);
    expect(s.battle_call).toBeNull();
    expect(s.history.flags.count_opinion).toBe(48);
    expect(s.player.renown).toBeLessThan(renown);
    expect(s.flags.active_threat).toBe(false); // not a raid

    const gate = freshState();
    gate.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    openHistoricalBattle(gate, ev("834-03"), { year: 834, season: "autumn" }, 40, { supply: { situation: "foraging", share: 0.3 } });
    const wheat = gate.resources.wheat;
    expect(refuseCall(gate, deps())).toMatch(/^You bar the hall/);
    expect(gate.resources.wheat).toBeLessThan(wheat);
  });

  it("Rank-and-File in a sector: the table's allies, the lord in the table's `lord` file, no extra nobles' file, the premise and momentum logged", async () => {
    const s = called("830-B1");
    const d = deps();
    const accepted = acceptCall(s, d);
    expect(accepted.started).toBe(true);
    expect(s.battle_session?.historical).toMatchObject({ id: "deserters_830", eventId: "830-B1", mode: "attached", abstractApplied: [], betrayed: false });
    expect(musterAndRide(s, d, [])).toBeUndefined();
    const b = s.battle!;
    expect(s.battle_session?.tier).toBe("rank_and_file");
    expect(b.player.attachedUnitId).toBe("p-lord-file");
    const lordFile = b.units.find((u) => u.id === "p-lord-file")!;
    expect(lordFile.name).toBe("The deputy's riders");
    expect(b.units.filter((u) => u.side === "player")).toHaveLength(1); // the row, nothing added
    const foe = b.units.find((u) => u.side === "enemy")!;
    expect(foe.name).toBe("Deserters at their plunder");
    expect(foe.strength).toBe(18);
    expect(foe.morale).toBeLessThanOrEqual(Math.floor(foe.maxMorale * 0.2)); // Disordered
    expect(b.battlefield.name).toBe("A village in the Morvan");
    expect(b.log.some((l) => l.text.includes("Historical momentum"))).toBe(true);
    await playToEnd(s, d, () => "A");
    const sess = s.battle_session!;
    expect(sess.phase).toBe("aftermath");
    const rec = s.battle_history.at(-1)!;
    expect(rec.kind).toBe("history");
    expect(rec.summary).toMatch(/The wider battle went as history says it did/);
    expect(s.history.record.some((r) => /deserters plundering a village|driven off by deserters|held his ground at/.test(r.text))).toBe(true);
    expect(finishBattle(s)).toBeUndefined();
    expect(s.battle_session).toBeNull();
  });

  it("Sub-Command in a sector: own files displace allied ones one for one, never the fixed; the lord holds the wall he was given", () => {
    const s = called("834-B1", 834, "summer", (st) => {
      st.player.rankLevel = 2;
      st.player.renown = 60;
      st.military.units.push(
        { id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 },
        { id: "u2", sheetId: "caballarii", name: "Fontenay horse", veteran: false, strength: 10, raisedTurn: 1 },
      );
    });
    const d = deps("", true);
    acceptCall(s, d);
    expect(musterAndRide(s, d, ["u1", "u2"])).toBeUndefined();
    const b = s.battle!;
    expect(s.battle_session?.tier).toBe("sub_command");
    const allies = b.units.filter((u) => u.owner === "ally");
    expect(allies).toHaveLength(3); // the rank-2 row of four less one displaced
    expect(allies.some((u) => u.id.startsWith("a-gaucelm-"))).toBe(true);
    expect(allies.some((u) => u.name === "The townsfolk")).toBe(false);
    expect(b.units.filter((u) => u.owner === "player")).toHaveLength(2);
    expect(b.player.attachedUnitId).toBe("p-u2"); // his mounted file
    // The table's fort: a makeshift stone wall along the player's front, garrisoned.
    const walls = b.battlefield.cells.filter((c) => c.fortification);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every((c) => c.fortification!.side === "player" && c.fortification!.points.every((p) => p.typeId === "stone_makeshift"))).toBe(true);
    expect(b.units.some((u) => u.side === "player" && u.fort)).toBe(true);
    expect(b.log.some((l) => /makeshift stone wall stands along the lord's line/.test(l.text))).toBe(true);
  });

  it("an enemy fort is garrisoned by the enemy; a king row brings Full Command by right", () => {
    const s = called("866-B1", 866, "autumn", (st) => {
      st.player.rankLevel = 2;
      st.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    });
    const d = deps("", true);
    acceptCall(s, d);
    expect(musterAndRide(s, d, ["u1"])).toBeUndefined();
    const b = s.battle!;
    const walls = b.battlefield.cells.filter((c) => c.fortification);
    expect(walls.every((c) => c.fortification!.side === "enemy")).toBe(true);
    expect(b.units.some((u) => u.side === "enemy" && u.fort)).toBe(true);
    expect(b.units.some((u) => u.id.startsWith("a-robert-"))).toBe(true);

    const duke = called("888-B1", 888, "summer", (st) => {
      st.player.rankLevel = 4; // at 80 he commands from behind the line, but a duke's sector is his by right all the same
      st.military.units.push({ id: "u1", sheetId: "heavy_horse", name: "The household horse", veteran: true, strength: 10, raisedTurn: 1 });
    });
    acceptCall(duke, d);
    expect(musterAndRide(duke, d, ["u1"])).toBeUndefined();
    expect(duke.battle_session?.tier).toBe("full_command");
    expect(duke.battle_session?.phase).toBe("scouting");
  });

  it("men sent under a captain: by letter, no file for the lord, the same orders; nothing to send clears the call", () => {
    const s = called("888-B1", 888, "summer", (st) => {
      st.history.flags.saint_florentin_888 = "sent_men";
      st.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    });
    expect(s.battle_call?.mode).toBe("captain");
    const d = deps("", true);
    acceptCall(s, d);
    expect(musterAndRide(s, d, [])).toMatch(/choose at least one file to send/);
    expect(musterAndRide(s, d, ["u1"])).toBeUndefined();
    const b = s.battle!;
    expect(b.player.attachedUnitId).toBeNull();
    expect(b.log.some((l) => /His captain carries his orders/.test(l.text))).toBe(true);
    expect(s.battle_session?.tier).toBe("sub_command");

    const none = called("888-B1", 888, "summer", (st) => {
      st.history.flags.saint_florentin_888 = "sent_men";
    });
    const r = acceptCall(none, d);
    expect(r.started).toBe(false);
    expect(none.battle_call).toBeNull();
  });

  it("past sixty-five the lord commands from behind the line; in his fifties he rides but every wound roll is taken twice", async () => {
    const old = called("888-B1", 888, "summer", (st) => {
      st.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    });
    expect(old.battle_call?.mode).toBe("unattached"); // born 808 → 80
    const d = deps("", true);
    acceptCall(old, d);
    expect(musterAndRide(old, d, ["u1"])).toBeUndefined();
    expect(old.battle!.player.attachedUnitId).toBeNull();
    expect(old.battle!.log.some((l) => /commands from behind the line, unattached, as his years require/.test(l.text))).toBe(true);

    const fifties = called("866-B1", 866, "autumn"); // born 808 → 58
    expect(fifties.battle_call?.mode).toBe("attached");
    expect(fifties.battle_call?.note).toMatch(/every wound roll is taken twice/);
    acceptCall(fifties, d);
    expect(musterAndRide(fifties, d, [])).toBeUndefined();
    expect(fifties.battle!.player.attachedUnitId).toBe("p-lord-file");
    expect(fifties.battle!.player.woundRollMode).toBe("normal");
    beforeRound(fifties);
    expect(fifties.battle!.player.woundRollMode).toBe("extra");
    // The abstract layer arrives as engine notes in the session as the rounds go by (Brissarthe: rounds 3 and 5).
    await playToEnd(fifties, d, () => "A");
    const sess = fifties.battle_session!;
    expect(sess.phase).toBe("aftermath");
    const applied = sess.historical!.abstractApplied;
    const rounds = fifties.battle!.round;
    expect(applied.length).toBe(rounds >= 5 ? 2 : rounds >= 3 ? 1 : 0);
    expect(sess.narration.filter((n) => n.kind === "engine" && /The heat|The church doors burst open/.test(n.text))).toHaveLength(applied.length);
  });

  it("a home defence at the gate: no allies, the villa's own makeshift wall, the stores settled by the result", async () => {
    const s = freshState();
    s.meta.year = 834;
    s.meta.season = "autumn";
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "The militia", veteran: false, strength: 30, raisedTurn: 1 });
    openHistoricalBattle(s, ev("834-03"), { year: 834, season: "autumn" }, 40, { supply: { situation: "foraging", share: 0.3 } });
    expect(s.battle_call?.mode).toBe("attached");
    const d = deps("", true);
    acceptCall(s, d);
    expect(musterAndRide(s, d, ["u1"])).toBeUndefined();
    const b = s.battle!;
    expect(b.units.filter((u) => u.owner === "ally")).toHaveLength(0);
    const walls = b.battlefield.cells.filter((c) => c.fortification);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every((c) => c.fortification!.side === "player" && c.fortification!.points.every((p) => p.typeId === "wooden_makeshift"))).toBe(true);
    const wheat = s.resources.wheat;
    const threat = s.flags.active_threat;
    let guard = 0;
    while (s.battle_session?.phase === "fighting" && guard++ < 80) await battleCommandRound(s, d, []);
    expect(s.battle_session?.phase).toBe("aftermath");
    const rec = s.battle_history.at(-1)!;
    expect(rec.summary).toMatch(/Supply check \(foraging\)/);
    if (rec.outcome === "victory") expect(s.resources.wheat).toBe(wheat);
    else expect(s.resources.wheat).toBeLessThan(wheat);
    expect(s.flags.active_threat).toBe(threat); // the gate's threat flag is not the supply check's
  });

  it("the history session round-trips through the schema", () => {
    const s = called("834-B1", 834, "summer", (st) => {
      st.player.rankLevel = 2;
      st.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    });
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, ["u1"]);
    const parsed = WorldStateSchema.parse(JSON.parse(JSON.stringify(s)));
    expect(parsed.battle_session?.historical).toEqual(s.battle_session?.historical);
    expect(parsed.battle_session?.callKind).toBe("history");
  });
});

describe("the sworn men on the field (rank design 'Vassals')", () => {
  it("a viscount's vassals ride as an allied file sized by their mood, and the result moves them; a call refused sours them", async () => {
    const s = freshState();
    s.player.renown = 120;
    promoteTo(s, 2, { patron: "the count", turn: 1 });
    const own = s.history.vassals.filter((v) => !v.group);
    expect(own).toHaveLength(3);
    own[0].mood = 70; // brings one more
    own[2].mood = 20; // stays home
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 8);
    const d = deps("", true);
    acceptCall(s, d);
    musterAndRide(s, d, ["u1"]);
    const expected = own[0].men + 1 + own[1].men;
    expect(s.battle_session?.swornMen).toBe(expected);
    expect(s.battle_session?.premise).toContain(`${expected} of the lord's sworn men ride at his side`);
    expect(s.battle_session?.premise).toContain(`${own[2].name} sent no one`);
    const file = s.battle!.units.find((u) => u.name === "The sworn men")!;
    expect(file.owner).toBe("ally");
    expect(file.strength).toBe(expected);
    let guard = 0;
    while (s.battle_session?.phase === "fighting" && guard++ < 80) await battleCommandRound(s, d, []);
    expect(s.battle_session?.phase).toBe("aftermath");
    const outcome = s.battle_history.at(-1)!.outcome;
    const moved = own[1].mood;
    if (outcome === "victory") expect(moved).toBe(58);
    else if (outcome === "defeat") expect(moved).toBe(42);
    else expect(moved).toBe(48);
    expect(s.battle_history.at(-1)!.summary).toContain("The sworn men —");

    const t = freshState();
    t.player.renown = 120;
    promoteTo(t, 2, { patron: "the count", turn: 1 });
    raiseCallDirect(t, "raid", 1);
    refuseCall(t, deps());
    expect(t.history.vassals.every((v) => v.mood === 44 && v.lastReason === "the lord did not answer the call")).toBe(true);
    // A summons away is the count's affair, not theirs.
    raiseCallDirect(t, "summons", 2);
    refuseCall(t, deps());
    expect(t.history.vassals.every((v) => v.mood === 44)).toBe(true);
  });
});