import {
  COUNTER_DAMAGE_SPLIT,
  DISORDERED_MORALE_FRACTION,
  ESCAPE_BASE,
  ESCAPE_MAX,
  ESCAPE_MIN,
  ESCAPE_SPEED_COEFFICIENT,
  FLANK_SHOCK_MULTIPLIER,
  GANG_UP_ATK_BONUS,
  GANG_UP_DEF_PENALTY,
  GANG_UP_MAX_ATTACKERS,
  MIN_HIT_DAMAGE,
  MORALE_DAMAGE_RATIO,
  OVERNIGHT_MORALE_RECOVERY,
  PURSUER_CAP,
  SPLASH_ENGAGED_SHARES,
  SPLASH_TARGET_SHARES,
} from "./constants";
import type { Rng } from "./rng";
import type { NumRange } from "./schema";

/**
 * The deterministic core (design doc §6, §8.3–8.7, §9.4). Everything here is a
 * pure function of its inputs; randomness comes in only through an explicit Rng.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** §6: fraction of a unit's blows that connected and mattered this round. */
export function hitMultiplier(effectiveAtk: number, effectiveDef: number): number {
  const atk = Math.max(0, effectiveAtk);
  const def = Math.max(0, effectiveDef);
  if (atk + def <= 0) return 0;
  return atk / (atk + def);
}

/** Midpoint of a damage range, for expected-value displays and flank shock. */
export function averageDamage(range: NumRange): number {
  return (range.min + range.max) / 2;
}

/** §6: roll within the stated range, integer, optionally scaled (inconsistent_torsion, finisher). */
export function rollDamage(rng: Rng, range: NumRange, multiplier = 1): number {
  const rolled = rng.int(Math.round(range.min), Math.round(range.max));
  return rolled * multiplier;
}

/** §6: final HP damage from a rolled value; minimum 1 once an attack connects. */
export function finalDamage(rolledDamage: number, multiplier: number): number {
  if (rolledDamage <= 0 || multiplier <= 0) return 0;
  return Math.max(MIN_HIT_DAMAGE, Math.round(rolledDamage * multiplier));
}

export type HitResolution = {
  hitMultiplier: number;
  rolledDamage: number;
  /** Damage before any siege halving — this is what morale is computed from. */
  fullDamage: number;
  /** Damage actually removed from HP. */
  hpDamage: number;
  /** Morale removed (positive number). */
  moraleDamage: number;
};

export type ResolveHitInput = {
  effectiveAtk: number;
  effectiveDef: number;
  rolledDamage: number;
  /** Target's morale_damage_ratio after tag multipliers; default 1.0. */
  moraleDamageRatio?: number;
  /** Target's morale_loss_multiplier (undisciplined 1.5); default 1.0. */
  moraleLossMultiplier?: number;
  /** §9.4 siege_weapon vs troops: HP halved, morale from the full value. */
  hpDamageMultiplier?: number;
};

/** §6 order of operations from step 4 onward. Steps 1–3 (modifiers) belong to the tag layer. */
export function resolveHit(input: ResolveHitInput): HitResolution {
  const multiplier = hitMultiplier(input.effectiveAtk, input.effectiveDef);
  const fullDamage = finalDamage(input.rolledDamage, multiplier);
  const hpMult = input.hpDamageMultiplier ?? 1;
  const hpDamage = fullDamage === 0 ? 0 : hpMult === 1 ? fullDamage : Math.max(MIN_HIT_DAMAGE, Math.round(fullDamage * hpMult));
  const ratio = (input.moraleDamageRatio ?? MORALE_DAMAGE_RATIO) * (input.moraleLossMultiplier ?? 1);
  const moraleDamage = Math.round(fullDamage * ratio);
  return { hitMultiplier: multiplier, rolledDamage: input.rolledDamage, fullDamage, hpDamage, moraleDamage };
}

/** §6: morale lost for a given HP-damage value. */
export function moraleDamageFromHp(fullDamage: number, moraleDamageRatio = MORALE_DAMAGE_RATIO, moraleLossMultiplier = 1): number {
  return Math.round(fullDamage * moraleDamageRatio * moraleLossMultiplier);
}

/** §8.4 gang-up: each attacker's ATK bonus and the defender's DEF penalty, as multipliers. */
export function gangUpModifiers(attackersOnDefender: number): { atkMultiplier: number; defMultiplier: number; allowed: boolean } {
  const n = Math.max(1, attackersOnDefender);
  if (n > GANG_UP_MAX_ATTACKERS) return { atkMultiplier: 1, defMultiplier: 1, allowed: false };
  return {
    atkMultiplier: 1 + (GANG_UP_ATK_BONUS[n] ?? 0),
    defMultiplier: 1 - (GANG_UP_DEF_PENALTY[n] ?? 0),
    allowed: true,
  };
}

/** §8.4: how one defender's return strike splits across attackers, front-loaded by Engage order. */
export function counterDamageSplit(attackers: number): readonly number[] {
  const n = clamp(Math.round(attackers), 1, GANG_UP_MAX_ATTACKERS);
  return COUNTER_DAMAGE_SPLIT[n];
}

/**
 * §8.4 flanking morale shock, fired once when a defender crosses 1→2 or 2→3 attackers.
 * `newAttackerAvgDamage` is the midpoint of the joining attacker's Damage range.
 */
