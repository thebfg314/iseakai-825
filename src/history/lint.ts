import { CANONICAL_RESOURCES } from "../engine/schema";
import { referencedNames } from "./conditions";
import { historyContent, type HistoryContent } from "./load";
import type { HistoryEffects, HistoryEffectsList, HistoryEvent, HistoryOption } from "./schema";

/** Names a condition may use that are not flags (flags.ts conditionVars). Every canonical store is readable by id. */
export const CONDITION_VARS = new Set([
  ...CANONICAL_RESOURCES,
  "year",
  "season",
  "rank",
  "renown",
  "age",
  "units",
  "men_under_arms",
  "manses",
  "vacant_manses",
  "denarii",
  "horses",
  "households",
  "tenure",
  "charter",
  "visibility",
  "swornTo",
  "king",
  "emperor",
  "count",
  "severity",
  "viking_danger",
  "ladder",
  "away",
  "regional_famine",
  "hunger",
  "monastery_nearby",
  "relics",
]);

/**
 * Content lint (03_HISTORY §4.1, §15): closed vocabularies hold across the data.
 * Returns problems as strings; empty means clean. A test asserts emptiness.
 */
export function lintHistory(content: HistoryContent = historyContent()): string[] {
  const problems: string[] = [];
  const flagIds = content.flags;
  const setters = new Map<string, number>();

  const checkCondition = (where: string, src: string | undefined | null) => {
    if (!src) return;
    let refs;
    try {
      refs = referencedNames(src);
    } catch (err) {
      problems.push(`${where}: condition does not parse: ${(err as Error).message}`);
      return;
    }
    for (const f of refs.flags) {
      if (!flagIds.has(f) && !CONDITION_VARS.has(f)) problems.push(`${where}: unknown flag or variable '${f}' in "${src}"`);
    }
    for (const id of refs.events) {
      if (!content.byId.has(id)) problems.push(`${where}: condition names unknown event ${id}`);
    }
    for (const [eventId, optionId] of refs.choices) {
      const ev = content.byId.get(eventId);
      if (!ev) continue;
      const all = [...(ev.choices?.options ?? []), ...ev.stages.flatMap((s) => s.choices?.options ?? [])];
      if (!all.some((o) => o.id === optionId)) problems.push(`${where}: chose(${eventId}, ${optionId}) names an option that does not exist`);
    }
  };

  const checkEffects = (where: string, fxList: HistoryEffectsList | undefined) => {
    if (!fxList) return;
    const blocks: HistoryEffects[] = Array.isArray(fxList) ? fxList : [fxList];
    blocks.forEach((fx, i) => checkOneEffects(blocks.length > 1 ? `${where}[${i}]` : where, fx));
  };

  const checkOneEffects = (where: string, fx: HistoryEffects) => {
    checkCondition(`${where}.when`, fx.when);
    for (const [id, op] of Object.entries(fx.flags ?? {})) {
      const def = flagIds.get(id);
      if (!def) {
        problems.push(`${where}: sets unregistered flag '${id}'`);
        continue;
      }
      setters.set(id, (setters.get(id) ?? 0) + 1);
      if (typeof op === "string" && /^[+-]\d+$/.test(op)) {
        if (def.type !== "int") problems.push(`${where}: '${id}' is ${def.type}; cannot apply ${op}`);
      } else if (def.type === "enum") {
        if (typeof op !== "string" || !(def.values ?? []).includes(op)) problems.push(`${where}: '${id}' cannot be ${JSON.stringify(op)}`);
      } else if (def.type === "int" && typeof op === "string") {
        problems.push(`${where}: '${id}' is int; got "${op}"`);
      }
    }
    if (fx.scene?.open && !content.byId.has(fx.scene.open)) problems.push(`${where}: opens unknown scene ${fx.scene.open}`);
  };

  const checkOptions = (where: string, options: HistoryOption[], needDefault: boolean) => {
    const ids = new Set<string>();
    for (const o of options) {
      if (ids.has(o.id)) problems.push(`${where}: duplicate option id ${o.id}`);
      ids.add(o.id);
      checkCondition(`${where}.${o.id}.requires`, o.requires);
      checkEffects(`${where}.${o.id}`, o.effects);
    }
    const defaults = options.filter((o) => o.default);
    if (needDefault && !defaults.length) problems.push(`${where}: one option must be default`);
    if (defaults.filter((o) => !o.requires).length > 1) problems.push(`${where}: more than one unconditional default`);
  };

  const checkEvent = (e: HistoryEvent) => {
    const w = e.id;
    checkCondition(`${w}.requires`, e.requires);
    checkCondition(`${w}.unless`, e.unless);
    if (e.fallback && !content.byId.has(e.fallback)) problems.push(`${w}: fallback ${e.fallback} does not exist`);
    for (const [i, b] of e.script.entries()) {
      if (!e.channel.includes(b.speaker)) problems.push(`${w}.script[${i}]: speaker ${b.speaker} not in channel`);
      checkCondition(`${w}.script[${i}].when`, b.when);
    }
    for (const v of e.variants) {
      checkCondition(`${w}.variants`, v.when);
      if (v.replace >= e.script.length) problems.push(`${w}: variant replaces script[${v.replace}] which does not exist`);
    }
    checkEffects(`${w}.onFire`, e.onFire);
    if (e.choices) checkOptions(`${w}.choices`, e.choices.options, true);
    for (const h of e.hooks) {
      checkCondition(`${w}.hooks.${h.id}.requires`, h.requires);
      checkEffects(`${w}.hooks.${h.id}`, h.effects);
    }
    if (e.outcomes) {
      checkOptions(`${w}.outcomes`, e.outcomes.options, true);
      if (e.links.fixedPoint && e.outcomes.options.length > 1) problems.push(`${w}: a fixed point may not offer a judged outcome`);
    }
    const stageIds = new Set<string>();
    for (const s of e.stages) {
      if (stageIds.has(s.id)) problems.push(`${w}: duplicate stage id ${s.id}`);
      stageIds.add(s.id);
      checkCondition(`${w}.${s.id}.requires`, s.requires);
      for (const [i, b] of s.script.entries()) {
        if (!e.channel.includes(b.speaker)) problems.push(`${w}.${s.id}.script[${i}]: speaker ${b.speaker} not in channel`);
        checkCondition(`${w}.${s.id}.script[${i}].when`, b.when);
      }
      if (s.choices) checkOptions(`${w}.${s.id}.choices`, s.choices.options, true);
      for (const h of s.hooks) {
        checkCondition(`${w}.${s.id}.hooks.${h.id}.requires`, h.requires);
        checkEffects(`${w}.${s.id}.hooks.${h.id}`, h.effects);
      }
      if (s.outcomes) checkOptions(`${w}.${s.id}.outcomes`, s.outcomes.options, true);
      checkEffects(`${w}.${s.id}.exit`, s.exitEffects);
    }
    if (e.deferred === "battle" && !e.battle) problems.push(`${w}: deferred battle without battle data`);
    if (e.deferred === "promotion" && !e.promotion) problems.push(`${w}: deferred promotion without promotion data`);
    if (e.type === "battle" && e.deferred !== "battle") problems.push(`${w}: type battle must be deferred: "battle" in this pass`);
    if (e.type === "promotion" && e.deferred !== "promotion") problems.push(`${w}: type promotion must be deferred: "promotion" in this pass`);
    if (!e.script.length && !e.stages.length && e.deferred !== "promotion" && e.deferred !== "battle") problems.push(`${w}: nothing to say`);
    if (e.carry && e.carryMax < 1) problems.push(`${w}: carry without carryMax`);
  };

  for (const e of content.events) checkEvent(e);
  for (const [id, def] of content.flags) {
    if (def.setBy === "engine") continue;
    if (!setters.has(id)) problems.push(`flag '${id}' is registered but nothing sets it`);
  }
  return problems;
}

/** The lint without the "nothing sets it" rule, for partially written calendars. */
export function lintHistoryStructure(content: HistoryContent = historyContent()): string[] {
  return lintHistory(content).filter((p) => !p.includes("nothing sets it"));
}
