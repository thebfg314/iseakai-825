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
export const STEWARD_TOOL_IMPROVEMENT = `A tool Bernard forges does not change the books by itself. You do not propose a yield or output change for that tool until that work is finished and the lord tells you to put the people onto it. Forging it is his work, and finishing it is not enough. When the lord does tell you, propose one add_modifier the books already understand, with the reason in the speech of the hall. Choose the target from what the tool actually does: grain_yield if the fields yield more grain, labour_efficiency if the same work takes fewer days, spoilage if less is lost in store, livestock_yield if the herds give more, project_speed if a work finishes sooner, specific_resource_output if one named store comes out better. A plough that turns the earth, instead of scratching a rut, is grain yield. You choose that target. Do not keep a list of inventions, and do not invent a special rule for one tool.

Other husbandry is the same kind of judgment. When the lord asks you to put a practice into the work, propose the ordinary book change that already fits. Moving to three-field rotation is adjust_sowing with rotation three_field (defer_proposal with beat after_harvest while crops stand). It is not a yield modifier. Adding legumes to the spring planting, and manuring the fields in spring, are whatever change already fits — you choose the proposal and the target. There is no table of inventions.

On land the estate already farms, one real improvement is modest: around a quarter more, and not a doubling. That figure is your judgment for each change. Several different improvements each keep their own figure; the quarter is not a ceiling on all of them together. Do not grant the same improvement twice: the same plough, the same manuring custom, the same legume change. A different improvement that also raises grain is not a duplicate. Write it as its own add_modifier, with its own reason in source. Historians do not have a clean medieval percent. Side-by-side trials of a turning plough against a scratch-plough are about a quarter more wheat when there is a difference at all. The larger historical gain was new clay land and less cross-ploughing, which this villa is not getting from one new plough. That is why the scale is a quarter, for each change, for whatever that change actually does. If you name a figure in speech, the add_modifier must use that same figure. A quarter more is effect op multiply and value 1.25, not 0.25 and not 2.`;

export const BERNARD_HARVEST_REDIRECT = "I do not write the harvest. Speak to Aldric the steward.";

export const IMPROVEMENT_ALREADY = "That improvement is already written.";

export const WORK_NOT_FINISHED =
  "That work is not finished. The people cannot take it up yet, and the books stay as they are.";

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

/** Manure, legumes, and the like — a practice the lord asked to put in, not a forged tool. */
export function lordOrderedHusbandry(playerText: string): boolean {
  return /\b(legumes?|peas?\b|manure|muck|seed[- ]?(?:keep|keeping|selection|saving|kept)|fallow)\b/i.test(playerText);
}

const ORDER_NOISE = new Set([
  "put", "set", "turn", "send", "have", "tell", "the", "and", "for", "onto", "into", "with", "from",
  "people", "folk", "hands", "them", "men", "women", "household", "households", "villeins", "tenants",
  "use", "using", "used", "new", "tool", "work", "this", "that", "once", "finished", "finish",
  "lord", "please", "aldric", "bernard", "fields", "field", "yield", "more", "your", "our",
]);

function projectText(project: { name: string; key: string; notes?: string | null }): string {
  return `${project.name} ${project.key.replaceAll("_", " ")} ${project.notes ?? ""}`.toLowerCase();
}

/**
 * The lord can put the people onto a tool only once that work is finished.
 * Named words must hit a finished project. An unnamed "new tool" needs some finished work.
 */
export function finishedToolReady(state: WorldState, playerText: string): boolean {
  const open = state.projects.filter((p) => p.status === "active" || p.status === "completed");
  const words = playerText
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3 && !ORDER_NOISE.has(word));
  if (words.length) {
    const hits = open.filter((project) => words.some((word) => projectText(project).includes(word)));
    if (!hits.length) return false;
    return hits.some((project) => project.status === "completed");
  }
  return open.some((project) => project.status === "completed");
}

export function asksAboutTheHarvest(text: string): boolean {
  return /\bharvest\b|\bthe fields\b|\bthe field\b|\bcrops?\b/i.test(text);
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

function reasonKey(text: string | undefined | null): string {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameReason(a: string, b: string): boolean {
  const left = reasonKey(a);
  const right = reasonKey(b);
  return left.length > 0 && left === right;
}

/**
 * The same custom already written: same source, or the same spoken reason.
 * A new reason on the same target is not this. A shared card summary is not a reason.
 */
export function identicalModifierAlready(
  state: WorldState,
  proposal: { source?: string; summary?: string; customNote?: string | null },
  also: MechanicalProposal[] = [],
): boolean {
  const names: string[] = [];
  const push = (text?: string | null) => {
    const key = reasonKey(text);
    if (key) names.push(key);
  };
  for (const modifier of state.modifiers) {
    push(modifier.source);
    push(modifier.customNote);
  }
  for (const pending of also) {
    const mod = asModifier(pending);
    if (!mod) continue;
    push(mod.source);
    push(mod.customNote);
    push(mod.summary);
  }
  const source = reasonKey(proposal.source);
  const note = reasonKey(proposal.customNote);
  if ([source, note].some((text) => text.length > 0 && names.some((have) => sameReason(text, have)))) return true;
  const summary = reasonKey(proposal.summary);
  if (!summary) return false;
  const written: string[] = [];
  for (const modifier of state.modifiers) {
    const have = reasonKey(modifier.source);
    const custom = reasonKey(modifier.customNote);
    if (have) written.push(have);
    if (custom) written.push(custom);
  }
  for (const pending of also) {
    const mod = asModifier(pending);
    if (!mod) continue;
    const have = reasonKey(mod.source);
    const custom = reasonKey(mod.customNote);
    if (have) written.push(have);
    if (custom) written.push(custom);
  }
  return written.some((have) => sameReason(summary, have));
}

/**
 * Align a named figure onto the book change. A tool's yield waits until the
 * lord has put the people onto finished work. Husbandry the lord ordered
 * keeps the proposal the model chose. The same reason is not written twice.
 */
export function prepareStewardToolProposals(
  state: WorldState,
  playerText: string,
  proposals: MechanicalProposal[],
  speech: string,
  already: MechanicalProposal[] = [],
): { proposals: MechanicalProposal[]; note?: string } {
  const toolAsk = lordToldStewardToUseTool(playerText);
  const husbandry = lordOrderedHusbandry(playerText);
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
    if (toolAsk) {
      if (!finishedToolReady(state, playerText)) {
        note = WORK_NOT_FINISHED;
        continue;
      }
    } else if (!husbandry) {
      continue;
    }
    if (identicalModifierAlready(state, mod, [...already, ...kept])) {
      note = IMPROVEMENT_ALREADY;
      continue;
    }
    kept.push(proposal);
  }
  return note ? { proposals: kept, note } : { proposals: kept };
}
