import { addressTroops, addUnit, attachPlayer, beginRounds, createBattle, deploy, endDay, playRound, summarizeBattle, type BattleSummary } from "../combat/battle";
import { aiFinalize, aiNarrow, assignRoles, finalize, generateCandidatePool, generateLayout, narrow, rollDuelWinner } from "../combat/scouting";
import type { RosterLine } from "../combat/scenario";
import type { BattleState } from "../combat/battleTypes";
import { PLAYER_PERSONAL_BASELINE, RAF_RENOWN_TIER } from "../combat/constants";
import { generateEncounter, hasAllies, LORD_FILE_ID, soloLossConsequences, tierFor, type EncounterKind } from "../combat/encounter";
import { applyRenown, rankMultiplier, rankTitle, stickyRank } from "../combat/renown";
import { createRng, seedFromString, type Rng } from "../combat/rng";
import { pushLog, rollPlayerFate } from "../combat/round";
import { canDirect, canLeadFile, canRideToWar, GENERAL_DEFEAT_WOUND_CHANCE } from "../engine/wounds";
import type { Rank } from "../combat/schema";
import { autoDeploy } from "../combat/scenario";
import { sheetFor, spawnUnit } from "../combat/units";
import { routSplit } from "../combat/formula";
import { cellIndex, emptyBattlefield, frontRow } from "../combat/grid";
import { GRID_COLUMNS } from "../combat/constants";
import { assignToPoint, buildFortificationCell, pointsInCell } from "../combat/fortification";
import { pursuitAtk, pursuitDef } from "../combat/tags";
import type { UnitInstance } from "../combat/battleTypes";
import { attachedUnit, biasForPositioning, drawVignette, DRAWS_PER_PHASE, EFFECT_TIERS_REF, resolveVignetteChoice, vignetteById } from "../combat/vignettes";
import type { Vignette } from "../combat/vignetteSchema";
import {
  aftermathUserPrompt,
  BATTLE_NARRATOR_SYSTEM,
  battleSceneUserPrompt,
  COMMANDER_SYSTEM,
  commanderOrderUserPrompt,
  parseCommanderReply,
  proseFromReply,
  routCardUserPrompt,
  splitAftermath,
  vignetteBridgeUserPrompt,
} from "../llm/battlePrompts";
import type { ChatMessageParam } from "../llm/types";
import { OrderSchema, type Order } from "../combat/battleTypes";
import { candidateObjectives, checkObjective, objectiveBonus } from "../combat/objectives";
import type { BattleCall, BattleCallKind, BattleNarration, BattleSession, Objective, WorldState } from "../engine/schema";
import { CALL_TEXT } from "../engine/military";
import { newId } from "../engine/util";

/**
 * Campaign battle flow (Phase 3): call to arms → muster → Rank-and-File fight narrated
 * through vignettes → aftermath written to the ledger. Runs on the WorldState; the
 * GameController owns persistence and the LLM connection.
 */

export type BattleDeps = {
  /** Raw model call; throws on failure. */
  chat: (messages: ChatMessageParam[], maxTokens: number) => Promise<string>;
  log: (actor: string, kind: "APPLY" | "REJECT" | "EVENT" | "CHAT" | "SEASON", summary: string) => void;
};

/** Season events that raise a call (Phase 0/3 decision: events + Eberhard). */
const CALL_EVENTS: Record<string, BattleCallKind> = {
  "pol-muster": "summons",
  "th-muster": "summons",
  "th-bandits": "bandits",
  "th-spill": "raid",
  "th-armed": "bandits",
};

export { raiseCallDirect } from "../engine/military";

export function raiseBattleCall(state: WorldState, rolledEventIds: readonly string[]): BattleCall | null {
  if (state.battle_call || state.battle || state.battle_session || state.player.dead || state.player.captive || state.player.maimed) return null;
  for (const id of rolledEventIds) {
    const kind = CALL_EVENTS[id];
    if (!kind) continue;
    const call: BattleCall = {
      kind,
      eventId: id,
      text: CALL_TEXT[kind],
      seed: seedFromString(`${id}:${state.meta.turn}:${state.meta.year}`),
      createdTurn: state.meta.turn,
    };
    state.battle_call = call;
    return call;
  }
  return null;
}

function note(session: BattleSession, kind: BattleNarration["kind"], text: string, round: number, ref?: string): void {
  session.narration.push({ id: newId("nar"), kind, round, text, ref });
}

export function refuseCall(state: WorldState, deps: BattleDeps): string {
  const call = state.battle_call;
  if (!call) return "There is no call to refuse.";
  state.battle_call = null;
  if (call.kind !== "summons") state.flags.active_threat = true;
  const text =
    call.kind === "summons"
      ? "You send word that the villa cannot spare its lord this season. The count will remember it."
      : "You bar the hall and keep the people inside. What they take from the outlying manses, they take.";
  deps.log("player", "REJECT", `Refused the call to arms (${call.kind}).`);
  return text;
}

export type AcceptResult = { started: boolean; text: string };

/**
 * §8.7 odds for a lone Caballarius (Speed 5, DEF 11) pursued by the encounter's raiders: up to three
 * pursuers' Speed sets the escape fraction; the front pursuer's ATK (with any mounted bonus) sets kill vs capture.
 */
export function soloFateOdds(kind: EncounterKind, seed: number): { escaped: number; killed: number; captured: number } {
  const enc = generateEncounter(kind, seed);
  const field = emptyBattlefield();
  const lord = spawnUnit("caballarii", { id: "solo-lord", side: "player", cell: { row: 2, col: 1 } });
  const pursuers: UnitInstance[] = [];
  let n = 0;
  for (const line of enc.enemy) {
    for (let i = 0; i < (line.count ?? 1) && pursuers.length < 3; i++) {
      pursuers.push(spawnUnit(line.sheetId, { id: `solo-e-${++n}`, side: "enemy", cell: { row: 2, col: 1 }, overrides: line.overrides }));
    }
  }
  if (!pursuers.length) return { escaped: 1, killed: 0, captured: 0 };
  // Fastest pursuers lead the chase.
  pursuers.sort((a, b) => sheetFor(b).speed - sheetFor(a).speed);
  const front = pursuers[0];
  return routSplit(
    sheetFor(lord).speed,
    pursuers.map((u) => sheetFor(u).speed),
    pursuitAtk(front, lord, field),
    pursuitDef(front, lord, field),
  );
}

/**
 * Answer the call. With allies or own units the session opens at the muster panel; with
 * neither, the solo rule resolves the engagement at once as a narrated loss.
 */
