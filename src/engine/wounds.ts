import { applyRenown } from "../combat/renown";
import type { Wound } from "../combat/schema";
import type { Rng } from "../combat/rng";
import type { SeasonEffectLine, WorldState } from "./schema";

/**
 * The lord's wounds (design review rules).
 *
 *  - A wound taken in battle ends his part in it at Rank-and-File; at Sub-/Full Command he still
 *    directs but can no longer Rally; a second open wound and he cannot even direct.
 *  - After the first season a wound heals with 30% chance, after the second with 15%.
 *  - One that survives two seasons is not a scar. It is a maiming: a hand taken off, a crushed
 *    leg, an eye put out. Each carries a death chance, lower where the hall knows clean-wound
 *    practice and higher when he is maimed already. Surviving one changes how he fights and
 *    is spoken of; it does not end the game. Dying of it does.
 *  - A one-handed or one-eyed lord commands from behind the line. A lame one cannot ride hard.
 *    Surviving a maiming publicly grants renown: he paid for his standing where men could see it.
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

export function openWoundCount(wounds: readonly Wound[]): number {
  return wounds.filter((w) => !w.permanent).length;
}

export function permanentWoundCount(wounds: readonly Wound[]): number {
  return wounds.filter((w) => w.permanent).length;
}

export function maimings(wounds: readonly Wound[]): Wound[] {
  return wounds.filter((w) => w.permanent && w.narrativeFlags.includes("maiming"));
}

/** May answer a call to arms at all. Open wounds count; a maiming that has set does not, by itself. */
export function canRideToWar(state: WorldState): { ok: boolean; reason?: string } {
  if (state.player.dead) return { ok: false, reason: "The lord is dead." };
  if (state.player.maimed) return { ok: false, reason: "The lord is too maimed to fight or rule." };
  if (state.player.captive) return { ok: false, reason: "The lord is in his captors' hands." };
  if (openWoundCount(state.player.wounds) >= 2) return { ok: false, reason: "With two wounds unhealed the lord can neither ride nor rule; the season must turn first." };
  return { ok: true };
}

/** A crushed leg: he can hold his own gate, and a captain can march, but he cannot ride hard himself. */
export function isLame(state: WorldState): boolean {
  return state.player.wounds.some((w) => w.narrativeFlags.includes("lame"));
}

/** May ride in or at the head of a file (Rank-and-File, Sub-Command). A maiming forbids it: he commands from behind the line. */
export function canLeadFile(state: WorldState): boolean {
  return permanentWoundCount(state.player.wounds) === 0;
}

/** May spend Command Pool on a Rally mid-battle: only while no wound is still open. */
export function canRally(wounds: readonly Wound[]): boolean {
  return openWoundCount(wounds) === 0;
}

/** May give orders: fewer than two wounds still open. */
export function canDirect(wounds: readonly Wound[]): boolean {
  return openWoundCount(wounds) < 2;
}

// ---------------------------------------------------------------------------
// Maiming
// ---------------------------------------------------------------------------

/** Death chance when a wound sets into a maiming. Rolled inside the band (retunable). */
export const MAIMING_DEATH = {
  /** First maiming, no clean-wound practice. */
  first: [0.5, 0.6],
  /** First maiming, with clean-wound practice and someone to tend it. */
  prepared: [0.3, 0.35],
  /** A second maiming on a lord already maimed. */
  second: [0.75, 0.85],
} as const;

/** Renown for surviving a maiming in public. Retunable. */
export const MAIMING_RENOWN = 20;

const MAIMING_KINDS = [
  { flag: "one_handed", location: "the right hand, taken off", word: "lost his right hand" },
  { flag: "lame", location: "a crushed leg", word: "will never ride hard again" },
  { flag: "one_eyed", location: "an eye put out", word: "lost an eye" },
] as const;

/** The hall can keep a wound clean: a technique, an innovation, or a man whose work is wounds. */
export function woundCraft(state: WorldState): boolean {
  const texts = [
    ...state.known_techniques.map((t) => `${t.id} ${t.name}`),
    ...(state.history.diffusion?.innovations ?? []).map((i) => `${i.id} ${i.name}`),
    ...state.npcs.map((n) => `${n.role} ${n.name}`),
  ]
    .join(" ")
    .toLowerCase();
  return /wound|salve|surgery|leech|medicine|infirmary/.test(texts);
}

/** A chance inside the band, so the same wound is not always the same odds. */
export function maimingDeathChance(alreadyMaimed: boolean, prepared: boolean, rng: Rng): number {
  const [lo, hi] = alreadyMaimed ? MAIMING_DEATH.second : prepared ? MAIMING_DEATH.prepared : MAIMING_DEATH.first;
  return lo + rng.float() * (hi - lo);
}

/**
 * A wound has failed to heal. It is a maiming now: roll whether it kills him.
 * Returns the ledger line. Sets `player.dead` when it does.
 */
export function resolveMaiming(state: WorldState, wound: Wound, rng: Rng): string {
  const already = maimings(state.player.wounds).some((w) => w !== wound);
  const prepared = !already && woundCraft(state);
  const chance = maimingDeathChance(already, prepared, rng);
  const kind = MAIMING_KINDS[rng.int(0, MAIMING_KINDS.length - 1)];
  wound.permanent = true;
  wound.location = kind.location;
  if (!wound.narrativeFlags.includes("maiming")) wound.narrativeFlags.push("maiming");
  if (!wound.narrativeFlags.includes(kind.flag)) wound.narrativeFlags.push(kind.flag);
  if (rng.chance(chance)) {
    state.player.dead = true;
    wound.narrativeFlags.push("fatal");
    return `The wound mortified (${kind.location}). The lord is dead of it.`;
  }
  const before = state.player.renown;
  state.player.renown = applyRenown(before, MAIMING_RENOWN);
  const gained = state.player.renown - before;
  state.history.record.push({
    year: state.meta.year,
    season: state.meta.season as "spring" | "summer" | "autumn" | "winter",
    text: `The lord survived a maiming (${kind.location}) and ${kind.word}.`,
    thread: "wounds",
  });
  const how = prepared ? "The hall knew how to keep a wound clean, and it was not enough to kill him, only to mark him." : "There was no one who knew how to keep a wound clean, and he lived through it anyway.";
  return `The wound has set: ${kind.location}. ${how} Men saw it, and his name is worth ${gained} more for having paid in public. ${kind.flag === "lame" ? "He will not ride hard again." : "He commands from behind the line from now on."}`;
}

/** Season tick: wounds heal, or set into a maiming that may kill him. */
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
    if (w.seasonsHeld >= WOUND_SEASONS_TO_PERMANENT && !w.permanent) {
      lines.push({ kind: "reject", text: resolveMaiming(state, w, rng) });
      kept.push(w);
      if (state.player.dead) break;
      continue;
    }
    kept.push(w);
  }
  state.player.wounds = kept;
  return lines;
}

/** One line for Aldric while a maiming is on him. Surviving one is not a game over. */
export function maimingLine(state: WorldState): string | null {
  const carried = maimings(state.player.wounds);
  if (!carried.length || state.player.dead) return null;
  const where = isLame(state)
    ? "He cannot ride hard: a captain may take the men, and he can hold his own gate."
    : "He commands from behind the line, at any age.";
  return `The lord's body: ${carried.map((w) => w.location).join("; ")}. ${where} He lived through it, and his name is the greater for men having seen the price. Say so if he asks.`;
}

/** The lord's own hurts mend fully between seasons (design review: 100% each season). */
export function healPersonalFully(state: WorldState): void {
  state.player.personal.hp = state.player.personal.maxHp;
}
