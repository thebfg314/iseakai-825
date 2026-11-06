import { z } from "zod";
import { BattlefieldSchema, BattleStateSchema, COMMAND_TIERS } from "../combat/battleTypes";
import { TagDefSchema, UnitSheetSchema, WoundSchema } from "../combat/schema";
import { PLAYER_PERSONAL_BASELINE } from "../combat/constants";
import { HISTORY_STATE_DEFAULT, HistoryStateSchema } from "../history/schema";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const CANONICAL_RESOURCES = [
  "denarii",
  "wheat",
  "rye",
  "barley",
  "oats",
  "cattle",
  "sheep",
  "pigs",
  "horses",
  "poultry",
  "bees",
  "wine",
  "cheese",
  "honey",
  "wool",
  "linen",
  "softwood",
  "hardwood",
  "charcoal",
  "iron",
  "copper",
  "tin",
  "salt",
  "stone",
  "hides",
  "beeswax",
  "trade_goods",
] as const;
export type CanonicalResource = (typeof CANONICAL_RESOURCES)[number];

export const RESOURCE_UNITS: Record<CanonicalResource, string> = {
  denarii: "denarii",
  wheat: "modii",
  rye: "modii",
  barley: "modii",
  oats: "modii",
  cattle: "head",
  sheep: "head",
  pigs: "head",
  horses: "head",
  poultry: "head",
  bees: "hives",
  wine: "barrels",
  cheese: "pounds",
  honey: "pounds",
  wool: "pounds",
  linen: "pounds",
  softwood: "cart-loads",
  hardwood: "cart-loads",
  charcoal: "cart-loads",
  iron: "pounds",
  copper: "pounds",
  tin: "pounds",
  salt: "pounds",
  stone: "cart-loads",
  hides: "pieces",
  beeswax: "pounds",
  trade_goods: "units",
};

export const LAND_TYPES = [
  "fertile_arable",
  "meadow",
  "vineyard",
  "orchard",
  "woodland",
  "scrub",
  "waste",
  "swamp",
] as const;
export type LandType = (typeof LAND_TYPES)[number];

export const MODIFIER_TARGETS = [
  "grain_yield",
  "labour_efficiency",
  "spoilage",
  "project_speed",
  "specific_resource_output",
  "accident_risk",
  "mood",
  "market_price",
  "livestock_yield",
  "harvest_risk",
  "custom",
] as const;
export type ModifierTarget = (typeof MODIFIER_TARGETS)[number];

export const PriceRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});
export type PriceRange = z.infer<typeof PriceRangeSchema>;

export const ResourceMapSchema = z.object({
  denarii: z.number(),
  wheat: z.number(),
  rye: z.number(),
  barley: z.number(),
  oats: z.number(),
  cattle: z.number(),
  sheep: z.number(),
  pigs: z.number(),
  horses: z.number(),
  poultry: z.number(),
  bees: z.number(),
  wine: z.number(),
  cheese: z.number(),
  honey: z.number(),
  wool: z.number(),
  linen: z.number(),
  softwood: z.number(),
  hardwood: z.number(),
  charcoal: z.number(),
  iron: z.number(),
  copper: z.number(),
  tin: z.number(),
  salt: z.number(),
  stone: z.number(),
  hides: z.number(),
  beeswax: z.number(),
  trade_goods: z.number(),
});
export type ResourceMap = z.infer<typeof ResourceMapSchema>;

