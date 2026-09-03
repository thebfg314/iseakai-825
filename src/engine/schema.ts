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
  }),
  materialsReserved: z.boolean(),
  status: z.enum(["active", "completed", "cancelled"]),
  rush: z.boolean().optional(),
  tag: z.string().optional(),
  notes: z.string().optional(),
  /** Gerulf road-hunt: time and a purse, not labour-days. */
  hunt: z
    .object({
      goods: z.string(),
      resource: z.string(),
      amount: z.number(),
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
});
export type Npc = z.infer<typeof NpcSchema>;

export const TechniqueSchema = z.object({
  id: z.string(),
  name: z.string(),
  discoveredTurn: z.number().int(),
  notes: z.string().optional(),
});
export type Technique = z.infer<typeof TechniqueSchema>;

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
    })
    .default({ present: false, stock: [] }),
  /** Visiting merchants leave npcs[]; bargains persist here by visitor name (Isaac, Gero, …). */
  merchant_memories: z.record(z.string(), z.array(NpcMemorySchema)).default({}),
  /** First-meeting intro already shown, by visitor name, so Isaac does not re-introduce on a later visit. */
  merchant_intro_spoken: z.record(z.string(), z.boolean()).default({}),
  agriculture: z
    .object({
      springBarleyShare: z.number().min(0).max(1).default(0.6),
      autumnWheatShare: z.number().min(0).max(1).default(0.45),
    })
    .default({ springBarleyShare: 0.6, autumnWheatShare: 0.45 }),
  /** Signed store / sown / household changes from the last Advance season. Empty on a fresh game. */
  last_season_deltas: z.record(z.string(), z.number()).default({}),
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

export const StartHuntProposalSchema = ProposalBase.extend({
  type: z.literal("start_hunt"),
  goods: z.string(),
  resource: z.string(),
  amount: z.coerce.number().positive(),
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
  | StartHuntProposal;

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
  status: z.enum(["pending", "applied", "rejected"]),
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
  at: string;
};

export type SeasonEffectLine = {
  kind: "info" | "apply" | "reject" | "event";
  text: string;
};
