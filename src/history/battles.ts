import type { BattleState, CommandTier, UnitInstance } from "../combat/battleTypes";
import { pushLog, loseMorale } from "../combat/round";
import { seedFromString } from "../combat/rng";
import type { RosterLine } from "../combat/scenario";
import { reserveRow } from "../combat/grid";
import { unitSheet } from "../combat/registry";
import { spawnUnit, isActive } from "../combat/units";
import { GRID_COLUMNS } from "../combat/constants";
import { DISORDERED_MORALE_FRACTION } from "../combat/constants";
import type { BattleCall, BattleSession, HistoryRideMode, WorldState } from "../engine/schema";
import { canLeadFile } from "../engine/wounds";
import { participationBand } from "./age";
import { evalCondition } from "./conditions";
import type { HistoryBeat } from "./deliver";
import { applyEffects } from "./effects";
import { bodyAge, conditionContext } from "./flags";
import { historyContent } from "./load";
import type { SeasonAt } from "./scheduler";
import type { BattleForces, BattleLine, HistoryEffectsList, HistoryEvent } from "./schema";
import { applySupplyLoss } from "./supply";

/**
 * Historical battles (03_HISTORY §9; design/history/Battle_Force_Tables.md).
 *
 * The grid is the lord's sector, not the battle. A deferred battle event
 * raises a `history` call to arms; the muster composes the sector from the
 * forces table for the lord's rank, his own files displacing allied ones one
 * for one (never named allies or royal engines); the rest of the battle
 * arrives as morale events from the abstract layer; the sector's result
 * writes the flags the tables name and nothing else. History stands.
 */

// ---------------------------------------------------------------------------
// Forces lookup
// ---------------------------------------------------------------------------

export function historyForces(id: string): BattleForces | undefined {
  return historyContent().battles.find((b) => b.id === id);
}

/** The forces entry an event raises: the first whose `when` holds. Supply-check entries are kept apart. */
export function forcesForEvent(state: WorldState, eventId: string, at?: SeasonAt, opts?: { supply?: boolean }): BattleForces | undefined {
  const ctx = conditionContext(state, at);
  const wantSupply = Boolean(opts?.supply);
  return historyContent().battles.find((b) => b.event === eventId && b.supply === wantSupply && (!b.when || evalCondition(b.when, ctx)));
}

// ---------------------------------------------------------------------------
// Raising the call
// ---------------------------------------------------------------------------

/** How the lord goes: the summons's "send men" by letter, over 65 or permanently wounded from behind the line, else in a file. */
export function historyRideMode(state: WorldState, event: HistoryEvent | undefined, at?: SeasonAt): HistoryRideMode {
  if (event && sentMenFor(state, event)) return "captain";
  const age = bodyAge(state, at?.year);
  if (participationBand(age) === "command_from_behind" || !canLeadFile(state)) return "unattached";
  return "attached";
}

/** The summons that led here was answered with "send men under a captain". */
function sentMenFor(state: WorldState, event: HistoryEvent): boolean {
  const req = event.requires ?? "";
  // The summons flags are enums with a `sent_men` value; the battle's `requires` names them.
  const names = Array.from(req.matchAll(/([a-z0-9_]+)\s*==\s*'sent_men'/g)).map((m) => m[1]);
  return names.some((n) => state.history.flags[n] === "sent_men");
}

export function rideNote(state: WorldState, forces: BattleForces, mode: HistoryRideMode, at?: SeasonAt): string {
  const age = bodyAge(state, at?.year);
  if (forces.home) return "Home defence: no allies at any rank. Whatever you have raised is all there is, and the fight is at your own gate.";
  if (mode === "captain") return "You chose to send men under a captain. You run the engagement by letter: the same orders, given from a day's ride away, and no file of your own to ride in.";
  if (mode === "unattached") {
    return age >= 65
      ? `At ${age} you command from behind the line. You do not ride in a file; your men and the sector's orders are yours.`
      : "The old wound keeps you out of the line. You command from behind it, unattached.";
  }
  const band = participationBand(age);
  const rank = state.player.rankLevel ?? 1;
  const base =
    rank >= 4
      ? "You command by right. Bring your files and the sector is yours to set."
      : rank === 3
        ? "A count brings a wing. Three files or more and the sector is yours to command."
        : "With no files of your own you ride as one horseman in an allied file; with one, you command your own men inside the sector.";
  return band === "subcommand_or_rear" ? `${base} At ${age} a man in the line is slower to rise from a fall: every wound roll is taken twice.` : base;
}

export type OpenBattleResult = { call: BattleCall | null; beats: HistoryBeat[]; lines: string[] };