export function flankShock(newAttackerAvgDamage: number, crossingTo: 2 | 3, effectiveAtk: number, effectiveDef: number): number {
  const shock = newAttackerAvgDamage * FLANK_SHOCK_MULTIPLIER[crossingTo] * hitMultiplier(effectiveAtk, effectiveDef);
  return Math.round(shock);
}

/** §8.5: a unit is Disordered at or below 25% of its max Morale. */
export function isDisordered(morale: number, maxMorale: number): boolean {
  if (maxMorale <= 0) return true;
  return morale <= maxMorale * DISORDERED_MORALE_FRACTION;
}

export type SplashRecipient<T> = { unit: T; shares: number; portion: number };

/**
 * §8.3 splash: the declared target takes 2 shares, each unit directly engaged against it 1 share.
 * §8.5 scrum: if the target and one of its engaged enemies are both Disordered, the target's
 * 2 shares split 1/1 between exactly those two.
 */
export function splashPortions<T>(
  rolledDamage: number,
  target: T,
  engagedAgainstTarget: readonly T[],
  scrumPartner?: T,
): SplashRecipient<T>[] {
  const rows: { unit: T; shares: number }[] = [];
  if (scrumPartner !== undefined && engagedAgainstTarget.includes(scrumPartner)) {
    rows.push({ unit: target, shares: SPLASH_TARGET_SHARES / 2 });
    rows.push({ unit: scrumPartner, shares: SPLASH_TARGET_SHARES / 2 });
    for (const u of engagedAgainstTarget) if (u !== scrumPartner) rows.push({ unit: u, shares: SPLASH_ENGAGED_SHARES });
  } else {
    rows.push({ unit: target, shares: SPLASH_TARGET_SHARES });
    for (const u of engagedAgainstTarget) rows.push({ unit: u, shares: SPLASH_ENGAGED_SHARES });
  }
  const total = rows.reduce((s, r) => s + r.shares, 0);
  return rows.map((r) => ({ ...r, portion: (rolledDamage * r.shares) / total }));
}

/** §8.7: fraction of a routing unit that gets away, driven by total pursuer Speed (capped at 3 pursuers). */
export function escapeFraction(routingSpeed: number, pursuerSpeeds: readonly number[]): number {
  const total = pursuerSpeeds.slice(0, PURSUER_CAP).reduce((s, v) => s + v, 0);
  return clamp(ESCAPE_BASE + (routingSpeed - total) * ESCAPE_SPEED_COEFFICIENT, ESCAPE_MIN, ESCAPE_MAX);
}

/** §8.7: of those caught, the killed fraction reuses hit_multiplier; the rest are captured. */
export function killFraction(pursuerEffectiveAtk: number, routingEffectiveDef: number): number {
  return hitMultiplier(pursuerEffectiveAtk, routingEffectiveDef);
}

export type RoutSplit = { escaped: number; killed: number; captured: number };

/** §8.7 combined: fractions of the whole routing unit that escape, die, or are captured. */
export function routSplit(routingSpeed: number, pursuerSpeeds: readonly number[], pursuerEffectiveAtk: number, routingEffectiveDef: number): RoutSplit {
  const escaped = escapeFraction(routingSpeed, pursuerSpeeds);
  const caught = 1 - escaped;
  const kill = killFraction(pursuerEffectiveAtk, routingEffectiveDef);
  return { escaped, killed: caught * kill, captured: caught * (1 - kill) };
}

/** Whole men from a fraction of a headcount, with the remainder assigned deterministically to `escaped`. */
export function routHeadcount(strength: number, split: RoutSplit): { escaped: number; killed: number; captured: number } {
  const killed = Math.round(strength * split.killed);
  const captured = Math.round(strength * split.captured);
  const escaped = Math.max(0, strength - killed - captured);
  return { escaped, killed, captured };
}

/** §9.4 hardened_structure: attacker ATK reduced by Structural DEF unless the attacker bypasses it. */
export function hardenedStructureAtk(effectiveAtk: number, structuralDef: number, bypasses: boolean): number {
  if (bypasses) return effectiveAtk;
  return Math.max(1, effectiveAtk - structuralDef);
}

/** §9.1 swamp: +1 DEF per 5 points of the defender's own base DEF. */
export function swampDefBonus(baseDef: number): number {
  return Math.floor(baseDef / 5);
}

/** §8.6 overnight: units regain 15–20% of max Morale, never above max, no HP recovery. */
export function overnightMorale(current: number, max: number, rng: Rng): number {
  const fraction = rng.between(OVERNIGHT_MORALE_RECOVERY.min, OVERNIGHT_MORALE_RECOVERY.max);
  return Math.min(max, Math.round(current + max * fraction));
}

/** Expected HP damage per hit, for order menus that show visible modifiers (§3). */
export function expectedDamage(effectiveAtk: number, effectiveDef: number, range: NumRange): number {
  return finalDamage(averageDamage(range), hitMultiplier(effectiveAtk, effectiveDef));
}

/** Hits needed, on average, to remove `pool` points at the expected damage per hit. */
export function hitsToBreak(pool: number, effectiveAtk: number, effectiveDef: number, range: NumRange): number {
  const perHit = expectedDamage(effectiveAtk, effectiveDef, range);
  if (perHit <= 0) return Infinity;
  return Math.ceil(pool / perHit);
}