export function acceptCall(state: WorldState, deps: BattleDeps): AcceptResult {
  const call = state.battle_call;
  if (!call) return { started: false, text: "There is no call to answer." };
  const fit = canRideToWar(state);
  if (!fit.ok) return { started: false, text: fit.reason ?? "The lord cannot ride." };
  const owned = state.military.units.filter((u) => u.strength > 0);
  if (owned.length === 0 && !canLeadFile(state)) {
    // A permanent wound bars him from riding in a file; with no men of his own there is no other way to the field.
    state.battle_call = null;
    deps.log("player", "REJECT", `Could not answer the call (${call.kind}): a permanent wound bars the lord from the line and he has no men to command.`);
    return { started: false, text: "The old wound will not let you sit the line with the other horsemen, and you have no men of your own to lead from behind it. The call goes unanswered." };
  }
  if (!hasAllies(call.kind) && owned.length === 0) {
    // Solo rule: a lone rider cannot hold a villa. The raid succeeds; the lord's own fate is one roll against the
    // §8.7 rout odds of a single Caballarius run at by the raiders — a mounted man outruns foot, not horse.
    const rng = createRng(call.seed);
    const loss = soloLossConsequences(call.kind, state.resources.denarii, rng);
    state.resources.denarii = Math.max(0, state.resources.denarii - loss.denariiLost);
    for (const key of ["cattle", "sheep", "pigs"] as const) {
      state.resources[key] = Math.max(0, state.resources[key] - Math.floor(state.resources[key] * loss.livestockFraction));
    }
    state.flags.active_threat = true;
    const split = soloFateOdds(call.kind, call.seed);
    const roll = rng.float();
    let fate: string;
    if (roll < split.killed) {
      state.player.dead = true;
      fate = "The lord was run down and killed.";
    } else if (roll < split.killed + split.captured) {
      fate = settleRansom(state);
    } else {
      fate = "The lord rode clear.";
    }
    const odds = `(escape ${Math.round(split.escaped * 100)}%, death ${Math.round(split.killed * 100)}%, capture ${Math.round(split.captured * 100)}%)`;
    state.battle_history.push({
      id: newId("battle"),
      turn: state.meta.turn,
      year: state.meta.year,
      season: state.meta.season,
      kind: call.kind,
      tier: "rank_and_file",
      outcome: "solo_loss",
      rounds: 0,
      renownDelta: 0,
      summary: `${loss.text} Lost ${loss.denariiLost} denarii and some of the herds. ${fate} ${odds}`,
    });
    state.battle_call = null;
    deps.log("engine", "EVENT", `Solo loss (${call.kind}): −${loss.denariiLost} denarii, herds thinned. ${fate} ${odds}`);
    return { started: false, text: `${loss.text} ${loss.denariiLost} denarii and part of the herds are gone. ${fate}` };
  }
  state.battle_session = {
    tier: "rank_and_file",
    callKind: call.kind,
    phase: "muster",
    broughtUnitIds: [],
    drawn: [],
    openingDone: false,
    crisisDraws: 0,
    turningDone: false,
    routCardDone: false,
    pendingCard: null,
    pendingRout: null,
    engageBias: 0,
    characterFlags: [],
    cardRenown: 0,
    premise: "",
    encounterSeed: call.seed,
    lastDrawRound: 0,
    lastNarratedSeq: 0,
    narration: [],
    objectives: [],
    objectiveBonus: 0,
    scouting: null,
    dayEndPending: false,
    repositionPool: [],
    pendingEncounter: null,
    prisonersHeld: 0,
  };
  return { started: true, text: call.text };
}

/**
 * Muster: the lord's Caballarii is fixed; owned units are brought by choice. At Rank-and-File
 * and Sub-Command the field is picked and the hosts placed for him; at Full Command he scouts
 * the ground (§9.5) and sets the whole field (§3 Deployment) himself.
 */
export function musterAndRide(state: WorldState, deps: BattleDeps, bringIds: readonly string[]): string | undefined {
  const session = state.battle_session;
  const call = state.battle_call;
  if (!session || session.phase !== "muster" || !call) return "No muster is waiting.";
  const owned = state.military.units.filter((u) => bringIds.includes(u.id) && u.strength > 0);
  const tier = tierFor(owned.length, state.player.fullCommandGranted);
  const enc = generateEncounter(call.kind, call.seed, { region: state.meta.region, year: state.meta.year });
  session.tier = tier;
  session.broughtUnitIds = owned.map((u) => u.id);
  session.premise = enc.premise;
  session.pendingEncounter = { allies: enc.allies, enemy: enc.enemy, premise: enc.premise };
  state.battle_call = null;
  deps.log("player", "APPLY", `Rode to battle (${call.kind}, ${tier}) with ${owned.length} unit(s) of his own.`);

  if (tier === "full_command") {
    const rng = createRng(call.seed ^ 0x9e3779b9);
    const pool = generateCandidatePool(rng, {
      weather: enc.battlefield.weather,
      // A9.5: a fortification fixed by the campaign filters the pool to layouts that include it.
      fortification: foughtAtTheVilla(call.kind) ? { side: "player", typeId: villaWallKind(state), row: frontRow("player"), pointsPerCell: 3 } : undefined,
    });
    const winner = rollDuelWinner(rng);
    session.scouting = { pool, winner, role: null, shortlist: [], stage: "choose_role" };
    session.phase = "scouting";
    if (winner === "enemy") {
      // The enemy chooses its role; the lord takes the other.
      const enemyRole = rng.chance(0.5) ? "narrower" : "finalizer";
      const roles = assignRoles("enemy", enemyRole);
      session.scouting.role = roles.narrower === "player" ? "narrower" : "finalizer";
      if (session.scouting.role === "finalizer") {
        session.scouting.shortlist = narrow(pool, aiNarrow(pool, "enemy"));
        session.scouting.stage = "finalize";
      } else {
        session.scouting.stage = "narrow";
      }
    }
    return undefined;
  }

  const err = buildBattle(state, enc.battlefield);
  if (err) return err;
  autoDeploy(state.battle!, "player");
  garrisonWalls(state.battle!);
  const begun = beginRounds(state.battle!);
  if (!begun.ok) return begun.reason;
  session.phase = "fighting";
  return undefined;
}

