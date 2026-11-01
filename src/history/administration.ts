import { createRng, seedFromString } from "../combat/rng";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import type { GameModifier, WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { ranksTable } from "./ranks";
import type { SeasonAt } from "./scheduler";
import type { HistoryState } from "./schema";

/**
 * Administration (rank design 'Administration — abstracted through Aldric'; 03_HISTORY §10c).
 * No cast of new officers: Aldric grows with the lord. One number — what he can run — against
 * the lord's own villas; shortfalls surface as his complaints, never as a management screen.
 * Over capacity the furthest holdings yield less (a maintained modifier on the harvest and the
 * herds), then dues go uncollected, then a holding runs itself. The fixes are the lord's to
 * speak and Aldric's `steward_office` card to write: raise him, let him hire clerks, or at Duke
 * name a deputy for a region — competent, ambitious, and inclined to keep a tenth.
 */

export type Administration = HistoryState["administration"];
export type AdministrationTick = { beats: HistoryBeat[]; lines: string[] };

const MOD_GRAIN = "mod-administration-grain";
const MOD_LIVESTOCK = "mod-administration-livestock";

function rankOf(state: WorldState): number {
  return Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
}

function table() {
  return ranksTable().administration;
}

export function administration(state: WorldState): Administration {
  return state.history.administration;
}

/** The villas Aldric has to run: the lord's own, not the fisc (the county's officers run that in aggregate). */
export function holdingsRun(state: WorldState): number {
  return state.holdings.length;
}

/** Capacity: the rank's low end, raised toward the high end by the lord's two possible promotions, plus clerks and a deputy. */
export function capacity(state: WorldState): number {
  const t = table();
  const key = String(rankOf(state)) as "1" | "2" | "3" | "4" | "5";
  const [low, high] = t.capacity[key] ?? [1, 2];
  const a = administration(state);
  const raised = Math.min(high, low + Math.round((a.standing * (high - low)) / 2));
  return raised + a.staff * t.staffPerHire + (a.deputy ? t.costs.deputy.capacity : 0);
}

export function overBy(state: WorldState): number {
  return Math.max(0, holdingsRun(state) - capacity(state));
}

/** 0 none; 1 tired (1–2 over); 2 dues uncollected (3–5); 3 a holding running itself (6+). */
export function overloadTier(state: WorldState): number {
  const over = overBy(state);
  if (over <= 0) return 0;
  const tiers = table().overload;
  let tier = 0;
  tiers.forEach((t, i) => {
    if (over >= t.over) tier = i + 1;
  });
  return tier;
}

export function overloadWord(tier: number): string {
  if (tier >= 3) return "a holding or two run themselves, and not honestly";
  if (tier === 2) return "dues go uncollected in the furthest villas";
  if (tier === 1) return "stretched thin; the furthest villas pay a little less";
  return "in hand";
}

export function stewardTitle(state: WorldState): string {
  const a = administration(state);
  const base = table().titles[String(rankOf(state)) as "1" | "2" | "3" | "4" | "5"] ?? "steward";
  return a.standing ? `${base}, raised ${a.standing === 1 ? "once" : "twice"} by the lord's hand` : base;
}

/** What the household's administration costs a season. */
export function upkeepPerSeason(state: WorldState): number {
  const a = administration(state);
  const c = table().costs;
  return a.standing * c.promote.perSeasonPerRank * rankOf(state) + a.staff * c.staff.perSeason + (a.deputy ? c.deputy.perSeason : 0);
}

/** The harvest and herd factor the overload imposes: the drop on the share of holdings beyond capacity. */
export function overloadFactor(state: WorldState): number {
  const tier = overloadTier(state);
  if (!tier) return 1;
  const drop = table().overload[tier - 1]?.drop ?? 0;
  const n = holdingsRun(state);
  return Math.max(0.5, 1 - (drop * overBy(state)) / Math.max(1, n));
}

function setModifier(state: WorldState, id: string, target: GameModifier["target"], value: number): void {
  const i = state.modifiers.findIndex((m) => m.id === id);
  if (value >= 0.999) {
    if (i >= 0) state.modifiers.splice(i, 1);
    return;
  }
  const mod: GameModifier = {
    id,
    target,
    kind: "permanent",
    seasons_remaining: null,
    effect: { op: "multiply", value: Math.round(value * 1000) / 1000 },
    source: "administration",
    customNote: "Aldric cannot reach every villa; the furthest pay less.",
  };
  if (i >= 0) state.modifiers[i] = mod;
  else state.modifiers.push(mod);
}

/** Keep the overload's modifiers in step with the holdings (also called after a grant or a forfeit). */
export function syncOverload(state: WorldState): void {
  const f = overloadFactor(state);
  setModifier(state, MOD_GRAIN, "grain_yield", f);
  setModifier(state, MOD_LIVESTOCK, "livestock_yield", f);
}

export type OfficeAction = "promote" | "hire" | "deputy";

/** What an action costs now, or why it cannot be had. */
export function officeCost(state: WorldState, action: OfficeAction): { once: number; perSeason: number } | { refused: string } {
  const a = administration(state);
  const c = table().costs;
  const r = rankOf(state);
  if (action === "promote") {
    if (a.standing >= 2) return { refused: "Aldric already stands as high as his office allows; a higher rank would give him more." };
    return { once: c.promote.oncePerRank * r, perSeason: c.promote.perSeasonPerRank * r };
  }
  if (action === "hire") {
    if (a.staff >= table().maxStaff) return { refused: "Aldric has as many clerks as the hall can hold; more would only talk to each other." };
    return { once: c.staff.once, perSeason: c.staff.perSeason };
  }
  if (r < 4) return { refused: "A regional deputy is a duke's officer; a count's lands are Aldric's to run." };
  if (a.deputy) return { refused: `${a.deputy.name} already holds the deputy's place.` };
  return { once: c.deputy.once, perSeason: c.deputy.perSeason };
}

/** Raise Aldric, hire clerks, or name a deputy. Pays from the chest. Returns the ledger line or a refusal. */
export function applyOfficeAction(state: WorldState, action: OfficeAction, turn: number, name?: string): { ok: boolean; line: string } {
  const cost = officeCost(state, action);
  if ("refused" in cost) return { ok: false, line: cost.refused };
  if (state.resources.denarii < cost.once) return { ok: false, line: `The chest holds ${Math.round(state.resources.denarii)} d; ${cost.once} are wanted.` };
  state.resources.denarii = Math.round(state.resources.denarii - cost.once);
  const a = administration(state);
  const steward = state.npcs.find((n) => n.id === "steward")?.name ?? "Aldric";
  let line: string;
  if (action === "promote") {
    a.standing += 1;
    line = `${steward} is raised in the lord's household (${cost.once} d, and ${cost.perSeason} d a season more); he now runs ${capacity(state)} villas with ease.`;
  } else if (action === "hire") {
    a.staff += 1;
    line = `${steward} takes on ${table().staffPerHire === 1 ? "a clerk" : "clerks"} under him (${cost.once} d, and ${cost.perSeason} d a season); the books stretch to ${capacity(state)} villas.`;
  } else {
    const deputyName = name?.trim() || pickDeputyName(state, turn);
    a.deputy = { name: deputyName, since: turn };
    line = `${deputyName} is named deputy over the outlying villas (${cost.once} d, and ${cost.perSeason} d a season). He is competent, and ambitious.`;
  }
  syncOverload(state);
  return { ok: true, line };
}

function pickDeputyName(state: WorldState, turn: number): string {
  const taken = new Set((state.history.vassals ?? []).map((v) => v.name));
  const pool = ranksTable().vassalNames.filter((n) => !taken.has(n));
  const rng = createRng(seedFromString(`${state.meta.region}:deputy:${turn}`));
  return pool.length ? pool[rng.int(0, pool.length - 1)] : "Rotbert";
}

function complaint(state: WorldState, tier: number, over: number): string {
  const n = holdingsRun(state);
  const far = state.holdings[n - 1]?.name ?? "the furthest villa";
  const fixes = (rankOf(state) >= 4 ? ["give me leave to hire clerks", "raise me and pay me for it", "name a deputy for the outlying villas"] : ["give me leave to hire clerks", "raise me and pay me for it"]).join(", or ");
  if (tier >= 3) {
    return `My lord, I must say it plainly: ${far} is running itself. The reeve there sends what he pleases and keeps the rest, and I have no man to send who would not do the same. ${over} villas more than I can hold. Either ${fixes}, or hold less.`;
  }
  if (tier === 2) {
    return `My lord, the dues from ${far} went uncollected this season; I had no one to send. I am ${over} villas past what I can hold in my head and my ledger. If you would ${fixes}, the books would close again.`;
  }
  return `My lord, I will not complain — but I am on the road more than I am at the hall, and ${far} sees me once a season if that. ${n} villas is more than one steward can walk. If you ever thought to ${fixes}, now would be the time.`;
}

/**
 * The season: pay the household, keep the yield modifier in step, leak what goes uncollected,
 * and have Aldric speak when the strain changes.
 */
export function tickAdministration(state: WorldState, at: SeasonAt, turn: number): AdministrationTick {
  const out: AdministrationTick = { beats: [], lines: [] };
  if (state.history.dead) return out;
  const a = administration(state);

  const pay = upkeepPerSeason(state);
  if (pay > 0 && a.paidTurn !== turn) {
    a.paidTurn = turn;
    const paid = Math.min(state.resources.denarii, pay);
    state.resources.denarii = Math.round(state.resources.denarii - paid);
    out.lines.push(`The household's officers were paid ${paid} d.`);
  }

  syncOverload(state);
  const tier = overloadTier(state);
  const over = overBy(state);
  if (tier >= 2) {
    const t = table().overload[tier - 1];
    const leak = Math.round(t.leakPerHolding * over);
    if (leak > 0) {
      const taken = Math.min(state.resources.denarii, leak);
      state.resources.denarii = Math.round(state.resources.denarii - taken);
      a.leaked += taken;
      const far = state.holdings[state.holdings.length - 1]?.name ?? "the furthest villa";
      out.lines.push(tier >= 3 ? `${far} runs itself: ${taken} d kept back by its reeve.` : `The dues of ${far} went uncollected this season (${taken} d).`);
    }
    if (t.mood) applyPeopleHappinessDelta(state, t.mood);
  }
  if (a.deputy && at.season === "spring") {
    const rng = createRng(seedFromString(`${state.meta.region}:deputy:leak:${at.year}`));
    const c = table().costs.deputy;
    const fisc = state.history.rank.lastRevenue?.fisc ?? 0;
    if (fisc > 0 && rng.chance(c.leakChance)) {
      const kept = Math.round(fisc * c.leakShare);
      state.resources.denarii = Math.max(0, Math.round(state.resources.denarii - kept));
      a.leaked += kept;
      out.lines.push(`${a.deputy.name} kept back ${kept} d of the outlying dues this year.`);
      out.beats.push({
        npcId: "steward",
        eventId: `administration:deputy:${at.year}`,
        text: `My lord, ${a.deputy.name}'s accounts for the year are short — ${kept} denarii, by my reckoning, and his explanation was good enough that I could not call it theft. He runs the outlying villas well. He also runs them as if they were his.`,
      });
    }
  }
  if (tier !== a.lastTier) {
    if (tier > a.lastTier) {
      out.beats.push({ npcId: "steward", eventId: `administration:tier:${tier}`, text: complaint(state, tier, over) });
    } else if (tier === 0) {
      out.beats.push({ npcId: "steward", eventId: "administration:tier:0", text: "The books are in hand again, my lord. I can reach every villa before the season turns." });
    }
    a.lastTier = tier;
  }
  return out;
}

/** The line for Aldric's HISTORY block. */
export function administrationLine(state: WorldState): string | null {
  const n = holdingsRun(state);
  const cap = capacity(state);
  const a = administration(state);
  if (n <= 1 && cap >= 1 && !a.staff && !a.standing && !a.deputy) return null;
  const tier = overloadTier(state);
  const parts = [`Aldric is ${stewardTitle(state)}: he runs ${n} villas against ${cap} he can hold${a.staff ? `, with ${a.staff} ${a.staff === 1 ? "clerk" : "clerks"}` : ""}${a.deputy ? `, and ${a.deputy.name} as deputy over the outlying villas` : ""}; the books are ${overloadWord(tier)}.`];
  const offers: string[] = [];
  for (const action of ["promote", "hire", "deputy"] as const) {
    const c = officeCost(state, action);
    if (!("refused" in c)) offers.push(`${action} (${c.once} d, ${c.perSeason} d a season)`);
  }
  if (offers.length) parts.push(`When the lord raises Aldric, gives him clerks, or names a deputy, propose steward_office {action: ${offers.join(" | ")}, name? for a deputy} for Confirm.`);
  return parts.join(" ");
}