/**
 * Raise the history call for a battle event (the scheduler's hook, 03_HISTORY §9).
 * Nothing is raised for a dead, captive or maimed lord; an open random call gives way.
 */
export function openHistoricalBattle(state: WorldState, event: HistoryEvent, at: SeasonAt, turn: number, opts?: { supply?: { situation: string; share: number } }): OpenBattleResult {
  const out: OpenBattleResult = { call: null, beats: [], lines: [] };
  if (state.player.dead || state.player.captive || state.player.maimed || state.history.dead) return out;
  if (state.battle || state.battle_session) return out;
  const forces = forcesForEvent(state, event.id, at, { supply: Boolean(opts?.supply) });
  if (!forces) {
    out.lines.push(`${event.id}: no forces table; the battle is not fought.`);
    return out;
  }
  if (state.battle_call?.kind === "history") return out;
  const mode = forces.home ? (canLeadFile(state) ? "attached" : "unattached") : historyRideMode(state, event, at);
  const call: BattleCall = {
    kind: "history",
    eventId: event.id,
    text: forces.call,
    seed: seedFromString(`${state.meta.region}:${forces.id}:${at.year}:${at.season}:${turn}`),
    createdTurn: turn,
    historyId: forces.id,
    mode,
    note: rideNote(state, forces, mode, at),
    supply: opts?.supply,
  };
  state.battle_call = call;
  out.call = call;
  out.beats.push({
    npcId: "steward",
    eventId: event.id,
    text: forces.home
      ? `${forces.call} The men are asking whether you ride out or bar the hall, my lord.`
      : `${forces.call} The muster waits on you, my lord; the season will not turn until you have ridden out or turned back.`,
  });
  out.lines.push(`History: the call to ${forces.title} is open (${mode}).`);
  return out;
}

/** Turning back from a raised history battle: the tables' cost, or the default. Returns ledger lines. */
export function refuseHistoricalBattle(state: WorldState, call: BattleCall): string[] {
  const forces = call.historyId ? historyForces(call.historyId) : undefined;
  const lines: string[] = [];
  if (!forces) return lines;
  if (call.supply) {
    const r = applySupplyLoss(state, call.supply.situation, call.supply.share);
    lines.push(`Supply check (${call.supply.situation}): the hall was barred; about ${Math.round(call.supply.share * 100)}% of stores lost.`);
    lines.push(...r);
    return lines;
  }
  if (forces.quest) {
    state.history.quest.phase = "failed";
    state.history.quest.phaseTurn = state.meta.turn;
    lines.push("Quest: the lord would not take the field he had called the great men to. The attempt is over.");
  }
  const r = applyEffects(state, forces.onRefuse ?? { flags: { count_opinion: "-2" }, renown: "-moderate" }, `${forces.id}:refuse`);
  lines.push(...r.lines);
  state.history.record.push({ year: state.meta.year, season: state.meta.season as SeasonAt["season"], text: `Turned back from ${forces.title} after the call had gone out.`, thread: "battle" });
  if (state.history.away) state.history.away = null;
  return lines;
}

// ---------------------------------------------------------------------------
// Composing the sector
// ---------------------------------------------------------------------------

/** A roster line with the forces table's extras; stored on the session until the battle is built. */
export type HistoryRosterLine = RosterLine & {
  lineId?: string;
  fixed?: boolean;
  lord?: boolean;
  disordered?: boolean;
  moraleFraction?: number;
};

const DEFAULT_FILL: BattleLine[] = [
  { sheet: "caballarii", count: 1, name: "Levied horse", fixed: false, lord: false, disordered: false, tags: [] },
  { sheet: "pedites_fyrd", count: 1, name: "Levied spearmen", fixed: false, lord: false, disordered: false, tags: [] },
];

function toLine(l: BattleLine, owner: "ally" | "enemy"): HistoryRosterLine {
  return {
    sheetId: l.sheet,
    count: 1,
    owner,
    name: l.name,
    extraTags: l.tags.length ? l.tags : undefined,
    overrides: l.strength ? { strength: l.strength } : undefined,
    lineId: l.id,
    fixed: l.fixed,
    lord: l.lord,
    disordered: l.disordered,
    moraleFraction: l.morale,
  };
}

function expand(lines: readonly BattleLine[], owner: "ally" | "enemy"): HistoryRosterLine[] {
  const out: HistoryRosterLine[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.count; i++) {
      const line = toLine(l, owner);
      if (i > 0) line.lord = false; // the lord rides in one file, not every copy of the line
      out.push(line);
    }
  }
  return out;
}

