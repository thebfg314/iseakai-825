import { extractJsonObject } from "../llm/parse";
import { allTags, allUnitSheets, canonicalTagId, isBuiltinSheet, isBuiltinTag, requireUnitSheet } from "./registry";
import { TagDefSchema, UnitSheetSchema, type TagDef, type UnitSheet } from "./schema";
import { unmetTagRequirements } from "./registry";

/**
 * The LLM ↔ engine seam for inventing units (design doc §1, §6 "clean LLM/engine seam").
 * The model proposes data — a sheet plus optional new tags written in the closed hook
 * vocabulary. Nothing here decides what a tag does; the engine already knows.
 */

export type ForgeProposal = {
  id: string;
  prompt: string;
  sheet: UnitSheet;
  newTags: TagDef[];
  rationale: string;
  /** Non-fatal notes for the human reviewer (e.g. stats far outside the roster's envelope). */
  warnings: string[];
};

export type ForgeParseResult = { ok: true; proposal: Omit<ForgeProposal, "id" | "prompt"> } | { ok: false; errors: string[]; raw: string };

const HOOK_KEYS = [
  "atkMultiplier",
  "defMultiplier",
  "hpMultiplier",
  "moraleDamageRatioMultiplier",
  "moraleLossMultiplier",
  "armorSource { defBonus }",
  "ignoreArmorDefFraction (0–1)",
  "firesEveryNRounds",
  "volleyCharges",
  "onChargesDepleted { losesTag, gainsTag }",
  "unlocksOrders [hold_formation | skirmish_and_withdraw]",
  "conditional [{ when: <condition>, atkMultiplier?, defMultiplier?, defBonus?, damageMultiplier?, moraleDelta?, counterDamage?, bypassesAmmoCost? }]",
  "onCharge { atkMultiplier }",
  "onChargeStopped { moraleDelta }",
  "onNearbyAllyRouts { moraleDelta }",
  "onRally { atkMultiplier, oneTime }",
  "disengageCostMultiplier",
  "skirmishVolley { extraVolleys, targetMaxSpeed }",
  "siege { bypassesHardenedStructure, vsUnitsHpDamageMultiplier }",
  "mobileFortification, stationaryEmplacement, precisionBolt, wallHeightNegation, dualShotType (booleans)",
  "damageRollMultiplierRange { min, max }",
  "misfireChance (0–1)",
  "requires { minSpeed?, minRange? }",
];

const CONDITION_KEYS = [
  "targetHasTag: <tag id>",
  "targetLacksTag: <tag id>",
  "targetArmored: true|false",
  "targetState: routing | engagedMelee",
  "selfState: engagedMelee | charging",
  "attackerHasTag: <tag id>",
  "attackerState: charging",
  "attackKind: melee | ranged",
];

