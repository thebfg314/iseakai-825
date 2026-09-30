import { z } from "zod";
import { addressTroops, attachPlayer, beginRounds, controlledUnitIds, createBattle, endDay, playRound, summarizeBattle, type BattleSummary, type DayEndChoice } from "../combat/battle";
import { BattlefieldSchema, BattleStateSchema, COMMAND_TIERS, OrderSchema, SIDES, OWNERS, type BattleState, type Order } from "../combat/battleTypes";
import { aiOrders } from "../combat/ai";
import { forgeRepairPrompt, forgeSystemPrompt, forgeUserPrompt, parseForgeReply, type ForgeProposal } from "../combat/forge";
import { assignToPoint, buildFortificationCell, pointsInCell } from "../combat/fortification";
import { cellIndex, emptyBattlefield } from "../combat/grid";
import {
  FORTIFICATION_TYPES,
  TERRAIN,
  WEATHER,
  allTags,
  allUnitSheets,
  customSheetList,
  customTagList,
  clearCustomContent,
  isBuiltinSheet,
  isBuiltinTag,
  registerCustomSheet,
  registerCustomTag,
  removeCustomSheet,
  unitSheet,
} from "../combat/registry";
import { RangeSchema, TagDefSchema, UnitSheetSchema, type FortificationType, type TagDef, type TerrainDef, type UnitSheet, type WeatherDef } from "../combat/schema";
import { autoDeploy } from "../combat/scenario";
import { resolveCommandClaim, type CommandClaimResult } from "../combat/renown";
import { sheetFor, spawnUnit } from "../combat/units";
import type { ChatMessageParam, ChatOpts } from "../llm/types";

/**
 * Battle Lab session (main process). Isolated from the campaign's world-state; custom
 * sheets and tags forged here live only for the session (Phase 0 decision).
 */

export const LabRosterLineSchema = z.object({
  sheetId: z.string(),
  count: z.number().int().min(1).max(8).default(1),
  owner: z.enum(OWNERS).optional(),
  veteran: z.boolean().default(false),
  extraTags: z.array(z.string()).default([]),
  overrides: z
    .object({
      hp: z.number().positive().optional(),
      atk: z.number().nonnegative().optional(),
      def: z.number().nonnegative().optional(),
      damage: RangeSchema.optional(),
      range: z.number().int().min(0).max(6).optional(),
      speed: z.number().int().min(0).optional(),
      morale: z.number().positive().optional(),
      strength: z.number().int().positive().optional(),
    })
    .optional(),
});
export type LabRosterLine = z.infer<typeof LabRosterLineSchema>;

export const LabFortificationSchema = z.object({
  side: z.enum(SIDES),
  typeId: z.string(),
  row: z.number().int().min(1).max(5),
  makeshift: z.boolean().default(false),
  pointsPerCell: z.number().int().min(1).max(3).default(2),
});

export const LabConfigSchema = z.object({
  seed: z.number().int().default(1),
  tier: z.enum(COMMAND_TIERS).default("full_command"),
  renown: z.number().min(1).default(40),
  rank: z.number().int().min(1).max(5).default(1),
  player: z.array(LabRosterLineSchema).default([{ sheetId: "caballarii", count: 1, veteran: false, extraTags: [] }]),
  enemy: z.array(LabRosterLineSchema).default([{ sheetId: "pedites_fyrd", count: 2, veteran: false, extraTags: [] }]),
  attachIndex: z.number().int().min(0).default(0),
  field: BattlefieldSchema.default(emptyBattlefield()),
  fortification: LabFortificationSchema.optional(),
  enemyPosture: z.enum(["attack", "defend"]).default("attack"),
  allyPosture: z.enum(["attack", "defend"]).default("attack"),
  /** When true the lab waits for explicit orders for controlled units instead of letting the AI drive them. */
  manualOrders: z.boolean().default(false),
  /** Pre-battle Address the Troops spends, by roster unit id. */
  addressTroops: z.record(z.string(), z.number().nonnegative()).default({}),
  /** Renown of the allied commander, for the Command Claim readout (stub until the narrative layer supplies it). */
  allyRenown: z.number().min(0).default(0),
});
export type LabConfig = z.infer<typeof LabConfigSchema>;

export const LabScenarioFileSchema = z.object({
  kind: z.literal("isekai-battle-lab-scenario"),
  version: z.literal(1),
  config: LabConfigSchema,
  customTags: z.array(z.unknown()).default([]),
  customSheets: z.array(z.unknown()).default([]),
});

export type LabForgeState = {
  busy: boolean;
  pending: ForgeProposal | null;
  error?: string;
  /** Recent forge activity for the panel. */
  history: string[];
};