/** The row for a rank: the highest defined at or below it, else the lowest defined. */
export function rowForRank(forces: BattleForces, rank: number) {
  const keys = Object.keys(forces.rows)
    .map(Number)
    .sort((a, b) => a - b);
  if (!keys.length) return undefined;
  const at = [...keys].reverse().find((k) => k <= rank) ?? keys[0];
  return forces.rows[String(at) as "1"];
}

/**
 * The allied part of the sector for a rank and a number of files brought. The sector total is the row's:
 * fewer files than the row expects are made up from `fill`; more displace allied files from the end, never fixed ones.
 */
export function composeAllies(forces: BattleForces, rank: number, brought: number): HistoryRosterLine[] {
  if (forces.home) return [];
  const row = rowForRank(forces, rank);
  if (!row) return [];
  const allies = expand(row.allies, "ally");
  const slots = row.slots;
  if (brought < slots) {
    const fill = row.fill?.length ? row.fill : DEFAULT_FILL;
    for (let i = 0; i < slots - brought; i++) allies.push(toLine(fill[i % fill.length], "ally"));
  } else if (brought > slots) {
    let extra = brought - slots;
    for (let i = allies.length - 1; i >= 0 && extra > 0; i--) {
      if (allies[i].fixed) continue;
      allies.splice(i, 1);
      extra--;
    }
  }
  return allies;
}

const QUEST_CONTINGENTS: Record<string, { sheet: string; name: string }[]> = {
  grievance: [
    { sheet: "heavy_horse", name: "household horse" },
    { sheet: "pedites_fyrd", name: "spearmen" },
  ],
  fear: [
    { sheet: "heavy_horse", name: "household horse" },
    { sheet: "pedites_fyrd", name: "spearmen" },
  ],
  money: [{ sheet: "caballarii", name: "horse" }],
  land: [
    { sheet: "caballarii", name: "horse" },
    { sheet: "pedites_fyrd", name: "spearmen" },
  ],
  marriage: [{ sheet: "heavy_horse", name: "household horse" }],
  office: [
    { sheet: "pedites_fyrd", name: "spearmen" },
    { sheet: "sagittarii", name: "archers" },
  ],
  debt: [
    { sheet: "pedites_fyrd", name: "spearmen" },
    { sheet: "sagittarii", name: "archers" },
  ],
  divine: [
    { sheet: "pedites_fyrd", name: "spearmen" },
    { sheet: "sagittarii", name: "archers" },
  ],
  protection: [
    { sheet: "caballarii", name: "horse" },
    { sheet: "breton_gascon_light_cavalry", name: "light horse" },
  ],
};

function line(sheet: string, name: string, extra?: Partial<HistoryRosterLine>): HistoryRosterLine {
  return { sheetId: sheet, count: 1, owner: "ally", name, ...extra };
}

/** The king-quest sector: the supporters won bring their contingents; the king's side grows with every one lost. */
export function composeQuestSector(state: WorldState): { allies: HistoryRosterLine[]; enemy: HistoryRosterLine[]; betrayerUnits: number } {
  const nobles = state.history.quest.nobles;
  const allies: HistoryRosterLine[] = [line("elite_foot", "The lord's household", { lord: true, fixed: true })];
  let betrayerUnits = 0;
  for (const n of nobles) {
    if (n.status !== "won" && n.status !== "betrayer") continue;
    const rows = QUEST_CONTINGENTS[n.motive] ?? QUEST_CONTINGENTS.money;
    for (const r of rows) {
      allies.push(line(r.sheet, `${n.name}'s ${r.name}`, { lineId: n.status === "betrayer" ? "betrayer" : undefined, fixed: true }));
      if (n.status === "betrayer") betrayerUnits++;
    }
  }
  const won = nobles.filter((n) => n.status === "won" || n.status === "betrayer").length;
  const size = won >= 7 ? 5 : won === 6 ? 6 : won >= 4 ? 7 : 8;
  const enemy: HistoryRosterLine[] = [
    { sheetId: "heavy_horse", count: 1, owner: "enemy", name: "The king's household" },
    { sheetId: "heavy_horse", count: 1, owner: "enemy", name: "The king's household" },
    { sheetId: "elite_foot", count: 1, owner: "enemy", name: "The king's household foot" },
  ];
  // Anything the lord let escape his lands is in the king's hands too (Technology Diffusion).
  for (const inv of state.history.diffusion.innovations) {
    if (inv.spread !== "kingdom" || !unitSheet(inv.id) || enemy.length >= size) continue;
    enemy.push({ sheetId: inv.id, count: 1, owner: "enemy", name: `The king's ${inv.name}` });
  }
  const counties = ["caballarii", "pedites_fyrd"];
  for (let i = 0; enemy.length < size; i++) enemy.push({ sheetId: counties[i % 2], count: 1, owner: "enemy", name: i % 2 ? "Loyal counties' spearmen" : "Loyal counties' horse" });
  return { allies, enemy, betrayerUnits };
}

