import type { Wound } from "../combat/schema";
import type { Rng } from "../combat/rng";
import type { SeasonEffectLine, WorldState } from "./schema";

/**
 * The lord's wounds (design review rules).
 *
 *  - A wound taken in battle ends his part in it at Rank-and-File; at Sub-/Full Command he still
 *    directs but can no longer Rally; a second wound and he cannot even direct.
 *  - After the first season a wound heals with 30% chance, after the second with 15%; one that
 *    survives two seasons is permanent.
 *  - He can rule with one wound but not two. Two wounds still open after their two seasons
 *    (i.e. two permanent wounds) leave him too maimed to fight or rule — the game ends.
 *  - One permanent wound means he can never again lead a file directly (ride Rank-and-File or
 *    Sub-Command); he may still command a whole host from behind the line.
 */

export const WOUND_HEAL_CHANCE = { afterFirstSeason: 0.3, afterSecondSeason: 0.15 } as const;
export const WOUND_SEASONS_TO_PERMANENT = 2;
/** A general not riding with a file rolls this for a wound when his army is routed and loses. */
export const GENERAL_DEFEAT_WOUND_CHANCE = 0.4;
/** Morale lost by units when their leader is wounded (fraction of max Morale). */
export const GENERAL_WOUNDED_MORALE_FRACTION = 0.25;
export const UNIT_LEADER_WOUNDED_MORALE_FRACTION = 0.15;

export function woundCount(wounds: readonly Wound[]): number {
  return wounds.length;
}

export function permanentWoundCount(wounds: readonly Wound[]): number {
  return wounds.filter((w) => w.permanent).length;
}

/** May answer a call to arms at all. */
export function canRideToWar(state: WorldState): { ok: boolean; reason?: string } {
  if (state.player.dead) return { ok: false, reason: "The lord is dead." };
  if (state.player.maimed) return { ok: false, reason: "The lord is too maimed to fight or rule." };
  if (state.player.captive) return { ok: false, reason: "The lord is in his captors' hands." };
  if (woundCount(state.player.wounds) >= 2) return { ok: false, reason: "With two wounds unhealed the lord can neither ride nor rule; the season must turn first." };
  return { ok: true };
}

/** May ride in or at the head of a file (Rank-and-File, Sub-Command). A permanent wound forbids it. */
export function canLeadFile(state: WorldState): boolean {
  return permanentWoundCount(state.player.wounds) === 0;
}

/** May spend Command Pool on a Rally mid-battle: only while unwounded. */
export function canRally(wounds: readonly Wound[]): boolean {
  return woundCount(wounds) === 0;
}

/** May give orders: fewer than two wounds. */
export function canDirect(wounds: readonly Wound[]): boolean {
  return woundCount(wounds) < 2;
}

/** Season tick: wounds heal or set; two permanent wounds end the game. */
export function tickWounds(state: WorldState, rng: Rng): SeasonEffectLine[] {
  const lines: SeasonEffectLine[] = [];
  if (state.player.dead || state.player.maimed) return lines;
  const kept: Wound[] = [];
  for (const w of state.player.wounds) {
    if (w.permanent) {
      kept.push(w);
      continue;
    }
    w.seasonsHeld += 1;
    if (w.seasonsHeld === 1 && rng.chance(WOUND_HEAL_CHANCE.afterFirstSeason)) {
      lines.push({ kind: "info", text: `The wound to ${w.location} has closed cleanly.` });
      continue;
    }
    if (w.seasonsHeld === 2 && rng.chance(WOUND_HEAL_CHANCE.afterSecondSeason)) {
      lines.push({ kind: "info", text: `The wound to ${w.location} has healed at last.` });
      continue;
    }
    if (w.seasonsHeld >= WOUND_SEASONS_TO_PERMANENT) {
      w.permanent = true;
      if (!w.narrativeFlags.includes("permanent")) w.narrativeFlags.push("permanent");
      lines.push({ kind: "reject", text: `The wound to ${w.location} will not heal; the lord will carry it for life.` });
    }
    kept.push(w);
  }
  state.player.wounds = kept;
  if (permanentWoundCount(kept) >= 2) {
    state.player.maimed = true;
    lines.push({ kind: "reject", text: "Two wounds that never healed: the lord can no longer sit a horse nor hold a court." });
  }
  return lines;
}

/** The lord's own hurts mend fully between seasons (design review: 100% each season). */
export function healPersonalFully(state: WorldState): void {
  state.player.personal.hp = state.player.personal.maxHp;
}