/** Create the battle for the session's encounter on a chosen field; the enemy deploys, the player's side does not yet. */
function buildBattle(state: WorldState, battlefield: BattleState["battlefield"]): string | undefined {
  const session = state.battle_session!;
  const enc = session.pendingEncounter;
  if (!enc) return "The muster has been lost.";
  const owned = state.military.units.filter((u) => session.broughtUnitIds.includes(u.id) && u.strength > 0);
  const tier = session.tier;
  const battle = createBattle({
    id: newId("battle"),
    seed: session.encounterSeed,
    tier,
    battlefield,
    player: {
      renown: state.player.renown,
      rank: state.player.rankLevel as Rank,
      wounds: state.player.wounds,
      hp: state.player.personal.hp,
      atk: state.player.personal.atk,
      def: state.player.personal.def,
      damage: state.player.personal.damage,
    },
  });
  battle.player.deferFate = tier === "rank_and_file";
  // Rank-and-File: the lord rides in the minor nobles' Caballarii, one horseman among many, NPC-led.
  // Above it he brings his own men and rides with one of them — no extra free file.
  if (tier === "rank_and_file") {
    addUnit(battle, spawnUnit("caballarii", { id: LORD_FILE_ID, side: "player", owner: "ally", name: "The minor nobles' horse" }));
  }
  for (const u of owned) {
    addUnit(battle, spawnUnit(u.sheetId, { id: `p-${u.id}`, side: "player", owner: "player", name: u.name, extraTags: u.veteran ? ["veteran"] : [], overrides: { strength: u.strength } }));
  }
  let n = 0;
  for (const line of enc.allies as RosterLine[]) {
    for (let i = 0; i < (line.count ?? 1); i++) addUnit(battle, spawnUnit(line.sheetId, { id: `a-${line.sheetId}-${++n}`, side: "player", owner: "ally", name: line.name }));
  }
  n = 0;
  for (const line of enc.enemy as RosterLine[]) {
    for (let i = 0; i < (line.count ?? 1); i++) addUnit(battle, spawnUnit(line.sheetId, { id: `e-${line.sheetId}-${++n}`, side: "enemy", name: line.name, overrides: line.overrides }));
  }
  // Design review, item 8: attacked at the villa, the lord fights behind his own walls — timber to
  // begin with, stone once a mason has raised one. The face runs along his front row.
  if (foughtAtTheVilla(session.callKind)) {
    const kind = villaWallKind(state);
    const row = frontRow("player");
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const cell = battle.battlefield.cells[cellIndex({ row, col })];
      cell.terrain = cell.terrain.filter((t) => t !== "river");
      cell.fortification = buildFortificationCell(kind, "player", `${row}:${col}`, 3);
    }
    pushLog(battle, "info", `The villa's ${kind === "stone" ? "stone wall" : "timber palisade"} stands along the lord's line; his files may hold it.`);
  }
  autoDeploy(battle, "enemy");
  // Attachment: the nobles' horse at Rank-and-File; otherwise his own mounted file if he has one, else his first.
  // A permanent wound (wounds.ts) keeps him out of the line altogether: he directs from behind it, unattached.
  if (tier === "rank_and_file" || canLeadFile(state)) {
    const attachId = tier === "rank_and_file" ? LORD_FILE_ID : pickAttachment(battle, owned.map((u) => `p-${u.id}`));
    if (!attachId) return "No file for the lord to ride with.";
    attachPlayer(battle, attachId);
  } else {
    pushLog(battle, "player", "The lord's old wound keeps him out of the line; he commands from behind it.");
  }
  state.battle = battle;
  return undefined;
}

/** Raids come to the villa's gate; a summons and the outlaws on the road are fought elsewhere. */
export function foughtAtTheVilla(kind: BattleCallKind): boolean {
  return kind === "raid";
}

/** The villa's walls as a fortification face: wooden to begin with, stone once a mason's wall stands. */
export function villaWallKind(state: WorldState): "wooden" | "stone" {
  return state.holdings.some((h) => h.features.includes("stone_wall")) ? "stone" : "wooden";
}

/** Player files standing in a fortified cell of their own side take up its points (one per point, in order). */
export function garrisonWalls(battle: BattleState): void {
  for (const u of battle.units) {
    if (u.side !== "player" || !u.cell || u.fort) continue;
    const fort = battle.battlefield.cells[cellIndex(u.cell)].fortification;
    if (!fort || fort.side !== "player") continue;
    const points = pointsInCell(battle.battlefield, u.cell);
    const free = points.find((p) => !battle.units.some((x) => x.fort?.pointId === p.id));
    if (free) assignToPoint(battle, u.id, free.id);
  }
}

function pickAttachment(battle: BattleState, ownIds: readonly string[]): string | undefined {
  const own = ownIds.map((id) => battle.units.find((u) => u.id === id)).filter((u): u is UnitInstance => Boolean(u));
  return (own.find((u) => u.tags.includes("mounted")) ?? own[0])?.id;
}

// ---------------------------------------------------------------------------
// Full Command: Scouting Duel (§9.5) and Deployment (§3)
// ---------------------------------------------------------------------------

/** The lord won the coin flip and chooses to Narrow (3 of 6) or Finalize (1 of 3). */
export function scoutChooseRole(state: WorldState, role: "narrower" | "finalizer"): string | undefined {
  const session = state.battle_session;
  const sc = session?.scouting;
  if (!session || !sc || session.phase !== "scouting" || sc.stage !== "choose_role") return "There is no choice of role to make.";
  if (sc.winner !== "player") return "The enemy won the toss; the role is not yours to choose.";
  sc.role = role;
  if (role === "narrower") {
    sc.stage = "narrow";
  } else {
    sc.shortlist = narrow(sc.pool, aiNarrow(sc.pool, "enemy"));
    sc.stage = "finalize";
  }
  return undefined;
}

/** The lord keeps three of the six; the enemy then picks the final one. */
export function scoutNarrow(state: WorldState, keep: readonly number[]): string | undefined {
  const session = state.battle_session;
  const sc = session?.scouting;
  if (!session || !sc || session.phase !== "scouting" || sc.stage !== "narrow") return "It is not the moment to narrow the ground.";
  let shortlist;
  try {
    shortlist = narrow(sc.pool, keep);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  sc.shortlist = shortlist;
  const field = finalize(shortlist, aiFinalize(shortlist, "enemy"));
  return chooseField(state, field);
}

/** The lord picks the final field from the enemy's three. */
export function scoutFinalize(state: WorldState, pick: number): string | undefined {
  const session = state.battle_session;
  const sc = session?.scouting;
  if (!session || !sc || session.phase !== "scouting" || sc.stage !== "finalize") return "It is not the moment to choose the ground.";
  const field = sc.shortlist[pick];
  if (!field) return "Choose one of the three.";
  return chooseField(state, field);
}

function chooseField(state: WorldState, field: BattleState["battlefield"]): string | undefined {
  const session = state.battle_session!;
  if (session.scouting) session.scouting.stage = "done";
  const err = buildBattle(state, field);
  if (err) return err;
  session.phase = "deployment";
  note(session, "engine", `The ground is chosen: ${field.name}, under ${field.weather.replace("_", " ")}.`, 0);
  return undefined;
}

/** Place one player-side file in rows 1–2. */
export function deployFile(state: WorldState, unitId: string, cell: { row: number; col: number }): string | undefined {
  const session = state.battle_session;
  const battle = state.battle;
  if (!session || !battle || session.phase !== "deployment") return "The hosts are not deploying.";
  const unit = battle.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== "player") return "That file is not yours to place.";
  const r = deploy(battle, unitId, cell);
  return r.ok ? undefined : r.reason;
}

/** Let the sergeants place whatever the lord has not. */
export function deployRest(state: WorldState): string | undefined {
  const session = state.battle_session;
  const battle = state.battle;
  if (!session || !battle || session.phase !== "deployment") return "The hosts are not deploying.";
  autoDeploy(battle, "player");
  return undefined;
}

