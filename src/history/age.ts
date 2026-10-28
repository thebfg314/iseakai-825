import type { WorldState } from "../engine/schema";
import { createRng, seedFromString } from "../combat/rng";
import { bodyAge } from "./flags";
import { seasonOrdinal } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * Age and death (03_HISTORY §11.2). `age = ageAt825 + (year − 825)`. The
 * participation band is exposed for the battle pass. Death of old age: from
 * the start of 910 the roll each season rises so death lands in 910–911
 * ("around 910–911, aged about 102"); 911-F1 fires in autumn 911 if he lives,
 * and he dies by winter 911 at the latest.
 */

export type ParticipationBand = "all" | "subcommand_or_rear" | "command_from_behind";

export function participationBand(age: number): ParticipationBand {
  if (age < 50) return "all";
  if (age < 65) return "subcommand_or_rear";
  return "command_from_behind";
}

export const DEATH_ROLL_START = { year: 910, season: "spring" } as const;
export const DEATH_CERTAIN = { year: 911, season: "winter" } as const;

/** Chance of death at the start of this season. */
export function deathChance(at: SeasonAt): number {
  const start = seasonOrdinal(DEATH_ROLL_START.year, DEATH_ROLL_START.season);
  const end = seasonOrdinal(DEATH_CERTAIN.year, DEATH_CERTAIN.season);
  const now = seasonOrdinal(at.year, at.season);
  if (now < start) return 0;
  if (now >= end) return 1;
  // 910: 0.08, 0.12, 0.16, 0.22; 911: 0.3, 0.4, 0.5; winter 911: certain.
  const steps = [0.08, 0.12, 0.16, 0.22, 0.3, 0.4, 0.5];
  return steps[Math.min(steps.length - 1, now - start)];
}

export function tickAge(state: WorldState, at: SeasonAt, turn: number): { died: boolean; line: string | null } {
  if (state.history.dead) return { died: false, line: null };
  const chance = deathChance(at);
  if (chance <= 0) return { died: false, line: null };
  const rng = createRng(seedFromString(`${state.meta.region}:age:${at.year}:${at.season}:${turn}`));
  if (!rng.chance(chance)) return { died: false, line: null };
  state.history.dead = { cause: "old_age", year: at.year };
  state.history.away = null;
  state.history.record.push({ year: at.year, season: at.season, text: `The lord died in his bed at Fontenay, aged ${bodyAge(state, at.year)}.`, thread: "ending" });
  return { died: true, line: `The lord of Fontenay died of old age in ${at.season} ${at.year}, aged ${bodyAge(state, at.year)}.` };
}

/** An earlier death (battle, wound, captivity) closes the chronicle the same way. */
export function markDeath(state: WorldState, cause: NonNullable<WorldState["history"]["dead"]>["cause"], year = state.meta.year): void {
  if (state.history.dead) return;
  state.history.dead = { cause, year };
  const how = cause === "battle" ? "fell in battle" : cause === "captivity" ? "died in his captors' hands" : cause === "wound" ? "died of his wounds" : "died of a sickness";
  state.history.record.push({ year, season: state.meta.season as SeasonAt["season"], text: `The lord ${how}, aged ${bodyAge(state, year)}.`, thread: "ending" });
}
