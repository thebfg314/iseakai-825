import { describe, expect, it } from "vitest";
import { addressTroops, attachPlayer, beginRounds, controlledUnitIds, createBattle, deploy, endDay, playRound, summarizeBattle } from "./battle";
import { BattleStateSchema, type BattleState, type Order } from "./battleTypes";
import { assignToPoint, buildFortificationCell, fortDefenderBonus, isTerrainDefender } from "./fortification";
import { cellIndex, emptyBattlefield } from "./grid";
import { createRng } from "./rng";
import { resolveRound } from "./round";
import { buildQuickScenario } from "./scenario";
import { generateLayout } from "./scouting";
import { simulateBattle } from "./simulate";
import { requireUnit, spawnUnit } from "./units";

function unit(state: BattleState, id: string) {
  return requireUnit(state.units, id);
}

/** Two units placed face to face in no man's land, rounds begun. */
function duel(playerSheet: string, enemySheet: string, seed = 1, tier: BattleState["tier"] = "full_command") {
  const state = createBattle({ id: "duel", seed, tier, battlefield: emptyBattlefield(), player: { renown: 40, rank: 1 } });
  state.units.push(spawnUnit(playerSheet, { id: "p1", side: "player", cell: { row: 3, col: 1 } }));
  state.units.push(spawnUnit(enemySheet, { id: "e1", side: "enemy", cell: { row: 3, col: 1 } }));
  attachPlayer(state, "p1");
  state.phase = "rounds";
  return state;
}

