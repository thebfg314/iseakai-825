import vignetteFile from "../../data/combat/vignettes.json";
import type { BattleState, UnitInstance } from "./battleTypes";
import { PLAYER_PERSONAL_BASELINE } from "./constants";
import type { Rng } from "./rng";
import type { Wound } from "./schema";
import { findUnit, isActive, isTargetable } from "./units";
import { addLordWound, nearestEnemies } from "./round";
import { VignetteFileSchema, type EffectTier, type Vignette, type VignetteEffect, type VignetteOption, type VignettePhase } from "./vignetteSchema";

/**
 * Rank-and-File vignette pool and choice resolution (design doc §4.1, content file).
 * The pool is data; this module draws cards, rolls the Effect Tier Reference, and turns
 * an option's effects into concrete changes on the battle state.
 */

const data = VignetteFileSchema.parse(vignetteFile);
export const VIGNETTES: readonly Vignette[] = data.vignettes;
export const EFFECT_TIERS_REF = data.tiers;

/** Draw caps per phase (§4.1 table). */
export const DRAWS_PER_PHASE: Record<VignettePhase, number> = { opening: 1, crisis: 6, turning: 1 };

export function vignetteById(id: string): Vignette | undefined {
  return VIGNETTES.find((v) => v.id === id);
}

export function poolFor(phase: VignettePhase, drawn: readonly string[] = []): Vignette[] {
  return VIGNETTES.filter((v) => v.phase === phase && !drawn.includes(v.id));
}

/** Random card from the phase pool, never repeating within a battle. Undefined if the pool is spent. */
export function drawVignette(phase: VignettePhase, drawn: readonly string[], rng: Rng): Vignette | undefined {
  const pool = poolFor(phase, drawn);
  return pool.length ? rng.pick(pool) : undefined;
}

export type ChoiceOutcome = {
  vignetteId: string;
  optionKey: "A" | "B";
  /** Personal HP Risk was rolled and wounded the lord. */
  wounded: boolean;
  personalDamage: number;
  hpBefore: number;
  hpAfter: number;
  permanentWound: boolean;
  /** Effects that actually applied (always + onSuccess/onFail). */
  effects: VignetteEffect;
  renownDelta: number;
  unitMoraleDelta: number;
  enemyDamage: number;
  enemyUnitId?: string;
  stabilized: boolean;
  died: boolean;
  /** Player-facing summary of what happened mechanically. */
  summary: string;
};

function tierRenown(t: EffectTier): number {
  return EFFECT_TIERS_REF.renown[t] ?? 0;
}
function tierMorale(t: EffectTier): number {
  return EFFECT_TIERS_REF.unitMorale[t] ?? 0;
}

function mergeEffects(...parts: (VignetteEffect | undefined)[]): VignetteEffect {
  const out: VignetteEffect = {};
  for (const p of parts) if (p) Object.assign(out, p);
  return out;
}

/** The lord's own unit, or undefined if it has left the field. */
export function attachedUnit(state: BattleState): UnitInstance | undefined {
  if (!state.player.attachedUnitId) return undefined;
  const u = findUnit(state.units, state.player.attachedUnitId);
  return u && isActive(u) ? u : undefined;
}

/** Enemy the vignette's "Enemy Unit" effect lands on: the one the lord's file is fighting, else the nearest. */
export function vignetteEnemy(state: BattleState): UnitInstance | undefined {
  const mine = attachedUnit(state);
  if (!mine) return undefined;
  const engaged = mine.engagedWith.map((id) => findUnit(state.units, id)).find((u) => u && isTargetable(u));
  return engaged ?? nearestEnemies(state, mine)[0];
}

/**
 * Resolve one option: roll the Personal HP Risk (with the Dismounted +15pp), pick the effect
 * branch, and apply everything to the battle state. Returns what happened for narration.
 */
