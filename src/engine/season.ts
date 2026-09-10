import type { SeasonEffectLine, WorldState } from "./schema";
import { YIELD_MID, labourKindFor, lookupProject } from "./projectCatalog";
import { autoFillLeftoverLabour, labourDaysFromAssignment } from "./labour";
import { modifiersFor, applyMultiplyAdd, moodFactor, tickModifiers, yieldMultiplier } from "./modifiers";
import { projectSpeed, resourceOutputBonus } from "./applyDelta";
import { consumeGrain, HOUSEHOLD_SEASON_GRAIN } from "./grain";
import { syncTradeFromFeatures } from "./merchant";
import { resolveHunts } from "./hunts";
import { flagCompletedProjectWantsTalk } from "./wantsTalk";
import { nextSeason, round0, round1 } from "./util";
import { featureName, landName, resourceName } from "../ui/ledgerCopy";

function harvestCrop(state: WorldState, crop: "wheat" | "rye" | "barley" | "oats"): string | null {
  let acres = 0;
  for (const h of state.holdings) acres += h.sown[crop];
  if (acres <= 0) return null;
  const spoilage = yieldMultiplier(state, crop);
  const base = YIELD_MID[crop] * acres;
  const amount = round1(resourceOutputBonus(state, crop, base * spoilage));
  state.resources[crop] = round1(state.resources[crop] + amount);
  for (const h of state.holdings) h.sown[crop] = 0;
  return `Harvested ${amount} modii of ${crop} from ${acres} acres.`;
}

function springBarleyShare(state: WorldState): number {
  return state.agriculture?.springBarleyShare ?? 0.6;
}

function autumnWheatShare(state: WorldState): number {
  return state.agriculture?.autumnWheatShare ?? 0.45;
}

function sowSpring(state: WorldState): string[] {
  const notes: string[] = [];
  const barleyShare = springBarleyShare(state);
  for (const h of state.holdings) {
    const sownCap = h.land.fertile_arable * 0.5;
    const already = h.sown.wheat + h.sown.rye;
    const remaining = Math.max(0, sownCap - already);
    if (remaining <= 0) {
      notes.push(`${h.name}: no spring sowing capacity (autumn crops occupy the sown half).`);
      continue;
    }
    const barley = round1(remaining * barleyShare);
    const oats = round1(remaining - barley);
    h.sown.barley = barley;
    h.sown.oats = oats;
    notes.push(`${h.name}: sowed ${barley} acres barley and ${oats} acres oats.`);
  }
  return notes;
}

function sowAutumn(state: WorldState): string[] {
  const notes: string[] = [];
  const wheatShare = autumnWheatShare(state);
  for (const h of state.holdings) {
    const sownCap = h.land.fertile_arable * 0.5;
    const wheat = round1(sownCap * wheatShare);
    const rye = round1(sownCap - wheat);
    h.sown.wheat = wheat;
    h.sown.rye = rye;
    h.sown.barley = 0;
    h.sown.oats = 0;
    notes.push(`${h.name}: sowed ${wheat} acres wheat and ${rye} acres rye for next year.`);
  }
  return notes;
}

function livestockSeason(state: WorldState): string[] {
  const notes: string[] = [];
  const season = state.meta.season;
  const livestockYield =
    applyMultiplyAdd(1, modifiersFor(state, "livestock_yield"), { lo: 0.4, hi: 2.5 }) * moodFactor(state) * (state.flags.hunger ? 0.9 : 1);
  if (season === "spring") {
    const wool = round0(resourceOutputBonus(state, "wool", state.resources.sheep * 2 * livestockYield));
    state.resources.wool += wool;
    notes.push(`Shearing: +${wool} lb wool.`);
  }
  if (season === "autumn") {
    const woodland = state.holdings.reduce((s, h) => s + h.land.woodland, 0);
    if (woodland >= 10) {
      const add = Math.floor(state.resources.pigs * 0.1);
      state.resources.pigs += add;
      if (add) notes.push(`Pannage: +${add} pigs.`);
    }
    const breed = Math.floor((state.resources.cattle + state.resources.sheep + state.resources.horses) * 0.05);
    if (breed > 0) {
      state.resources.sheep += breed;
      notes.push(`Herd increase: +${breed} sheep (young stock).`);
    }
    if (state.holdings.some((h) => h.features.includes("monastery")) && state.resources.sheep >= 1) {
      state.resources.sheep -= 1;
      notes.push("Tithe: 1 sheep to the cell (the year's increase).");
    }
    const wineAcres = state.holdings.reduce((s, h) => s + h.land.vineyard, 0);
    if (wineAcres > 0) {
      const wine = round1(resourceOutputBonus(state, "wine", wineAcres * 0.6 * livestockYield));
      state.resources.wine += wine;
      notes.push(`Vintage: +${wine} barrels wine.`);
    }
    const orch = state.holdings.reduce((s, h) => s + h.land.orchard, 0);
    if (orch > 0) {
      const goods = round0(orch * 3);
      state.resources.trade_goods += goods;
      notes.push(`Orchard: +${goods} ${resourceName("trade_goods")} (dried fruit / cider value).`);
    }
  }
  if (season === "winter") {
    const meadow = state.holdings.reduce((s, h) => s + h.land.meadow, 0);
    const grazers = state.resources.cattle + state.resources.horses;
    if (meadow < grazers) {
      const loseC = Math.floor(state.resources.cattle * 0.05);
      const loseH = Math.floor(state.resources.horses * 0.05);
      state.resources.cattle -= loseC;
      state.resources.horses -= loseH;
      if (loseC || loseH) notes.push(`Hard winter fodder: lost ${loseC} cattle, ${loseH} horses.`);
    } else if (Math.random() < 1 / 6) {
      if (state.resources.cattle > 0) {
        state.resources.cattle -= 1;
        notes.push("One beast lost despite adequate meadow.");
      }
    }
    if (state.resources.oats + state.resources.barley < 1) {
      const loseP = Math.floor(state.resources.pigs * 0.02);
      const loseS = Math.floor(state.resources.sheep * 0.02);
      state.resources.pigs -= loseP;
      state.resources.sheep -= loseS;
      if (loseP || loseS) notes.push(`Empty fodder stores: lost ${loseP} pigs, ${loseS} sheep.`);
    }
    const woodland = state.holdings.reduce((s, h) => s + h.land.woodland, 0);
    if (woodland >= 10) {
      state.resources.softwood += 1;
      notes.push("Winter woodland cut: +1 cart-load softwood.");
    }
  }
  return notes;
}

