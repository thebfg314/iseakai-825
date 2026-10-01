import type { MechanicalProposal, ModifierTarget, WorldState } from "./schema";
import { innerProposalOfDefer } from "./forthcoming";

/**
 * Scale for a tool the estate already has land and hands for.
 * Historians do not have a clean medieval percent. Side-by-side trials of a
 * turning plough against a scratch-plough are about a quarter more wheat when
 * there is a difference at all. The larger historical gain was new clay land
 * and less cross-ploughing, which this villa is not getting from one new plough.
 * That is why any such improvement is modest — not a rule for one invention.
 */
export const STEWARD_TOOL_IMPROVEMENT = `A tool Bernard forges does not change the books by itself. You do not propose a yield or output change until the lord tells you to put the people onto that tool. Forging it is his work, and it is not enough. When the lord does tell you, propose one add_modifier the books already understand, with the reason in the speech of the hall. Choose the target from what the tool actually does: grain_yield if the fields yield more grain, labour_efficiency if the same work takes fewer days, spoilage if less is lost in store, livestock_yield if the herds give more, project_speed if a work finishes sooner, specific_resource_output if one named store comes out better. Do not keep a list of inventions, and do not invent a special rule for one tool.

On land the estate already farms, a real improvement is modest: around a quarter more, and not a doubling. The same kind of improvement does not stack a second time. Historians do not have a clean medieval percent. Side-by-side trials of a turning plough against a scratch-plough are about a quarter more wheat when there is a difference at all. The larger historical gain was new clay land and less cross-ploughing, which this villa is not getting from one new plough. That is why the scale is a quarter, for whatever the tool actually changes. If you name a figure in speech, the add_modifier must use that same figure. A quarter more is effect op multiply and value 1.25, not 0.25 and not 2.`;

export const BERNARD_HARVEST_REDIRECT = "I do not write the harvest. Speak to Aldric the steward.";

export const IMPROVEMENT_ALREADY =
  "That improvement is already written. The same kind does not come a second time.";

/** Targets a tool can change. The steward picks one from what the tool does. */
export const IMPROVEMENT_TARGETS = new Set<ModifierTarget>([
  "grain_yield",
  "labour_efficiency",
  "spoilage",
  "livestock_yield",
  "project_speed",
  "specific_resource_output",
]);

const FIELD_TARGETS = new Set<ModifierTarget>([
  "grain_yield",
  "labour_efficiency",
  "spoilage",
  "livestock_yield",
  "harvest_risk",
]);

const GRAIN_RESOURCES = new Set(["wheat", "rye", "barley", "oats", "grain"]);

type Effect = { op: "multiply" | "add" | "set"; value: number };
type ModifierProposal = Extract<MechanicalProposal, { type: "add_modifier" }>;

export type ImprovementKind = "gain" | "saving";

const SPOKEN_PHRASES: { re: RegExp; factor: number }[] = [
  { re: /\bone and a quarter\b/i, factor: 1.25 },
  { re: /\b(?:a|one) quarter more\b/i, factor: 1.25 },
  { re: /\bby a quarter\b/i, factor: 1.25 },
  { re: /\bone part in four\b/i, factor: 1.25 },
  { re: /\ba quarter again\b/i, factor: 1.25 },
  { re: /\b(?:a|one) quarter less\b/i, factor: 0.75 },
  { re: /\bby a quarter less\b/i, factor: 0.75 },
  { re: /\b(?:a|one) fifth more\b/i, factor: 1.2 },
  { re: /\bby a fifth\b/i, factor: 1.2 },
  { re: /\bone part in five\b/i, factor: 1.2 },
  { re: /\b(?:a|one) fifth less\b/i, factor: 0.8 },
  { re: /\b(?:a|one) third more\b/i, factor: 1 + 1 / 3 },
  { re: /\bby a third\b/i, factor: 1 + 1 / 3 },
  { re: /\b(?:a|one) third less\b/i, factor: 1 - 1 / 3 },
  { re: /\bby a third less\b/i, factor: 1 - 1 / 3 },
  { re: /\bhalf again\b/i, factor: 1.5 },
  { re: /\bhalf as much again\b/i, factor: 1.5 },
  { re: /\bhalf more\b/i, factor: 1.5 },
  { re: /\bby half\b/i, factor: 1.5 },
  { re: /\bhalf less\b/i, factor: 0.5 },
  { re: /\b(?:a|one) tenth more\b/i, factor: 1.1 },
  { re: /\bby a tenth\b/i, factor: 1.1 },
  { re: /\b(?:double|twice|twofold)\b/i, factor: 2 },
];