describe("round resolution", () => {
  it("engage links both units, strikes are logged with the formula breakdown, and levy morale drains 1:1", () => {
    const state = duel("heavy_horse", "peasant_levy");
    playRound(state, [{ type: "engage", unitId: "p1", targetId: "e1" }], { enemyAi: { posture: "defend" } });
    const hh = unit(state, "p1");
    const levy = unit(state, "e1");
    expect(hh.engagedWith).toEqual(["e1"]);
    expect(levy.engagedWith).toEqual(["p1"]);
    const strike = state.log.find((e) => e.kind === "strike" && e.unitId === "p1");
    expect(strike?.data?.charging).toBe(true);
    expect(strike?.data?.effAtk).toBeCloseTo(18 * 1.4); // first round of a link is a charge; shock ×1.4
    expect(strike?.data?.effDef).toBe(5);
    expect(levy.maxHp - levy.hp).toBeGreaterThan(0);
    expect(levy.maxMorale - levy.morale).toBeGreaterThanOrEqual(levy.maxHp - levy.hp); // undisciplined ×1.5
    expect(hh.moraleDealt).toBe(levy.moraleTaken);
  });

  it("charge bonus applies only on the first round of a link, and only to the unit that made contact", () => {
    const state = duel("heavy_horse", "pedites_fyrd");
    playRound(state, [{ type: "engage", unitId: "p1", targetId: "e1" }], { enemyAi: { posture: "defend" } });
    playRound(state, [], { enemyAi: { posture: "defend" } });
    const strikes = state.log.filter((e) => e.kind === "strike" && e.unitId === "p1");
    expect(strikes[0].data?.charging).toBe(true);
    expect(strikes[0].data?.effAtk).toBeCloseTo(18 * 1.4);
    expect(strikes[1].data?.charging).toBe(false);
    expect(strikes[1].data?.effAtk).toBe(18);
  });

  it("a unit that is charged by shock cavalry does not get the shock bonus on its return strike", () => {
    const state = createBattle({ id: "charged", seed: 3, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit("pedites_fyrd", { id: "pd", side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("heavy_horse", { id: "hh", side: "enemy", cell: { row: 3, col: 1 } }));
    state.phase = "rounds";
    resolveRound(state, [{ type: "engage", unitId: "pd", targetId: "hh" }], createRng(3));
    const horse = state.log.find((e) => e.kind === "strike" && e.unitId === "hh");
    expect(horse?.data?.charging).toBe(false);
    expect(horse?.data?.effAtk).toBe(18);
  });

  it("a stopped charge costs shock cavalry 15 morale; spears braced in formation stop it", () => {
    const state = duel("heavy_horse", "elite_foot");
    playRound(state, [{ type: "engage", unitId: "p1", targetId: "e1" }], { enemyAi: { posture: "defend" } });
    expect(state.log.some((e) => e.kind === "shock" && /charge is stopped/.test(e.text))).toBe(true);
    expect(state.log.some((e) => /braces spears/.test(e.text))).toBe(true);
  });

  it("engagement chains: A→1 and 1→B put 1 in a two-on-one and fire a flank shock", () => {
    const state = createBattle({ id: "chain", seed: 3, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit("pedites_fyrd", { id: "A", side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("pedites_fyrd", { id: "B", side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("heavy_horse", { id: "1", side: "enemy", cell: { row: 3, col: 1 } }));
    state.phase = "rounds";
    resolveRound(
      state,
      [
        { type: "engage", unitId: "A", targetId: "1" },
        { type: "engage", unitId: "1", targetId: "B" },
      ],
      createRng(3),
    );
    expect(unit(state, "1").engagedWith).toEqual(["A", "B"]);
    expect(unit(state, "A").engagedWith).toEqual(["1"]);
    expect(unit(state, "B").engagedWith).toEqual(["1"]);
    expect(state.log.some((e) => e.kind === "shock" && e.unitId === "1" && e.data?.attackers === 2)).toBe(true);
    // 1's single strike is split 2/3 front (A) and 1/3 (B)
    const strikes = state.log.filter((e) => e.kind === "strike" && e.unitId === "1");
    expect(strikes.map((s) => s.targetId)).toEqual(["B", "A"]); // declared target moves to the front
    expect(strikes[0].data?.share).toBeCloseTo(2 / 3, 2);
    expect(strikes[1].data?.share).toBeCloseTo(1 / 3, 2);
  });

  it("gang-up cap: a fourth attacker is refused", () => {
    const state = createBattle({ id: "cap", seed: 4, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    for (const id of ["a", "b", "c", "d"]) state.units.push(spawnUnit("pedites_fyrd", { id, side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("elite_foot", { id: "t", side: "enemy", cell: { row: 3, col: 1 } }));
    state.phase = "rounds";
    const orders: Order[] = ["a", "b", "c", "d"].map((id) => ({ type: "engage", unitId: id, targetId: "t" }));
    resolveRound(state, orders, createRng(4));
    expect(unit(state, "t").engagedWith).toEqual(["a", "b", "c"]);
    expect(unit(state, "d").engagedWith).toEqual([]);
    expect(state.log.some((e) => /already pressed by three/.test(e.text))).toBe(true);
  });

  it("movement banks across rounds and leaving a fight costs double", () => {
    const state = duel("pedites_fyrd", "peasant_levy");
    // Speed 2: one clean move completes in a round.
    playRound(state, [{ type: "move", unitId: "p1", to: { row: 2, col: 1 } }], { enemyAi: { posture: "defend" } });
    expect(unit(state, "p1").cell).toEqual({ row: 2, col: 1 });
    // Back into the fight, engage, then try to leave: 4 points at Speed 2 takes two rounds.
    playRound(state, [{ type: "move", unitId: "p1", to: { row: 3, col: 1 } }], { enemyAi: { posture: "defend" } });
    playRound(state, [{ type: "engage", unitId: "p1", targetId: "e1" }], { enemyAi: { posture: "defend" } });
    playRound(state, [{ type: "move", unitId: "p1", to: { row: 2, col: 1 } }], { enemyAi: { posture: "defend" } });
    const p = unit(state, "p1");
    if (p.status === "active") {
      expect(p.cell).toEqual({ row: 3, col: 1 });
      expect(p.pendingMove?.paid).toBe(2);
      playRound(state, [], { enemyAi: { posture: "defend" } });
      if (unit(state, "p1").status === "active") expect(unit(state, "p1").cell).toEqual({ row: 2, col: 1 });
    }
  });

  it("ranged fire: sticky target, range check, and splash onto a friend engaged with the target", () => {
    const state = createBattle({ id: "arrows", seed: 5, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit("sagittarii", { id: "sg", side: "player", cell: { row: 1, col: 1 } }));
    state.units.push(spawnUnit("pedites_fyrd", { id: "pd", side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("peasant_levy", { id: "lv", side: "enemy", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("peasant_levy", { id: "far", side: "enemy", cell: { row: 5, col: 2 } }));
    state.phase = "rounds";
    const rng = createRng(5);
    resolveRound(state, [{ type: "fire", unitId: "sg", targetId: "far" }], rng);
    expect(state.log.some((e) => /out of range/.test(e.text))).toBe(true);
    resolveRound(state, [{ type: "fire", unitId: "sg", targetId: "lv" }, { type: "engage", unitId: "pd", targetId: "lv" }], rng);
    const volleys = state.log.filter((e) => e.kind === "fire" && e.round === 2);
    expect(volleys.filter((v) => v.targetId === "lv").length).toBeGreaterThanOrEqual(2); // volley + skirmish_volley vs Speed 2
    expect(volleys.some((v) => v.targetId === "pd" && v.data?.splash === true)).toBe(true);
    expect(unit(state, "sg").ammo).toBe(24 - 2);
    // No new order: the archers keep shooting the same target.
    resolveRound(state, [], rng);
    expect(state.log.some((e) => e.kind === "fire" && e.round === 3 && e.unitId === "sg")).toBe(true);
  });

  it("crossbows fire every second round", () => {
    const state = createBattle({ id: "xbow", seed: 6, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit("crossbowmen", { id: "xb", side: "player", cell: { row: 2, col: 1 } }));
    state.units.push(spawnUnit("elite_foot", { id: "ef", side: "enemy", cell: { row: 4, col: 1 } }));
    state.phase = "rounds";
    const rng = createRng(6);
    for (let i = 0; i < 4; i++) resolveRound(state, [{ type: "fire", unitId: "xb", targetId: "ef" }, { type: "hold", unitId: "ef" }], rng);
    const rounds = state.log.filter((e) => e.kind === "fire" && e.unitId === "xb").map((e) => e.round);
    expect(rounds).toEqual([1, 3]);
  });

  it("emptying the quiver strips skirmish_volley and adds low_melee", () => {
    const state = createBattle({ id: "ammo", seed: 7, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    const sg = spawnUnit("sagittarii", { id: "sg", side: "player", cell: { row: 2, col: 1 } });
    sg.ammo = 1;
    state.units.push(sg, spawnUnit("heavy_horse", { id: "hh", side: "enemy", cell: { row: 4, col: 1 } }));
    state.phase = "rounds";
    resolveRound(state, [{ type: "fire", unitId: "sg", targetId: "hh" }, { type: "hold", unitId: "hh" }], createRng(7));
    expect(unit(state, "sg").ammo).toBe(0);
    expect(unit(state, "sg").tags).not.toContain("skirmish_volley");
    expect(unit(state, "sg").tags).toContain("low_melee");
  });
});

describe("Command Pool", () => {
  it("Address the Troops caps at base Morale and drains the pool; berserkers ignite", () => {
    const state = createBattle({ id: "pool", seed: 8, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 100, rank: 2 } });
    expect(state.commandPool.total).toBe(150);
    state.units.push(spawnUnit("peasant_levy", { id: "lv", side: "player" }));
    state.units.push(spawnUnit("ship_crew", { id: "sc", side: "player", extraTags: ["berserker"] }));
    expect(addressTroops(state, "lv", 60).spent).toBe(35);
    expect(unit(state, "lv").shield).toBe(35);
    expect(addressTroops(state, "lv", 5).ok).toBe(false);
    expect(addressTroops(state, "sc", 10).spent).toBe(10);
    expect(unit(state, "sc").berserk).toBe(true);
    expect(state.commandPool.remaining).toBe(105);
  });

  it("Rally needs the lord in the same cell; shield absorbs before Morale and counts as taken", () => {
    const state = createBattle({ id: "rally", seed: 9, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 50, rank: 1 } });
    state.units.push(spawnUnit("caballarii", { id: "cb", side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("pedites_fyrd", { id: "pd", side: "player", cell: { row: 3, col: 1 } }));
    state.units.push(spawnUnit("pedites_fyrd", { id: "away", side: "player", cell: { row: 1, col: 0 } }));
    state.units.push(spawnUnit("heavy_horse", { id: "hh", side: "enemy", cell: { row: 3, col: 1 } }));
    attachPlayer(state, "cb");
    state.phase = "rounds";
    resolveRound(state, [{ type: "rally", unitId: "pd", amount: 20 }, { type: "rally", unitId: "away", amount: 20 }, { type: "engage", unitId: "hh", targetId: "pd" }], createRng(9));
    expect(state.log.some((e) => /Rally on away refused/.test(e.text))).toBe(true);
    const pd = unit(state, "pd");
    expect(state.commandPool.remaining).toBe(30);
    expect(pd.shield + pd.moraleTaken).toBeGreaterThanOrEqual(20); // 20 shield placed, then hits absorbed first
    expect(pd.morale).toBeGreaterThanOrEqual(pd.maxMorale - Math.max(0, pd.moraleTaken - 20));
  });
});

describe("rout, fate, and aftermath", () => {
  it("a broken unit leaves the field with its men split three ways, and the summary carries the ledger", () => {
    const state = duel("heavy_horse", "peasant_levy", 11);
    const summary = simulateBattle(state, { enemyAi: { posture: "defend" }, maxRounds: 20 });
    expect(summary.outcome).toBe("victory");
    const levy = summary.units.find((u) => u.id === "e1")!;
    expect(levy.status === "routed" || levy.status === "destroyed").toBe(true);
    expect(levy.strength).toBe(0);
    expect(levy.escaped + levy.casualties + levy.captured).toBe(100);
    expect(summary.prisonersTaken).toBe(levy.captured);
    expect(summary.renownDelta).toBe(summary.moraleDealt - summary.moraleTaken);
    expect(summary.renownDelta).toBeGreaterThan(0);
    const hh = summary.units.find((u) => u.id === "p1")!;
    expect(hh.veteranEarned).toBe(true);
    expect(unit(state, "e1").cell).toBeNull();
    expect(state.log.some((e) => e.kind === "rout" && e.unitId === "e1")).toBe(true);
  });

  it("only Peasant Levy dead on the player's side count as levyDead", () => {
    const state = buildQuickScenario({ seed: 12, tier: "full_command", player: [{ sheetId: "peasant_levy" }, { sheetId: "pedites_fyrd" }], enemy: [{ sheetId: "heavy_horse", count: 2 }] });
    const summary = simulateBattle(state, { maxRounds: 30 });
    const levy = summary.units.find((u) => u.sheetId === "peasant_levy" && u.side === "player")!;
    expect(summary.levyDead).toBe(levy.casualties);
    expect(summary.levyDead).toBeGreaterThanOrEqual(0);
  });

  it("Rank-and-File: the lord rolls the same fate odds as his unit when it breaks", () => {
    let fates = new Set<string>();
    for (let seed = 20; seed < 32; seed++) {
      const state = duel("caballarii", "heavy_horse", seed, "rank_and_file");
      expect(controlledUnitIds(state)).toEqual([]);
      simulateBattle(state, { maxRounds: 40 });
      fates.add(state.player.fate);
      if (state.player.fate === "killed") expect(state.player.alive).toBe(false);
    }
    expect([...fates].every((f) => ["escaped", "killed", "captured", "fighting", "carried_off"].includes(f))).toBe(true);
    expect(fates.size).toBeGreaterThan(1);
  });

  it("Rank-and-File Renown comes from the personal tally, not the unit ledger", () => {
    const state = duel("caballarii", "peasant_levy", 13, "rank_and_file");
    const summary = simulateBattle(state, { maxRounds: 40 });
    expect(state.log.some((e) => e.kind === "player" && /In the press/.test(e.text))).toBe(true);
    expect(summary.renownDelta).toBe(Math.round(state.player.personalDealt - state.player.personalTaken));
  });

  it("undisciplined neighbours waver when a friend routs", () => {
    const state = createBattle({ id: "waver", seed: 14, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    const doomed = spawnUnit("peasant_levy", { id: "doomed", side: "enemy", cell: { row: 3, col: 1 } });
    doomed.morale = 1;
    state.units.push(doomed);
    state.units.push(spawnUnit("peasant_levy", { id: "neighbour", side: "enemy", cell: { row: 4, col: 1 } }));
    state.units.push(spawnUnit("heavy_horse", { id: "hh", side: "player", cell: { row: 3, col: 1 } }));
    state.phase = "rounds";
    resolveRound(state, [{ type: "engage", unitId: "hh", targetId: "doomed" }], createRng(14));
    expect(unit(state, "doomed").status).not.toBe("active");
    expect(unit(state, "neighbour").morale).toBe(35 - 15);
  });
});

describe("multi-day engagements", () => {
  it("ten quiet rounds end the day; hold recovers 15–20% morale; withdraw abandons the field", () => {
    const state = createBattle({ id: "night", seed: 15, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit("elite_foot", { id: "p", side: "player", cell: { row: 2, col: 0 } }));
    state.units.push(spawnUnit("elite_foot", { id: "e", side: "enemy", cell: { row: 4, col: 2 } }));
    unit(state, "p").morale = 40;
    state.phase = "rounds";
    for (let i = 0; i < 10; i++) playRound(state, [{ type: "hold", unitId: "p" }], { enemyAi: { posture: "defend" } });
    expect(state.phase).toBe("day_end");
    expect(state.round).toBe(10);
    endDay(state, "hold");
    expect(state.day).toBe(2);
    expect(state.phase).toBe("rounds");
    expect(unit(state, "p").morale).toBeGreaterThanOrEqual(52);
    expect(unit(state, "p").morale).toBeLessThanOrEqual(56);
    for (let i = 0; i < 10; i++) playRound(state, [{ type: "hold", unitId: "p" }], { enemyAi: { posture: "defend" } });
    endDay(state, "withdraw");
    expect(state.phase).toBe("finished");
    expect(state.outcome).toBe("withdrawn");
    expect(unit(state, "p").status).toBe("withdrawn");
  });
});

describe("fortifications", () => {
  function siege(attackerSheet: string, seed: number) {
    const field = emptyBattlefield();
    field.cells[cellIndex({ row: 4, col: 1 })].fortification = buildFortificationCell("wooden", "enemy", "4:1", 2);
    const state = createBattle({ id: "siege", seed, tier: "full_command", battlefield: field, player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit(attackerSheet, { id: "atk", side: "player", cell: { row: 4, col: 1 } }));
    const garrison = spawnUnit("pedites_fyrd", { id: "wall", side: "enemy", cell: { row: 4, col: 1 } });
    garrison.occupancyRounds = 3;
    state.units.push(garrison);
    const stored = spawnUnit("peasant_levy", { id: "stored", side: "enemy", cell: { row: 4, col: 1 } });
    stored.occupancyRounds = 3;
    state.units.push(stored);
    expect(assignToPoint(state, "wall", "fort:4:1:0").ok).toBe(true);
    expect(assignToPoint(state, "stored", "fort:4:1:0").ok).toBe(true);
    state.phase = "rounds";
    return state;
  }

  it("the Presented unit gets +10 as Defender; the Stored one is untouchable", () => {
    const state = siege("heavy_horse", 16);
    expect(unit(state, "wall").fort?.presented).toBe(true);
    expect(unit(state, "stored").fort?.presented).toBe(false);
    expect(isTerrainDefender(state.units, unit(state, "wall"))).toBe(true);
    expect(fortDefenderBonus(state, unit(state, "wall"))).toBe(10);
    resolveRound(state, [{ type: "engage", unitId: "atk", targetId: "stored" }], createRng(16));
    expect(unit(state, "atk").engagedWith).toEqual([]);
    resolveRound(state, [{ type: "engage", unitId: "atk", targetId: "wall" }], createRng(17));
    const strike = state.log.find((e) => e.kind === "strike" && e.unitId === "atk");
    expect(String(strike?.data?.defNotes)).toMatch(/fortification \+10/);
  });

  it("ordinary troops barely scratch the timber; a ram bypasses hardened_structure and breaches", () => {
    const horse = siege("heavy_horse", 18);
    resolveRound(horse, [{ type: "attack_structure", unitId: "atk", pointId: "fort:4:1:0" }], createRng(18));
    const hit = horse.log.find((e) => e.kind === "structure")!;
    expect(hit.data?.effAtk).toBe(6);
    expect(Number(hit.data?.damage)).toBeLessThanOrEqual(5);

    const ram = siege("battering_ram", 19);
    const rng = createRng(19);
    let rounds = 0;
    while (!ram.log.some((e) => /breached/.test(e.text)) && rounds < 30) {
      resolveRound(ram, [{ type: "attack_structure", unitId: "atk", pointId: "fort:4:1:0" }, { type: "hold", unitId: "wall" }, { type: "hold", unitId: "stored" }], rng);
      rounds++;
    }
    expect(rounds).toBeLessThan(20);
    expect(ram.log.find((e) => e.kind === "structure")?.data?.effAtk).toBe(22);
    expect(unit(ram, "stored").fort?.presented).toBe(true); // exposed by the breach
    expect(fortDefenderBonus(ram, unit(ram, "wall"))).toBe(0);
  });
});

describe("battle lifecycle and determinism", () => {
  it("deployment rows are enforced and rounds cannot begin with units off the field", () => {
    const state = createBattle({ id: "dep", seed: 21, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 1, rank: 1 } });
    state.units.push(spawnUnit("pedites_fyrd", { id: "p", side: "player" }), spawnUnit("pedites_fyrd", { id: "e", side: "enemy" }));
    expect(deploy(state, "p", { row: 3, col: 0 }).ok).toBe(false);
    expect(deploy(state, "p", { row: 2, col: 0 }).ok).toBe(true);
    expect(beginRounds(state).ok).toBe(false);
    expect(deploy(state, "e", { row: 4, col: 0 }).ok).toBe(true);
    expect(beginRounds(state).ok).toBe(true);
  });

  it("the same seed replays the same battle; the state round-trips through its schema", () => {
    const run = () => {
      const s = buildQuickScenario({ seed: 99, tier: "full_command", player: [{ sheetId: "caballarii" }, { sheetId: "sagittarii" }], enemy: [{ sheetId: "pedites_fyrd", count: 2 }] });
      simulateBattle(s, { maxRounds: 40 });
      return s;
    };
    const a = run();
    const b = run();
    expect(a.log.map((e) => e.text)).toEqual(b.log.map((e) => e.text));
    expect(a.outcome).toBe(b.outcome);
    const parsed = BattleStateSchema.parse(JSON.parse(JSON.stringify(a)));
    expect(parsed.units.length).toBe(a.units.length);
  });

  it("the script AI walks around cliffs and rivers and never dances: random terrain always resolves", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const field = generateLayout(createRng(seed * 7), { roughness: 0.6 });
      const s = buildQuickScenario({ seed, tier: "full_command", player: [{ sheetId: "pedites_fyrd" }, { sheetId: "frankish_horse_archers" }], enemy: [{ sheetId: "caballarii" }, { sheetId: "peasant_levy" }], battlefield: field });
      const sum = simulateBattle(s);
      expect(sum.outcome, `seed ${seed} on ${field.name}`).not.toBe("undecided");
    }
  });

  it("mismatched forces resolve the expected way and balanced ones still finish", () => {
    const strong = simulateBattle(buildQuickScenario({ seed: 31, tier: "full_command", player: [{ sheetId: "heavy_horse", count: 2 }], enemy: [{ sheetId: "peasant_levy", count: 2 }] }));
    expect(strong.outcome).toBe("victory");
    const weak = simulateBattle(buildQuickScenario({ seed: 32, tier: "full_command", player: [{ sheetId: "peasant_levy", count: 2 }], enemy: [{ sheetId: "heavy_horse", count: 2 }] }));
    expect(weak.outcome).toBe("defeat");
    const even = simulateBattle(buildQuickScenario({ seed: 33, tier: "full_command", player: [{ sheetId: "pedites_fyrd", count: 2 }, { sheetId: "sagittarii" }], enemy: [{ sheetId: "pedites_fyrd", count: 2 }, { sheetId: "sagittarii" }] }));
    expect(["victory", "defeat", "draw"]).toContain(even.outcome);
    expect(even.rounds).toBeLessThan(60);
  });
});
