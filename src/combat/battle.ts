import type { Battlefield, BattleOutcome, BattleState, Cell, CommandTier, Order, UnitInstance } from "./battleTypes";
import { PLAYER_PERSONAL_BASELINE } from "./constants";
import { overnightMorale } from "./formula";
import { isDeploymentCell } from "./grid";
import { hasTag } from "./registry";
import { commandPool, rankAndFileRenown, renownDelta, spendShield, subCommandRenown } from "./renown";
import { createRng, type Rng } from "./rng";
import type { Rank, Wound } from "./schema";
import { pushLog, resolveRound } from "./round";
import { isActive } from "./units";
import { aiOrders, type AiOptions } from "./ai";

/** Battle lifecycle (§3 phases as they touch the engine): deployment → rounds → day end → aftermath. */

export type CreateBattleInput = {
  id: string;
  seed: number;
  tier: CommandTier;
  battlefield: Battlefield;
  player: {
    renown: number;
    rank: Rank;
    wounds?: Wound[];
    hp?: number;
    atk?: number;
    def?: number;
    damage?: { min: number; max: number };
  };
  units?: UnitInstance[];
};

export function createBattle(input: CreateBattleInput): BattleState {
  const pool = commandPool(input.player.renown, input.player.rank);
  const state: BattleState = {
    id: input.id,
    seed: input.seed,
    rngState: input.seed >>> 0,
    tier: input.tier,
    phase: "deployment",
    round: 0,
    day: 1,
    battlefield: input.battlefield,
    units: input.units ?? [],
    player: {
      attachedUnitId: null,
      hp: input.player.hp ?? PLAYER_PERSONAL_BASELINE.hp,
      maxHp: input.player.hp ?? PLAYER_PERSONAL_BASELINE.hp,
      atk: input.player.atk ?? PLAYER_PERSONAL_BASELINE.atk,
      def: input.player.def ?? PLAYER_PERSONAL_BASELINE.def,
      damage: input.player.damage ?? { ...PLAYER_PERSONAL_BASELINE.damage },
      renown: input.player.renown,
      rank: input.player.rank,
      wounds: input.player.wounds ?? [],
      newWounds: [],
      woundsAtStart: (input.player.wounds ?? []).length,
      dismounted: false,
      alive: true,
      fate: "fighting",
      personalDealt: 0,
      personalTaken: 0,
      deferFate: false,
      woundRollMode: "normal",
    },
    commandPool: { total: pool, remaining: pool },
    log: [],
    awaitingReposition: false,
  };
  pushLog(state, "phase", `Deployment. Command Pool ${pool} (Renown ${input.player.renown} × rank ${input.player.rank}).`);
  return state;
}

function withRng<T>(state: BattleState, fn: (rng: Rng) => T): T {
  const rng = createRng(state.rngState);
  try {
    return fn(rng);
  } finally {
    state.rngState = rng.state();
  }
}

export function addUnit(state: BattleState, unit: UnitInstance): void {
  if (state.phase !== "deployment") throw new Error("Units can only be added during deployment.");
  if (state.units.some((u) => u.id === unit.id)) throw new Error(`Duplicate unit id ${unit.id}`);
  state.units.push(unit);
}

export function deploy(state: BattleState, unitId: string, cell: Cell): { ok: boolean; reason?: string } {
  if (state.phase !== "deployment") return { ok: false, reason: "not in deployment" };
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: "no such unit" };
  if (!isDeploymentCell(unit.side, cell)) return { ok: false, reason: "outside that side's deployment rows" };
  unit.cell = { ...cell };
  unit.occupancyRounds = 0;
  pushLog(state, "deploy", `${unit.name} [${unit.id}] deploys to row ${cell.row}, column ${cell.col}.`, { unitId });
  return { ok: true };
}

/** The unit the player rides with (§8.7). Must be a player-side unit. */
export function attachPlayer(state: BattleState, unitId: string): { ok: boolean; reason?: string } {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== "player") return { ok: false, reason: "must attach to a player-side unit" };
  state.player.attachedUnitId = unitId;
  pushLog(state, "player", `The lord rides with ${unit.name} [${unit.id}].`, { unitId });
  return { ok: true };
}