function advanceProjects(state: WorldState): string[] {
  const notes: string[] = [];
  notes.push(...autoFillLeftoverLabour(state));
  for (const proj of state.projects.filter((p) => p.status === "active")) {
    if (proj.tag === "hunt" || proj.hunt) continue;
    const assign = state.labour.assigned.find((a) => a.projectId === proj.id);
    if (!assign) {
      notes.push(`${proj.name}: no extra hands called this season.`);
      continue;
    }
    const kind = labourKindFor(proj);
    let days = labourDaysFromAssignment(kind, assign.men, assign.women, assign.youths);
    const rush = proj.rush ? 1.15 : 1;
    days *= projectSpeed(state, rush);
    proj.labourDaysDone = round1(proj.labourDaysDone + days);
    const owed = Math.max(0, round1(proj.labourDaysRequired - proj.labourDaysDone));
    notes.push(
      `${proj.name}: ${round1(days)} days of work done this season; ${owed === 0 ? "the work is finished" : `${owed} days still owed`}.`,
    );
    if (proj.labourDaysDone >= proj.labourDaysRequired) {
      proj.status = "completed";
      const holding = state.holdings.find((h) => h.id === proj.holdingId);
      const cat = lookupProject(proj.key);
      if (holding && cat?.completesToFeature && !holding.features.includes(cat.completesToFeature)) {
        holding.features.push(cat.completesToFeature);
        notes.push(`${proj.name} is finished: a ${featureName(cat.completesToFeature)} now stands on ${holding.name}.`);
      } else if (holding && cat?.completesToLand) {
        const acres = cat.completesToLand.acres ?? 1;
        holding.land[cat.completesToLand.from] = Math.max(0, holding.land[cat.completesToLand.from] - acres);
        holding.land[cat.completesToLand.to] += acres;
        notes.push(
          `${proj.name} is finished: ${acres} acre${acres === 1 ? "" : "s"} of ${landName(cat.completesToLand.from)} is now ${landName(cat.completesToLand.to)}.`,
        );
      } else {
        notes.push(`${proj.name} is finished.`);
      }
      flagCompletedProjectWantsTalk(state, proj);
      syncTradeFromFeatures(state);
    }
  }
  state.labour.assigned = state.labour.assigned.filter((a) =>
    state.projects.some((p) => p.id === a.projectId && p.status === "active"),
  );
  return notes;
}

export function resolveAgricultureAndProjects(state: WorldState): SeasonEffectLine[] {
  const lines: SeasonEffectLine[] = [];
  const add = (text: string) => lines.push({ kind: "info", text });

  const households = state.population.households;
  state.flags.hunger = false;
  add(consumeGrain(state, round1(households * HOUSEHOLD_SEASON_GRAIN), "Households"));
  if (state.holdings.some((h) => h.features.includes("monastery") || h.features.includes("chapel"))) {
    const hasMonastery = state.holdings.some((h) => h.features.includes("monastery"));
    const house = hasMonastery ? "cell" : "oratory";
    add(consumeGrain(state, round1(households * 0.15), `Tithe to the ${house}`));
    const woolRender = 1;
    if (state.resources.wool >= woolRender) {
      state.resources.wool = round1(state.resources.wool - woolRender);
      add(`Tithe: ${woolRender} lb wool to the ${house}.`);
    }
  }

  const season = state.meta.season;
  if (season === "spring") sowSpring(state).forEach(add);
  if (season === "summer") {
    const w = harvestCrop(state, "wheat");
    const r = harvestCrop(state, "rye");
    if (w) add(w);
    if (r) add(r);
  }
  if (season === "autumn") {
    const b = harvestCrop(state, "barley");
    const o = harvestCrop(state, "oats");
    if (b) add(b);
    if (o) add(o);
    sowAutumn(state).forEach(add);
  }
  livestockSeason(state).forEach(add);
  advanceProjects(state).forEach(add);
  resolveHunts(state).forEach(add);
  return lines;
}

export function finishSeasonClock(state: WorldState): SeasonEffectLine[] {
  const notes = tickModifiers(state);
  const next = nextSeason(state.meta.year, state.meta.season);
  state.meta.year = next.year;
  state.meta.season = next.season;
  state.meta.turn += 1;
  notes.push(...autoFillLeftoverLabour(state));
  return notes.map((text) => ({ kind: "info" as const, text }));
}