/** Command tier for a history battle: by right at duke and king rank, a count with a wing, the quest always. */
export function historicalTier(state: WorldState, forces: BattleForces, brought: number, mode: HistoryRideMode): CommandTier {
  if (brought <= 0) return mode === "attached" ? "rank_and_file" : "sub_command";
  const rank = state.player.rankLevel ?? 1;
  if (forces.fullCommand || state.player.fullCommandGranted || rank >= 4 || (rank === 3 && brought >= 3)) return "full_command";
  return "sub_command";
}

export type HistoricalEncounter = {
  forces: BattleForces;
  allies: HistoryRosterLine[];
  enemy: HistoryRosterLine[];
  premise: string;
  tier: CommandTier;
};

/** Rosters and tier for the muster. */
export function historicalEncounter(state: WorldState, call: BattleCall, brought: number): HistoricalEncounter | undefined {
  const forces = call.historyId ? historyForces(call.historyId) : undefined;
  if (!forces) return undefined;
  const mode = call.mode ?? "attached";
  const tier = historicalTier(state, forces, brought, mode);
  let allies: HistoryRosterLine[];
  let enemy: HistoryRosterLine[];
  if (forces.quest) {
    const q = composeQuestSector(state);
    allies = q.allies;
    enemy = q.enemy;
  } else {
    allies = composeAllies(forces, state.player.rankLevel ?? 1, brought);
    enemy = expand(forces.enemy, "enemy");
  }
  // One horseman among many needs a file to ride in; a home defence with no men never raises a call.
  if (tier === "rank_and_file" && !allies.some((a) => a.lord)) {
    const file = allies.find((a) => a.sheetId === "caballarii") ?? allies.find((a) => unitSheet(a.sheetId)?.kind === "troop");
    if (file) file.lord = true;
    else allies.unshift(line("caballarii", "The household's riders", { lord: true }));
  }
  return { forces, allies, enemy, premise: forces.premise, tier };
}

// ---------------------------------------------------------------------------
// Units on the field
// ---------------------------------------------------------------------------

/** Starting morale for a line: Disordered (a fifth), worn (a fraction), or the sheet's. */
export function applyLineMorale(unit: UnitInstance, l: Pick<HistoryRosterLine, "disordered" | "moraleFraction">): void {
  if (l.disordered) unit.morale = Math.max(1, Math.floor(unit.maxMorale * (DISORDERED_MORALE_FRACTION - 0.05)));
  else if (l.moraleFraction) unit.morale = Math.max(1, Math.round(unit.maxMorale * l.moraleFraction));
}

// ---------------------------------------------------------------------------
// The abstract layer
// ---------------------------------------------------------------------------

/** The rest of the battle arrives: morale events due at this round, each once. Returns the lines to narrate. */
export function applyAbstractLayer(state: WorldState): string[] {
  const battle = state.battle;
  const session = state.battle_session;
  const h = session?.historical;
  if (!battle || !session || !h) return [];
  const forces = historyForces(h.id);
  if (!forces) return [];
  const texts: string[] = [];
  const due = battle.round + 1;
  forces.abstract.forEach((ev, i) => {
    if (ev.round > due || h.abstractApplied.includes(i)) return;
    h.abstractApplied.push(i);
    for (const u of battle.units) {
      if (u.side !== ev.side || !isActive(u)) continue;
      if (ev.morale < 0) {
        const mult = u.tags.includes("undisciplined") ? 1.5 : 1;
        loseMorale(battle, u, Math.round(-ev.morale * mult));
      } else {
        u.morale = Math.min(u.maxMorale, u.morale + ev.morale);
      }
    }
    pushLog(battle, "morale", `${ev.text} (${ev.side === "player" ? "our" : "their"} files ${ev.morale < 0 ? "lose" : "gain"} ${Math.abs(ev.morale)} heart.)`);
    texts.push(ev.text);
  });
  if (forces.quest && !h.betrayed && due >= 3) {
    const t = turnBetrayer(battle);
    h.betrayed = true;
    if (t) texts.push(t);
  }
  return texts;
}

