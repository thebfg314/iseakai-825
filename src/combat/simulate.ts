import type { BattleState, Order } from "./battleTypes";
import { aiOrders } from "./ai";
import { controlledUnitIds, endDay, playRound, summarizeBattle, type BattleSummary, type DayEndChoice, type PlayRoundOptions } from "./battle";

/** Headless runner for tests and the lab's auto-run. */

export type SimulateOptions = PlayRoundOptions & {
  /** Safety valve: stop after this many rounds regardless (default 60 = six days). */
  maxRounds?: number;
  /** Player orders per round; default lets the script AI run the player's side too. */
  playerOrders?: (state: BattleState) => Order[];
  /** Nightfall choice; default hold the ground. */
  dayEnd?: (state: BattleState) => DayEndChoice;
};

export function simulateBattle(state: BattleState, opts: SimulateOptions = {}): BattleSummary {
  const max = opts.maxRounds ?? 60;
  while (state.phase !== "finished" && state.round < max) {
    if (state.phase === "day_end") {
      endDay(state, opts.dayEnd?.(state) ?? "hold");
      continue;
    }
    if (state.phase !== "rounds") break;
    // With no human orders the script AI commands the player's controlled units as well.
    const orders = opts.playerOrders ? opts.playerOrders(state) : aiOrders(state, "player", controlledUnitIds(state), opts.allyAi ?? { posture: "attack" });
    playRound(state, orders, { enemyAi: opts.enemyAi, allyAi: opts.allyAi ?? { posture: "attack" } });
  }
  return summarizeBattle(state);
}