export const HoldingSchema = z.object({
  id: z.string(),
  name: z.string(),
  land: z.object({
    fertile_arable: z.number(),
    meadow: z.number(),
    vineyard: z.number(),
    orchard: z.number(),
    woodland: z.number(),
    scrub: z.number(),
    waste: z.number(),
    swamp: z.number(),
  }),
  sown: z.object({
    wheat: z.number(),
    rye: z.number(),
    barley: z.number(),
    oats: z.number(),
  }),
  households: z.number().int().nonnegative(),
  features: z.array(z.string()),
  /** Manses on the polyptych (03_HISTORY §4). Tributes and levies read free + servile. */
  manses: z
    .object({
      free: z.number().int().nonnegative().default(6),
      servile: z.number().int().nonnegative().default(4),
      vacant: z.number().int().nonnegative().default(4),
    })
    .default({ free: 6, servile: 4, vacant: 4 }),
  /**
   * How the villa is held (rank progression). Fontenay's own tenure lives in history.land; granted
   * villas carry it here. A benefice is lost when its patron falls or the lord is stripped.
   */
  tenure: z.enum(["owned", "benefice", "precaria"]).optional(),
  /** Who granted it (a benefice) — matched by forfeit effects. */
  grantedBy: z.string().optional(),
  grantedTurn: z.number().int().optional(),
  /** The lord's seat: where the fortification point stands. */
  seat: z.boolean().optional(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const CustomResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  amount: z.number(),
  priceMin: z.number(),
  priceMax: z.number(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type CustomResource = z.infer<typeof CustomResourceSchema>;

export const LabourAssignmentSchema = z.object({
  projectId: z.string(),
  men: z.number().nonnegative(),
  women: z.number().nonnegative(),
  youths: z.number().nonnegative(),
});
export type LabourAssignment = z.infer<typeof LabourAssignmentSchema>;

export const ProjectSeasonMarkSchema = z.object({
  year: z.number().int(),
  season: z.enum(SEASONS),
  labourDaysDone: z.number(),
  huntSeasonsElapsed: z.number().int().optional(),
  /** Seasons of the smith's own work, when this mark is his hands and not the village. */
  smithingSeasonsElapsed: z.number().int().optional(),
});
export type ProjectSeasonMark = z.infer<typeof ProjectSeasonMarkSchema>;

export const LabourPoolViewSchema = z.object({
  men: z.number(),
  women: z.number(),
  youths: z.number(),
});

export const EstateSeasonSnapshotSchema = z.object({
  year: z.number().int(),
  season: z.enum(SEASONS),
  turn: z.number().int(),
  region: z.string(),
  holdings: z.array(HoldingSchema),
  resources: ResourceMapSchema,
  custom_resources: z.array(CustomResourceSchema),
  population: z.object({
    households: z.number().int().nonnegative(),
    adult_men: z.number().int().nonnegative(),
    adult_women: z.number().int().nonnegative(),
    youths: z.number().int().nonnegative(),
    mancipia: z.number().int().nonnegative().optional(),
  }),
  agriculture: z.object({
    springBarleyShare: z.number().min(0).max(1),
    autumnWheatShare: z.number().min(0).max(1),
    rotation: z.enum(["two_field", "three_field"]).default("two_field"),
  }),
  last_season_deltas: z.record(z.string(), z.number()).default({}),
  flags: z.object({
    merchant_present: z.boolean(),
    hunger: z.boolean(),
  }),
  merchant: z.object({
    present: z.boolean(),
    name: z.string().optional(),
    stock: z.array(z.object({ resource: z.string(), amount: z.number() })).default([]),
  }),
  market: z.record(z.string(), PriceRangeSchema),
  npcs: z.array(z.object({ name: z.string(), role: z.string() })),
  known_techniques: z.array(z.object({ id: z.string(), name: z.string() })),
  labour: z
    .object({
      pool: LabourPoolViewSchema,
      remaining: LabourPoolViewSchema,
    })
    .optional(),
});
export type EstateSeasonSnapshot = z.infer<typeof EstateSeasonSnapshotSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  holdingId: z.string(),
  labourDaysRequired: z.number(),
  labourDaysDone: z.number(),
  materials: z.object({
    lumber: z.number(),
    iron: z.number(),
    stone: z.number(),
    /** Cart-loads of charcoal set aside. Older saves omit this. */
    charcoal: z.number().optional(),
    /** Cart-loads of clay dug with the work. Not a store. Older saves omit this. */
    clay: z.number().optional(),
  }),
  materialsReserved: z.boolean(),
  status: z.enum(["active", "completed", "cancelled"]),
  rush: z.boolean().optional(),
  tag: z.string().optional(),
  notes: z.string().optional(),
  /** Season the work was first written. Absent on older saves. */
  startedYear: z.number().int().optional(),
  startedSeason: z.enum(SEASONS).optional(),
  /** Season the work finished or was stopped. Absent while underway, or on older saves. */
  completedYear: z.number().int().optional(),
  completedSeason: z.enum(SEASONS).optional(),
  /** Labour (or hunt elapsed) as written at the close of each season of work. */
  seasonMarks: z.array(ProjectSeasonMarkSchema).optional(),
  /** Gerulf road-hunt: time and a purse, not labour-days. */
  hunt: z
    .object({
      goods: z.string(),
      resource: z.string(),
      amount: z.number(),
      /** Road the purse was priced on. Absent on older saves. */
      difficulty: z.enum(["easy", "medium", "difficult"]).optional(),
      quotedDenarii: z.number(),
      escrowedDenarii: z.number(),
      durationSeasons: z.number().int(),
      seasonsElapsed: z.number().int(),
      riskNote: z.string().optional(),
      unit: z.string().optional(),
      customName: z.string().optional(),
      customUnit: z.string().optional(),
      priceMin: z.number().optional(),
      priceMax: z.number().optional(),
      tags: z.array(z.string()).optional(),
      customNotes: z.string().optional(),
      reportSpeech: z.string().optional(),
      reportEmotion: z.string().optional(),
      reported: z.boolean().optional(),
    })
    .optional(),
  /**
   * His own smithing: seasons of the smith, not the village's spare days.
   * The same clock a road errand uses — duration and seasons already spent.
   */
  smithing: z
    .object({
      durationSeasons: z.number().int(),
      seasonsElapsed: z.number().int(),
      /**
       * Days at the hearth the piece needs, when the card named them. Older
       * saves and cards without forgeDays leave these out: labourDaysRequired
       * was his own time then, and the village was never called.
       */
      forgeDaysRequired: z.number().optional(),
      forgeDaysDone: z.number().optional(),
    })
    .optional(),
  /**
   * Goods added to the stores once, when the work is marked finished.
   * The amounts the chronicler named. Absent when the work pays nothing.
   */
  result: z
    .array(
      z.object({
        resource: z.string(),
        amount: z.number(),
        name: z.string().optional(),
        unit: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * The chronicler's judgment that this work finishes inside the season it was begun.
   * Absent means the books judge from the days and one season of spare labour.
   */
  finishesThisSeason: z.boolean().optional(),
  /** Set once the named result has been added to the stores. Cancel does not set this. */
  resultPaid: z.boolean().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ModifierSchema = z.object({
  id: z.string(),
  target: z.enum(MODIFIER_TARGETS),
  kind: z.enum(["temporary", "permanent"]),
  seasons_remaining: z.number().int().nullable().optional(),
  promote_on_expire: z.boolean().optional(),
  effect: z.object({
    op: z.enum(["multiply", "add", "set"]),
    value: z.number(),
  }),
  source: z.string(),
  risks: z.array(z.string()).optional(),
  holdingId: z.string().optional(),
  resourceId: z.string().optional(),
  customNote: z.string().optional(),
});
export type GameModifier = z.infer<typeof ModifierSchema>;

export const StandingOrderSchema = z.object({
  id: z.string(),
  text: z.string(),
  active: z.boolean(),
});
export type StandingOrder = z.infer<typeof StandingOrderSchema>;

export const NpcMemorySchema = z.object({
  turn: z.number().int(),
  year: z.number().int(),
  season: z.enum(SEASONS),
  summary: z.string(),
});
export type NpcMemory = z.infer<typeof NpcMemorySchema>;

export const NpcSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  location: z.string(),
  notes: z.string().optional(),
  memories: z.array(NpcMemorySchema).default([]),
  /** Engine first-meeting intro already shown this save. */
  introSpoken: z.boolean().optional(),
  /** Tab badge: they have news, an intro, or a waiting Confirm. Old saves default false. */
  wantsTalk: z.boolean().default(false),
});
export type Npc = z.infer<typeof NpcSchema>;

export const TechniqueSchema = z.object({
  id: z.string(),
  name: z.string(),
  discoveredTurn: z.number().int(),
  notes: z.string().optional(),
});
export type Technique = z.infer<typeof TechniqueSchema>;

export const FORTHCOMING_BEATS = ["after_harvest", "next_spring_sowing", "next_autumn_sowing"] as const;
export type ForthcomingBeat = (typeof FORTHCOMING_BEATS)[number];

export const ForthcomingOrderSchema = z.object({
  id: z.string(),
  npcId: z.string(),
  text: z.string(),
  beat: z.enum(FORTHCOMING_BEATS).optional(),
  seasonsRemaining: z.number().int().nonnegative().optional(),
  proposal: z.unknown(),
  status: z.enum(["waiting", "applied", "cancelled", "rejected"]).default("waiting"),
  createdTurn: z.number().int().optional(),
  createdSeason: z.enum(SEASONS).optional(),
  createdYear: z.number().int().optional(),
});
export type ForthcomingOrder = z.infer<typeof ForthcomingOrderSchema>;

/** A unit the estate owns between battles (raised/trained in Phase 4; empty until then). */
export const OwnedUnitSchema = z.object({
  id: z.string(),
  sheetId: z.string(),
  name: z.string(),
  veteran: z.boolean().default(false),
  strength: z.number().int().nonnegative(),
  raisedTurn: z.number().int().optional(),
});
export type OwnedUnit = z.infer<typeof OwnedUnitSchema>;

/** Men hired and under drill; becomes an OwnedUnit when the seasons are served (Phase 4). */
export const TrainingSchema = z.object({
  id: z.string(),
  sheetId: z.string(),
  name: z.string(),
  men: z.number().int().positive(),
  seasonsRequired: z.number().int().nonnegative(),
  seasonsElapsed: z.number().int().nonnegative().default(0),
  startedTurn: z.number().int(),
});
export type Training = z.infer<typeof TrainingSchema>;

export const BATTLE_CALL_KINDS = ["summons", "raid", "bandits", "history"] as const;
export type BattleCallKind = (typeof BATTLE_CALL_KINDS)[number];

/** How the lord takes the field in a history battle (03_HISTORY §9, age bands). */
export const HISTORY_RIDE_MODES = ["attached", "unattached", "captain"] as const;
export type HistoryRideMode = (typeof HISTORY_RIDE_MODES)[number];

/** An open call to arms raised by a season event; answered or refused from the hall. */
export const BattleCallSchema = z.object({
  kind: z.enum(BATTLE_CALL_KINDS),
  eventId: z.string(),
  text: z.string(),
  seed: z.number().int(),
  createdTurn: z.number().int(),
  /** History battles: the forces entry in data/history/battles.json. */
  historyId: z.string().optional(),
  /** History battles: attached in a file, commanding from behind the line, or by letter through a captain. */
  mode: z.enum(HISTORY_RIDE_MODES).optional(),
  /** History battles: the muster panel's line on how he rides. */
  note: z.string().optional(),
  /** Home defence raised by a supply check: the share of stores lost if he bars the hall or loses. */
  supply: z.object({ situation: z.string(), share: z.number().min(0).max(1) }).optional(),
});
export type BattleCall = z.infer<typeof BattleCallSchema>;

export const BATTLE_NARRATION_KINDS = ["scene", "bridge", "card", "choice", "result", "engine", "aftermath", "orders"] as const;

export const BattleNarrationSchema = z.object({
  id: z.string(),
  kind: z.enum(BATTLE_NARRATION_KINDS),
  round: z.number().int(),
  text: z.string(),
  /** For "card": the vignette id; for "choice": the option key. */
  ref: z.string().optional(),
});
export type BattleNarration = z.infer<typeof BattleNarrationSchema>;

export const OBJECTIVE_KINDS = ["hold_column", "break_unit", "protect_unit", "advance", "keep_whole"] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/** A Sub-Command objective (design doc §4.2): engine-checkable facts, commander's words from the narrator. */
export const ObjectiveSchema = z.object({
  id: z.string(),
  kind: z.enum(OBJECTIVE_KINDS),
  /** Column index for hold_column / advance; unit id for break_unit / protect_unit. */
  target: z.string().optional(),
  /** Round by which advance must be achieved; hold_column must last until this round. */
  byRound: z.number().int().optional(),
  difficulty: z.number().int().min(1).max(3),
  /** The commander's order, as spoken. */
  text: z.string(),
  status: z.enum(["active", "success", "failed"]).default("active"),
  issuedRound: z.number().int(),
  resolvedRound: z.number().int().optional(),
  bonus: z.number().optional(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

/** Rank-and-File vignette progress and the narrated transcript, saved with the battle. */
export const BattleSessionSchema = z.object({
  tier: z.enum(COMMAND_TIERS),
  callKind: z.enum(BATTLE_CALL_KINDS),
  phase: z.enum(["muster", "scouting", "deployment", "fighting", "aftermath", "closed"]).default("muster"),
  broughtUnitIds: z.array(z.string()).default([]),
  /** Men the lord's sworn vassals brought to this field (history/vassals.ts); 0 when none rode. */
  swornMen: z.number().int().nonnegative().default(0),
  /** Men of his own files as they rode out (the hall's measure of how he equips them). */
  ownMen: z.number().int().nonnegative().default(0),
  /** Full Command §9.5 Scouting Duel in progress. */
  scouting: z
    .object({
      pool: z.array(BattlefieldSchema),
      /** Who won the coin flip. */
      winner: z.enum(["player", "enemy"]),
      /** The lord's role once assigned; null while the winner (the lord) is still choosing. */
      role: z.enum(["narrower", "finalizer"]).nullable(),
      shortlist: z.array(BattlefieldSchema).default([]),
      stage: z.enum(["choose_role", "narrow", "finalize", "done"]),
    })
    .nullable()
    .default(null),
  /** Full Command §8.6: nightfall, the lord must choose; a reposition offers new ground to pick. */
  dayEndPending: z.boolean().default(false),
  repositionPool: z.array(BattlefieldSchema).default([]),
  /** Encounter rosters kept until deployment builds the battle. */
  pendingEncounter: z
    .object({
      allies: z.array(z.unknown()),
      enemy: z.array(z.unknown()),
      premise: z.string(),
    })
    .nullable()
    .default(null),
  drawn: z.array(z.string()).default([]),
  openingDone: z.boolean().default(false),
  crisisDraws: z.number().int().default(0),
  turningDone: z.boolean().default(false),
  routCardDone: z.boolean().default(false),
  /** Card currently shown, awaiting the lord's choice. */
  pendingCard: z
    .object({
      vignetteId: z.string(),
      bridge: z.string(),
    })
    .nullable()
    .default(null),
  /** Attached unit broke: its escape/kill/capture split is held until the lord chooses how to meet it. */
  pendingRout: z
    .object({
      escaped: z.number(),
      killed: z.number(),
      captured: z.number(),
      narration: z.string(),
    })
    .nullable()
    .default(null),
  /** Positioning bias for the lord's unit next round: −1 hold back, +1 press ahead. */
  engageBias: z.number().int().default(0),
  /** Flags set by vignette choices for the narrative layer (took_prisoner, spared_rival, …). */
  characterFlags: z.array(z.string()).default([]),
  /** §4.1 discrete card awards (Low 3 / Medium 10 / High 30), summed across the battle. */
  cardRenown: z.number().default(0),
  /** Encounter premise handed to the narrator. */
  premise: z.string().default(""),
  encounterSeed: z.number().int().default(0),
  lastDrawRound: z.number().int().default(0),
  /** Battle log seq already covered by narration, so a bridge only tells what is new. */
  lastNarratedSeq: z.number().int().default(0),
  narration: z.array(BattleNarrationSchema).default([]),
  /** Sub-/Full Command: objectives issued by the commander, in order. */
  objectives: z.array(ObjectiveSchema).default([]),
  /** Sum of objective bonuses at aftermath (§4.2 Objective_bonus). */
  objectiveBonus: z.number().default(0),
  /** Common captives that are the lord's own to settle as unfree or sell (only when the fight was his alone). */
  prisonersHeld: z.number().int().nonnegative().default(0),
  /** Set once aftermath has been narrated and the ledger written. */
  aftermathText: z.string().optional(),
  renownDelta: z.number().optional(),
  /** History battles (03_HISTORY §9): which forces entry, how the lord rides, and what the abstract layer has already done. */
  historical: z
    .object({
      id: z.string(),
      eventId: z.string(),
      mode: z.enum(HISTORY_RIDE_MODES),
      /** Indices into the forces entry's `abstract` list already applied. */
      abstractApplied: z.array(z.number().int()).default([]),
      /** The king-quest betrayer has turned. */
      betrayed: z.boolean().default(false),
      supply: z.object({ situation: z.string(), share: z.number().min(0).max(1) }).optional(),
    })
    .nullable()
    .default(null),
});
export type BattleSession = z.infer<typeof BattleSessionSchema>;

export const BattleRecordSchema = z.object({
  id: z.string(),
  turn: z.number().int(),
  year: z.number().int(),
  season: z.enum(SEASONS),
  kind: z.enum(BATTLE_CALL_KINDS),
  tier: z.enum(COMMAND_TIERS),
  outcome: z.string(),
  rounds: z.number().int(),
  renownDelta: z.number(),
  summary: z.string(),
  /** Heart dealt and taken by the files the lord commanded (the renown formula's two halves). */
  moraleDealt: z.number().optional(),
  moraleTaken: z.number().optional(),
  /** Men of his own he brought, and the manses he held that day: what the hall measures his equipping against. */
  ownMen: z.number().int().nonnegative().optional(),
  manses: z.number().int().nonnegative().optional(),
  /** A captain carried his orders; the day says nothing of his own handling. */
  captain: z.boolean().optional(),
});
export type BattleRecord = z.infer<typeof BattleRecordSchema>;

export const ChurchNeglectKindSchema = z.enum(["tithe", "wool", "sheep", "sunday", "feast_day", "took_from_cell"]);

export const ChurchNeglectSlipSchema = z.object({
  turn: z.number().int(),
  year: z.number().int(),
  season: z.enum(SEASONS),
  kind: ChurchNeglectKindSchema,
  note: z.string(),
});

export const ChurchLetterSchema = z.object({
  id: z.string(),
  year: z.number().int(),
  season: z.enum(SEASONS),
  turn: z.number().int(),
  text: z.string(),
});

export const ChurchStateSchema = z.object({
  /** `year-season` of the sponsored feast already kept. Empty if none this season. */
  feastHeldKey: z.string().default(""),
  /** Joy from that feast which cools on the next Advance season. Half of what was given. */
  feastFade: z.number().int().nonnegative().default(0),
  neglect: z.array(ChurchNeglectSlipSchema).default([]),
  bishopLetterTurn: z.number().int().nullable().default(null),
  letters: z.array(ChurchLetterSchema).default([]),
  /** Lasting note the household hears after the bishop writes. Empty until then. */
  reputation: z.string().default(""),
  almsTurn: z.number().int().nullable().default(null),
  surplusSeasonKey: z.string().default(""),
  surplusSold: z.record(z.string(), z.number()).default({}),
});
export type ChurchState = z.infer<typeof ChurchStateSchema>;

const CHURCH_STATE_DEFAULT: ChurchState = {
  feastHeldKey: "",
  feastFade: 0,
  neglect: [],
  bishopLetterTurn: null,
  letters: [],
  reputation: "",
  almsTurn: null,
  surplusSeasonKey: "",
  surplusSold: {},
};

export const WorldStateSchema = z.object({
  meta: z.object({
    year: z.number().int(),
    season: z.enum(SEASONS),
    turn: z.number().int().min(1),
    region: z.string(),
    eraNote: z.string().optional(),
  }),
  player: z.object({
    name: z.string(),
    /** Legacy label kept for prompts and old saves; the combat rank is rankLevel. */
    rank: z.string().default("minor_noble"),
    /** §5.2.1 rank 1–5 (Minor Noble … King). Titles are sticky. Old saves default to 1. */
    rankLevel: z.number().int().min(1).max(5).default(1),
    /** §5.2.1 accumulating Renown, floor 1. */
    renown: z.number().min(1).default(1),
    /** §5.2 persistent wounds. */
    wounds: z.array(WoundSchema).default([]),
    /** Personal combat baseline (vignette file). */
    personal: z
      .object({
        hp: z.number(),
        maxHp: z.number(),
        atk: z.number(),
        def: z.number(),
        damage: z.object({ min: z.number(), max: z.number() }),
      })
      .default({
        hp: PLAYER_PERSONAL_BASELINE.hp,
        maxHp: PLAYER_PERSONAL_BASELINE.hp,
        atk: PLAYER_PERSONAL_BASELINE.atk,
        def: PLAYER_PERSONAL_BASELINE.def,
        damage: { ...PLAYER_PERSONAL_BASELINE.damage },
      }),
    /** Won a Command Claim; may hold Full Command when eligible for Sub-Command. */
    fullCommandGranted: z.boolean().default(false),
    /** Killed in battle: the game is over. */
    dead: z.boolean().default(false),
    /** Two wounds that never healed: too maimed to fight or rule. The game is over. */
    maimed: z.boolean().default(false),
    /** Taken in battle and the ransom could not be met: he stays in his captors' hands. The game is over. */
    captive: z.boolean().default(false),
    /** Body age in 825. The lord is a modern man set down in this year; no birth year is shown (03_HISTORY §4). */
    ageAt825: z.number().int().min(10).max(60).default(17),
  }),
  /** Units the estate owns between battles, men under drill, and campaign-invented sheets (Phase 4). */
  military: z
    .object({
      units: z.array(OwnedUnitSchema).default([]),
      training: z.array(TrainingSchema).default([]),
      customSheets: z.array(UnitSheetSchema).default([]),
      customTags: z.array(TagDefSchema).default([]),
    })
    .default({ units: [], training: [], customSheets: [], customTags: [] }),
  /** Live battle, persisted so a save mid-fight resumes. */
  battle: BattleStateSchema.nullable().default(null),
  battle_session: BattleSessionSchema.nullable().default(null),
  battle_call: BattleCallSchema.nullable().default(null),
  battle_history: z.array(BattleRecordSchema).default([]),
  holdings: z.array(HoldingSchema),
  resources: ResourceMapSchema,
  custom_resources: z.array(CustomResourceSchema),
  population: z.object({
    households: z.number().int().nonnegative(),
    adult_men: z.number().int().nonnegative(),
    adult_women: z.number().int().nonnegative(),
    youths: z.number().int().nonnegative(),
    mancipia: z.number().int().nonnegative().optional(),
  }),
  labour: z.object({
    assigned: z.array(LabourAssignmentSchema),
    harvest_risk: z.boolean(),
  }),
  market: z.record(z.string(), PriceRangeSchema),
  projects: z.array(ProjectSchema),
  modifiers: z.array(ModifierSchema),
  standing_orders: z.array(StandingOrderSchema),
  npcs: z.array(NpcSchema),
  known_techniques: z.array(TechniqueSchema),
  flags: z.object({
    merchant_present: z.boolean(),
    active_threat: z.boolean(),
    monastery_nearby: z.boolean(),
    hunger: z.boolean(),
    /**
     * Pagus-wide dearth. An event may set this later. False means hunger, if any,
     * is this villa's own. The cell will not open its barn in a regional famine.
     */
    regional_famine: z.boolean().default(false),
  }),
  trade: z
    .object({
      major_river: z.boolean().default(false),
      major_road: z.boolean().default(false),
      known_surplus: z.boolean().default(false),
      remote: z.boolean().default(false),
    })
    .default({ major_river: false, major_road: false, known_surplus: false, remote: false }),
  merchant: z
    .object({
      present: z.boolean().default(false),
      name: z.string().optional(),
      face: z.number().int().min(1).max(8).optional(),
      last_chance: z.number().optional(),
      stock: z.array(z.object({ resource: z.string(), amount: z.number() })).default([]),
      /** Remaining denarii this visitor will pay for estate goods this visit. */
      purse: z.number().nonnegative().optional(),
      purseStart: z.number().nonnegative().optional(),
      /** 0–1 demand that visit; stretches bulk step sizes inside category ranges. */
      demand: z.number().min(0).max(1).optional(),
      /** Goods the player sold them this visit, kept at the exact sale price for buyback. */
      buyback: z
        .array(
          z.object({
            resource: z.string(),
            amount: z.number(),
            pricePerUnit: z.number(),
          }),
        )
        .default([]),
      boughtVolume: z.record(z.string(), z.number()).default({}),
      soldVolume: z.record(z.string(), z.number()).default({}),
      purseDrained: z.boolean().optional(),
    })
    .default({ present: false, stock: [] }),
  /** Visiting merchants leave npcs[]; bargains persist here by visitor name (Isaac, Gero, …). */
  merchant_memories: z.record(z.string(), z.array(NpcMemorySchema)).default({}),
  /** First-meeting intro already shown, by visitor name, so Isaac does not re-introduce on a later visit. */
  merchant_intro_spoken: z.record(z.string(), z.boolean()).default({}),
  /** Extra buying power on the next visit, keyed by visitor name, after a drained purse. */
  merchant_purse_bonus: z.record(z.string(), z.number()).default({}),
  agriculture: z
    .object({
      springBarleyShare: z.number().min(0).max(1).default(0.6),
      autumnWheatShare: z.number().min(0).max(1).default(0.45),
      rotation: z.enum(["two_field", "three_field"]).default("two_field"),
    })
    .default({ springBarleyShare: 0.6, autumnWheatShare: 0.45, rotation: "two_field" }),
  /** Signed store / sown / household changes from the last Advance season. Empty on a fresh game. */
  last_season_deltas: z.record(z.string(), z.number()).default({}),
  /**
   * Estate-wide people's happiness (0 wretched … 100 joyful). Source of truth for
   * morale. Modifier target `mood` nudges this meter (on confirm, and each season
   * while the custom lasts); it does not scale yield or callable labour. Old saves
   * default to 50.
   */
  peopleHappiness: z.number().min(0).max(100).default(50),
  /**
   * Consecutive Advance seasons the meter has stayed joyful (≥75) or wretched (≤24).
   * Old saves default to 0.
   */
  peopleHappinessHighStreak: z.number().int().nonnegative().default(0),
  peopleHappinessLowStreak: z.number().int().nonnegative().default(0),
  /**
   * True when the demesne people are gone and the villa cannot be worked. Old saves default false.
   */
  estateAbandoned: z.boolean().default(false),
  /** Closed seasons' estate books, oldest first. Empty until the first Advance season. */
  estate_history: z.array(EstateSeasonSnapshotSchema).default([]),
  /**
   * Confirmed mechanical changes waiting on a later season beat.
   * Old saves default to [].
   */
  forthcoming_orders: z.array(ForthcomingOrderSchema).default([]),
  /**
   * Cell of Saint-Martin: feasts, neglect, the bishop's letters, alms, surplus sold.
   * Old saves default to a quiet cell.
   */
  church: ChurchStateSchema.default(CHURCH_STATE_DEFAULT),
  /**
   * The opening tutorial. A fresh estate is "offered" (starting-estate.json);
   * a save written before the tutorial existed is mid-game and defaults to "declined".
   */
  tutorial: z
    .object({
      status: z.enum(["offered", "active", "done", "declined"]).default("declined"),
      step: z.number().int().nonnegative().default(0),
    })
    .default({ status: "declined", step: 0 }),
  /** The dated historical calendar and its background systems (03_HISTORY.md). Old saves load as "nothing has fired". */
  history: HistoryStateSchema.default(HISTORY_STATE_DEFAULT),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const PROPOSAL_TYPES = [
  "assign_labour",
  "set_standing_order",
  "start_project",
  "adjust_project",
  "adjust_sowing",
  "transfer_resources",
  "add_modifier",
  "remove_modifier",
  "register_resource",
  "register_feature",
  "register_npc",
  "event_effect",
  "start_hunt",
  "settle_households",
  "defer_proposal",
  "raise_unit",
  "disband_unit",
  "call_to_arms",
  "register_unit_sheet",
  "free_mancipia",
  "sponsor_feast",
  "history_choice",
  "history_hook",
  "history_outcome",
  "history_scene",
  "innovation_register",
  "innovation_expose",
  "vassal_mood",
  "justice_verdict",
  "set_stance",
  "steward_office",
  "household_upkeep",
  "giving_stance",
  "vassal_gift",
  "vassal_occasion",
  "church_endowment",
  "church_purchase",
  "marriage",
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

const ProposalBase = z.object({
  id: z.string().optional(),
  summary: z.string().default("Proposed change"),
  requiresConfirm: z.boolean().optional(),
});

export const AssignLabourProposalSchema = ProposalBase.extend({
  type: z.literal("assign_labour"),
  holdingId: z.string().optional(),
  projectId: z.string(),
  men: z.coerce.number().nonnegative().default(0),
  women: z.coerce.number().nonnegative().default(0),
  youths: z.coerce.number().nonnegative().default(0),
});

export const SetStandingOrderProposalSchema = ProposalBase.extend({
  type: z.literal("set_standing_order"),
  orderId: z.string().optional(),
  text: z.string(),
  active: z.boolean().default(true),
});

export const ProjectResultEntrySchema = z.object({
  resource: z.string().min(1),
  amount: z.coerce.number(),
  name: z.string().optional(),
  unit: z.string().optional(),
});
export type ProjectResultEntry = z.infer<typeof ProjectResultEntrySchema>;

/**
 * A result may arrive as a list of stores, or as an object of resource → amount
 * (or resource → { amount, name, unit }). Junk is dropped so one bad figure
 * does not throw out the whole work.
 */
function coerceProjectResult(val: unknown): unknown {
  if (val == null || val === "") return [];
  const items: { resource: string; amount: number; name?: string; unit?: string }[] = [];
  const push = (resource: unknown, raw: unknown) => {
    if (typeof resource !== "string" || !resource.trim()) return;
    let amount: unknown = raw;
    let name: string | undefined;
    let unit: string | undefined;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const row = raw as Record<string, unknown>;
      amount = row.amount ?? row.qty ?? row.value;
      if (typeof row.name === "string" && row.name.trim()) name = row.name.trim();
      if (typeof row.unit === "string" && row.unit.trim()) unit = row.unit.trim();
    }
    const n = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : NaN;
    if (!Number.isFinite(n)) return;
    items.push({ resource: resource.trim(), amount: n, ...(name ? { name } : {}), ...(unit ? { unit } : {}) });
  };
  if (Array.isArray(val)) {
    for (const row of val) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const o = row as Record<string, unknown>;
      push(o.resource ?? o.id ?? o.good ?? o.store, o);
    }
    return items;
  }
  if (typeof val === "object") {
    for (const [resource, raw] of Object.entries(val as Record<string, unknown>)) push(resource, raw);
    return items;
  }
  return [];
}

export const ProjectResultSchema = z.preprocess(coerceProjectResult, z.array(ProjectResultEntrySchema)).optional();

export const StartProjectProposalSchema = ProposalBase.extend({
  type: z.literal("start_project"),
  projectKey: z.string(),
  holdingId: z.string().optional(),
  name: z.string().optional(),
  customCosts: z
    .object({
      /** The village's spare days (woodwork, hauling, building). May be 0 on a smith's own piece. */
      labourDays: z.coerce.number(),
      /** The smith's own days at the hearth. Present on his cards; the books turn it into seasons at 70 a season. */
      forgeDays: z.coerce.number().optional(),
      /** A new design that needs no timber, iron, or stone may leave those out; they read as 0. */
      lumber: z.coerce.number().default(0),
      iron: z.coerce.number().default(0),
      stone: z.coerce.number().default(0),
      /** Cart-loads. A new design only; a catalogue key keeps its own charcoal charge. */
      charcoal: z.coerce.number().optional(),
      /** Coin taken from the chest when a new design begins. */
      denarii: z.coerce.number().optional(),
    })
    .optional(),
  /** Goods the stores gain once, when this work is finished. Omitted when it pays nothing. */
  result: ProjectResultSchema,
  /**
   * True when this work finishes inside the season, false when it runs past it.
   * Omitted, the books judge from the days and one season of spare labour.
   */
  finishesThisSeason: z.preprocess((val) => {
    if (val == null || val === "") return undefined;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const s = val.trim().toLowerCase();
      if (s === "true" || s === "yes") return true;
      if (s === "false" || s === "no") return false;
    }
    return undefined;
  }, z.boolean().optional()),
  tag: z.string().optional(),
  notes: z.string().optional(),
});

export const AdjustProjectProposalSchema = ProposalBase.extend({
  type: z.literal("adjust_project"),
  projectId: z.string(),
  rush: z.boolean().optional(),
  cancel: z.boolean().optional(),
  labourThisSeason: z
    .object({
      men: z.coerce.number().nonnegative(),
      women: z.coerce.number().nonnegative(),
      youths: z.coerce.number().nonnegative(),
    })
    .optional(),
});

export const AdjustSowingProposalSchema = ProposalBase.extend({
  type: z.literal("adjust_sowing"),
  holdingId: z.string().optional(),
  springBarleyShare: z.coerce.number().min(0).max(1).optional(),
  autumnWheatShare: z.coerce.number().min(0).max(1).optional(),
  wheat: z.coerce.number().nonnegative().optional(),
  rye: z.coerce.number().nonnegative().optional(),
  barley: z.coerce.number().nonnegative().optional(),
  oats: z.coerce.number().nonnegative().optional(),
  rotation: z.enum(["two_field", "three_field"]).optional(),
});

export const TransferResourcesProposalSchema = ProposalBase.extend({
  type: z.literal("transfer_resources"),
  resource: z.string(),
  amount: z.coerce.number(),
  direction: z.enum(["buy", "sell", "consume", "gain"]),
  pricePerUnit: z.coerce.number().optional(),
  reason: z.string().optional(),
});

export const AddModifierProposalSchema = ProposalBase.extend({
  type: z.literal("add_modifier"),
  target: z.enum(MODIFIER_TARGETS),
  kind: z.enum(["temporary", "permanent"]),
  seasonsRemaining: z.coerce.number().int().optional(),
  promoteOnExpire: z.boolean().optional(),
  effect: z.object({
    op: z.enum(["multiply", "add", "set"]),
    value: z.coerce.number(),
  }),
  source: z.string(),
  risks: z.array(z.string()).optional(),
  holdingId: z.string().optional(),
  resourceId: z.string().optional(),
  customNote: z.string().optional(),
  techniqueName: z.string().optional(),
});

export const RemoveModifierProposalSchema = ProposalBase.extend({
  type: z.literal("remove_modifier"),
  modifierId: z.string(),
});

export const RegisterResourceProposalSchema = ProposalBase.extend({
  type: z.literal("register_resource"),
  resourceId: z.string(),
  name: z.string(),
  unit: z.string(),
  priceMin: z.coerce.number(),
  priceMax: z.coerce.number(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  initialAmount: z.coerce.number().optional(),
  isNew: z.literal(true).default(true),
});

export const RegisterFeatureProposalSchema = ProposalBase.extend({
  type: z.literal("register_feature"),
  holdingId: z.string(),
  feature: z.string(),
  isNew: z.literal(true).default(true),
});

export const RegisterNpcProposalSchema = ProposalBase.extend({
  type: z.literal("register_npc"),
  npc: NpcSchema,
  isNew: z.literal(true).default(true),
});

export const EventEffectProposalSchema = ProposalBase.extend({
  type: z.literal("event_effect"),
  eventId: z.string(),
  nested: z.array(z.unknown()).optional(),
  resource: z.string().optional(),
  amount: z.coerce.number().optional(),
  direction: z.enum(["buy", "sell", "consume", "gain"]).optional(),
  moodDelta: z.coerce.number().optional(),
});

export const SettleHouseholdsProposalSchema = ProposalBase.extend({
  type: z.literal("settle_households"),
  households: z.coerce.number().int().positive().default(1),
  adult_men: z.coerce.number().int().nonnegative().default(1),
  adult_women: z.coerce.number().int().nonnegative().default(1),
  youths: z.coerce.number().int().nonnegative().default(1),
});

export const SponsorFeastProposalSchema = ProposalBase.extend({
  type: z.literal("sponsor_feast"),
  tier: z.enum(["plain", "grand"]),
  feastName: z.string().optional(),
});

export const StartHuntProposalSchema = ProposalBase.extend({
  type: z.literal("start_hunt"),
  goods: z.string(),
  resource: z.string(),
  amount: z.coerce.number().positive(),
  /** easy 1.1, medium 1.4, difficult 1.7. The engine prices the purse; this is the only cost choice. */
  difficulty: z.enum(["easy", "medium", "difficult"]).optional(),
  quotedDenarii: z.coerce.number().positive(),
  durationSeasons: z.coerce.number().int().min(1).max(8),
  riskNote: z.string().optional(),
  unit: z.string().optional(),
  customName: z.string().optional(),
  customUnit: z.string().optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  tags: z.array(z.string()).optional(),
  customNotes: z.string().optional(),
});

/** Raise a unit from the villa's men (levy) or hire and drill professionals (Phase 4). */
export const RaiseUnitProposalSchema = ProposalBase.extend({
  type: z.literal("raise_unit"),
  sheetId: z.string(),
  men: z.coerce.number().int().positive(),
  name: z.string().optional(),
});

export const DisbandUnitProposalSchema = ProposalBase.extend({
  type: z.literal("disband_unit"),
  unitId: z.string(),
});

/** Eberhard's door: ride out against a threat now rather than wait for the season. */
export const CallToArmsProposalSchema = ProposalBase.extend({
  type: z.literal("call_to_arms"),
  kind: z.enum(BATTLE_CALL_KINDS),
});

/** An invented unit (design doc §1/§6): data only, validated against the closed hook vocabulary on apply. */
export const RegisterUnitSheetProposalSchema = ProposalBase.extend({
  type: z.literal("register_unit_sheet"),
  sheet: z.unknown(),
  newTags: z.array(z.unknown()).default([]),
  rationale: z.string().optional(),
  isNew: z.literal(true).default(true),
});

/** Manumission (Constitution §4.3): N of the unfree become free tenants of the villa. */
export const FreeMancipiaProposalSchema = ProposalBase.extend({
  type: z.literal("free_mancipia"),
  count: z.coerce.number().int().positive(),
});

/** History layer (03_HISTORY §6.3): the lord has decided a declared choice on a dated event. */
export const HistoryChoiceProposalSchema = ProposalBase.extend({
  type: z.literal("history_choice"),
  eventId: z.string(),
  optionId: z.string(),
});

/** History layer: the lord's words plainly did what a declared hook describes. */
export const HistoryHookProposalSchema = ProposalBase.extend({
  type: z.literal("history_hook"),
  eventId: z.string(),
  hookId: z.string(),
});

/** History layer: the household's judgement of a momentum outcome, from the closed list. */
export const HistoryOutcomeProposalSchema = ProposalBase.extend({
  type: z.literal("history_outcome"),
  eventId: z.string(),
  outcomeId: z.string(),
  reasoning: z.string().optional(),
});

/** History layer: a live scene moves on, optionally with the stage's choice. */
export const HistorySceneProposalSchema = ProposalBase.extend({
  type: z.literal("history_scene"),
  eventId: z.string(),
  advance: z.boolean().default(true),
  choiceId: z.string().optional(),
});

/** Technology diffusion (03_HISTORY §12): a new thing the lord has introduced is on the record. */
export const InnovationRegisterProposalSchema = ProposalBase.extend({
  type: z.literal("innovation_register"),
  innovationId: z.string(),
  name: z.string(),
  legibility: z.enum(["obvious", "puzzling", "opaque"]),
  reproduction: z.enum(["trivial", "craftsman", "capital", "programme"]),
  proof: z.enum(["self", "season", "cycles", "generation"]),
  writtenDown: z.boolean().default(false),
});

export const INNOVATION_EXPOSURES = ["taught", "sold", "public_use", "battle_allies", "monks_copied", "shown_king", "espionage"] as const;

/** Technology diffusion: an innovation was shown to the world in one of the declared ways. */
export const InnovationExposeProposalSchema = ProposalBase.extend({
  type: z.literal("innovation_expose"),
  innovationId: z.string(),
  how: z.enum(INNOVATION_EXPOSURES),
});

/** Vassals (03_HISTORY §10a): Aldric's reading of how the lord's words sat with a sworn man, or with all of them. */
export const VassalMoodProposalSchema = ProposalBase.extend({
  type: z.literal("vassal_mood"),
  /** A vassal id from the HISTORY block, or "all". */
  vassalId: z.string().min(1),
  delta: z.number().int().min(-15).max(15),
  reason: z.string().min(1),
});

/** Justice (03_HISTORY §10b): the lord's judgement on the case before the hall, from the closed list the speaker was given. */
export const JusticeVerdictProposalSchema = ProposalBase.extend({
  type: z.literal("justice_verdict"),
  caseId: z.string().min(1),
  verdictId: z.string().min(1),
});

/** How the lord's officers judge in his name (Count+), or how his tolls are set on the roads. */
export const SetStanceProposalSchema = ProposalBase.extend({
  type: z.literal("set_stance"),
  kind: z.enum(["justice", "tolls"]),
  stance: z.enum(["lenient", "fair", "strict", "extortionate", "low", "customary", "greedy"]),
});

/** Administration (03_HISTORY §10c): raise Aldric, let him hire clerks, or name a regional deputy (Duke+). */
export const StewardOfficeProposalSchema = ProposalBase.extend({
  type: z.literal("steward_office"),
  action: z.enum(["promote", "hire", "deputy"]),
  name: z.string().optional(),
});

/** Household style (upkeep.ts): cut up to 10 points off the rank's household share. The household itself is not optional. */
export const HouseholdUpkeepProposalSchema = ProposalBase.extend({
  type: z.literal("household_upkeep"),
  /** Points below the rank's household share, 0 (as a lord of this rank is expected to keep) through 10. */
  cut: z.coerce.number().int().min(0).max(10),
});

/** How openly the hall gives, inside the household bill. */
export const GivingStanceProposalSchema = ProposalBase.extend({
  type: z.literal("giving_stance"),
  level: z.enum(["lean", "customary", "generous"]),
});

/** A thing given to one sworn man. Negotiation is remembered as a bribe. */
export const VassalGiftProposalSchema = ProposalBase.extend({
  type: z.literal("vassal_gift"),
  vassalId: z.string().min(1),
  kind: z.enum(["horse", "mail", "sword", "bird", "cup", "cloak", "relic"]),
  occasion: z.enum(["ordinary", "wedding", "confirm", "funeral", "victory", "birth", "negotiation"]).default("ordinary"),
});

/** The open wedding, confirmation, funeral, victory, birth, or holy-day distribution. */
export const VassalOccasionProposalSchema = ProposalBase.extend({
  type: z.literal("vassal_occasion"),
  option: z.enum(["snub", "token", "customary", "lavish"]),
});

export const ChurchEndowmentProposalSchema = ProposalBase.extend({
  type: z.literal("church_endowment"),
  kind: z.enum(["repair", "chapel", "monastery", "major_house", "immunity"]),
});

export const ChurchPurchaseProposalSchema = ProposalBase.extend({
  type: z.literal("church_purchase"),
  aim: z.enum(["judgment", "support", "annulment", "absolution"]),
});

/** Marriage (marriage.ts): the lord's word on one of four matches, or a visit in person to the widow (court). Aldric only. */
export const MarriageProposalSchema = ProposalBase.extend({
  type: z.literal("marriage"),
  archetype: z.enum(["hildegard", "theoderada", "gisla", "linda"]),
  action: z.enum(["marry", "court"]).default("marry"),
});

export const InnerMechanicalProposalSchema = z.discriminatedUnion("type", [
  VassalMoodProposalSchema,
  JusticeVerdictProposalSchema,
  SetStanceProposalSchema,
  StewardOfficeProposalSchema,
  MarriageProposalSchema,
  HouseholdUpkeepProposalSchema,
  GivingStanceProposalSchema,
  VassalGiftProposalSchema,
  VassalOccasionProposalSchema,
  ChurchEndowmentProposalSchema,
  ChurchPurchaseProposalSchema,
  FreeMancipiaProposalSchema,
  RaiseUnitProposalSchema,
  DisbandUnitProposalSchema,
  CallToArmsProposalSchema,
  RegisterUnitSheetProposalSchema,
  AssignLabourProposalSchema,
  SetStandingOrderProposalSchema,
  StartProjectProposalSchema,
  AdjustProjectProposalSchema,
  AdjustSowingProposalSchema,
  TransferResourcesProposalSchema,
  AddModifierProposalSchema,
  RemoveModifierProposalSchema,
  RegisterResourceProposalSchema,
  RegisterFeatureProposalSchema,
  RegisterNpcProposalSchema,
  EventEffectProposalSchema,
  StartHuntProposalSchema,
  SettleHouseholdsProposalSchema,
  SponsorFeastProposalSchema,
  HistoryChoiceProposalSchema,
  HistoryHookProposalSchema,
  HistoryOutcomeProposalSchema,
  HistorySceneProposalSchema,
  InnovationRegisterProposalSchema,
  InnovationExposeProposalSchema,
]);

export const DeferProposalSchema = ProposalBase.extend({
  type: z.literal("defer_proposal"),
  beat: z.enum(FORTHCOMING_BEATS).optional(),
  seasonsRemaining: z.coerce.number().int().min(1).optional(),
  applyAfterSeasons: z.coerce.number().int().min(1).optional(),
  trigger: z
    .union([
      z.enum(FORTHCOMING_BEATS),
      z.object({
        beat: z.enum(FORTHCOMING_BEATS).optional(),
        seasonsRemaining: z.coerce.number().int().min(1).optional(),
        applyAfterSeasons: z.coerce.number().int().min(1).optional(),
      }),
    ])
    .optional(),
  text: z.string().optional(),
  proposal: InnerMechanicalProposalSchema,
});

export const MechanicalProposalSchema = z.discriminatedUnion("type", [
  FreeMancipiaProposalSchema,
  RaiseUnitProposalSchema,
  DisbandUnitProposalSchema,
  CallToArmsProposalSchema,
  RegisterUnitSheetProposalSchema,
  AssignLabourProposalSchema,
  SetStandingOrderProposalSchema,
  StartProjectProposalSchema,
  AdjustProjectProposalSchema,
  AdjustSowingProposalSchema,
  TransferResourcesProposalSchema,
  AddModifierProposalSchema,
  RemoveModifierProposalSchema,
  RegisterResourceProposalSchema,
  RegisterFeatureProposalSchema,
  RegisterNpcProposalSchema,
  EventEffectProposalSchema,
  StartHuntProposalSchema,
  SettleHouseholdsProposalSchema,
  SponsorFeastProposalSchema,
  HistoryChoiceProposalSchema,
  HistoryHookProposalSchema,
  HistoryOutcomeProposalSchema,
  HistorySceneProposalSchema,
  InnovationRegisterProposalSchema,
  InnovationExposeProposalSchema,
  VassalMoodProposalSchema,
  JusticeVerdictProposalSchema,
  SetStanceProposalSchema,
  StewardOfficeProposalSchema,
  HouseholdUpkeepProposalSchema,
  GivingStanceProposalSchema,
  VassalGiftProposalSchema,
  VassalOccasionProposalSchema,
  ChurchEndowmentProposalSchema,
  ChurchPurchaseProposalSchema,
  MarriageProposalSchema,
  DeferProposalSchema,
]);

export type AssignLabourProposal = z.infer<typeof AssignLabourProposalSchema>;
export type MarriageProposal = z.infer<typeof MarriageProposalSchema>;
export type VassalMoodProposal = z.infer<typeof VassalMoodProposalSchema>;
export type JusticeVerdictProposal = z.infer<typeof JusticeVerdictProposalSchema>;
export type SetStanceProposal = z.infer<typeof SetStanceProposalSchema>;
export type StewardOfficeProposal = z.infer<typeof StewardOfficeProposalSchema>;
export type HouseholdUpkeepProposal = z.infer<typeof HouseholdUpkeepProposalSchema>;
export type GivingStanceProposal = z.infer<typeof GivingStanceProposalSchema>;
export type VassalGiftProposal = z.infer<typeof VassalGiftProposalSchema>;
export type VassalOccasionProposal = z.infer<typeof VassalOccasionProposalSchema>;
export type ChurchEndowmentProposal = z.infer<typeof ChurchEndowmentProposalSchema>;
export type ChurchPurchaseProposal = z.infer<typeof ChurchPurchaseProposalSchema>;
export type SetStandingOrderProposal = z.infer<typeof SetStandingOrderProposalSchema>;
export type StartProjectProposal = z.infer<typeof StartProjectProposalSchema>;
export type AdjustProjectProposal = z.infer<typeof AdjustProjectProposalSchema>;
export type AdjustSowingProposal = z.infer<typeof AdjustSowingProposalSchema>;
export type TransferResourcesProposal = z.infer<typeof TransferResourcesProposalSchema>;
export type AddModifierProposal = z.infer<typeof AddModifierProposalSchema>;
export type RemoveModifierProposal = z.infer<typeof RemoveModifierProposalSchema>;
export type RegisterResourceProposal = z.infer<typeof RegisterResourceProposalSchema>;
export type RegisterFeatureProposal = z.infer<typeof RegisterFeatureProposalSchema>;
export type RegisterNpcProposal = z.infer<typeof RegisterNpcProposalSchema>;
export type EventEffectProposal = z.infer<typeof EventEffectProposalSchema>;
export type StartHuntProposal = z.infer<typeof StartHuntProposalSchema>;
export type SettleHouseholdsProposal = z.infer<typeof SettleHouseholdsProposalSchema>;
export type SponsorFeastProposal = z.infer<typeof SponsorFeastProposalSchema>;
export type InnerMechanicalProposal = z.infer<typeof InnerMechanicalProposalSchema>;
export type DeferProposal = z.infer<typeof DeferProposalSchema>;
export type RaiseUnitProposal = z.infer<typeof RaiseUnitProposalSchema>;
export type DisbandUnitProposal = z.infer<typeof DisbandUnitProposalSchema>;
export type CallToArmsProposal = z.infer<typeof CallToArmsProposalSchema>;
export type RegisterUnitSheetProposal = z.infer<typeof RegisterUnitSheetProposalSchema>;
export type FreeMancipiaProposal = z.infer<typeof FreeMancipiaProposalSchema>;
export type HistoryChoiceProposal = z.infer<typeof HistoryChoiceProposalSchema>;
export type HistoryHookProposal = z.infer<typeof HistoryHookProposalSchema>;
export type HistoryOutcomeProposal = z.infer<typeof HistoryOutcomeProposalSchema>;
export type HistorySceneProposal = z.infer<typeof HistorySceneProposalSchema>;
export type InnovationRegisterProposal = z.infer<typeof InnovationRegisterProposalSchema>;
export type InnovationExposeProposal = z.infer<typeof InnovationExposeProposalSchema>;

export type MechanicalProposal =
  | FreeMancipiaProposal
  | HistoryChoiceProposal
  | HistoryHookProposal
  | HistoryOutcomeProposal
  | HistorySceneProposal
  | InnovationRegisterProposal
  | InnovationExposeProposal
  | VassalMoodProposal
  | JusticeVerdictProposal
  | SetStanceProposal
  | StewardOfficeProposal
  | HouseholdUpkeepProposal
  | GivingStanceProposal
  | VassalGiftProposal
  | VassalOccasionProposal
  | ChurchEndowmentProposal
  | ChurchPurchaseProposal
  | MarriageProposal
  | RaiseUnitProposal
  | DisbandUnitProposal
  | CallToArmsProposal
  | RegisterUnitSheetProposal
  | AssignLabourProposal
  | SetStandingOrderProposal
  | StartProjectProposal
  | AdjustProjectProposal
  | AdjustSowingProposal
  | TransferResourcesProposal
  | AddModifierProposal
  | RemoveModifierProposal
  | RegisterResourceProposal
  | RegisterFeatureProposal
  | RegisterNpcProposal
  | EventEffectProposal
  | StartHuntProposal
  | SettleHouseholdsProposal
  | SponsorFeastProposal
  | DeferProposal;

export const LlmResponseSchema = z.object({
  speech: z.string(),
  chronicle: z.string().optional(),
  emotion: z.string().optional(),
  proposals: z.array(z.unknown()).default([]),
});
export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export const PendingProposalSchema = z.object({
  id: z.string(),
  npcId: z.string(),
  proposal: MechanicalProposalSchema,
  status: z.enum(["pending", "applied", "rejected", "withheld"]),
  rejectReason: z.string().optional(),
});
export type PendingProposal = z.infer<typeof PendingProposalSchema>;

export type ApplyResult = {
  ok: boolean;
  reason?: string;
  logLine: string;
  state: WorldState;
};

export type ChatMessage = {
  id: string;
  role: "player" | "npc" | "system";
  npcId?: string;
  npcName?: string;
  text: string;
  chronicle?: string;
  emotion?: string;
  /** Quiet in-world aside (Ask about cue), not a ledger note. */
  aside?: boolean;
  at: string;
};

export type SeasonEffectLine = {
  kind: "info" | "apply" | "reject" | "event";
  text: string;
};