export type LabView = {
  config: LabConfig;
  battle: BattleState | null;
  summary: BattleSummary | null;
  /** Command Claim (stub): the lord's contribution vs the allied contingent's. */
  claim: (CommandClaimResult & { allyUnits: number }) | null;
  snapshotCount: number;
  controlled: string[];
  registry: {
    sheets: UnitSheet[];
    tags: TagDef[];
    terrain: TerrainDef[];
    weather: WeatherDef[];
    fortifications: FortificationType[];
    customSheetIds: string[];
    customTagIds: string[];
  };
  forge: LabForgeState;
  error?: string;
};

export type LabChat = (messages: ChatMessageParam[], opts?: ChatOpts) => Promise<string>;

const MAX_SNAPSHOTS = 400;

export class LabController {
  config: LabConfig = LabConfigSchema.parse({});
  battle: BattleState | null = null;
  private snapshots: string[] = [];
  forge: LabForgeState = { busy: false, pending: null, history: [] };
  private forgeSeq = 0;
  private lastError: string | undefined;

  constructor(private readonly chat: LabChat) {}

  view(): LabView {
    const v: LabView = {
      config: this.config,
      battle: this.battle,
      summary: this.battle ? summarizeBattle(this.battle) : null,
      claim: this.battle ? this.commandClaim() : null,
      snapshotCount: this.snapshots.length,
      controlled: this.battle ? controlledUnitIds(this.battle) : [],
      registry: {
        sheets: allUnitSheets(),
        tags: allTags(),
        terrain: [...TERRAIN],
        weather: [...WEATHER],
        fortifications: [...FORTIFICATION_TYPES],
        customSheetIds: customSheetList().map((s) => s.id),
        customTagIds: customTagList().map((t) => t.id),
      },
      forge: this.forge,
      error: this.lastError,
    };
    this.lastError = undefined;
    return v;
  }

  /** Score the lord's contributed files against the allied ones on his side, using the stated ally Renown. */
  private commandClaim(): (CommandClaimResult & { allyUnits: number }) | null {
    const b = this.battle;
    if (!b) return null;
    const sheetOf = (u: BattleState["units"][number]) => {
      const s = sheetFor(u);
      return { hp: s.hp, atk: s.atk, def: s.def };
    };
    const mine = b.units.filter((u) => u.side === "player" && u.owner === "player").map(sheetOf);
    const allies = b.units.filter((u) => u.side === "player" && u.owner === "ally").map(sheetOf);
    const result = resolveCommandClaim({ renown: this.config.renown, units: mine }, allies.length ? [{ renown: this.config.allyRenown, units: allies }] : []);
    return { ...result, allyUnits: allies.length };
  }

  private fail(message: string): LabView {
    this.lastError = message;
    return this.view();
  }