/** §5.2.2 Address the Troops, before the first exchange. */
export function addressFile(state: WorldState, unitId: string, amount: number): string | undefined {
  const session = state.battle_session;
  const battle = state.battle;
  if (!session || !battle || session.phase !== "deployment") return "The speech must come before the fighting.";
  const r = addressTroops(battle, unitId, amount);
  return r.ok ? undefined : r.reason;
}

/** Everyone placed: the battle begins. */
export function beginBattle(state: WorldState): string | undefined {
  const session = state.battle_session;
  const battle = state.battle;
  if (!session || !battle || session.phase !== "deployment") return "The hosts are not deploying.";
  garrisonWalls(battle);
  const begun = beginRounds(battle);
  if (!begun.ok) return begun.reason;
  session.phase = "fighting";
  return undefined;
}

/** §8.6 nightfall at Full Command: hold, seek new ground, or withdraw. */
export async function dayEndChoice(state: WorldState, deps: BattleDeps, choice: "hold" | "reposition" | "withdraw", pick?: number): Promise<string | undefined> {
  const session = state.battle_session;
  const battle = state.battle;
  if (!session || !battle || session.phase !== "fighting" || battle.phase !== "day_end") return "It is not nightfall.";
  if (choice === "hold") {
    endDay(battle, "hold");
    session.dayEndPending = false;
    session.repositionPool = [];
    note(session, "engine", "The host holds its ground through the night and stands to at dawn.", battle.round);
    return undefined;
  }
  if (choice === "withdraw") {
    endDay(battle, "withdraw");
    session.dayEndPending = false;
    session.repositionPool = [];
    note(session, "engine", "Under cover of night the host draws off. The field is left to whoever wants it.", battle.round);
    return enterAftermath(state, deps);
  }
  if (!session.repositionPool.length) {
    const rng = createRng(battle.rngState ^ 0x51ed270b);
    session.repositionPool = Array.from({ length: 3 }, () => generateLayout(rng, { weather: battle.battlefield.weather, roughness: 0.5 }));
    return undefined; // the lord now picks from the pool
  }
  const field = session.repositionPool[pick ?? -1];
  if (!field) return "Choose one of the three grounds.";
  endDay(battle, "reposition", field);
  session.dayEndPending = false;
  session.repositionPool = [];
  note(session, "engine", `Overnight the host marches to better ground: ${field.name}.`, battle.round);
  return undefined;
}

// ---------------------------------------------------------------------------
// Fighting
// ---------------------------------------------------------------------------

async function narrate(deps: BattleDeps, user: string, maxTokens: number, fallback: string): Promise<string> {
  try {
    const raw = await deps.chat([{ role: "system", content: BATTLE_NARRATOR_SYSTEM }, { role: "user", content: user }], maxTokens);
    const prose = proseFromReply(raw);
    return prose.length > 20 ? prose : fallback;
  } catch {
    return fallback;
  }
}

function engineBridge(battle: BattleState, sinceSeq: number): string {
  const rows = battle.log.filter((e) => e.seq >= sinceSeq && (e.kind === "engage" || e.kind === "rout" || e.kind === "shock" || e.kind === "player" || e.kind === "fire")).slice(-4);
  if (!rows.length) return "The lines close.";
  return rows.map((e) => e.text.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim()).join(" ");
}

function mineStanding(battle: BattleState): { standing: number; broken: number } {
  const mine = battle.units.filter((u) => u.side === "player");
  return { standing: mine.filter((u) => u.status === "active").length, broken: mine.filter((u) => u.status !== "active").length };
}

async function presentCard(state: WorldState, deps: BattleDeps, card: Vignette, bridgeUser: string | null, fallback: string): Promise<void> {
  const battle = state.battle!;
  const session = state.battle_session!;
  const bridge = bridgeUser ? await narrate(deps, bridgeUser, 400, fallback) : fallback;
  session.drawn.push(card.id);
  session.lastDrawRound = battle.round;
  session.lastNarratedSeq = battle.log.length;
  session.pendingCard = { vignetteId: card.id, bridge };
  note(session, card.phase === "opening" ? "scene" : "bridge", bridge, battle.round);
  note(session, "card", `${card.title}\n\n${card.text}`, battle.round, card.id);
}

/**
 * Advance the fight to the next moment that needs the lord: a drawn card, his file breaking,
 * or the end. Rounds between are fought by the script commanders on both sides.
 */
export async function battleContinue(state: WorldState, deps: BattleDeps): Promise<string | undefined> {
  const battle = state.battle;
  const session = state.battle_session;
  if (!battle || !session || session.phase !== "fighting") return "There is no fight to continue.";
  if (session.pendingCard || session.pendingRout) return "The moment waits on your choice.";
  if (session.tier !== "rank_and_file") return commandContinue(state, deps);

  for (let guard = 0; guard < 80; guard++) {
    if (battle.phase === "finished") return enterAftermath(state, deps);
    if (battle.phase === "day_end") {
      endDay(battle, "hold");
      note(session, "engine", "Night ends the fighting. Word comes down the line: the host holds its ground and takes up the fight at dawn.", battle.round);
      continue;
    }
    if (!session.openingDone) {
      session.openingDone = true;
      const card = drawVignette("opening", session.drawn, sessionRng(state));
      if (card) {
        const fallback = `${session.premise} You take your place in the line of the horse, one rider among the rest, and wait for the horn.`;
        await presentCard(state, deps, card, battleSceneUserPrompt(state, battle, session.premise), fallback);
        return undefined;
      }
    }

    const mine = attachedUnit(battle);
    const bias = biasForPositioning(session.engageBias > 0 ? "sooner" : session.engageBias < 0 ? "later" : undefined);
    const logBefore = battle.log.length;
    playRound(battle, [], {
      allyAi: { posture: "attack", unitBias: mine && bias ? { [mine.id]: bias } : undefined },
      enemyAi: { posture: "attack" },
    });
    session.engageBias = 0;
    // Files breaking are the one engine fact a man in the line always sees; everything else waits for the bridge.
    for (const e of battle.log.slice(logBefore)) {
      if (e.kind === "rout") note(session, "engine", e.text.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " "), e.round);
    }

    if (!battle.player.alive) return enterAftermath(state, deps);
    if (battle.player.fate === "carried_off") {
      // Wounded and carried from the line: his part is over; the hosts finish without him.
      note(session, "engine", "You are carried from the line, and the fight goes on without you.", battle.round);
      finishWithoutTheLord(battle);
      return enterAftermath(state, deps);
    }
    if (battle.player.pendingFate && !session.routCardDone) {
      session.routCardDone = true;
      const f = battle.player.pendingFate;
      const fallback = `Your file breaks around you. The pursuit is close and the ground ${f.escaped > 0.5 ? "open enough to run" : "closing fast"}. Run with the rest, or turn and stand over the banner.`;
      const prose = await narrate(deps, routCardUserPrompt(battle, f), 400, fallback);
      session.pendingRout = { ...f, narration: prose };
      session.lastNarratedSeq = battle.log.length;
      note(session, "bridge", prose, battle.round);
      return undefined;
    }
    if (battle.player.fate !== "fighting") {
      // The lord is out of it; the hosts finish without him.
      finishWithoutTheLord(battle);
      return enterAftermath(state, deps);
    }
    const alive = attachedUnit(battle);
    if (!alive) continue;

    const rng = sessionRng(state);
    const anyRout = battle.units.some((u) => u.status !== "active");
    if (!session.turningDone && battle.round >= 3 && (anyRout || battle.round >= 7)) {
      session.turningDone = true;
      const card = drawVignette("turning", session.drawn, rng);
      if (card) {
        await presentCard(state, deps, card, vignetteBridgeUserPrompt(battle, session.lastNarratedSeq, card), engineBridge(battle, session.lastNarratedSeq));
        return undefined;
      }
    }
    if (session.crisisDraws < DRAWS_PER_PHASE.crisis && battle.round >= 2 && battle.round - session.lastDrawRound >= 2) {
      const card = drawVignette("crisis", session.drawn, rng);
      if (card) {
        session.crisisDraws += 1;
        await presentCard(state, deps, card, vignetteBridgeUserPrompt(battle, session.lastNarratedSeq, card), engineBridge(battle, session.lastNarratedSeq));
        return undefined;
      }
    }
  }
  return "The fight drags on without decision.";
}