export function resolveVignetteChoice(state: BattleState, vignette: Vignette, optionKey: "A" | "B", rng: Rng): ChoiceOutcome {
  const option = vignette.options.find((o) => o.key === optionKey) as VignetteOption;
  const p = state.player;
  const hpBefore = p.hp;
  let wounded = false;
  let damage = 0;
  if (option.risk) {
    const ref = EFFECT_TIERS_REF.personalRisk[option.risk]!;
    const chance = ref.chance + (p.dismounted ? PLAYER_PERSONAL_BASELINE.dismountedRiskBonus : 0);
    if (rng.chance(chance)) {
      wounded = true;
      damage = rng.int(ref.damage.min, ref.damage.max);
    }
  }
  const effects = mergeEffects(option.always, wounded ? option.onFail : option.onSuccess);
  const parts: string[] = [];

  // Personal HP and permanent injury (content file: below 10 HP → 33% per qualifying hit).
  let permanentWound = false;
  let died = false;
  if (damage > 0) {
    p.hp = Math.max(0, p.hp - damage);
    parts.push(`you take ${damage} (HP ${p.hp}/${p.maxHp})`);
    if (p.hp <= 0) {
      p.alive = false;
      p.fate = "killed";
      died = true;
      parts.push("and do not rise again");
    } else if (p.hp < PLAYER_PERSONAL_BASELINE.permanentInjuryHpThreshold && rng.chance(PLAYER_PERSONAL_BASELINE.permanentInjuryChance)) {
      permanentWound = true;
      const wound: Wound = { location: "unresolved", cause: `${vignette.title}, day ${state.day} round ${state.round}`, statEffect: {}, renownEffect: 0, narrativeFlags: ["awaiting_narration", "permanent"], seasonsHeld: 0, permanent: true };
      addLordWound(state, wound);
      parts.push("— a wound that will not fully heal; you are carried from the line");
    }
  } else if (option.risk) {
    parts.push("you come through unhurt");
  }

  // Renown.
  let renownDelta = 0;
  if (effects.renown) {
    renownDelta = tierRenown(effects.renown.tier) * effects.renown.sign;
    parts.push(`Renown ${renownDelta > 0 ? "+" : ""}${renownDelta}`);
  }

  // Own unit morale.
  let unitMoraleDelta = 0;
  const mine = attachedUnit(state);
  if (effects.unitMorale && mine) {
    unitMoraleDelta = tierMorale(effects.unitMorale.tier) * effects.unitMorale.sign;
    mine.morale = Math.max(0, Math.min(mine.maxMorale, mine.morale + unitMoraleDelta));
    parts.push(`your file's morale ${unitMoraleDelta > 0 ? "+" : ""}${unitMoraleDelta}`);
  }

  // Enemy unit HP and morale.
  let enemyDamage = 0;
  let enemyUnitId: string | undefined;
  if (effects.enemy) {
    const enemy = vignetteEnemy(state);
    if (enemy) {
      const ref = EFFECT_TIERS_REF.enemy[effects.enemy]!;
      enemyDamage = rng.int(ref.min, ref.max);
      enemy.hp = Math.max(0, enemy.hp - enemyDamage);
      enemy.morale = Math.max(0, enemy.morale - enemyDamage);
      enemy.moraleTaken += enemyDamage;
      if (mine) mine.moraleDealt += enemyDamage;
      enemyUnitId = enemy.id;
      parts.push(`the enemy file loses ${enemyDamage}`);
    }
  }

  if (effects.flankShockHalf && mine) mine.flankShockScale = 0.5;
  if (effects.holdFormation && mine) mine.holdFormation = true;
  if (effects.dismount) {
    p.dismounted = true;
    parts.push("you are on foot now");
  }
  if (effects.remount) {
    p.dismounted = false;
    parts.push("you are back in the saddle");
  }
  if (effects.skipWoundRoll) p.woundRollMode = "skip";
  if (effects.extraWoundRoll) p.woundRollMode = "extra";

  let stabilized = false;
  if (effects.stabilize && p.hp < PLAYER_PERSONAL_BASELINE.permanentInjuryHpThreshold && rng.chance(0.3)) {
    p.hp = Math.min(p.maxHp, p.hp + 2);
    stabilized = true;
    parts.push(`you steady yourself (HP ${p.hp})`);
  }

  const summary = parts.length ? parts.join("; ") : "nothing turns on it";
  return {
    vignetteId: vignette.id,
    optionKey,
    wounded,
    personalDamage: damage,
    hpBefore,
    hpAfter: p.hp,
    permanentWound,
    effects,
    renownDelta,
    unitMoraleDelta,
    enemyDamage,
    enemyUnitId,
    stabilized,
    died,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1) + ".",
  };
}

/** Which unit-AI bias a positioning effect implies for the next round. */
export function biasForPositioning(pos: VignetteEffect["positioning"]): "press" | "hold" | undefined {
  switch (pos) {
    case "sooner":
    case "high_ground":
      return "press";
    case "later":
    case "distance":
      return "hold";
    default:
      return undefined;
  }
}