function roundFigure(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function usableFigure(n: number): boolean {
  return Number.isFinite(n) && n > 0.25 && n <= 2.5;
}

/** The figure named in speech, as a multiplier. A quarter more is 1.25. No figure returns null. */
export function parseSpokenImprovement(speech: string): number | null {
  if (!speech.trim()) return null;
  const found = { index: -1, factor: 0 };
  const consider = (index: number, factor: number) => {
    if (!usableFigure(factor)) return;
    if (found.index < 0 || index >= found.index) {
      found.index = index;
      found.factor = roundFigure(factor);
    }
  };

  for (const { re, factor } of SPOKEN_PHRASES) {
    const match = re.exec(speech);
    if (match) consider(match.index, factor);
  }
  for (const match of speech.matchAll(/\b(?:multiply(?:\s+by)?|×)\s*(\d+(?:\.\d+)?)\b/gi)) {
    consider(match.index ?? 0, Number(match[1]));
  }
  for (const match of speech.matchAll(/\btimes\s*(\d+(?:\.\d+)?)\b/gi)) {
    consider(match.index ?? 0, Number(match[1]));
  }
  for (const match of speech.matchAll(/\b(\d+(?:\.\d+)?)\s*times\b/gi)) {
    consider(match.index ?? 0, Number(match[1]));
  }
  for (const match of speech.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:percent|per cent|%)\s*more\b/gi)) {
    consider(match.index ?? 0, 1 + Number(match[1]) / 100);
  }
  for (const match of speech.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:percent|per cent|%)\s*less\b/gi)) {
    consider(match.index ?? 0, 1 - Number(match[1]) / 100);
  }
  return found.index < 0 ? null : found.factor;
}

/** The lord told Aldric to put the people onto the tool. Forging it is not this. */
export function lordToldStewardToUseTool(playerText: string): boolean {
  const t = playerText.toLowerCase();
  if (
    /\b(put|set|turn|send|have|tell)\b[\s\S]{0,80}\b(people|folk|hands|households?|villeins|tenants|them|men|women)\b[\s\S]{0,50}\b(on|onto|to|with|use|using)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(use|take up|work with)\b[\s\S]{0,60}\b(the new|new tool|what (?:bernard|the smith)|the tool)\b/.test(t)) {
    return true;
  }
  if (/\bput (?:it|them|the new \w+) (?:to|on|onto) (?:the )?(?:fields|land|work)\b/.test(t)) {
    return true;
  }
  return false;
}

export function asksAboutTheHarvest(text: string): boolean {
  return /\bharvest\b|\bthe fields\b|\bthe field\b|\bcrops?\b/i.test(text);
}

/** Spoilage improves when less is lost. Every other tool target improves when output rises. */
const SAVING_TARGETS = new Set<ModifierTarget>(["spoilage"]);

export function improvementKind(target: ModifierTarget, effect: { op: string; value: number }): ImprovementKind | null {
  if (!IMPROVEMENT_TARGETS.has(target)) return null;
  const saving = SAVING_TARGETS.has(target);
  if (effect.op === "multiply") {
    if (effect.value > 1) return saving ? null : "gain";
    if (effect.value > 0 && effect.value < 1) return saving ? "saving" : null;
    return null;
  }
  if (effect.op === "add") {
    if (effect.value > 0) return saving ? null : "gain";
    if (effect.value < 0) return saving ? "saving" : null;
    return null;
  }
  if (effect.op === "set" && !saving) return "gain";
  return null;
}

function asModifier(p: MechanicalProposal | { type?: string }): ModifierProposal | null {
  if (p.type === "add_modifier") return p as ModifierProposal;
  if (p.type === "defer_proposal") {
    const inner = innerProposalOfDefer(p as Extract<MechanicalProposal, { type: "defer_proposal" }>);
    if (inner?.type === "add_modifier") return inner as ModifierProposal;
  }
  return null;
}

function improvementProposal(p: MechanicalProposal): ModifierProposal | null {
  const mod = asModifier(p);
  if (!mod || !IMPROVEMENT_TARGETS.has(mod.target)) return null;
  return mod;
}

/** Bernard forges. He does not write the fields, the harvest, or a grain yield. */
export function proposalWritesTheFields(p: MechanicalProposal): boolean {
  const mod = asModifier(p);
  if (!mod) return false;
  if (FIELD_TARGETS.has(mod.target)) return true;
  if (mod.target === "specific_resource_output" && mod.resourceId && GRAIN_RESOURCES.has(mod.resourceId)) return true;
  return false;
}

export function sameImprovementAlready(
  state: WorldState,
  target: ModifierTarget,
  effect: { op: string; value: number },
  also: MechanicalProposal[] = [],
): boolean {
  const kind = improvementKind(target, effect);
  if (!kind) return false;
  if (state.modifiers.some((m) => m.target === target && improvementKind(m.target, m.effect) === kind)) return true;
  return also.some((p) => {
    const mod = improvementProposal(p);
    return mod != null && mod.target === target && improvementKind(mod.target, mod.effect) === kind;
  });
}

/**
 * Align a named figure onto the book change, drop a yield until the lord has
 * told Aldric to put the people on the tool, and refuse a second stack.
 */
export function prepareStewardToolProposals(
  state: WorldState,
  playerText: string,
  proposals: MechanicalProposal[],
  speech: string,
  already: MechanicalProposal[] = [],
): { proposals: MechanicalProposal[]; note?: string } {
  const asked = lordToldStewardToUseTool(playerText);
  const factor = parseSpokenImprovement(speech);
  const kept: MechanicalProposal[] = [];
  let note: string | undefined;
  for (const proposal of proposals) {
    const mod = improvementProposal(proposal);
    if (!mod) {
      kept.push(proposal);
      continue;
    }
    if (factor != null) {
      const aligned: Effect = { op: "multiply", value: factor };
      mod.effect = aligned;
    }
    if (!asked) continue;
    if (improvementKind(mod.target, mod.effect) && sameImprovementAlready(state, mod.target, mod.effect, [...already, ...kept])) {
      note = IMPROVEMENT_ALREADY;
      continue;
    }
    kept.push(proposal);
  }
  return note ? { proposals: kept, note } : { proposals: kept };
}
