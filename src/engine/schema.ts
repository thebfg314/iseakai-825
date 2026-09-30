import { z } from "zod";

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
    rank: z.literal("minor_noble"),
  }),
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
  "sponsor_feast",
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

export const StartProjectProposalSchema = ProposalBase.extend({
  type: z.literal("start_project"),
  projectKey: z.string(),
  holdingId: z.string().optional(),
  name: z.string().optional(),
  customCosts: z
    .object({
      labourDays: z.coerce.number(),
      lumber: z.coerce.number(),
      iron: z.coerce.number(),
      stone: z.coerce.number(),
    })
    .optional(),
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

export const InnerMechanicalProposalSchema = z.discriminatedUnion("type", [
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
  DeferProposalSchema,
]);

export type AssignLabourProposal = z.infer<typeof AssignLabourProposalSchema>;
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

export type MechanicalProposal =
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