/** §5.2.2 "Address the Troops": pre-battle pool spend on any player-side unit, no cell restriction. */
export function addressTroops(state: BattleState, unitId: string, amount: number): { ok: boolean; spent: number; reason?: string } {
  if (state.phase !== "deployment") return { ok: false, spent: 0, reason: "only before the battle" };
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== "player") return { ok: false, spent: 0, reason: "no such friendly unit" };
  const s = spendShield(state.commandPool.remaining, amount, unit.maxMorale, unit.shield);
  if (s.spent <= 0) return { ok: false, spent: 0, reason: "nothing to spend or unit already at its cap" };
  state.commandPool.remaining = s.poolAfter;
  unit.shield = s.shieldAfter;
  if (!unit.berserk && hasTag(unit.tags, "berserker")) {
    unit.berserk = true;
    pushLog(state, "morale", `${unit.name} [${unit.id}] hears the lord's words and works into a fury.`, { unitId });
  }
  pushLog(state, "rally", `The lord addresses ${unit.name} [${unit.id}]: +${s.spent} shield (pool ${state.commandPool.remaining} left).`, { unitId, data: { spent: s.spent } });
  return { ok: true, spent: s.spent };
}

export function beginRounds(state: BattleState): { ok: boolean; reason?: string } {
  if (state.phase !== "deployment") return { ok: false, reason: "not in deployment" };
  const undeployed = state.units.filter((u) => u.status === "active" && !u.cell);
  if (undeployed.length) return { ok: false, reason: `undeployed: ${undeployed.map((u) => u.id).join(", ")}` };
  if (!state.units.some((u) => u.side === "player" && isActive(u)) || !state.units.some((u) => u.side === "enemy" && isActive(u))) {
    return { ok: false, reason: "both sides need at least one unit" };
  }
  state.phase = "rounds";
  pushLog(state, "phase", "Both hosts are in place. The battle begins.");
  return { ok: true };
}

/** Unit ids the player gives orders to at this tier (§4). */
export function controlledUnitIds(state: BattleState): string[] {
  switch (state.tier) {
    case "full_command":
      return state.units.filter((u) => u.side === "player" && isActive(u)).map((u) => u.id);
    case "sub_command":
      return state.units.filter((u) => u.side === "player" && u.owner === "player" && isActive(u)).map((u) => u.id);
    case "rank_and_file":
      return [];
  }
}

export type PlayRoundOptions = { enemyAi?: AiOptions; allyAi?: AiOptions };

/**
 * One round: the player's orders for the units they control, the script AI for everyone else
 * (the enemy, allied NPC units, and — at Rank-and-File — the player's own side entirely).
 */
export function playRound(state: BattleState, playerOrders: readonly Order[], opts?: PlayRoundOptions): BattleState {
  if (state.phase !== "rounds") throw new Error(`Cannot play a round in phase ${state.phase}`);
  const controlled = new Set(controlledUnitIds(state));
  const filtered = playerOrders.filter((o) => o.type === "rally" || controlled.has(o.unitId));
  const uncontrolled = state.units.filter((u) => u.side === "player" && isActive(u) && !controlled.has(u.id)).map((u) => u.id);
  const ally = aiOrders(state, "player", uncontrolled, opts?.allyAi ?? { posture: "attack" });
  const enemy = aiOrders(state, "enemy", "all", opts?.enemyAi);
  withRng(state, (rng) => resolveRound(state, [...filtered, ...ally, ...enemy], rng));
  return state;
}

export type DayEndChoice = "hold" | "reposition" | "withdraw";

