import type { BattleLogEntry, BattleState, Cell, LogKind, Order, UnitInstance } from "./battleTypes";
import {
  CASUALTY_PER_HP_LOST_FRACTION,
  ENGAGE_COST,
  FIRE_COST,
  GANG_UP_MAX_ATTACKERS,
  PLAYER_WOUND_CHANCE_PER_ROUND,
  PLAYER_WOUND_FATAL_CHANCE,
  RALLY_COST,
  ROUNDS_PER_DAY,
} from "./constants";
import {
  averageDamage,
  counterDamageSplit,
  finalDamage,
  flankShock,
  hardenedStructureAtk,
  hitMultiplier,
  isDisordered,
  rollDamage,
  routSplit,
  routHeadcount,
  splashPortions,
} from "./formula";
import { breachPoint, fortDefenderBonus, isTerrainDefender, locatePoint } from "./fortification";
import { cellLabel, defenderTerrainBonus, manhattan, moveCost, rangePenalty, sameCell } from "./grid";
import { hasTag, resolveTags } from "./registry";
import { absorbMoraleLoss, spendShield } from "./renown";
import type { Rng } from "./rng";
import type { Wound } from "./schema";
import { moraleMultipliers, pursuitAtk, pursuitDef, resolveAttackModifiers, structureAttackAtk, type AttackKind } from "./tags";
import {
  actionPointsPerRound,
  canFireThisRound,
  casualtiesForHpLoss,
  disengageCostMultiplier,
  findUnit,
  isActive,
  isEngaged,
  isRanged,
  isStationary,
  isStored,
  isTargetable,
  sheetFor,
  unitsInCell,
} from "./units";

/**
 * One battle round (§8.4 turn order): Move Phase → Engagement Phase → Damage Phase,
 * then rout resolution and bookkeeping. Orders for both sides arrive together.
 */

export type RoundResult = { entries: BattleLogEntry[] };

type PendingHit = {
  attackerId: string;
  targetId: string;
  hpDamage: number;
  moraleDamage: number;
  /** Extra morale delta on hit (loud), applied after shield. */
  extraMoraleDelta: number;
  kind: AttackKind;
};

export function pushLog(state: BattleState, kind: LogKind, text: string, extra?: Partial<Omit<BattleLogEntry, "seq" | "round" | "day" | "kind" | "text">>): BattleLogEntry {
  const entry: BattleLogEntry = {
    seq: state.log.length,
    round: state.round,
    day: state.day,
    kind,
    text,
    ...extra,
  };
  state.log.push(entry);
  return entry;
}

function displayName(u: UnitInstance): string {
  return `${u.name} [${u.id}]`;
}