/** System prompt for the forge. Lists the closed vocabulary and the current roster so the model reuses rather than reinvents. */
export function forgeSystemPrompt(): string {
  const tags = allTags()
    .map((t) => `- ${t.id}: ${t.summary}`)
    .join("\n");
  const roster = allUnitSheets()
    .map((u) => `- ${u.id} (${u.kind}): HP ${u.hp} ATK ${u.atk} DEF ${u.def} Dmg ${u.damage.min}–${u.damage.max} Rng ${u.range} Spd ${u.speed} Mor ${u.morale} Str ${u.strength}; tags ${u.tags.join(", ")}`)
    .join("\n");
  return `You design unit sheets for a deterministic 9th-century battle engine (Carolingian Francia, year 825). You propose DATA only. You never decide what a tag does in combat — the engine defines every hook once. The player reviews and approves or rejects your proposal.

Reply with ONE JSON object, no markdown fences:
{
  "sheet": { "id": "snake_case_id", "name": "...", "kind": "troop" | "siege", "hp": n, "atk": n, "def": n, "damage": { "min": n, "max": n }, "range": 0-4, "speed": n, "morale": n, "strength": n, "tags": ["..."], "tagParams": { "limited_ammo": { "volleyCharges": n } }?, "skins": ["..."]?, "anachronistic": true?, "requirements": [ { "resource": "snake_case_good", "name": "...", "perMan": n, "source": "smith" | "hunt" | "merchant", "replacesHorses": true?, "note": "..."? } ]?, "notes": "..."? },
  "newTags": [ { "id": "snake_case", "summary": "...", <hooks> } ],
  "rationale": "two or three sentences on historical grounding and where it sits against the existing roster"
}

Rules:
- requirements: if the unit needs gear, mounts, or knowledge that 825 Francia does not have to hand, work out what is missing and list it as goods — each with who supplies it: "smith" (Bernard forges it: locks, steel prods, stirrups, lamellar), "hunt" (Gerulf finds it on the roads: horse breeds, horn for composite bows, a master to teach a craft), or "merchant" (a passing trader's stall). perMan is how many of the good each man needs. Set replacesHorses when the good is the mount itself. A plain spear-and-shield levy of the time needs none.
- Reuse existing tags whenever one fits. Only add a newTag when no existing tag expresses the idea. Check the registry first.
- New tags may ONLY use these hook keys: ${HOOK_KEYS.join("; ")}.
- Condition objects inside "conditional[].when" may ONLY use: ${CONDITION_KEYS.join("; ")}. Tag ids referenced in conditions must exist in the registry or in your newTags.
- Sheet stats are FINAL values: any armor DEF or load Speed effect is already included in def/speed. An armor tag's armorSource.defBonus only records how much of def is armor (so armor-piercing can halve it).
- Stat envelope of the roster: HP 50–95, ATK 8–18 for troops (siege up to 45), DEF 3–16, Damage 4–14 (siege to 24), Range 0–4, Speed 0–6, Morale 35–80, strength = abstract headcount (troops 50–100, siege crews 12–20).
- A ranged unit must have range >= 1 and the tag "ranged". shock requires speed >= 4. hit_and_run requires range >= 1 and speed >= 3.
- Anachronistic units are allowed and should be honestly powerful, flagged "anachronistic": true, never nerfed for being early.
- ids must be lowercase snake_case and must not collide with the roster.

Registry tags:
${tags}

Roster:
${roster}`;
}

export function forgeUserPrompt(request: string): string {
  return `Design this unit:\n${request}`;
}

export function forgeRepairPrompt(errors: string[]): string {
  return `Your previous proposal was rejected by the schema validator. Fix ONLY these problems and reply with the corrected JSON object again, nothing else:\n- ${errors.join("\n- ")}`;
}

function idOk(id: unknown): id is string {
  return typeof id === "string" && /^[a-z][a-z0-9_]*$/.test(id);
}

/** Strict parse + validation of a model reply. Never touches the registry. */
export function parseForgeReply(raw: string): ForgeParseResult {
  const json = extractJsonObject(raw);
  if (!json) return { ok: false, errors: ["No JSON object found in the reply."], raw };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    try {
      data = JSON.parse(json.replace(/,\s*([}\]])/g, "$1"));
    } catch (e) {
      return { ok: false, errors: [`JSON did not parse: ${e instanceof Error ? e.message : String(e)}`], raw };
    }
  }
  return validateForgeObject(data, raw);
}

/**
 * Validate an already-parsed { sheet, newTags, rationale } object — the shared seam for the
 * lab forge and the campaign's register_unit_sheet proposal.
 */
