import type { Battlefield, UnitInstance } from "./battleTypes";
import { defenderTerrainBonus, hasTerrain, rangedDefBonusAt, weatherRangedAtkMultiplier } from "./grid";
import { gangUpModifiers, swampDefBonus } from "./formula";
import { armorDef, hasTag, isArmored, resolveTags } from "./registry";
import type { ConditionalModifier, TagCondition, TagDef } from "./schema";
import { isEngaged, sheetFor } from "./units";

/**
 * Steps 1–3 of the §6 order of operations: turn sheet numbers + tags + battlefield
 * context into effective ATK and DEF for one attack. Every applied modifier is
 * returned as a note so the lab log can show its work.
 */

export type AttackKind = "melee" | "ranged";

export type AttackContext = {
  attacker: UnitInstance;
  target: UnitInstance;
  attackKind: AttackKind;
  field: Battlefield;
  /** First round of a new melee engagement between these two (§11.3 charge definition). */
  attackerCharging?: boolean;
  /** The target is a routing unit being run down (§8.7 pursuit). */
  targetRouting?: boolean;
  /** Enemy units engaged on the target, for gang-up (§8.4). */
  attackersOnTarget?: number;
  /** Attacker holds its cell's terrain as Defender (§9.3). */
  attackerIsDefender?: boolean;
  /** Target holds its cell's terrain as Defender (§9.3). */
  targetIsDefender?: boolean;
  /** Fortification Defender DEF Bonus the target currently enjoys (0 if none, negated, or breached). */
  targetFortBonus?: number;
  /** Cannon dual_shot_type choice; grape behaves like precision_bolt. */
  shot?: "solid" | "grape";
};

export type StatBreakdown = { value: number; notes: string[] };

export type AttackModifiers = {
  atk: StatBreakdown;
  def: StatBreakdown;
  /** Multiplier on the rolled damage (efficient_finisher, inconsistent_torsion is rolled separately). */
  damageMultiplier: number;
  /** Extra morale delta applied on a hit (loud). Negative = loss for the target. */
  extraMoraleDelta: number;
  /** anti_cavalry_spears vs a charge: the target strikes back immediately. */
  counterDamage: boolean;
  /** efficient_finisher against routing: no ammo spent. */
  bypassesAmmoCost: boolean;
  /** Siege behaviour for this attack (troop target only). */
  hpDamageMultiplier: number;
  bypassesHardenedStructure: boolean;
};

function conditionHolds(cond: TagCondition, ctx: AttackContext, holder: "attacker" | "target"): boolean {
  const { attacker, target } = ctx;
  if (cond.attackKind && cond.attackKind !== ctx.attackKind) return false;
  if (cond.targetHasTag && !hasTag(target.tags, cond.targetHasTag)) return false;
  if (cond.targetLacksTag && hasTag(target.tags, cond.targetLacksTag)) return false;
  if (cond.targetArmored !== undefined && isArmored({ def: sheetFor(target).def, tags: target.tags }) !== cond.targetArmored) return false;
  if (cond.targetState === "routing" && !ctx.targetRouting) return false;
  // The engine only knows the attacker's charge state; a "charging target" never matches.
  if (cond.targetState === "charging") return false;
  if (cond.targetState === "engagedMelee" && !isEngaged(target)) return false;
  if (cond.attackerHasTag && !hasTag(attacker.tags, cond.attackerHasTag)) return false;
  if (cond.attackerState === "charging" && !ctx.attackerCharging) return false;
  if (cond.selfState) {
    const self = holder === "attacker" ? attacker : target;
    if (cond.selfState === "engagedMelee" && !isEngaged(self)) return false;
    if (cond.selfState === "charging" && !(holder === "attacker" && ctx.attackerCharging)) return false;
  }
  return true;
}

function activeConditionals(tags: readonly TagDef[], ctx: AttackContext, holder: "attacker" | "target"): { tag: TagDef; mod: ConditionalModifier }[] {
  const out: { tag: TagDef; mod: ConditionalModifier }[] = [];
  for (const tag of tags) {
    for (const mod of tag.conditional ?? []) {
      if (conditionHolds(mod.when, ctx, holder)) out.push({ tag, mod });
    }
  }
  return out;
}