// ---------------------------------------------------------------------------
// Sub-/Full Command (design doc §4.2): the lord gives orders; the marshal gives objectives
// ---------------------------------------------------------------------------

/** Between orders: open the battle with a scene and the first objective; handle nightfall and the end. */
async function commandContinue(state: WorldState, deps: BattleDeps): Promise<string | undefined> {
  const battle = state.battle!;
  const session = state.battle_session!;
  if (battle.phase === "finished") return enterAftermath(state, deps);
  if (battle.phase === "day_end") return nightfall(state);
  if (!session.openingDone) {
    session.openingDone = true;
    const fallback =
      session.tier === "full_command"
        ? `${session.premise} The whole host waits on your word.`
        : `${session.premise} Your own men stand under your banner in the line; the marshal's orders come down to you.`;
    const scene = await narrate(deps, battleSceneUserPrompt(state, battle, session.premise), 450, fallback);
    note(session, "scene", scene, battle.round);
    if (session.tier === "sub_command") await issueObjective(state, deps);
    return undefined;
  }
  if (session.tier === "sub_command" && !session.objectives.some((o) => o.status === "active") && attachedUnit(battle)) await issueObjective(state, deps);
  return undefined;
}

/** §8.6: Sub-Command is told the host holds; Full Command decides. */
function nightfall(state: WorldState): string | undefined {
  const battle = state.battle!;
  const session = state.battle_session!;
  if (session.tier === "full_command") {
    if (!session.dayEndPending) {
      session.dayEndPending = true;
      note(session, "engine", "Night ends the fighting. Neither host has broken. Hold the ground, seek better, or draw off?", battle.round);
    }
    return undefined;
  }
  endDay(battle, "hold");
  note(session, "engine", "Night ends the fighting. The marshal holds the host where it stands until dawn.", battle.round);
  return undefined;
}

/** Ask the marshal to choose among the engine's feasible objectives and phrase the order. */
async function issueObjective(state: WorldState, deps: BattleDeps, previous?: Objective): Promise<Objective | undefined> {
  const battle = state.battle!;
  const session = state.battle_session!;
  const candidates = candidateObjectives(battle, session.objectives);
  if (!candidates.length) return undefined;
  let pick = 0;
  let text = candidates[0].plain;
  try {
    const prev = previous && previous.status !== "active" ? { text: previous.text, status: previous.status, note: lastNote(session, previous.id) } : undefined;
    const raw = await deps.chat(
      [
        { role: "system", content: COMMANDER_SYSTEM },
        { role: "user", content: commanderOrderUserPrompt(battle, candidates, prev) },
      ],
      350,
    );
    const parsed = parseCommanderReply(raw, candidates.length);
    if (parsed) {
      pick = parsed.pick;
      text = parsed.order;
    }
  } catch {
    /* engine words stand */
  }
  const c = candidates[pick];
  const objective: Objective = {
    id: newId("obj"),
    kind: c.kind,
    target: c.target,
    byRound: c.byRound,
    difficulty: c.difficulty,
    text,
    status: "active",
    issuedRound: battle.round,
  };
  session.objectives.push(objective);
  note(session, "orders", text, battle.round, objective.id);
  deps.log("engine", "EVENT", `Objective issued (${c.kind}${c.target ? ` ${c.target}` : ""}, difficulty ${c.difficulty}).`);
  return objective;
}

function lastNote(session: BattleSession, objectiveId: string): string {
  return [...session.narration].reverse().find((n) => n.kind === "result" && n.ref === objectiveId)?.text ?? "";
}

/** Check every active objective against the field; resolved ones are graded and reported. */
function resolveObjectives(state: WorldState, deps: BattleDeps): Objective[] {
  const battle = state.battle!;
  const session = state.battle_session!;
  const resolved: Objective[] = [];
  for (const o of session.objectives) {
    if (o.status !== "active") continue;
    const check = checkObjective(battle, o);
    if (check.status === "active") continue;
    o.status = check.status;
    o.resolvedRound = battle.round;
    o.bonus = objectiveBonus(check.status, o.difficulty);
    session.objectiveBonus += o.bonus;
    note(session, "result", `${check.status === "success" ? "Order carried out" : "Order failed"}: ${check.note} (${o.bonus >= 0 ? "+" : ""}${o.bonus} to your name.)`, battle.round, o.id);
    deps.log("engine", "EVENT", `Objective ${check.status}: ${check.note}`);
    resolved.push(o);
  }
  return resolved;
}