/** The king-quest betrayer: his files leave the sector and reappear across the field. */
function turnBetrayer(battle: BattleState): string | null {
  const mine = battle.units.filter((u) => u.side === "player" && u.id.startsWith("a-betrayer-") && isActive(u));
  if (!mine.length) return null;
  const row = reserveRow("enemy");
  let n = 0;
  for (const u of mine) {
    u.status = "withdrawn";
    u.engagedWith = [];
    u.engagedSince = {};
    u.fort = undefined;
    const col = n++ % GRID_COLUMNS;
    const copy = spawnUnit(u.sheetId, { id: `e-turncoat-${n}`, side: "enemy", owner: "enemy", name: u.name, extraTags: u.tags.filter((t) => t === "veteran"), cell: { row, col } });
    copy.strength = u.strength;
    copy.initialStrength = u.strength;
    // Mid-battle: addUnit only accepts units during deployment.
    battle.units.push(copy);
  }
  const text = `${mine[0].name.replace(/'s .*$/, "")} has turned. His files leave the line and take their place across the field, as Aldric said one would.`;
  pushLog(battle, "info", text);
  for (const u of battle.units) {
    if (u.side !== "player" || !isActive(u)) continue;
    loseMorale(battle, u, u.tags.includes("undisciplined") ? 9 : 6);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ResultClass = "won" | "lost" | "held";

export function resultClass(outcome: string | null | undefined): ResultClass {
  if (outcome === "victory" || outcome === "enemy_withdrew") return "won";
  if (outcome === "defeat") return "lost";
  return "held";
}

/**
 * After the ledger: the effects the tables name for the sector's result, a named survivor's,
 * the supply loss of a home defence lost, and the record line. History stands otherwise.
 */
export function applyHistoricalResults(state: WorldState, battle: BattleState, session: BattleSession): string[] {
  const h = session.historical;
  if (!h) return [];
  const forces = historyForces(h.id);
  if (!forces) return [];
  const lines: string[] = [];
  const cls = resultClass(battle.outcome);
  const seed = `${forces.id}:${cls}:${state.meta.year}`;
  for (const key of [cls, "any"] as const) {
    const eff = forces.results?.[key];
    if (!eff) continue;
    const r = applyEffects(state, eff, seed);
    if (r.refused) lines.push(`${forces.title}: ${r.refused}`);
    lines.push(...r.lines);
  }
  if (forces.survivor) {
    const standing = battle.units.some((u) => u.side === "player" && u.id.startsWith(`a-${forces.survivor!.unit}-`) && (u.status === "active" || u.status === "withdrawn"));
    if (standing) {
      const r = applyEffects(state, forces.survivor.effects, `${seed}:survivor`);
      lines.push(...r.lines);
    }
  }
  if (h.supply) {
    if (cls === "lost") {
      lines.push(`Supply check (${h.supply.situation}): the militia was broken; about ${Math.round(h.supply.share * 100)}% of stores lost.`);
      lines.push(...applySupplyLoss(state, h.supply.situation, h.supply.share));
    } else if (cls === "held") {
      const half = h.supply.share / 2;
      lines.push(`Supply check (${h.supply.situation}): they were held at the gate but not driven off; about ${Math.round(half * 100)}% of stores lost.`);
      lines.push(...applySupplyLoss(state, h.supply.situation, half));
    } else {
      lines.push(`Supply check (${h.supply.situation}): the militia drove them off. Nothing taken.`);
    }
  }
  if (forces.quest && cls === "lost") {
    state.history.quest.phase = "failed";
    state.history.quest.phaseTurn = state.meta.turn;
    lines.push("Quest: the field against the king was lost. The attempt is over.");
  }
  if (!hasRecord(forces.results?.[cls])) {
    // No record line from the table for this result: the engine writes a plain one.
    const verb = cls === "won" ? "won his stretch of the field at" : cls === "lost" ? "lost his stretch of the field at" : "held his ground at";
    state.history.record.push({ year: state.meta.year, season: state.meta.season as SeasonAt["season"], text: `The lord ${verb} ${forces.title}.`, thread: "battle" });
  }
  return lines;
}

function hasRecord(effects: HistoryEffectsList | undefined): boolean {
  if (!effects) return false;
  const list = Array.isArray(effects) ? effects : [effects];
  return list.some((e) => Boolean(e.record));
}

/** Fortification face for a history battle, if the tables give one. */
export function historicalFort(forces: BattleForces | undefined): { side: "player" | "enemy"; typeId: string; makeshift: boolean; points: number } | undefined {
  if (!forces?.fort) return undefined;
  return { side: forces.fort.side, typeId: forces.fort.type, makeshift: forces.fort.makeshift, points: forces.fort.points };
}
