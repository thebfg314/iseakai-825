/**
 * Tunables from the design doc, gathered in one place so playtesting changes
 * one number, not five call sites. Section references are to the design doc.
 */

/** §6: every point of HP damage costs one point of Morale by default. */
export const MORALE_DAMAGE_RATIO = 1.0;

/** §6: once an attack connects it deals at least this much HP damage. */
export const MIN_HIT_DAMAGE = 1;

/** §8.1 grid. Rows 1–2 own side, 3 no man's land, 4–5 enemy side. */
export const GRID_COLUMNS = 3;
export const GRID_ROWS = 5;

/** §8.2 movement and action costs. */
export const MOVE_COST = 2;
export const DISENGAGE_MOVE_COST = 4;
export const FIRE_COST = 1;
export const ENGAGE_COST = 1;
export const RALLY_COST = 1;
/** §7.19 stationary_emplacement: no movement, but one firing action a round. */
export const STATIONARY_ACTION_POINTS = 1;

/** §8.3 splash shares: declared target 2, each unit directly engaged against it 1. */
export const SPLASH_TARGET_SHARES = 2;
export const SPLASH_ENGAGED_SHARES = 1;

/** §8.4 gang-up. Index = number of attackers engaged on one defender. */
export const GANG_UP_MAX_ATTACKERS = 3;
export const GANG_UP_ATK_BONUS: Record<number, number> = { 1: 0, 2: 0.15, 3: 0.25 };
export const GANG_UP_DEF_PENALTY: Record<number, number> = { 1: 0, 2: 0.1, 3: 0.2 };
/** §8.4 counter-damage split, front-loaded toward the first to Engage. */
export const COUNTER_DAMAGE_SPLIT: Record<number, readonly number[]> = {
  1: [1],
  2: [2 / 3, 1 / 3],
  3: [1 / 2, 1 / 4, 1 / 4],
};
/** §8.4 flanking morale shock multipliers when a defender crosses to 2 or 3 attackers. */
export const FLANK_SHOCK_MULTIPLIER: Record<2 | 3, number> = { 2: 3, 3: 6 };

/** §8.5 Disordered at or below this fraction of max Morale. */
export const DISORDERED_MORALE_FRACTION = 0.25;

/** §8.6 multi-day engagements. */
export const ROUNDS_PER_DAY = 10;
export const OVERNIGHT_MORALE_RECOVERY = { min: 0.15, max: 0.2 } as const;

/** §8.7 rout resolution. */
export const ESCAPE_BASE = 0.5;
export const ESCAPE_SPEED_COEFFICIENT = 0.1;
export const ESCAPE_MIN = 0.05;
export const ESCAPE_MAX = 0.95;
export const PURSUER_CAP = GANG_UP_MAX_ATTACKERS;

/** §8.7 personal risk while the attached unit is Engaged. */
export const PLAYER_WOUND_CHANCE_PER_ROUND = 0.05;
export const PLAYER_WOUND_FATAL_CHANCE = 0.12;

/** Phase 0 decision: casualties as a fraction of HP lost × strength. */
export const CASUALTY_PER_HP_LOST_FRACTION = 0.5;

/** §5.2.1 rank thresholds (index 0 = rank 1). */
export const RANK_THRESHOLDS: readonly number[] = [1, 100, 500, 1000, 2000];
/** §5.2.2 Command Pool rank multipliers (index 0 = rank 1). */
export const RANK_MULTIPLIERS: readonly number[] = [1.0, 1.5, 2.0, 2.75, 3.5];
export const RENOWN_FLOOR = 1;
/** §5.2.2 a unit can never hold shield beyond its own base Morale. */
export const COMMAND_POOL_UNIT_CAP_MULTIPLIER = 2;
export const RALLY_RATE = 1;

/** §4.1 Rank-and-File Renown tiers for vignette awards. */
export const RAF_RENOWN_TIER = { low: 3, medium: 10, high: 30 } as const;

/** Rank-and-File personal baseline (vignette file). */
export const PLAYER_PERSONAL_BASELINE = {
  hp: 20,
  atk: 15,
  def: 11,
  damage: { min: 6, max: 11 },
  permanentInjuryHpThreshold: 10,
  permanentInjuryChance: 0.33,
  dismountedRiskBonus: 0.15,
} as const;

/** §9.3 Defender designation: occupancy lead needed to hold a terrain feature. */
export const DEFENDER_OCCUPANCY_LEAD = 1;

/** §9.5 Scouting Duel candidate pool. */
export const SCOUTING_POOL_SIZE = 6;
export const SCOUTING_NARROW_TO = 3;