/** One round under the lord's orders (Sub-/Full Command). Objectives are checked after; the marshal replaces resolved ones. */
export async function battleCommandRound(state: WorldState, deps: BattleDeps, rawOrders: unknown[]): Promise<string | undefined> {
  const battle = state.battle;
  const session = state.battle_session;
  if (!battle || !session || session.phase !== "fighting") return "There is no fight to command.";
  if (session.tier === "rank_and_file") return "A man in the line gives no orders.";
  if (!session.openingDone) return commandContinue(state, deps);
  if (battle.phase === "day_end") return session.tier === "full_command" ? "Night has fallen. Choose: hold, seek new ground, or withdraw." : commandContinue(state, deps);
  if (battle.phase !== "rounds") return commandContinue(state, deps);
  let orders: Order[] = [];
  for (const o of rawOrders) {
    const r = OrderSchema.safeParse(o);
    if (!r.success) return `Order rejected: ${r.error.issues.map((i) => i.message).join("; ")}`;
    orders.push(r.data);
  }
  if (!canDirect(battle.player.wounds)) {
    // Two wounds: he can no longer direct; the sergeants fight on as they see fit.
    if (orders.length) note(session, "engine", "Twice wounded, you can no longer make yourself understood. The sergeants fight the files as they see fit.", battle.round);
    orders = [];
  }
  const logBefore = battle.log.length;
  playRound(battle, orders, { allyAi: { posture: "attack" }, enemyAi: { posture: "attack" } });
  for (const e of battle.log.slice(logBefore)) {
    if (e.kind === "rout" || (e.kind === "player" && /wounded|struck down|taken/.test(e.text))) {
      note(session, "engine", e.text.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " "), e.round);
    }
  }
  const resolved = session.tier === "sub_command" ? resolveObjectives(state, deps) : [];
  if (!battle.player.alive) return enterAftermath(state, deps);
  const phaseAfter = phaseOf(battle);
  if (phaseAfter === "finished") return enterAftermath(state, deps);
  if (battle.player.fate !== "fighting") {
    finishWithoutTheLord(battle);
    return enterAftermath(state, deps);
  }
  if (phaseAfter === "day_end") nightfall(state);
  if (session.tier === "sub_command" && resolved.length && attachedUnit(battle) && !session.objectives.some((o) => o.status === "active")) {
    await issueObjective(state, deps, resolved[resolved.length - 1]);
  }
  return undefined;
}

/** Read the phase after engine calls that TypeScript cannot see mutating it. */
function phaseOf(battle: BattleState): BattleState["phase"] {
  return battle.phase;
}

/** Run the remaining rounds with both hosts under their script commanders. */
function finishWithoutTheLord(battle: BattleState): void {
  for (let g = 0; g < 60; g++) {
    const phase: BattleState["phase"] = battle.phase;
    if (phase === "finished") return;
    if (phase === "day_end") endDay(battle, "hold");
    else if (phase === "rounds") playRound(battle, [], { allyAi: { posture: "attack" } });
    else return;
  }
}

function sessionRng(state: WorldState): Rng {
  // Draws and vignette rolls use their own stream so they never disturb the engine's replayable rolls.
  const session = state.battle_session!;
  const seed = (session.encounterSeed ^ (state.battle?.round ?? 0) * 7919 ^ session.narration.length * 104729) >>> 0;
  return createRng(seed);
}