/** Full modifier resolution for one attack. */
export function resolveAttackModifiers(ctx: AttackContext): AttackModifiers {
  const { attacker, target, field } = ctx;
  const aSheet = sheetFor(attacker);
  const tSheet = sheetFor(target);
  const aTags = resolveTags(attacker.tags);
  const tTags = resolveTags(target.tags);
  const atkNotes: string[] = [];
  const defNotes: string[] = [];

  // ---- ATK -----------------------------------------------------------------
  let atk = aSheet.atk;
  for (const t of aTags) {
    if (t.atkMultiplier && t.atkMultiplier !== 1) {
      atk *= t.atkMultiplier;
      atkNotes.push(`${t.id} ×${t.atkMultiplier}`);
    }
  }
  if (attacker.berserk) {
    const b = aTags.find((t) => t.onRally);
    if (b?.onRally) {
      atk *= b.onRally.atkMultiplier;
      atkNotes.push(`berserk ×${b.onRally.atkMultiplier}`);
    }
  }
  let damageMultiplier = 1;
  let extraMoraleDelta = 0;
  let bypassesAmmoCost = false;
  for (const { tag, mod } of activeConditionals(aTags, ctx, "attacker")) {
    if (mod.atkMultiplier) {
      atk *= mod.atkMultiplier;
      atkNotes.push(`${tag.id} ×${mod.atkMultiplier}`);
    }
    if (mod.damageMultiplier) damageMultiplier *= mod.damageMultiplier;
    if (mod.moraleDelta) extraMoraleDelta += mod.moraleDelta;
    if (mod.bypassesAmmoCost) bypassesAmmoCost = true;
  }
  if (ctx.attackerCharging) {
    for (const t of aTags) {
      if (!t.onCharge) continue;
      const ok = t.requires?.minSpeed === undefined || aSheet.speed >= t.requires.minSpeed;
      if (ok) {
        atk *= t.onCharge.atkMultiplier;
        atkNotes.push(`${t.id} charge ×${t.onCharge.atkMultiplier}`);
      }
    }
  }
  const gang = gangUpModifiers(ctx.attackersOnTarget ?? 1);
  if (gang.atkMultiplier !== 1) {
    atk *= gang.atkMultiplier;
    atkNotes.push(`gang-up ×${gang.atkMultiplier.toFixed(2)}`);
  }
  if (ctx.attackerIsDefender && attacker.cell) {
    const bonus = defenderTerrainBonus(field, attacker.cell);
    if (bonus.atkMultiplier !== 1) {
      atk *= bonus.atkMultiplier;
      atkNotes.push(`high ground ×${bonus.atkMultiplier}`);
    }
  }
  if (ctx.attackKind === "ranged") {
    const w = weatherRangedAtkMultiplier(field);
    if (w !== 1) {
      atk *= w;
      atkNotes.push(`${field.weather} ×${w}`);
    }
  }

  // ---- DEF -----------------------------------------------------------------
  let def = tSheet.def;
  const pierce = aTags.reduce((f, t) => Math.max(f, t.ignoreArmorDefFraction ?? 0), 0);
  if (pierce > 0) {
    const armor = armorDef({ def: tSheet.def, tags: target.tags });
    const ignored = armor * pierce;
    if (ignored > 0) {
      def -= ignored;
      defNotes.push(`armor_piercing −${ignored.toFixed(1)} of ${armor} armor`);
    }
  }
  let counterDamage = false;
  for (const { tag, mod } of activeConditionals(tTags, ctx, "target")) {
    if (mod.defBonus) {
      def += mod.defBonus;
      defNotes.push(`${tag.id} +${mod.defBonus}`);
    }
    if (mod.defMultiplier) {
      def *= mod.defMultiplier;
      defNotes.push(`${tag.id} ×${mod.defMultiplier}`);
    }
    if (mod.counterDamage) counterDamage = true;
  }
  if (target.holdFormation) {
    def += 2;
    defNotes.push("hold_formation +2");
  }
  if (target.cell) {
    if (ctx.attackKind === "ranged") {
      const brush = rangedDefBonusAt(field, target.cell);
      if (brush) {
        def += brush;
        defNotes.push(`cover +${brush}`);
      }
    }
    if (hasTerrain(field, target.cell, "swamp")) {
      const s = swampDefBonus(tSheet.def);
      if (s) {
        def += s;
        defNotes.push(`swamp +${s}`);
      }
    }
    if (ctx.targetIsDefender) {
      const bonus = defenderTerrainBonus(field, target.cell);
      if (bonus.defMultiplier !== 1) {
        def *= bonus.defMultiplier;
        defNotes.push(`high ground ×${bonus.defMultiplier}`);
      }
    }
  }
  if (ctx.targetFortBonus) {
    def += ctx.targetFortBonus;
    defNotes.push(`fortification +${ctx.targetFortBonus}`);
  }
  if (gang.defMultiplier !== 1) {
    def *= gang.defMultiplier;
    defNotes.push(`gang-up ×${gang.defMultiplier.toFixed(2)}`);
  }

  // ---- siege behaviour -------------------------------------------------------
  const siege = aTags.find((t) => t.siege)?.siege;
  const precision = aTags.some((t) => t.precisionBolt) || ctx.shot === "grape";
  const hpDamageMultiplier = siege && !precision ? siege.vsUnitsHpDamageMultiplier : 1;
  const bypassesHardenedStructure = Boolean(siege?.bypassesHardenedStructure) && ctx.shot !== "grape";

  return {
    atk: { value: Math.max(0, atk), notes: atkNotes },
    def: { value: Math.max(0, def), notes: defNotes },
    damageMultiplier,
    extraMoraleDelta,
    counterDamage,
    bypassesAmmoCost,
    hpDamageMultiplier,
    bypassesHardenedStructure,
  };
}

