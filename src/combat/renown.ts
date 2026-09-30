import {
  COMMAND_POOL_UNIT_CAP_MULTIPLIER,
  RANK_MULTIPLIERS,
  RANK_THRESHOLDS,
  RENOWN_FLOOR,
} from "./constants";
import { RANK_TITLES, type Rank } from "./schema";

/** §5.2.1 Renown, rank thresholds, and §5.2.2 Command Pool. Pure functions. */

export function rankForRenown(renown: number): Rank {
  let rank: Rank = 1;
  RANK_THRESHOLDS.forEach((threshold, i) => {
    if (renown >= threshold) rank = (i + 1) as Rank;
  });
  return rank;
}

export function rankTitle(rank: Rank): string {
  return RANK_TITLES[rank - 1];
}

export function renownForRank(rank: Rank): number {
  return RANK_THRESHOLDS[rank - 1];
}

/** Titles are sticky: never lower than the rank already held, even if Renown falls. */
export function stickyRank(currentRank: Rank, renown: number): Rank {
  return Math.max(currentRank, rankForRenown(renown)) as Rank;
}

/** §5.2.1 core formula for units the player personally controls. */
export function renownDelta(moraleDealt: number, moraleTaken: number): number {
  return Math.round(moraleDealt - moraleTaken);
}

/** §5.2.1 floor at the Rank 1 threshold. */
export function applyRenown(current: number, delta: number): number {
  return Math.max(RENOWN_FLOOR, Math.round(current + delta));
}

export function rankMultiplier(rank: Rank): number {
  return RANK_MULTIPLIERS[rank - 1];
}

/** §5.2.2 per-battle Command Pool. */
export function commandPool(renown: number, rank: Rank): number {
  return Math.round(renown * rankMultiplier(rank));
}

/** §5.2.2 a unit's maximum shield: base + shield may not exceed 2× base Morale. */
export function maxShieldFor(baseMorale: number, currentShield = 0): number {
  return Math.max(0, baseMorale * COMMAND_POOL_UNIT_CAP_MULTIPLIER - baseMorale - currentShield);
}

/** Spend from the pool onto one unit at 1:1, respecting the cap. Returns what actually moved. */
export function spendShield(pool: number, requested: number, baseMorale: number, currentShield = 0): { spent: number; poolAfter: number; shieldAfter: number } {
  const room = maxShieldFor(baseMorale, currentShield);
  const spent = Math.max(0, Math.min(pool, requested, room));
  return { spent, poolAfter: pool - spent, shieldAfter: currentShield + spent };
}

/**
 * Shield absorbs morale loss before the unit's own Morale. Returns the split and
 * counts the absorbed part as "morale taken" for the Renown formula (Phase 0 decision).
 */
export function absorbMoraleLoss(shield: number, morale: number, loss: number): { shield: number; morale: number; absorbed: number; toMorale: number } {
  const absorbed = Math.min(shield, Math.max(0, loss));
  const toMorale = Math.max(0, loss) - absorbed;
  return { shield: shield - absorbed, morale: morale - toMorale, absorbed, toMorale };
}

/**
 * §4.1 Rank-and-File Renown: blows and deeds only. The file's own objective share was cut in the
 * second design review (item 7) — one man in the line does not carry his file's orders.
 */
export function rankAndFileRenown(personalCombatDelta: number, turningPointAward: number): number {
  return Math.round(personalCombatDelta + turningPointAward);
}

/** §4.2 Sub-Command: base formula plus the LLM-judged objective bonus. */
export function subCommandRenown(moraleDealt: number, moraleTaken: number, objectiveBonus: number): number {
  return renownDelta(moraleDealt, moraleTaken) + Math.round(objectiveBonus);
}

/** §8.7 ransom; Ransom_constant is an economy tunable still to be set. */
export function ransomCost(renown: number, rank: Rank, ransomConstant: number): number {
  return Math.round(renown * rankMultiplier(rank) * ransomConstant);
}

// ---------------------------------------------------------------------------
// Command Claim (stub). Score = Renown + Σ(HP + ATK + DEF) of units contributed.
// Allies come from the historical-narrative layer, still to be designed; the
// weighting between Renown and unit power is an open tunable.
// ---------------------------------------------------------------------------

export type ClaimContribution = { renown: number; units: readonly { hp: number; atk: number; def: number }[] };

export function contributionScore(c: ClaimContribution): number {
  const power = c.units.reduce((s, u) => s + u.hp + u.atk + u.def, 0);
  return c.renown + power;
}

export type CommandClaimResult = { playerScore: number; bestAllyScore: number; playerWins: boolean };

/** With no allies there is no claim to make; the player simply holds whatever tier they qualified for. */
export function resolveCommandClaim(player: ClaimContribution, allies: readonly ClaimContribution[]): CommandClaimResult {
  const playerScore = contributionScore(player);
  const bestAllyScore = allies.reduce((best, a) => Math.max(best, contributionScore(a)), 0);
  return { playerScore, bestAllyScore, playerWins: allies.length > 0 && playerScore > bestAllyScore };
}