function fmt(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sheet Range plus high-ground bonus for a Defender, minus woodland/wind penalties. */
export function effectiveRange(state: BattleState, firer: UnitInstance, target: Cell): number {
  if (!firer.cell) return 0;
  const sheet = sheetFor(firer);
  let range = sheet.range;
  if (isTerrainDefender(state.units, firer)) range += defenderTerrainBonus(state.battlefield, firer.cell).rangeBonus;
  range -= rangePenalty(state.battlefield, firer.cell, target);
  return Math.max(0, range);
}

export function inRange(state: BattleState, firer: UnitInstance, target: Cell): boolean {
  if (!firer.cell) return false;
  return manhattan(firer.cell, target) <= effectiveRange(state, firer, target);
}

/** Apply already-computed damage to a unit, routing morale through any Command Pool shield. */
export function applyHit(state: BattleState, attacker: UnitInstance | undefined, target: UnitInstance, hpDamage: number, moraleDamage: number, extraMoraleDelta = 0): void {
  if (hpDamage > 0) {
    target.hp = Math.max(0, target.hp - hpDamage);
    target.casualties += casualtiesForHpLoss(target, hpDamage, CASUALTY_PER_HP_LOST_FRACTION);
    target.strength = Math.max(0, target.initialStrength - target.casualties);
  }
  const totalMorale = Math.max(0, moraleDamage) + Math.max(0, -extraMoraleDelta);
  if (totalMorale > 0) {
    const r = absorbMoraleLoss(target.shield, target.morale, totalMorale);
    target.shield = r.shield;
    target.morale = Math.max(0, r.morale);
    target.moraleTaken += totalMorale;
    if (attacker) attacker.moraleDealt += totalMorale;
  }
}

/** Morale loss with no attacker (flank shock, ally routing, charge stopped). */
export function loseMorale(state: BattleState, target: UnitInstance, amount: number, attacker?: UnitInstance): void {
  applyHit(state, attacker, target, 0, amount);
}

function unlinkEngagements(state: BattleState, unit: UnitInstance): void {
  for (const id of unit.engagedWith) {
    const other = findUnit(state.units, id);
    if (!other) continue;
    other.engagedWith = other.engagedWith.filter((x) => x !== unit.id);
    delete other.engagedSince[unit.id];
  }
  unit.engagedWith = [];
  unit.engagedSince = {};
}

function relocate(state: BattleState, unit: UnitInstance, to: Cell): void {
  unlinkEngagements(state, unit);
  unit.cell = { ...to };
  unit.occupancyRounds = 0;
  unit.holdFormation = false;
  unit.fort = undefined;
  unit.pendingMove = undefined;
  unit.fireTarget = undefined;
}

// ---------------------------------------------------------------------------
// Round driver
// ---------------------------------------------------------------------------

export function resolveRound(state: BattleState, orders: readonly Order[], rng: Rng): RoundResult {
  const startSeq = state.log.length;
  state.round += 1;
  pushLog(state, "phase", `Round ${state.round} (day ${state.day}) begins.`);

  const ap = new Map<string, number>();
  for (const u of state.units) if (isActive(u)) ap.set(u.id, actionPointsPerRound(u));
  const spend = (u: UnitInstance, cost: number): boolean => {
    const have = ap.get(u.id) ?? 0;
    if (have < cost) return false;
    ap.set(u.id, have - cost);
    return true;
  };

  const byUnit = new Map<string, Order>();
  const rallies: Extract<Order, { type: "rally" }>[] = [];
  for (const o of orders) {
    if (o.type === "rally") rallies.push(o);
    else byUnit.set(o.unitId, o);
  }
  const moved = new Set<string>();
  const engagedThisRound = new Map<string, string>(); // attacker → declared target

  // ---- Move Phase ------------------------------------------------------------
  for (const [unitId, order] of byUnit) {
    const unit = findUnit(state.units, unitId);
    if (!unit || !isActive(unit) || !unit.cell) continue;
    if (order.type !== "hold_formation" && order.type !== "hold") unit.holdFormation = false;
    if (order.type === "skirmish_and_withdraw") {
      if (!hasTag(unit.tags, "hit_and_run")) {
        pushLog(state, "info", `${displayName(unit)} lacks hit_and_run; skirmish order ignored.`, { unitId });
        continue;
      }
      const target = findUnit(state.units, order.targetId);
      if (target && isTargetable(target) && target.side !== unit.side && inRange(state, unit, target.cell!) && spend(unit, FIRE_COST)) {
        fireVolley(state, rng, unit, target, "ranged", undefined, "skirmish");
      }
      planMove(state, unit, order.to, ap, moved, true);
      continue;
    }
    if (order.type === "move") {
      planMove(state, unit, order.to, ap, moved, false);
      continue;
    }
    if (order.type === "swap_presented") {
      const other = findUnit(state.units, order.withUnitId);
      if (other && unit.fort && other.fort && unit.fort.pointId === other.fort.pointId && unit.fort.presented !== other.fort.presented) {
        if ((ap.get(unit.id) ?? 0) >= 2 && (ap.get(other.id) ?? 0) >= 2) {
          spend(unit, 2);
          spend(other, 2);
          unit.fort.presented = !unit.fort.presented;
          other.fort.presented = !other.fort.presented;
          pushLog(state, "move", `${displayName(unit)} and ${displayName(other)} swap places at the ${locatePoint(state.battlefield, unit.fort.pointId)?.point.label ?? "wall"}.`, { unitId });
        }
      }
      continue;
    }
    // Units with a pending move but a different order this round keep their banked progress.
  }
  // Continue banked moves for units with no new order.
  for (const unit of state.units) {
    if (!isActive(unit) || !unit.pendingMove || byUnit.has(unit.id)) continue;
    planMove(state, unit, unit.pendingMove.to, ap, moved, isEngaged(unit));
  }

  // ---- Engagement Phase ------------------------------------------------------
  for (const [unitId, order] of byUnit) {
    const unit = findUnit(state.units, unitId);
    if (!unit || !isActive(unit) || !unit.cell) continue;
    if (order.type === "hold_formation") {
      if (hasTag(unit.tags, "drilled_spear")) {
        unit.holdFormation = true;
        pushLog(state, "info", `${displayName(unit)} holds formation (+2 DEF).`, { unitId });
      } else {
        pushLog(state, "info", `${displayName(unit)} has no drilled_spear; cannot hold formation.`, { unitId });
      }
      continue;
    }
    if (order.type !== "engage") continue;
    const target = findUnit(state.units, order.targetId);
    if (!target || !isTargetable(target) || target.side === unit.side || isStored(unit)) continue;
    if (!sameCell(unit.cell, target.cell)) {
      pushLog(state, "info", `${displayName(unit)} cannot engage ${displayName(target)}: not in the same cell.`, { unitId, targetId: target.id });
      continue;
    }
    if (sheetFor(unit).atk <= 0) continue;
    engagedThisRound.set(unit.id, target.id);
    if (unit.engagedWith.includes(target.id)) continue; // continuing a clash is free
    if (target.engagedWith.length >= GANG_UP_MAX_ATTACKERS) {
      pushLog(state, "info", `${displayName(unit)} cannot reach ${displayName(target)}: already pressed by three.`, { unitId, targetId: target.id });
      continue;
    }
    if (!spend(unit, ENGAGE_COST)) {
      pushLog(state, "info", `${displayName(unit)} has no action left to engage.`, { unitId });
      continue;
    }
    linkEngagement(state, rng, unit, target);
  }

  // ---- Rally (player action, same cell) ---------------------------------------
  const attached = state.player.attachedUnitId ? findUnit(state.units, state.player.attachedUnitId) : undefined;
  const ralliedThisRound = new Set<string>();
  for (const r of rallies) {
    if (state.player.wounds.length > 0) {
      pushLog(state, "info", "Rally refused: a wounded lord cannot rally the line.");
      break;
    }
    const target = findUnit(state.units, r.unitId);
    if (!attached || !target || !isActive(target) || target.side !== "player" || !sameCell(attached.cell, target.cell)) {
      pushLog(state, "info", `Rally on ${r.unitId} refused: the lord is not in that cell.`);
      continue;
    }
    if (ralliedThisRound.has(target.id)) continue;
    if (!spend(attached, RALLY_COST)) continue;
    const s = spendShield(state.commandPool.remaining, r.amount, target.maxMorale, target.shield);
    if (s.spent <= 0) continue;
    state.commandPool.remaining = s.poolAfter;
    target.shield = s.shieldAfter;
    ralliedThisRound.add(target.id);
    triggerBerserk(state, target);
    pushLog(state, "rally", `The lord rallies ${displayName(target)}: +${s.spent} shield (pool ${state.commandPool.remaining} left).`, { unitId: target.id, data: { spent: s.spent, shield: target.shield } });
  }

  // ---- Damage Phase: ranged fire --------------------------------------------
  for (const unit of state.units) {
    if (!isActive(unit) || !isRanged(unit) || isStored(unit) || !unit.cell) continue;
    const order = byUnit.get(unit.id);
    let targetId: string | undefined;
    let shot: "solid" | "grape" | undefined;
    if (order?.type === "fire") {
      targetId = order.targetId;
      shot = order.shot;
      unit.fireTarget = targetId;
    } else if (order?.type === "attack_structure") {
      fireAtStructure(state, rng, unit, order.pointId, ap, "ranged");
      continue;
    } else if (!order && unit.fireTarget && !isEngaged(unit)) {
      targetId = unit.fireTarget; // sticky target
    }
    if (!targetId) continue;
    const target = findUnit(state.units, targetId);
    if (!target || !isTargetable(target) || target.side === unit.side || !target.cell) {
      unit.fireTarget = undefined;
      continue;
    }
    if (!inRange(state, unit, target.cell)) {
      pushLog(state, "info", `${displayName(unit)} holds fire: ${displayName(target)} is out of range.`, { unitId: unit.id, targetId });
      if (!order) unit.fireTarget = undefined;
      continue;
    }
    if (!canFireThisRound(unit, state.round)) {
      pushLog(state, "info", `${displayName(unit)} is still reloading.`, { unitId: unit.id });
      continue;
    }
    if (unit.ammo !== undefined && unit.ammo <= 0) continue;
    if (!spend(unit, FIRE_COST)) continue;
    fireVolley(state, rng, unit, target, "ranged", shot, "volley");
    const sv = resolveTags(unit.tags).find((t) => t.skirmishVolley)?.skirmishVolley;
    if (sv && sheetFor(target).speed <= sv.targetMaxSpeed && isActive(target)) {
      for (let i = 0; i < sv.extraVolleys; i++) fireVolley(state, rng, unit, target, "ranged", shot, "skirmish_volley");
    }
  }

  // ---- Damage Phase: melee, resolved simultaneously from a snapshot -----------
  const hits: PendingHit[] = [];
  const stoppedCharges: { charger: UnitInstance; target: UnitInstance; delta: number }[] = [];
  for (const unit of state.units) {
    if (!isActive(unit) || isStored(unit) || !unit.cell) continue;
    const order = byUnit.get(unit.id);
    if (order?.type === "attack_structure" && !isRanged(unit)) {
      fireAtStructure(state, rng, unit, order.pointId, ap, "melee");
      continue;
    }
    if (!isEngaged(unit) || sheetFor(unit).atk <= 0) continue;
    const recipients = unit.engagedWith.map((id) => findUnit(state.units, id)).filter((u): u is UnitInstance => Boolean(u && isActive(u)));
    if (!recipients.length) continue;
    const declared = engagedThisRound.get(unit.id);
    if (declared) {
      const i = recipients.findIndex((r) => r.id === declared);
      if (i > 0) recipients.unshift(...recipients.splice(i, 1));
    }
    const split = counterDamageSplit(recipients.length);
    const rolled = rollDamage(rng, sheetFor(unit).damage, torsionMultiplier(unit, rng));
    recipients.forEach((target, i) => {
      // A charge belongs to the unit that made contact: it declared the Engage this round and the link is new.
      // The unit that was charged strikes back normally — it does not also "charge".
      const charging = unit.engagedSince[target.id] === state.round && engagedThisRound.get(unit.id) === target.id;
      const mods = resolveAttackModifiers({
        attacker: unit,
        target,
        attackKind: "melee",
        field: state.battlefield,
        attackerCharging: charging,
        attackersOnTarget: target.engagedWith.length,
        attackerIsDefender: isTerrainDefender(state.units, unit),
        targetIsDefender: isTerrainDefender(state.units, target),
        targetFortBonus: fortDefenderBonus(state, target),
      });
      const portion = rolled * split[i] * mods.damageMultiplier;
      const m = hitMultiplier(mods.atk.value, mods.def.value);
      const full = finalDamage(portion, m);
      const hp = mods.hpDamageMultiplier === 1 ? full : full === 0 ? 0 : Math.max(1, Math.round(full * mods.hpDamageMultiplier));
      const mm = moraleMultipliers(target);
      const morale = Math.round(full * mm.moraleDamageRatio * mm.moraleLossMultiplier);
      hits.push({ attackerId: unit.id, targetId: target.id, hpDamage: hp, moraleDamage: morale, extraMoraleDelta: mods.extraMoraleDelta, kind: "melee" });
      pushLog(state, "strike", `${displayName(unit)} strikes ${displayName(target)}${charging ? " (charge)" : ""}: ATK ${fmt(mods.atk.value)} vs DEF ${fmt(mods.def.value)} → ×${m.toFixed(3)}, rolled ${fmt(portion)} → ${hp} HP, ${morale} morale.`, {
        unitId: unit.id,
        targetId: target.id,
        data: {
          effAtk: fmt(mods.atk.value),
          effDef: fmt(mods.def.value),
          hitMultiplier: fmt(m),
          rolled: fmt(portion),
          share: fmt(split[i]),
          hpDamage: hp,
          moraleDamage: morale,
          charging,
          atkNotes: mods.atk.notes.join("; "),
          defNotes: mods.def.notes.join("; "),
        },
      });
      if (mods.counterDamage) {
        const c = resolveAttackModifiers({ attacker: target, target: unit, attackKind: "melee", field: state.battlefield });
        const cRoll = rollDamage(rng, sheetFor(target).damage);
        const cm = hitMultiplier(c.atk.value, c.def.value);
        const cFull = finalDamage(cRoll, cm);
        const tmm = moraleMultipliers(unit);
        hits.push({ attackerId: target.id, targetId: unit.id, hpDamage: cFull, moraleDamage: Math.round(cFull * tmm.moraleDamageRatio * tmm.moraleLossMultiplier), extraMoraleDelta: 0, kind: "melee" });
        pushLog(state, "strike", `${displayName(target)} braces spears against the charge: counter ${cFull} HP to ${displayName(unit)}.`, { unitId: target.id, targetId: unit.id });
      }
      if (charging && resolveTags(unit.tags).some((t) => t.onChargeStopped)) {
        const stopped = target.holdFormation || hasTag(target.tags, "anti_cavalry_spears");
        if (stopped) {
          const delta = resolveTags(unit.tags).find((t) => t.onChargeStopped)!.onChargeStopped!.moraleDelta;
          stoppedCharges.push({ charger: unit, target, delta });
        }
      }
    });
  }
  for (const h of hits) {
    const attacker = findUnit(state.units, h.attackerId);
    const target = findUnit(state.units, h.targetId);
    if (!target || !isActive(target)) continue;
    applyHit(state, attacker, target, h.hpDamage, h.moraleDamage, h.extraMoraleDelta);
  }
  for (const s of stoppedCharges) {
    if (!isActive(s.target) || isDisordered(s.target.morale, s.target.maxMorale)) continue;
    loseMorale(state, s.charger, -s.delta);
    pushLog(state, "shock", `${displayName(s.charger)}'s charge is stopped by ${displayName(s.target)}: morale ${s.delta}.`, { unitId: s.charger.id, targetId: s.target.id });
  }

  // ---- Player exposure (§8.7, §4.1) ------------------------------------------
  // A general at Full Command directs from behind the press; his risk is the rout of his army (design review).
  if (state.tier !== "full_command" && attached && isActive(attached) && isEngaged(attached) && state.player.alive && state.player.fate === "fighting") {
    personalExposure(state, rng, attached);
  }

  // ---- Rout & destruction -----------------------------------------------------
  for (const unit of [...state.units]) {
    if (!isActive(unit)) continue;
    if (unit.morale > 0 && unit.hp > 0) continue;
    resolveRout(state, rng, unit, unit.hp <= 0 ? "destroyed" : "routed");
  }

  // ---- Bookkeeping ------------------------------------------------------------
  for (const unit of state.units) {
    if (!isActive(unit)) continue;
    if (!moved.has(unit.id)) unit.occupancyRounds += 1;
    if (isEngaged(unit)) unit.wasEngaged = true;
    unit.flankShockScale = undefined;
  }
  state.player.woundRollMode = "normal";
  checkBattleEnd(state);
  if (state.phase === "rounds" && state.round % ROUNDS_PER_DAY === 0) {
    state.phase = "day_end";
    pushLog(state, "phase", `Nightfall ends day ${state.day}; neither side has broken.`);
  }
  return { entries: state.log.slice(startSeq) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planMove(state: BattleState, unit: UnitInstance, to: Cell, ap: Map<string, number>, moved: Set<string>, forceDisengage: boolean): void {
  if (!unit.cell || isStationary(unit)) return;
  if (sameCell(unit.cell, to)) return;
  const disengaging = forceDisengage || isEngaged(unit);
  const cost = moveCost(state.battlefield, { from: unit.cell, to, disengaging, disengageCostMultiplier: disengageCostMultiplier(unit) });
  if (cost === null) {
    pushLog(state, "info", `${displayName(unit)} cannot move to ${cellLabel(to)}: no path.`, { unitId: unit.id });
    unit.pendingMove = undefined;
    return;
  }
  if (!unit.pendingMove || !sameCell(unit.pendingMove.to, to)) unit.pendingMove = { to: { ...to }, cost, paid: 0 };
  unit.pendingMove.cost = cost;
  const have = ap.get(unit.id) ?? 0;
  const need = unit.pendingMove.cost - unit.pendingMove.paid;
  const pay = Math.min(have, need);
  unit.pendingMove.paid += pay;
  ap.set(unit.id, have - pay);
  if (unit.pendingMove.paid >= unit.pendingMove.cost) {
    const from = unit.cell;
    relocate(state, unit, to);
    moved.add(unit.id);
    pushLog(state, "move", `${displayName(unit)} moves ${cellLabel(from)} → ${cellLabel(to)}${disengaging ? " (disengaging)" : ""}.`, { unitId: unit.id, data: { cost } });
  } else {
    pushLog(state, "move", `${displayName(unit)} works toward ${cellLabel(to)} (${unit.pendingMove.paid}/${unit.pendingMove.cost}).`, { unitId: unit.id });
  }
}

function linkEngagement(state: BattleState, rng: Rng, attacker: UnitInstance, target: UnitInstance): void {
  const beforeTarget = target.engagedWith.length;
  const beforeAttacker = attacker.engagedWith.length;
  attacker.engagedWith.push(target.id);
  attacker.engagedSince[target.id] = state.round;
  target.engagedWith.push(attacker.id);
  target.engagedSince[attacker.id] = state.round;
  pushLog(state, "engage", `${displayName(attacker)} engages ${displayName(target)} at ${cellLabel(target.cell!)}.`, { unitId: attacker.id, targetId: target.id });
  // §8.4 flank shock fires for whichever unit just crossed to 2 or 3 enemies on it — in a chain
  // (A→1, 1→B) that can be the unit that did the engaging.
  flankIfCrossed(state, target, beforeTarget, attacker);
  flankIfCrossed(state, attacker, beforeAttacker, target);
}

function flankIfCrossed(state: BattleState, defender: UnitInstance, before: number, newcomer: UnitInstance): void {
  const after = defender.engagedWith.length;
  if (!((before === 1 && after === 2) || (before === 2 && after === 3))) return;
  const mods = resolveAttackModifiers({ attacker: newcomer, target: defender, attackKind: "melee", field: state.battlefield, attackersOnTarget: after });
  const shock = Math.round(flankShock(averageDamage(sheetFor(newcomer).damage), after as 2 | 3, mods.atk.value, mods.def.value) * (defender.flankShockScale ?? 1));
  if (shock <= 0) return;
  loseMorale(state, defender, shock, newcomer);
  pushLog(state, "shock", `${displayName(defender)} is flanked (${after} attackers): morale −${shock}.`, { unitId: defender.id, data: { shock, attackers: after } });
}

function triggerBerserk(state: BattleState, unit: UnitInstance): void {
  if (unit.berserk) return;
  const tag = resolveTags(unit.tags).find((t) => t.onRally);
  if (!tag?.onRally) return;
  unit.berserk = true;
  pushLog(state, "morale", `${displayName(unit)} works into a berserk fury (ATK ×${tag.onRally.atkMultiplier} for the battle).`, { unitId: unit.id });
}

function torsionMultiplier(unit: UnitInstance, rng: Rng): number {
  const r = resolveTags(unit.tags).find((t) => t.damageRollMultiplierRange)?.damageRollMultiplierRange;
  return r ? rng.between(r.min, r.max) : 1;
}

function fireVolley(state: BattleState, rng: Rng, firer: UnitInstance, target: UnitInstance, kind: AttackKind, shot: "solid" | "grape" | undefined, label: string): void {
  const misfire = resolveTags(firer.tags).find((t) => t.misfireChance)?.misfireChance;
  if (misfire && rng.chance(misfire)) {
    const rolled = rollDamage(rng, sheetFor(firer).damage);
    applyHit(state, undefined, firer, rolled, rolled);
    firer.lastFiredRound = state.round;
    pushLog(state, "fire", `${displayName(firer)} misfires! ${rolled} damage to its own crew.`, { unitId: firer.id, data: { misfire: true, rolled } });
    return;
  }
  const rolled = rollDamage(rng, sheetFor(firer).damage, torsionMultiplier(firer, rng));
  const engagedOnTarget = target.engagedWith.map((id) => findUnit(state.units, id)).filter((u): u is UnitInstance => Boolean(u && isActive(u)));
  const scrumPartner = engagedOnTarget.find((u) => isDisordered(target.morale, target.maxMorale) && isDisordered(u.morale, u.maxMorale));
  const portions = splashPortions(rolled, target, engagedOnTarget, scrumPartner);
  let spentAmmo = true;
  for (const p of portions) {
    const mods = resolveAttackModifiers({
      attacker: firer,
      target: p.unit,
      attackKind: kind,
      field: state.battlefield,
      attackersOnTarget: p.unit.engagedWith.length,
      attackerIsDefender: isTerrainDefender(state.units, firer),
      targetIsDefender: isTerrainDefender(state.units, p.unit),
      targetFortBonus: fortDefenderBonus(state, p.unit),
      shot,
    });
    if (p.unit.id === target.id && mods.bypassesAmmoCost) spentAmmo = false;
    const m = hitMultiplier(mods.atk.value, mods.def.value);
    const full = finalDamage(p.portion * mods.damageMultiplier, m);
    const hp = mods.hpDamageMultiplier === 1 ? full : full === 0 ? 0 : Math.max(1, Math.round(full * mods.hpDamageMultiplier));
    const mm = moraleMultipliers(p.unit);
    const morale = Math.round(full * mm.moraleDamageRatio * mm.moraleLossMultiplier);
    applyHit(state, firer, p.unit, hp, morale, mods.extraMoraleDelta);
    const splash = p.unit.id !== target.id;
    pushLog(state, "fire", `${displayName(firer)} ${label} ${splash ? "splashes" : "hits"} ${displayName(p.unit)}: ATK ${fmt(mods.atk.value)} vs DEF ${fmt(mods.def.value)} → ×${m.toFixed(3)}, ${fmt(p.portion)} of ${rolled} → ${hp} HP, ${morale} morale.`, {
      unitId: firer.id,
      targetId: p.unit.id,
      data: {
        effAtk: fmt(mods.atk.value),
        effDef: fmt(mods.def.value),
        hitMultiplier: fmt(m),
        rolled,
        shares: p.shares,
        portion: fmt(p.portion),
        hpDamage: hp,
        moraleDamage: morale,
        splash,
        atkNotes: mods.atk.notes.join("; "),
        defNotes: mods.def.notes.join("; "),
      },
    });
  }
  firer.lastFiredRound = state.round;
  if (spentAmmo && firer.ammo !== undefined) {
    firer.ammo -= 1;
    if (firer.ammo <= 0) depleteAmmo(state, firer);
  }
}

function depleteAmmo(state: BattleState, unit: UnitInstance): void {
  const rule = resolveTags(unit.tags).find((t) => t.onChargesDepleted)?.onChargesDepleted;
  if (!rule) return;
  if (rule.losesTag) unit.tags = unit.tags.filter((t) => t !== rule.losesTag);
  if (rule.gainsTag && !unit.tags.includes(rule.gainsTag)) unit.tags.push(rule.gainsTag);
  pushLog(state, "info", `${displayName(unit)} has emptied its quivers.`, { unitId: unit.id });
}

function fireAtStructure(state: BattleState, rng: Rng, attacker: UnitInstance, pointId: string, ap: Map<string, number>, kind: AttackKind): void {
  const located = locatePoint(state.battlefield, pointId);
  if (!located || located.point.breached || located.side === attacker.side || !attacker.cell) return;
  if (kind === "melee" && !sameCell(attacker.cell, located.cell)) {
    pushLog(state, "info", `${displayName(attacker)} must be at the wall to assault it.`, { unitId: attacker.id });
    return;
  }
  if (kind === "ranged" && (!inRange(state, attacker, located.cell) || !canFireThisRound(attacker, state.round))) return;
  const cost = kind === "ranged" ? FIRE_COST : ENGAGE_COST;
  const have = ap.get(attacker.id) ?? 0;
  if (have < cost) return;
  ap.set(attacker.id, have - cost);
  const base = structureAttackAtk(attacker, state.battlefield, kind, isTerrainDefender(state.units, attacker));
  const bypass = resolveTags(attacker.tags).some((t) => t.siege?.bypassesHardenedStructure);
  const atk = hardenedStructureAtk(base.value, located.point.structuralDef, bypass);
  const m = hitMultiplier(atk, located.point.structuralDef);
  const rolled = rollDamage(rng, sheetFor(attacker).damage, torsionMultiplier(attacker, rng));
  const dmg = finalDamage(rolled, m);
  located.point.hp = Math.max(0, located.point.hp - dmg);
  if (kind === "ranged") attacker.lastFiredRound = state.round;
  pushLog(state, "structure", `${displayName(attacker)} batters the ${located.point.label}: ATK ${fmt(atk)}${bypass ? " (siege, unreduced)" : ` (reduced by ${located.point.structuralDef})`} → ×${m.toFixed(3)}, ${dmg} damage (${located.point.hp}/${located.point.maxHp}).`, {
    unitId: attacker.id,
    data: { effAtk: fmt(atk), structuralDef: located.point.structuralDef, hitMultiplier: fmt(m), rolled, damage: dmg, pointHp: located.point.hp },
  });
  if (located.point.hp <= 0) {
    breachPoint(state, pointId);
    pushLog(state, "structure", `The ${located.point.label} is breached!`, { unitId: attacker.id });
  }
}

function personalExposure(state: BattleState, rng: Rng, attached: UnitInstance): void {
  const p = state.player;
  const enemy = attached.engagedWith.map((id) => findUnit(state.units, id)).find((u) => u && isActive(u));
  if (enemy) {
    const eSheet = sheetFor(enemy);
    const dealt = finalDamage(rollDamage(rng, p.damage), hitMultiplier(p.atk, eSheet.def));
    const taken = finalDamage(rollDamage(rng, eSheet.damage), hitMultiplier(eSheet.atk, p.def));
    p.personalDealt += dealt;
    p.personalTaken += taken;
    pushLog(state, "player", `In the press: the lord deals ${dealt} and takes ${taken} (personal tally ${p.personalDealt}/${p.personalTaken}).`, { data: { dealt, taken } });
  }
  if (p.woundRollMode === "skip") return;
  const rolls = p.woundRollMode === "extra" ? 2 : 1;
  for (let i = 0; i < rolls; i++) {
    if (!p.alive || !rng.chance(PLAYER_WOUND_CHANCE_PER_ROUND)) continue;
    if (rng.chance(PLAYER_WOUND_FATAL_CHANCE)) {
      p.alive = false;
      p.fate = "killed";
      pushLog(state, "player", "The lord is struck down. The wound is mortal.");
    } else {
      addLordWound(state, { location: "unresolved", cause: `battle, day ${state.day} round ${state.round}`, statEffect: {}, renownEffect: 0, narrativeFlags: ["awaiting_narration"], seasonsHeld: 0, permanent: false });
    }
  }
}

/** Morale lost by the lord's men when he is wounded (design review): the general's whole host, or his own file. */
export const GENERAL_WOUNDED_MORALE_FRACTION = 0.25;
export const UNIT_LEADER_WOUNDED_MORALE_FRACTION = 0.15;

/**
 * Every wound the lord takes in battle goes through here (design review rules):
 *  - Rank-and-File: too hurt to fight on — carried from the line; his part in the battle is over.
 *  - Sub-Command: he leads a file; it loses 15% of its max Morale for its leader going down.
 *  - Full Command: he is the general; every file of the host loses 25% of its max Morale.
 * A second wound at the command tiers leaves him unable to direct (enforced by the session).
 */
export function addLordWound(state: BattleState, wound: Wound): void {
  const p = state.player;
  p.wounds.push(wound);
  p.newWounds.push(wound);
  const attached = p.attachedUnitId ? findUnit(state.units, p.attachedUnitId) : undefined;
  switch (state.tier) {
    case "rank_and_file":
      pushLog(state, "player", "The lord is wounded in the fighting and carried from the line. His part in the battle is over.");
      if (p.fate === "fighting") p.fate = "carried_off";
      break;
    case "sub_command":
      pushLog(state, "player", "The lord is wounded at the head of his file.");
      if (attached && isActive(attached)) {
        const loss = Math.round(attached.maxMorale * UNIT_LEADER_WOUNDED_MORALE_FRACTION);
        loseMorale(state, attached, loss);
        pushLog(state, "morale", `${displayName(attached)} sees its leader go down: morale −${loss}.`, { unitId: attached.id });
      }
      break;
    case "full_command":
      pushLog(state, "player", "The lord, commanding the host, is wounded.");
      for (const u of state.units) {
        if (u.side !== "player" || !isActive(u)) continue;
        const loss = Math.round(u.maxMorale * GENERAL_WOUNDED_MORALE_FRACTION);
        loseMorale(state, u, loss);
      }
      pushLog(state, "morale", `Word runs down the line that the general is hurt: every file −${Math.round(GENERAL_WOUNDED_MORALE_FRACTION * 100)}% of its heart.`);
      break;
  }
}

function resolveRout(state: BattleState, rng: Rng, unit: UnitInstance, status: "routed" | "destroyed"): void {
  const pursuers = unit.engagedWith.map((id) => findUnit(state.units, id)).filter((u): u is UnitInstance => Boolean(u && isActive(u)));
  const speed = sheetFor(unit).speed;
  let split;
  if (pursuers.length) {
    const front = pursuers[0];
    split = routSplit(
      speed,
      pursuers.map((u) => sheetFor(u).speed),
      pursuitAtk(front, unit, state.battlefield),
      pursuitDef(front, unit, state.battlefield),
    );
  } else {
    split = { escaped: 1, killed: 0, captured: 0 };
  }
  const men = routHeadcount(unit.strength, split);
  unit.escaped += men.escaped;
  unit.captured += men.captured;
  unit.casualties += men.killed;
  unit.strength = 0;
  const wasAttached = state.player.attachedUnitId === unit.id;
  unlinkEngagements(state, unit);
  unit.status = status;
  const from = unit.cell;
  unit.cell = null;
  unit.fort = undefined;
  unit.pendingMove = undefined;
  pushLog(state, "rout", `${displayName(unit)} ${status === "destroyed" ? "is destroyed" : "breaks and routs"} from ${from ? cellLabel(from) : "the field"}: ${men.escaped} escape, ${men.killed} killed, ${men.captured} captured.`, {
    unitId: unit.id,
    data: { escaped: fmt(split.escaped), killed: fmt(split.killed), captured: fmt(split.captured), menEscaped: men.escaped, menKilled: men.killed, menCaptured: men.captured, pursuers: pursuers.length },
  });
  // Nearby undisciplined allies waver.
  if (from) {
    for (const ally of state.units) {
      if (!isActive(ally) || ally.side !== unit.side || !ally.cell || manhattan(ally.cell, from) > 1) continue;
      const rule = resolveTags(ally.tags).find((t) => t.onNearbyAllyRouts)?.onNearbyAllyRouts;
      if (!rule) continue;
      loseMorale(state, ally, -rule.moraleDelta);
      pushLog(state, "morale", `${displayName(ally)} sees them run: morale ${rule.moraleDelta}.`, { unitId: ally.id });
    }
  }
  if (wasAttached && state.player.alive && state.player.fate === "fighting") {
    if (state.player.deferFate) {
      state.player.pendingFate = { escaped: split.escaped, killed: split.killed, captured: split.captured };
      pushLog(state, "player", `The lord's unit is gone. His own fate hangs on the next moment (escape ${Math.round(split.escaped * 100)}%, death ${Math.round(split.killed * 100)}%, capture ${Math.round(split.captured * 100)}%).`);
    } else {
      rollPlayerFate(state, rng, split);
    }
  }
}

/** §8.7: the lord is one more roll against his unit's escape/kill/capture odds. */
export function rollPlayerFate(state: BattleState, rng: Rng, split: { escaped: number; killed: number; captured: number }): void {
  const roll = rng.float();
  if (roll < split.escaped) state.player.fate = "escaped";
  else if (roll < split.escaped + split.killed) {
    state.player.fate = "killed";
    state.player.alive = false;
  } else state.player.fate = "captured";
  state.player.pendingFate = undefined;
  pushLog(state, "player", `The lord ${state.player.fate === "escaped" ? "gets away" : state.player.fate === "killed" ? "is killed in the rout" : "is taken captive"}.`, { data: { roll: fmt(roll) } });
}

function checkBattleEnd(state: BattleState): void {
  const playerLeft = state.units.some((u) => u.side === "player" && isActive(u));
  const enemyLeft = state.units.some((u) => u.side === "enemy" && isActive(u));
  if (playerLeft && enemyLeft) return;
  state.phase = "finished";
  state.outcome = !playerLeft && !enemyLeft ? "draw" : enemyLeft ? "defeat" : "victory";
  pushLog(state, "phase", `The field is decided: ${state.outcome}.`);
}

/** Cells with living enemies of `unit`, nearest first. */
export function nearestEnemies(state: BattleState, unit: UnitInstance): UnitInstance[] {
  if (!unit.cell) return [];
  const cell = unit.cell;
  return state.units
    .filter((u) => u.side !== unit.side && isTargetable(u) && u.cell)
    .sort((a, b) => manhattan(cell, a.cell!) - manhattan(cell, b.cell!));
}

export { unitsInCell };