/** §8.6 Full Command's nightfall choice; other tiers are simply told the outcome. */
export function endDay(state: BattleState, choice: DayEndChoice, newField?: Battlefield): BattleState {
  if (state.phase !== "day_end") throw new Error("Not at a day's end.");
  if (choice === "withdraw") {
    state.phase = "finished";
    state.outcome = "withdrawn";
    for (const u of state.units) if (u.side === "player" && isActive(u)) u.status = "withdrawn";
    pushLog(state, "phase", "The army withdraws under cover of night. The engagement is abandoned.");
    return state;
  }
  withRng(state, (rng) => {
    for (const u of state.units) {
      if (!isActive(u)) continue;
      const before = u.morale;
      u.morale = overnightMorale(u.morale, u.maxMorale, rng);
      if (u.morale !== before) pushLog(state, "morale", `${u.name} [${u.id}] rests: morale ${before} → ${u.morale}.`, { unitId: u.id });
    }
  });
  if (choice === "reposition") {
    if (!newField) {
      state.awaitingReposition = true;
      pushLog(state, "phase", "The army seeks better ground overnight; a new field must be chosen before dawn.");
      return state;
    }
    state.battlefield = newField;
    for (const u of state.units) {
      if (!isActive(u)) continue;
      u.occupancyRounds = 0;
      u.fort = undefined;
      u.engagedWith = [];
      u.engagedSince = {};
      u.pendingMove = undefined;
    }
  }
  state.awaitingReposition = false;
  state.day += 1;
  state.phase = "rounds";
  pushLog(state, "phase", `Dawn of day ${state.day}. ${choice === "hold" ? "Both hosts stand where they stood." : `The field is now ${newField?.name ?? "new ground"}.`}`);
  return state;
}

// ---------------------------------------------------------------------------
// Aftermath (§10 ledgers)
// ---------------------------------------------------------------------------

export type UnitReport = {
  id: string;
  name: string;
  sheetId: string;
  side: UnitInstance["side"];
  owner: UnitInstance["owner"];
  status: UnitInstance["status"];
  hp: number;
  maxHp: number;
  morale: number;
  maxMorale: number;
  strength: number;
  initialStrength: number;
  casualties: number;
  captured: number;
  escaped: number;
  moraleDealt: number;
  moraleTaken: number;
  veteranEarned: boolean;
};

export type BattleSummary = {
  outcome: BattleOutcome | "undecided";
  rounds: number;
  days: number;
  units: UnitReport[];
  /** §5.2.1 over units the player personally controls. */
  moraleDealt: number;
  moraleTaken: number;
  renownDelta: number;
  prisonersTaken: number;
  prisonersLost: number;
  /** Peasant Levy dead on the player's side: the only casualties that touch the estate's adult_men. */
  levyDead: number;
  player: BattleState["player"];
  commandPool: BattleState["commandPool"];
};

export function summarizeBattle(state: BattleState, opts?: { objectiveBonus?: number; turningPointAward?: number }): BattleSummary {
  const units: UnitReport[] = state.units.map((u) => ({
    id: u.id,
    name: u.name,
    sheetId: u.sheetId,
    side: u.side,
    owner: u.owner,
    status: u.status,
    hp: u.hp,
    maxHp: u.maxHp,
    morale: u.morale,
    maxMorale: u.maxMorale,
    strength: u.strength,
    initialStrength: u.initialStrength,
    casualties: u.casualties,
    captured: u.captured,
    escaped: u.escaped,
    moraleDealt: u.moraleDealt,
    moraleTaken: u.moraleTaken,
    veteranEarned: (u.status === "active" || u.status === "withdrawn") && u.wasEngaged && !hasTag(u.tags, "veteran"),
  }));
  const mine = state.units.filter((u) => u.side === "player" && u.owner === "player");
  const moraleDealt = mine.reduce((s, u) => s + u.moraleDealt, 0);
  const moraleTaken = mine.reduce((s, u) => s + u.moraleTaken, 0);
  let delta: number;
  switch (state.tier) {
    case "rank_and_file":
      delta = rankAndFileRenown(state.player.personalDealt - state.player.personalTaken, opts?.turningPointAward ?? 0);
      break;
    case "sub_command":
      delta = subCommandRenown(moraleDealt, moraleTaken, opts?.objectiveBonus ?? 0);
      break;
    case "full_command":
      delta = renownDelta(moraleDealt, moraleTaken);
      break;
  }
  return {
    outcome: state.outcome ?? "undecided",
    rounds: state.round,
    days: state.day,
    units,
    moraleDealt,
    moraleTaken,
    renownDelta: delta,
    prisonersTaken: state.units.filter((u) => u.side === "enemy").reduce((s, u) => s + u.captured, 0),
    prisonersLost: state.units.filter((u) => u.side === "player").reduce((s, u) => s + u.captured, 0),
    levyDead: state.units.filter((u) => u.side === "player" && u.sheetId === "peasant_levy").reduce((s, u) => s + u.casualties, 0),
    player: state.player,
    commandPool: state.commandPool,
  };
}