export function validateForgeObject(data: unknown, raw = ""): ForgeParseResult {
  if (!data || typeof data !== "object") return { ok: false, errors: ["Proposal is not an object."], raw };
  const rec = data as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  // New tags first so the sheet can reference them.
  const rawTags = Array.isArray(rec.newTags) ? rec.newTags : [];
  const newTags: TagDef[] = [];
  const newTagIds = new Set<string>();
  rawTags.forEach((t, i) => {
    const parsed = TagDefSchema.safeParse(t);
    if (!parsed.success) {
      errors.push(`newTags[${i}]: ${parsed.error.issues.map((x) => `${x.path.join(".") || "(root)"} ${x.message}`).join("; ")}`);
      return;
    }
    if (isBuiltinTag(parsed.data.id)) {
      errors.push(`newTags[${i}]: "${parsed.data.id}" already exists in the registry — reuse it instead of redefining it.`);
      return;
    }
    newTags.push(parsed.data);
    newTagIds.add(parsed.data.id);
  });
  const knownTag = (id: string) => newTagIds.has(id) || canonicalTagId(id) !== undefined;
  for (const t of newTags) {
    for (const c of t.conditional ?? []) {
      for (const ref of [c.when.targetHasTag, c.when.targetLacksTag, c.when.attackerHasTag]) {
        if (ref && !knownTag(ref)) errors.push(`newTag "${t.id}" references unknown tag "${ref}" in a condition.`);
      }
    }
    for (const ref of [t.onChargesDepleted?.losesTag, t.onChargesDepleted?.gainsTag]) {
      if (ref && !knownTag(ref)) errors.push(`newTag "${t.id}" references unknown tag "${ref}" in onChargesDepleted.`);
    }
  }

  const sheetParsed = UnitSheetSchema.safeParse(rec.sheet);
  if (!sheetParsed.success) {
    errors.push(`sheet: ${sheetParsed.error.issues.map((x) => `${x.path.join(".") || "(root)"} ${x.message}`).join("; ")}`);
    return { ok: false, errors, raw };
  }
  const sheet = sheetParsed.data;
  if (!idOk(sheet.id)) errors.push(`sheet.id "${sheet.id}" must be lowercase snake_case.`);
  if (isBuiltinSheet(sheet.id)) errors.push(`sheet.id "${sheet.id}" collides with a roster sheet.`);
  for (const tag of sheet.tags) if (!knownTag(tag)) errors.push(`sheet.tags references unknown tag "${tag}" — reuse a registry tag or define it in newTags.`);
  if (sheet.range >= 1 && !sheet.tags.some((t) => canonicalTagId(t) === "ranged")) errors.push(`sheet has range ${sheet.range} but lacks the "ranged" tag.`);
  if (sheet.range === 0 && sheet.tags.some((t) => canonicalTagId(t) === "ranged")) errors.push(`sheet carries "ranged" but has range 0.`);
  if (sheet.kind === "troop" && sheet.atk === 0) warnings.push("A troop sheet with ATK 0 can never strike.");

  // Requirement checks need the new tags visible; evaluate against a merged view without mutating the registry.
  const pseudoRegistry = new Map<string, TagDef>([...allTags(), ...newTags].map((t) => [t.id, t]));
  for (const tagName of sheet.tags) {
    const def = pseudoRegistry.get(canonicalTagId(tagName) ?? tagName);
    if (!def?.requires) continue;
    if (def.requires.minSpeed !== undefined && sheet.speed < def.requires.minSpeed) errors.push(`tag "${def.id}" needs Speed >= ${def.requires.minSpeed}; sheet has ${sheet.speed}.`);
    if (def.requires.minRange !== undefined && sheet.range < def.requires.minRange) errors.push(`tag "${def.id}" needs Range >= ${def.requires.minRange}; sheet has ${sheet.range}.`);
  }

  // Envelope warnings — the reviewer decides, not the validator.
  const env = { hp: [50, 95], atk: [0, 45], def: [3, 20], morale: [35, 80], speed: [0, 6] } as const;
  for (const [k, [lo, hi]] of Object.entries(env) as [keyof typeof env, readonly [number, number]][]) {
    const v = sheet[k];
    if (v < lo || v > hi) warnings.push(`${k} ${v} is outside the roster envelope ${lo}–${hi}.`);
  }
  if (sheet.damage.max > 24) warnings.push(`damage.max ${sheet.damage.max} exceeds every roster sheet.`);
  if (sheet.anachronistic) warnings.push("Flagged anachronistic: gate its acquisition in the narrative layer, do not nerf it.");

  if (errors.length) return { ok: false, errors, raw };
  return {
    ok: true,
    proposal: {
      sheet,
      newTags,
      rationale: typeof rec.rationale === "string" ? rec.rationale : "",
      warnings,
    },
  };
}

/** Sanity: after registration the sheet resolves and satisfies requirements. */
export function verifyRegistered(sheetId: string): string[] {
  const sheet = requireUnitSheet(sheetId);
  return unmetTagRequirements(sheet).map((u) => `${u.tag}: ${u.reason}`);
}
