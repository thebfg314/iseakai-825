import type { Battlefield, BattleState, CommandTier, Owner, Side, UnitInstance } from "./battleTypes";
import { addUnit, attachPlayer, beginRounds, createBattle, deploy } from "./battle";
import { GRID_COLUMNS } from "./constants";
import { emptyBattlefield, frontRow, reserveRow } from "./grid";
import { requireUnitSheet } from "./registry";
import type { Rank } from "./schema";
import { spawnUnit, type SpawnOptions } from "./units";

/** Quick battle builders shared by tests, the lab, and the campaign's encounter generator. */

export type RosterLine = {
  sheetId: string;
  count?: number;
  owner?: Owner;
  extraTags?: string[];
  overrides?: SpawnOptions["overrides"];
  name?: string;
};

export type QuickScenario = {
  id?: string;
  seed: number;
  tier: CommandTier;
  battlefield?: Battlefield;
  player: RosterLine[];
  enemy: RosterLine[];
  /** Index into the expanded player roster the lord rides with; default 0. */
  attachIndex?: number;
  renown?: number;
  rank?: Rank;
  /** Skip beginRounds so the caller can adjust deployment. */
  leaveInDeployment?: boolean;
};

function expand(lines: readonly RosterLine[], side: Side): UnitInstance[] {
  const out: UnitInstance[] = [];
  const counts = new Map<string, number>();
  for (const line of lines) {
    const n = line.count ?? 1;
    for (let i = 0; i < n; i++) {
      const k = (counts.get(line.sheetId) ?? 0) + 1;
      counts.set(line.sheetId, k);
      const id = `${side[0]}-${line.sheetId}-${k}`;
      out.push(
        spawnUnit(line.sheetId, {
          id,
          side,
          owner: line.owner ?? (side === "enemy" ? "enemy" : "player"),
          extraTags: line.extraTags,
          overrides: line.overrides,
          name: line.name,
        }),
      );
    }
  }
  return out;
}

/** Melee to the front row, ranged and siege to the reserve row, spread across the columns. */
export function autoDeploy(state: BattleState, side: Side): void {
  const units = state.units.filter((u) => u.side === side && !u.cell);
  const front = units.filter((u) => requireUnitSheet(u.sheetId).range === 0 && requireUnitSheet(u.sheetId).kind === "troop");
  const back = units.filter((u) => !front.includes(u));
  front.forEach((u, i) => deploy(state, u.id, { row: frontRow(side), col: spreadColumn(i, front.length) }));
  back.forEach((u, i) => deploy(state, u.id, { row: reserveRow(side), col: spreadColumn(i, back.length) }));
}

function spreadColumn(i: number, n: number): number {
  if (n === 1) return 1;
  if (n === 2) return i === 0 ? 0 : 2;
  return i % GRID_COLUMNS;
}

export function buildQuickScenario(s: QuickScenario): BattleState {
  const state = createBattle({
    id: s.id ?? `battle-${s.seed}`,
    seed: s.seed,
    tier: s.tier,
    battlefield: s.battlefield ?? emptyBattlefield(),
    player: { renown: s.renown ?? 1, rank: s.rank ?? 1 },
  });
  const playerUnits = expand(s.player, "player");
  const enemyUnits = expand(s.enemy, "enemy");
  for (const u of [...playerUnits, ...enemyUnits]) addUnit(state, u);
  autoDeploy(state, "player");
  autoDeploy(state, "enemy");
  const attach = playerUnits[s.attachIndex ?? 0];
  if (attach) attachPlayer(state, attach.id);
  if (!s.leaveInDeployment) {
    const begun = beginRounds(state);
    if (!begun.ok) throw new Error(begun.reason);
  }
  return state;
}