  setConfig(patch: unknown): LabView {
    const merged = { ...this.config, ...(patch as Partial<LabConfig>) };
    const parsed = LabConfigSchema.safeParse(merged);
    if (!parsed.success) return this.fail(`Config rejected: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    for (const line of [...parsed.data.player, ...parsed.data.enemy]) {
      if (!unitSheet(line.sheetId)) return this.fail(`Unknown unit sheet "${line.sheetId}".`);
    }
    this.config = parsed.data;
    return this.view();
  }

  /** Terrain painter helper: set one cell's terrain list / cliff flag. */
  paintCell(row: number, col: number, terrain: string[], cliffBelow?: boolean): LabView {
    const field = structuredClone(this.config.field);
    const cell = field.cells[cellIndex({ row, col })];
    if (!cell) return this.fail("No such cell.");
    cell.terrain = terrain.filter((t) => TERRAIN.some((d) => d.id === t));
    if (cliffBelow !== undefined) cell.cliffBelow = cliffBelow;
    return this.setConfig({ field });
  }

  build(): LabView {
    const c = this.config;
    if (!c.player.length || !c.enemy.length) return this.fail("Both sides need at least one roster line.");
    const field = structuredClone(c.field);
    if (c.fortification) {
      const f = c.fortification;
      for (let col = 0; col < 3; col++) {
        const cell = field.cells[cellIndex({ row: f.row, col })];
        cell.terrain = cell.terrain.filter((t) => t !== "river");
        cell.fortification = buildFortificationCell(f.typeId, f.side, `${f.row}:${col}`, f.pointsPerCell, f.makeshift);
      }
    }
    const state = createBattle({
      id: `lab-${c.seed}-${Date.now().toString(36)}`,
      seed: c.seed,
      tier: c.tier,
      battlefield: field,
      player: { renown: c.renown, rank: c.rank as 1 | 2 | 3 | 4 | 5 },
    });
    const expand = (lines: LabRosterLine[], side: "player" | "enemy") => {
      const counts = new Map<string, number>();
      const out = [];
      for (const line of lines) {
        for (let i = 0; i < line.count; i++) {
          const k = (counts.get(line.sheetId) ?? 0) + 1;
          counts.set(line.sheetId, k);
          const extra = [...line.extraTags];
          if (line.veteran && !extra.includes("veteran")) extra.push("veteran");
          out.push(
            spawnUnit(line.sheetId, {
              id: `${side[0]}-${line.sheetId}-${k}`,
              side,
              owner: line.owner ?? (side === "enemy" ? "enemy" : "player"),
              extraTags: extra,
              overrides: line.overrides,
            }),
          );
        }
      }
      return out;
    };
    const playerUnits = expand(c.player, "player");
    const enemyUnits = expand(c.enemy, "enemy");
    state.units.push(...playerUnits, ...enemyUnits);
    autoDeploy(state, "player");
    autoDeploy(state, "enemy");
    if (c.fortification) {
      // Garrison the wall: units of the fort's side standing in its row take up its points.
      const f = c.fortification;
      for (const u of state.units) {
        if (u.side !== f.side || !u.cell || u.cell.row !== f.row) continue;
        const points = pointsInCell(state.battlefield, u.cell);
        const taken = state.units.filter((x) => x.fort && points.some((p) => p.id === x.fort!.pointId)).length;
        const point = points[taken % points.length];
        if (point) assignToPoint(state, u.id, point.id);
      }
    }
    const attach = playerUnits[Math.min(c.attachIndex, playerUnits.length - 1)];
    if (attach) attachPlayer(state, attach.id);
    for (const [unitId, amount] of Object.entries(c.addressTroops)) if (amount > 0) addressTroops(state, unitId, amount);
    const begun = beginRounds(state);
    if (!begun.ok) return this.fail(begun.reason ?? "Could not begin.");
    this.battle = state;
    this.snapshots = [];
    return this.view();
  }

  private snapshot(): void {
    if (!this.battle) return;
    this.snapshots.push(JSON.stringify(this.battle));
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  step(orders: unknown[] = []): LabView {
    if (!this.battle) return this.fail("Build a battle first.");
    if (this.battle.phase !== "rounds") return this.fail(`Battle is in phase ${this.battle.phase}.`);
    const parsed: Order[] = [];
    for (const o of orders) {
      const r = OrderSchema.safeParse(o);
      if (!r.success) return this.fail(`Order rejected: ${r.error.issues.map((i) => i.message).join("; ")}`);
      parsed.push(r.data);
    }
    this.snapshot();
    const controlled = controlledUnitIds(this.battle);
    const covered = new Set(parsed.map((o) => (o.type === "rally" ? "" : o.unitId)));
    // AI fills in for any controlled unit the player left without an order (unless strictly manual).
    const filler = this.config.manualOrders ? [] : aiOrders(this.battle, "player", controlled.filter((id) => !covered.has(id)), { posture: this.config.allyPosture });
    playRound(this.battle, [...parsed, ...filler], { enemyAi: { posture: this.config.enemyPosture }, allyAi: { posture: this.config.allyPosture } });
    return this.view();
  }

  autoRun(maxRounds = 200): LabView {
    if (!this.battle) return this.fail("Build a battle first.");
    let guard = 0;
    while (this.battle.phase !== "finished" && guard++ < maxRounds) {
      if (this.battle.phase === "day_end") {
        this.snapshot();
        endDay(this.battle, "hold");
        continue;
      }
      if (this.battle.phase !== "rounds") break;
      this.snapshot();
      const controlled = controlledUnitIds(this.battle);
      playRound(this.battle, aiOrders(this.battle, "player", controlled, { posture: this.config.allyPosture }), {
        enemyAi: { posture: this.config.enemyPosture },
        allyAi: { posture: this.config.allyPosture },
      });
    }
    return this.view();
  }

  rewind(steps = 1): LabView {
    if (!this.snapshots.length) return this.fail("Nothing to rewind.");
    let last: string | undefined;
    for (let i = 0; i < Math.max(1, steps) && this.snapshots.length; i++) last = this.snapshots.pop();
    if (last) this.battle = BattleStateSchema.parse(JSON.parse(last));
    return this.view();
  }

  dayEnd(choice: DayEndChoice): LabView {
    if (!this.battle || this.battle.phase !== "day_end") return this.fail("Not at a day's end.");
    this.snapshot();
    endDay(this.battle, choice);
    return this.view();
  }

  reset(): LabView {
    this.battle = null;
    this.snapshots = [];
    return this.view();
  }

  exportScenario(): string {
    return JSON.stringify(
      { kind: "isekai-battle-lab-scenario", version: 1, config: this.config, customTags: customTagList(), customSheets: customSheetList() },
      null,
      2,
    );
  }

  importScenario(text: string): LabView {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.fail("That is not JSON.");
    }
    const parsed = LabScenarioFileSchema.safeParse(raw);
    if (!parsed.success) return this.fail(`Scenario rejected: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    // Custom content travels with the scenario; validate and register it before the roster is checked.
    const tags: TagDef[] = [];
    for (const [i, t] of parsed.data.customTags.entries()) {
      const r = TagDefSchema.safeParse(t);
      if (!r.success) return this.fail(`customTags[${i}] rejected: ${r.error.issues.map((x) => x.message).join("; ")}`);
      tags.push(r.data);
    }
    const sheets: UnitSheet[] = [];
    for (const [i, s] of parsed.data.customSheets.entries()) {
      const r = UnitSheetSchema.safeParse(s);
      if (!r.success) return this.fail(`customSheets[${i}] rejected: ${r.error.issues.map((x) => x.message).join("; ")}`);
      sheets.push(r.data);
    }
    try {
      for (const t of tags) if (!isBuiltinTag(t.id)) registerCustomTag(t);
      for (const s of sheets) if (!isBuiltinSheet(s.id)) registerCustomSheet(s);
    } catch (e) {
      return this.fail(e instanceof Error ? e.message : String(e));
    }
    this.battle = null;
    this.snapshots = [];
    return this.setConfig(parsed.data.config);
  }

  // ---- Unit Forge -----------------------------------------------------------

  async forgeUnit(request: string): Promise<LabView> {
    if (this.forge.busy) return this.fail("The forge is already working.");
    const text = request.trim();
    if (!text) return this.fail("Describe the unit first.");
    this.forge = { ...this.forge, busy: true, error: undefined };
    try {
      const messages: ChatMessageParam[] = [
        { role: "system", content: forgeSystemPrompt() },
        { role: "user", content: forgeUserPrompt(text) },
      ];
      let raw = await this.chat(messages, { maxTokens: 1800, temperature: 0.4 });
      let result = parseForgeReply(raw);
      if (!result.ok) {
        raw = await this.chat([...messages, { role: "assistant", content: raw }, { role: "user", content: forgeRepairPrompt(result.errors) }], { maxTokens: 1800, temperature: 0.2 });
        result = parseForgeReply(raw);
      }
      if (!result.ok) {
        this.forge = { ...this.forge, busy: false, error: `The forge could not produce a valid sheet: ${result.errors.join(" | ")}`, history: [...this.forge.history, `✗ ${text.slice(0, 60)}`].slice(-20) };
        return this.view();
      }
      this.forgeSeq += 1;
      this.forge = {
        busy: false,
        pending: { id: `forge-${this.forgeSeq}`, prompt: text, ...result.proposal },
        history: [...this.forge.history, `? ${result.proposal.sheet.name}`].slice(-20),
      };
      return this.view();
    } catch (e) {
      this.forge = { ...this.forge, busy: false, error: e instanceof Error ? e.message : String(e) };
      return this.view();
    }
  }

  approveForge(): LabView {
    const p = this.forge.pending;
    if (!p) return this.fail("No proposal to approve.");
    try {
      for (const t of p.newTags) registerCustomTag(t);
      registerCustomSheet(p.sheet);
    } catch (e) {
      return this.fail(e instanceof Error ? e.message : String(e));
    }
    this.forge = { busy: false, pending: null, history: [...this.forge.history, `✓ ${p.sheet.name} (${p.sheet.id})`].slice(-20) };
    return this.view();
  }

  rejectForge(): LabView {
    const p = this.forge.pending;
    this.forge = { busy: false, pending: null, history: p ? [...this.forge.history, `✗ ${p.sheet.name}`].slice(-20) : this.forge.history };
    return this.view();
  }

  /** Remove a forged sheet from the session (and any roster lines that used it). */
  discardCustomSheet(id: string): LabView {
    removeCustomSheet(id);
    return this.setConfig({
      player: this.config.player.filter((l) => l.sheetId !== id),
      enemy: this.config.enemy.filter((l) => l.sheetId !== id),
    });
  }

  /** End of session: forged content does not outlive the lab. */
  dispose(): void {
    clearCustomContent();
    this.battle = null;
    this.snapshots = [];
    this.forge = { busy: false, pending: null, history: [] };
  }
}
