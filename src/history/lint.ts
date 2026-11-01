import { unitSheet } from "../combat/registry";
import { CANONICAL_RESOURCES } from "../engine/schema";
import { referencedNames } from "./conditions";
import { historyContent, type HistoryContent } from "./load";
import type { HistoryEffects, HistoryEffectsList, HistoryEvent, HistoryOption } from "./schema";
import { isSlotName } from "./slots";

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
  "quest",
  "quest_attempt",
  "allies",
  "happiness",
  "favour",
  "away",
  "regional_famine",
  "hunger",
  "monastery_nearby",
  "relics",
  "villas",
  "counties",
  "vassals",
  "vassal_mood",
  "trade_health",
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
    for (const [id, amount] of [...Object.entries(fx.cost ?? {}), ...Object.entries(fx.gain ?? {})]) {
      if (typeof amount === "string" && !isSlotName(amount.replace(/^\{|\}$/g, ""))) problems.push(`${where}: ${id} names unknown amount slot ${amount}`);
    }
    if (fx.promote) {
      checkCondition(`${where}.promote.scaleWhen`, fx.promote.scaleWhen);
      if (fx.promote.mark) {
        const def = flagIds.get(fx.promote.mark);
        if (!def) problems.push(`${where}.promote: marks unregistered flag '${fx.promote.mark}'`);
        else if (def.type !== "bool") problems.push(`${where}.promote: mark '${fx.promote.mark}' must be a bool flag`);
        else setters.set(fx.promote.mark, (setters.get(fx.promote.mark) ?? 0) + 1);
      }
      checkEffects(`${where}.promote.onPromote`, fx.promote.onPromote as HistoryEffectsList | undefined);
      checkEffects(`${where}.promote.onThanks`, fx.promote.onThanks as HistoryEffectsList | undefined);
    }
    if (fx.grant && !fx.grant.villas && !fx.grant.county) problems.push(`${where}: grant of nothing`);
  };

  const checkSlots = (where: string, text: string) => {
    for (const m of text.matchAll(/\{([a-z0-9_]+)\}/g)) {
      if (!isSlotName(m[1])) problems.push(`${where}: unknown slot {${m[1]}} in script`);
    }
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
      checkSlots(`${w}.script[${i}]`, b.text);
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
    if (e.type === "promotion" && !e.rolled) {
      // Rolled windows (Q-003) are settled by the system that rolls them; dated ones must carry the grant in data.
      const blocks = (fx: HistoryEffectsList | undefined): HistoryEffects[] => (!fx ? [] : Array.isArray(fx) ? fx : [fx]);
      const all = [...blocks(e.onFire), ...e.choices?.options.flatMap((o) => blocks(o.effects)) ?? [], ...e.stages.flatMap((s) => [...blocks(s.exitEffects), ...(s.choices?.options.flatMap((o) => blocks(o.effects)) ?? [])])];
      if (!all.some((fx) => fx.promote || fx.grant)) problems.push(`${w}: a promotion window must carry a promote or grant effect`);
    }
    if (e.type === "battle" && e.deferred !== "battle") problems.push(`${w}: type battle must be deferred: "battle" (the battle pass reads event.battle and the forces table)`);
    if (e.deferred === "battle" && content.battles.length && !content.battles.some((b) => b.event === e.id && !b.supply)) problems.push(`${w}: deferred battle without a forces table entry (data/history/battles.json)`);
    if (e.type === "promotion" && e.deferred !== "promotion") problems.push(`${w}: type promotion must be deferred: "promotion" in this pass`);
    if (!e.script.length && !e.stages.length && e.deferred !== "promotion" && e.deferred !== "battle") problems.push(`${w}: nothing to say`);
    if (e.carry && e.carryMax < 1) problems.push(`${w}: carry without carryMax`);
  };

  for (const e of content.events) checkEvent(e);
  for (const b of content.battles) checkForces(b);
  function checkForces(b: HistoryContent["battles"][number]) {
    const w = `battles.${b.id}`;
    const ev = content.byId.get(b.event);
    if (!ev) problems.push(`${w}: names unknown event ${b.event}`);
    else if (b.supply) {
      if (!ev.supplyCheck) problems.push(`${w}: a supply-check battle on an event without a supply check`);
      else if (!b.home) problems.push(`${w}: a supply-check battle must be home defence`);
    } else if (ev.deferred !== "battle") problems.push(`${w}: ${b.event} is not a deferred battle`);
    checkCondition(`${w}.when`, b.when);
    const sheets = (lines: { sheet: string }[], where: string) => {
      for (const l of lines) if (!unitSheet(l.sheet)) problems.push(`${where}: unknown unit sheet '${l.sheet}'`);
    };
    sheets(b.enemy, `${w}.enemy`);
    for (const [rank, row] of Object.entries(b.rows)) {
      sheets(row.allies, `${w}.rows.${rank}`);
      if (row.fill) sheets(row.fill, `${w}.rows.${rank}.fill`);
      if (b.home && (row.allies.length || row.slots)) problems.push(`${w}.rows.${rank}: home defence has no allies at any rank`);
    }
    if (!b.home && !b.quest && !Object.keys(b.rows).length) problems.push(`${w}: no allied rows`);
    for (const key of ["won", "lost", "held", "any"] as const) checkEffects(`${w}.results.${key}`, b.results?.[key]);
    if (b.survivor) {
      checkEffects(`${w}.survivor`, b.survivor.effects);
      const named = Object.values(b.rows).some((r) => r.allies.some((l) => l.id === b.survivor!.unit));
      if (!named) problems.push(`${w}.survivor: no allied line carries id '${b.survivor.unit}'`);
    }
    checkEffects(`${w}.onRefuse`, b.onRefuse);
    for (const [i, a] of b.abstract.entries()) if (a.morale === 0) problems.push(`${w}.abstract[${i}]: a morale event of nothing`);
  }
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
