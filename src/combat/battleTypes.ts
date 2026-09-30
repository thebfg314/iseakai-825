import { z } from "zod";
import { GRID_COLUMNS, GRID_ROWS } from "./constants";
import { ORDER_IDS, RangeSchema, WoundSchema } from "./schema";

/**
 * Live battle state (design doc §8). Zod so a battle can be saved mid-fight and
 * a lab scenario replayed. Everything the engine mutates lives here; the
 * content registry (sheets, tags, terrain) stays read-only in registry.ts.
 */

export const SIDES = ["player", "enemy"] as const;
export type Side = (typeof SIDES)[number];

/** Who the unit answers to. `ally` units stand on the player's side but are NPC-commanded. */
export const OWNERS = ["player", "ally", "enemy"] as const;
export type Owner = (typeof OWNERS)[number];

export const COMMAND_TIERS = ["rank_and_file", "sub_command", "full_command"] as const;
export type CommandTier = (typeof COMMAND_TIERS)[number];

export const CellSchema = z.object({
  /** 1 = own reserve, 2 = own front, 3 = no man's land, 4 = enemy front, 5 = enemy reserve. */
  row: z.number().int().min(1).max(GRID_ROWS),
  /** 0 = Left, 1 = Center, 2 = Right. */
  col: z.number().int().min(0).max(GRID_COLUMNS - 1),
});
export type Cell = z.infer<typeof CellSchema>;