/** Attacker ATK against a Fortification Point's structure (no target tags to weigh): static tags, berserk, weather, high ground. */
export function structureAttackAtk(attacker: UnitInstance, field: Battlefield, attackKind: AttackKind, attackerIsDefender: boolean): StatBreakdown {
  const sheet = sheetFor(attacker);
  const tags = resolveTags(attacker.tags);
  const notes: string[] = [];
  let atk = sheet.atk;
  for (const t of tags) {
    if (t.atkMultiplier && t.atkMultiplier !== 1) {
      atk *= t.atkMultiplier;
      notes.push(`${t.id} ×${t.atkMultiplier}`);
    }
  }
  const b = tags.find((t) => t.onRally);
  if (attacker.berserk && b?.onRally) {
    atk *= b.onRally.atkMultiplier;
    notes.push(`berserk ×${b.onRally.atkMultiplier}`);
  }
  if (attackKind === "ranged") {
    const w = weatherRangedAtkMultiplier(field);
    if (w !== 1) {
      atk *= w;
      notes.push(`${field.weather} ×${w}`);
    }
  }
  if (attackerIsDefender && attacker.cell) {
    const bonus = defenderTerrainBonus(field, attacker.cell);
    if (bonus.atkMultiplier !== 1) {
      atk *= bonus.atkMultiplier;
      notes.push(`high ground ×${bonus.atkMultiplier}`);
    }
  }
  return { value: Math.max(0, atk), notes };
}

/** Target-side morale bookkeeping multipliers (veteran ×0.6 ratio, undisciplined ×1.5 loss). */
export function moraleMultipliers(unit: UnitInstance): { moraleDamageRatio: number; moraleLossMultiplier: number } {
  const tags = resolveTags(unit.tags);
  return {
    moraleDamageRatio: tags.reduce((m, t) => m * (t.moraleDamageRatioMultiplier ?? 1), 1),
    moraleLossMultiplier: tags.reduce((m, t) => m * (t.moraleLossMultiplier ?? 1), 1),
  };
}

/** Effective ATK against a routing unit for §8.7 kill fraction (mounted ×1.3 etc.), no gang-up. */
export function pursuitAtk(pursuer: UnitInstance, routing: UnitInstance, field: Battlefield): number {
  return resolveAttackModifiers({ attacker: pursuer, target: routing, attackKind: "melee", field, targetRouting: true }).atk.value;
}

/** Effective DEF of a routing unit against its pursuer, no gang-up. */
export function pursuitDef(pursuer: UnitInstance, routing: UnitInstance, field: Battlefield): number {
  return resolveAttackModifiers({ attacker: pursuer, target: routing, attackKind: "melee", field, targetRouting: true }).def.value;
}

/** Legal orders for a unit from its tags (§6 "tags generate the order menu"). */
export function orderMenu(unit: UnitInstance): string[] {
  const base = ["hold", "move"];
  const sheet = sheetFor(unit);
  if (sheet.range >= 1 && hasTag(unit.tags, "ranged")) base.push("fire");
  if (sheet.atk > 0) base.push("engage", "attack_structure");
  for (const t of resolveTags(unit.tags)) for (const o of t.unlocksOrders ?? []) if (!base.includes(o)) base.push(o);
  return base;
}