/** The lord answers a card (A/B) or the rout moment (run / stand). */
export async function battleChoose(state: WorldState, deps: BattleDeps, key: "A" | "B"): Promise<string | undefined> {
  const battle = state.battle;
  const session = state.battle_session;
  if (!battle || !session || session.phase !== "fighting") return "There is no choice to make.";
  const rng = sessionRng(state);

  if (session.pendingRout) {
    const f = session.pendingRout;
    session.pendingRout = null;
    if (key === "B") {
      note(session, "choice", "You turn and stand over the banner.", battle.round, "B");
      const ref = EFFECT_TIERS_REF.personalRisk.high!;
      const chance = ref.chance + (battle.player.dismounted ? PLAYER_PERSONAL_BASELINE.dismountedRiskBonus : 0);
      if (rng.chance(chance)) {
        const dmg = rng.int(ref.damage.min, ref.damage.max);
        battle.player.hp = Math.max(0, battle.player.hp - dmg);
        if (battle.player.hp <= 0) {
          battle.player.alive = false;
          battle.player.fate = "killed";
          battle.player.pendingFate = undefined;
          note(session, "result", `You take ${dmg} and go down beside the banner. You do not rise.`, battle.round);
          return undefined;
        }
        note(session, "result", `You take ${dmg} holding the ground (HP ${battle.player.hp}/${battle.player.maxHp}). Then the press carries you off with the rest.`, battle.round);
      } else {
        session.cardRenown += RAF_RENOWN_TIER.high;
        note(session, "result", `You hold the banner up long enough for men to see it. Renown +${RAF_RENOWN_TIER.high}. Then the press carries you off with the rest.`, battle.round);
      }
    } else {
      note(session, "choice", "You run with the rest and take your chances.", battle.round, "A");
    }
    rollPlayerFate(battle, rng, f);
    const fate = battle.player.fate;
    note(session, "result", fate === "escaped" ? "You get clear." : fate === "killed" ? "They ride you down." : "A spear at your back and a hand on your bridle: you are taken for ransom.", battle.round);
    return undefined;
  }

  if (!session.pendingCard) return "There is no choice to make.";
  const card = vignetteById(session.pendingCard.vignetteId);
  session.pendingCard = null;
  if (!card) return "The card is lost.";
  const option = card.options.find((o) => o.key === key)!;
  note(session, "choice", option.text, battle.round, key);
  const outcome = resolveVignetteChoice(battle, card, key, rng);
  session.cardRenown += outcome.renownDelta;
  if (outcome.effects.flag && !session.characterFlags.includes(outcome.effects.flag)) session.characterFlags.push(outcome.effects.flag);
  const bias = biasForPositioning(outcome.effects.positioning);
  session.engageBias = bias === "press" ? 1 : bias === "hold" ? -1 : 0;
  note(session, "result", outcome.summary, battle.round);
  deps.log("player", "APPLY", `Vignette ${card.id} → ${key}: ${outcome.summary}`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Aftermath and ledger
// ---------------------------------------------------------------------------

async function enterAftermath(state: WorldState, deps: BattleDeps): Promise<string | undefined> {
  const battle = state.battle!;
  const session = state.battle_session!;
  if (session.phase !== "fighting") return undefined;
  session.phase = "aftermath";
  if (battle.phase !== "finished") {
    battle.phase = "finished";
    battle.outcome = battle.outcome ?? (battle.player.alive ? "draw" : "defeat");
  }
  // Objectives still open resolve against the finished field.
  if (session.tier !== "rank_and_file") resolveObjectives(state, deps);
  const summary = summarizeBattle(battle, { turningPointAward: session.cardRenown, objectiveBonus: session.objectiveBonus });
  const facts = applyLedger(state, deps, summary);
  const fallback = `${facts.join(" ")} ${battle.outcome === "victory" ? "The field is yours." : battle.outcome === "defeat" ? "The field is lost." : "Neither side can claim the field."}`;
  const text = await narrate(deps, aftermathUserPrompt(state, battle, facts, battle.player.newWounds.length), 700, fallback);
  const { prose, wounds } = splitAftermath(text);
  // Wound flavour from the narrator, engine placeholders otherwise.
  battle.player.newWounds.forEach((w, i) => {
    const flavour = wounds[i];
    const stored = state.player.wounds.find((x) => x === w) ?? w;
    stored.location = flavour?.location || defaultWoundLocation(i);
    stored.cause = flavour?.how ? `${flavour.how} (${session.callKind}, ${state.meta.season} ${state.meta.year})` : `${session.callKind}, ${state.meta.season} ${state.meta.year}`;
    stored.narrativeFlags = stored.narrativeFlags.filter((f) => f !== "awaiting_narration");
    if (!state.player.wounds.includes(stored)) state.player.wounds.push(stored);
  });
  session.aftermathText = prose;
  note(session, "aftermath", prose, battle.round);
  return undefined;
}

const WOUND_LOCATIONS = ["a cut across the brow", "the left forearm", "a spear-graze along the ribs", "the right thigh", "two fingers of the shield hand", "the shoulder"];
function defaultWoundLocation(i: number): string {
  return WOUND_LOCATIONS[i % WOUND_LOCATIONS.length];
}

/** Write the battle into the estate's books. Returns plain facts for the narrator and the ledger note. */
function applyLedger(state: WorldState, deps: BattleDeps, summary: BattleSummary): string[] {
  const battle = state.battle!;
  const session = state.battle_session!;
  const facts: string[] = [];
  const rng = createRng(battle.seed ^ 0x5bd1e995);
  const outcome = battle.outcome ?? "draw";
  facts.push(`Outcome for the host: ${outcome}, after ${battle.round} round${battle.round === 1 ? "" : "s"} over ${battle.day} day${battle.day === 1 ? "" : "s"}.`);

  // Renown and rank.
  const before = state.player.renown;
  state.player.renown = applyRenown(before, summary.renownDelta);
  const oldRank = state.player.rankLevel as Rank;
  state.player.rankLevel = stickyRank(oldRank, state.player.renown);
  if (session.tier === "rank_and_file") {
    facts.push(`Renown ${summary.renownDelta >= 0 ? "+" : ""}${summary.renownDelta} (now ${state.player.renown}); personal blows dealt ${battle.player.personalDealt} and taken ${battle.player.personalTaken}; deeds worth ${session.cardRenown}.`);
  } else {
    facts.push(`Renown ${summary.renownDelta >= 0 ? "+" : ""}${summary.renownDelta} (now ${state.player.renown}): your files dealt ${summary.moraleDealt} and took ${summary.moraleTaken} in heart; the marshal's orders count ${session.objectiveBonus >= 0 ? "+" : ""}${session.objectiveBonus}.`);
    for (const o of session.objectives) {
      facts.push(`Order "${o.text.slice(0, 90)}${o.text.length > 90 ? "…" : ""}" — ${o.status}${o.bonus !== undefined ? ` (${o.bonus >= 0 ? "+" : ""}${o.bonus})` : ""}.`);
    }
  }
  if (state.player.rankLevel > oldRank) facts.push(`The lord's name now carries the rank of ${rankTitle(state.player.rankLevel as Rank)}.`);
  session.renownDelta = summary.renownDelta;

  // The lord's body.
  state.player.personal.hp = Math.max(0, battle.player.hp);
  if (!battle.player.alive) {
    state.player.dead = true;
    facts.push("The lord is dead.");
  } else if (battle.player.fate === "captured") {
    facts.push(settleRansom(state));
  } else if (battle.player.fate === "escaped") {
    facts.push("The lord's file broke; he got clear.");
  } else if (battle.player.fate === "carried_off") {
    facts.push("The lord was wounded and carried from the line before the end.");
  }
  // A general who lost the field without riding in a file still ran real risk in the rout (design review: 40%).
  if (outcome === "defeat" && session.tier !== "rank_and_file" && !battle.player.attachedUnitId && battle.player.alive && rng.chance(GENERAL_DEFEAT_WOUND_CHANCE)) {
    const wound = { location: "unresolved", cause: `the rout, ${state.meta.season} ${state.meta.year}`, statEffect: {}, renownEffect: 0, narrativeFlags: ["awaiting_narration"], seasonsHeld: 0, permanent: false };
    battle.player.wounds.push(wound);
    battle.player.newWounds.push(wound);
    facts.push("Caught up in the rout of his host, the lord was wounded.");
  }
  if (battle.player.newWounds.length) facts.push(`The lord took ${battle.player.newWounds.length} wound${battle.player.newWounds.length === 1 ? "" : "s"}.`);
  if (battle.player.wounds.length >= 2) facts.push("With two wounds unhealed he can neither ride nor hold court until they mend.");
  if (battle.player.dismounted) facts.push("He finished the day on foot; the horse is lost.");

  // Threat.
  if (outcome === "victory" && session.callKind !== "summons") {
    state.flags.active_threat = false;
    facts.push("The villa is safe; the threat is driven off.");
  } else if (outcome === "defeat" && session.callKind !== "summons") {
    const lost = Math.round(state.resources.denarii * 0.2);
    state.resources.denarii = Math.max(0, state.resources.denarii - lost);
    state.flags.active_threat = true;
    facts.push(`They took ${lost} denarii from the hall before they left.`);
  }

  // Spoils: everything the host takes goes into one pool and is shared by contribution (design review).
  const spoils = spoilsPool(battle, outcome, rng);
  const share = contributionShare(state, battle, session.tier);
  if (spoils.pool > 0) {
    const mine = Math.round(spoils.pool * share);
    state.resources.denarii += mine;
    const noble = spoils.nobles.length ? ` Among the captives ${spoils.nobles.map((n) => `a ${n.title} (${n.ransom} denarii)`).join(", ")}.` : "";
    facts.push(`Spoils: ${spoils.pool} denarii in all (${spoils.lootFromDead} from the dead, ${spoils.commonRansom} in common ransoms${spoils.nobleRansom ? `, ${spoils.nobleRansom} in noble ransoms` : ""}); your share by contribution ${Math.round(share * 100)}%: ${mine} denarii.${noble}`);
  }
  // Prisoners are yours only when the fight was yours alone; otherwise they are the host's and you take coin.
  if (outcome === "victory" && share >= 0.999 && spoils.commonPrisoners > 0) {
    session.prisonersHeld = spoils.commonPrisoners;
    facts.push(`${spoils.commonPrisoners} captives are yours to settle on the land as unfree or to sell.`);
  }

  // Own units brought.
  for (const owned of state.military.units) {
    const unit = battle.units.find((u) => u.id === `p-${owned.id}`);
    if (!unit) continue;
    owned.strength = unit.status === "active" || unit.status === "withdrawn" ? unit.strength : Math.max(0, unit.escaped);
    if (unit.wasEngaged && (unit.status === "active" || unit.status === "withdrawn")) owned.veteran = true;
  }
  if (summary.levyDead > 0) {
    state.population.adult_men = Math.max(0, state.population.adult_men - summary.levyDead);
    const grief = applyLevyGrief(state, summary.levyDead);
    facts.push(`${summary.levyDead} of the villa's men did not come home.${grief < 0 ? ` The people's heart falls by ${-grief}.` : ""}`);
  }
  state.battle_history.push({
    id: battle.id,
    turn: state.meta.turn,
    year: state.meta.year,
    season: state.meta.season,
    kind: session.callKind,
    tier: session.tier,
    outcome,
    rounds: battle.round,
    renownDelta: summary.renownDelta,
    summary: facts.join(" "),
  });
  deps.log("engine", "EVENT", `Battle ${outcome} (${session.callKind}, ${session.tier}): renown ${summary.renownDelta >= 0 ? "+" : ""}${summary.renownDelta}.`);
  return facts;
}

// ---------------------------------------------------------------------------
// Ransom and grief (design review, items 9 and 10)
// ---------------------------------------------------------------------------

/**
 * A captured lord is redeemed at Renown × rank multiplier. History was not kind about shortfalls:
 * there was no loan to work off. If the chest cannot meet it he stays where he is, and the
 * chronicle of this house ends (design review, item 9).
 */
export function settleRansom(state: WorldState): string {
  const ransom = Math.round(state.player.renown * rankMultiplier(state.player.rankLevel as Rank));
  const paid = Math.min(state.resources.denarii, ransom);
  if (paid < ransom) {
    state.player.captive = true;
    return `The lord was taken. His captors asked ${ransom} denarii and the chest held ${paid}; no one came with the rest, and he remains in their hands.`;
  }
  state.resources.denarii -= paid;
  return `The lord was taken and ransomed for ${paid} denarii.`;
}

/** Each levy man who does not come home costs the people's heart this much… */
export const LEVY_DEAD_HAPPINESS_PER_MAN = 3;
/** …but grief alone will not drive it below this (people begin leaving well above it). */
export const LEVY_DEAD_HAPPINESS_FLOOR = 20;

/** Design review, item 10: brothers, fathers, and sons lost to war tear at a village. Returns the delta applied. */
export function applyLevyGrief(state: WorldState, levyDead: number): number {
  if (levyDead <= 0) return 0;
  const before = state.peopleHappiness ?? 50;
  const after = Math.max(Math.min(before, LEVY_DEAD_HAPPINESS_FLOOR), before - LEVY_DEAD_HAPPINESS_PER_MAN * levyDead);
  state.peopleHappiness = after;
  return after - before;
}

// ---------------------------------------------------------------------------
// Spoils (design review): one pool, shared by contribution
// ---------------------------------------------------------------------------

export const SPOILS = {
  /** Denarii stripped from each enemy dead. */
  perDead: 0.5,
  /** Common prisoner's worth. */
  perPrisoner: 1,
  /** Chance a given prisoner turns out to be a noble worth a real ransom. */
  nobleChance: 1 / 500,
  /** Rank odds among noble captives (of 20) and their ransoms. Kings are never kept — narrative only. */
  nobleTable: [
    { title: "minor noble", weight: 10, ransom: 50 },
    { title: "viscount", weight: 6, ransom: 100 },
    { title: "count", weight: 3, ransom: 200 },
    { title: "magnate", weight: 1, ransom: 500 },
  ],
} as const;

export type SpoilsPool = {
  pool: number;
  lootFromDead: number;
  commonPrisoners: number;
  commonRansom: number;
  nobleRansom: number;
  nobles: { title: string; ransom: number }[];
};

export function spoilsPool(battle: BattleState, outcome: string, rng: Rng): SpoilsPool {
  const enemy = battle.units.filter((u) => u.side === "enemy");
  const dead = enemy.reduce((s, u) => s + u.casualties, 0);
  const captured = enemy.reduce((s, u) => s + u.captured, 0);
  // Only a held field is stripped; a drawn or abandoned one yields the captives taken and no more; a lost one nothing.
  const lootFromDead = outcome === "victory" ? Math.round(dead * SPOILS.perDead) : 0;
  if (outcome === "defeat") return { pool: 0, lootFromDead: 0, commonPrisoners: 0, commonRansom: 0, nobleRansom: 0, nobles: [] };
  const nobles: { title: string; ransom: number }[] = [];
  for (let i = 0; i < captured; i++) {
    if (!rng.chance(SPOILS.nobleChance)) continue;
    let r = rng.int(1, 20);
    for (const row of SPOILS.nobleTable) {
      r -= row.weight;
      if (r <= 0) {
        nobles.push({ title: row.title, ransom: row.ransom });
        break;
      }
    }
  }
  const commonPrisoners = captured - nobles.length;
  const commonRansom = commonPrisoners * SPOILS.perPrisoner;
  const nobleRansom = nobles.reduce((s, n) => s + n.ransom, 0);
  return { pool: lootFromDead + commonRansom + nobleRansom, lootFromDead, commonPrisoners, commonRansom, nobleRansom, nobles };
}

/**
 * The lord's slice of the pool: his contribution over the whole friendly host's, on the Command Claim
 * score (Renown + Σ(HP+ATK+DEF) of files contributed). At Rank-and-File he is one horseman of the
 * nobles' file, so his contribution is one man's share of that file. Alone on the field: everything.
 */
export function contributionShare(state: WorldState, battle: BattleState, tier: BattleSession["tier"]): number {
  const power = (u: UnitInstance) => {
    const s = sheetFor(u);
    return s.hp + s.atk + s.def;
  };
  const allies = battle.units.filter((u) => u.side === "player" && u.owner === "ally");
  const mine = battle.units.filter((u) => u.side === "player" && u.owner === "player");
  let own: number;
  let others: number;
  if (tier === "rank_and_file") {
    const file = battle.units.find((u) => u.id === LORD_FILE_ID);
    own = file ? power(file) / Math.max(1, file.initialStrength) : 1;
    others = allies.reduce((s, u) => s + power(u), 0) - (file ? power(file) / Math.max(1, file.initialStrength) : 0);
  } else {
    own = state.player.renown + mine.reduce((s, u) => s + power(u), 0);
    others = allies.reduce((s, u) => s + power(u), 0);
  }
  if (others <= 0) return 1;
  return Math.max(0, Math.min(1, own / (own + others)));
}

/** Close the book on a finished battle; captives held are settled as unfree or sold. */
export function finishBattle(state: WorldState, disposition?: "settle" | "sell"): string | undefined {
  const session = state.battle_session;
  if (!session) return "No battle is open.";
  if (session.phase !== "aftermath") return "The battle is not over.";
  if (session.prisonersHeld > 0) {
    if (!disposition) return "Decide what becomes of the captives.";
    if (disposition === "settle") {
      state.population.mancipia = (state.population.mancipia ?? 0) + session.prisonersHeld;
    } else {
      state.resources.denarii += session.prisonersHeld * SPOILS.perPrisoner;
    }
    const last = state.battle_history.at(-1);
    if (last) last.summary += disposition === "settle" ? ` ${session.prisonersHeld} captives settled on the land as unfree.` : ` ${session.prisonersHeld} captives sold for ${session.prisonersHeld * SPOILS.perPrisoner} denarii.`;
  }
  state.battle = null;
  state.battle_session = null;
  return undefined;
}

/** Between seasons the lord's own hurts mend a little. */
export function healPersonal(state: WorldState, amount = 5): void {
  const p = state.player.personal;
  p.hp = Math.min(p.maxHp, p.hp + amount);
}