export const UNIT_STATUSES = ["active", "routed", "destroyed", "withdrawn"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const PendingMoveSchema = z.object({
  to: CellSchema,
  cost: z.number(),
  paid: z.number(),
});

export const UnitInstanceSchema = z.object({
  id: z.string(),
  sheetId: z.string(),
  name: z.string(),
  side: z.enum(SIDES),
  owner: z.enum(OWNERS),
  /** Instance tags: sheet tags plus acquired ones (veteran, berserker) minus any lost to ammo depletion. */
  tags: z.array(z.string()),
  /** Lab overrides of sheet numbers; the effective sheet is the registry sheet with these applied. */
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
  hp: z.number(),
  maxHp: z.number(),
  morale: z.number(),
  maxMorale: z.number(),
  /** Command Pool shield in front of Morale (§5.2.2). */
  shield: z.number().default(0),
  strength: z.number().int(),
  initialStrength: z.number().int(),
  ammo: z.number().int().optional(),
  cell: CellSchema.nullable(),
  status: z.enum(UNIT_STATUSES).default("active"),
  /** Enemy ids engaged against this unit, in the order they engaged (front first). */
  engagedWith: z.array(z.string()).default([]),
  /** Round each engagement began, keyed by enemy id — first round of a link is a charge. */
  engagedSince: z.record(z.string(), z.number()).default({}),
  pendingMove: PendingMoveSchema.optional(),
  /** Consecutive rounds in the current cell (§9.3 Defender designation). */
  occupancyRounds: z.number().int().default(0),
  fireTarget: z.string().optional(),
  lastFiredRound: z.number().int().optional(),
  holdFormation: z.boolean().default(false),
  /** Which Fortification Point the unit is assigned to, and whether it is Presented (§9.4). */
  fort: z.object({ pointId: z.string(), presented: z.boolean() }).optional(),
  berserk: z.boolean().default(false),
  wasEngaged: z.boolean().default(false),
  /** Vignette effect: multiply any flank shock this unit takes next round (0.5 = halved). Cleared each round. */
  flankShockScale: z.number().optional(),
  /** Renown bookkeeping (§5.2.1). Shield absorption counts as taken. */
  moraleDealt: z.number().default(0),
  moraleTaken: z.number().default(0),
  casualties: z.number().int().default(0),
  captured: z.number().int().default(0),
  escaped: z.number().int().default(0),
});
export type UnitInstance = z.infer<typeof UnitInstanceSchema>;

export const FortPointSchema = z.object({
  id: z.string(),
  label: z.string(),
  typeId: z.string(),
  hp: z.number(),
  maxHp: z.number(),
  structuralDef: z.number(),
  defenderDefBonus: z.number(),
  breached: z.boolean().default(false),
});
export type FortPoint = z.infer<typeof FortPointSchema>;

export const BattleCellSchema = z.object({
  /** Terrain ids present (heavy_brush may stack with woodland). Empty = grassland. */
  terrain: z.array(z.string()).default([]),
  /** Boundary between this row and row + 1 in this column is blocked (§9.1 Impassable Cliffs). */
  cliffBelow: z.boolean().default(false),
  fortification: z
    .object({
      side: z.enum(SIDES),
      points: z.array(FortPointSchema),
    })
    .optional(),
});
export type BattleCell = z.infer<typeof BattleCellSchema>;

export const BattlefieldSchema = z.object({
  name: z.string().default("Open field"),
  weather: z.string().default("sunshine"),
  /** 15 cells, index = (row − 1) × 3 + col. */
  cells: z.array(BattleCellSchema).length(GRID_ROWS * GRID_COLUMNS),
});
export type Battlefield = z.infer<typeof BattlefieldSchema>;

export const PlayerBattleStateSchema = z.object({
  attachedUnitId: z.string().nullable(),
  hp: z.number(),
  maxHp: z.number(),
  atk: z.number(),
  def: z.number(),
  damage: RangeSchema,
  renown: z.number(),
  rank: z.number().int().min(1).max(5),
  wounds: z.array(WoundSchema).default([]),
  /** Wounds taken this battle, awaiting narrative flavour from the LLM layer. */
  newWounds: z.array(WoundSchema).default([]),
  dismounted: z.boolean().default(false),
  alive: z.boolean().default(true),
  /** carried_off: wounded and taken from the line; his part in the fight is over (Rank-and-File rule). */
  fate: z.enum(["fighting", "escaped", "killed", "captured", "carried_off"]).default("fighting"),
  /** Wounds carried into the battle (permanent ones bar him from riding with a file). */
  woundsAtStart: z.number().int().nonnegative().default(0),
  /** §4.1 personal combat delta, accumulated while the attached unit is Engaged. */
  personalDealt: z.number().default(0),
  personalTaken: z.number().default(0),
  /** Rank-and-File: when the attached unit breaks, hold the fate roll until the lord chooses how to meet it. */
  deferFate: z.boolean().default(false),
  pendingFate: z.object({ escaped: z.number(), killed: z.number(), captured: z.number() }).optional(),
  /** Vignette choices can skip or double next round's §8.7 wound roll. */
  woundRollMode: z.enum(["normal", "skip", "extra"]).default("normal"),
});
export type PlayerBattleState = z.infer<typeof PlayerBattleStateSchema>;

export const CommandPoolStateSchema = z.object({ total: z.number(), remaining: z.number() });

export const BATTLE_PHASES = ["deployment", "rounds", "day_end", "finished"] as const;
export type BattlePhase = (typeof BATTLE_PHASES)[number];

export const BATTLE_OUTCOMES = ["victory", "defeat", "draw", "withdrawn", "enemy_withdrew"] as const;
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

export const LOG_KINDS = [
  "phase",
  "deploy",
  "move",
  "engage",
  "fire",
  "strike",
  "shock",
  "morale",
  "rout",
  "structure",
  "rally",
  "player",
  "ai",
  "info",
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const BattleLogEntrySchema = z.object({
  seq: z.number().int(),
  round: z.number().int(),
  day: z.number().int(),
  kind: z.enum(LOG_KINDS),
  text: z.string(),
  unitId: z.string().optional(),
  targetId: z.string().optional(),
  /** Formula breakdown for the lab: effective ATK/DEF, multiplier, roll, damage, shares. */
  data: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
});
export type BattleLogEntry = z.infer<typeof BattleLogEntrySchema>;

export const BattleStateSchema = z.object({
  id: z.string(),
  seed: z.number().int(),
  rngState: z.number().int(),
  tier: z.enum(COMMAND_TIERS),
  phase: z.enum(BATTLE_PHASES).default("deployment"),
  round: z.number().int().default(0),
  day: z.number().int().default(1),
  battlefield: BattlefieldSchema,
  units: z.array(UnitInstanceSchema),
  player: PlayerBattleStateSchema,
  commandPool: CommandPoolStateSchema,
  log: z.array(BattleLogEntrySchema).default([]),
  outcome: z.enum(BATTLE_OUTCOMES).optional(),
  /** Set by the Reposition day-end choice; the caller supplies a new battlefield before resuming. */
  awaitingReposition: z.boolean().default(false),
});
export type BattleState = z.infer<typeof BattleStateSchema>;

// ---------------------------------------------------------------------------
// Orders (§8.2). Universal orders plus the ones tags unlock.
// ---------------------------------------------------------------------------

export const OrderSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), unitId: z.string(), to: CellSchema }),
  z.object({ type: z.literal("engage"), unitId: z.string(), targetId: z.string() }),
  z.object({
    type: z.literal("fire"),
    unitId: z.string(),
    targetId: z.string(),
    /** Cannon dual_shot_type: solid (structure) or grape (troops). */
    shot: z.enum(["solid", "grape"]).optional(),
  }),
  z.object({ type: z.literal("attack_structure"), unitId: z.string(), pointId: z.string() }),
  z.object({ type: z.literal("hold"), unitId: z.string() }),
  z.object({ type: z.literal("hold_formation"), unitId: z.string() }),
  z.object({ type: z.literal("skirmish_and_withdraw"), unitId: z.string(), targetId: z.string(), to: CellSchema }),
  z.object({ type: z.literal("rally"), unitId: z.string(), amount: z.number().positive() }),
  z.object({ type: z.literal("swap_presented"), unitId: z.string(), withUnitId: z.string() }),
]);
export type Order = z.infer<typeof OrderSchema>;
export type OrderType = Order["type"];

/** Order ids the registry's unlocksOrders may reference, checked against the schema list. */
export const ORDER_TYPE_SET: ReadonlySet<string> = new Set([...ORDER_IDS, "attack_structure", "move"]);
