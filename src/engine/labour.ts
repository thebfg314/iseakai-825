import type { LabourAssignment, Project, WorldState } from "./schema";
import { LABOUR_MIDPOINTS, labourKindFor } from "./projectCatalog";
import { modifiersFor, applyMultiplyAdd, moodFactor } from "./modifiers";

export type LabourPool = {
  men: number;
  women: number;
  youths: number;
};

export type LabourKind = "mostly_men" | "men_women" | "mixed";

export type LabourRole = keyof LabourPool;

/**
 * Constitution §4.3: women may only do small leftover assist on mostly-men
 * heavy work (0.6 factor). Larger leftover waits for men next season.
 */
export const MOSTLY_MEN_WOMAN_ASSIST_DAYS = 6;

/** Indoor / skilled craft where a few youths may assist after women and men. */
export const LIGHT_YOUTH_ASSIST_KEYS = new Set(["textile_workshop", "pottery_kiln"]);

/** Constitution §4.3: most dangerous / heaviest mostly-men works — no auto women. */
export const MOSTLY_MEN_NO_WOMEN_KEYS = new Set(["quarry", "wooden_tower", "drain_swamp"]);

const EMPTY_POOL: LabourPool = { men: 0, women: 0, youths: 0 };

export function labourPool(state: WorldState): LabourPool {
  const mid = LABOUR_MIDPOINTS[state.meta.season];
  const eff = applyMultiplyAdd(1, modifiersFor(state, "labour_efficiency"), { lo: 0.4, hi: 2.5 }) * moodFactor(state);
  return {
    men: Math.round(state.population.adult_men * mid.men * eff),
    women: Math.round(state.population.adult_women * mid.women * eff),
    youths: Math.round(state.population.youths * mid.youths * eff),
  };
}

export function labourUsed(state: WorldState): LabourPool {
  const used: LabourPool = { men: 0, women: 0, youths: 0 };
  for (const a of state.labour.assigned) {
    used.men += a.men;
    used.women += a.women;
    used.youths += a.youths;
  }
  return used;
}

export function labourRemaining(state: WorldState): LabourPool {
  const pool = labourPool(state);
  const used = labourUsed(state);
  return {
    men: Math.max(0, pool.men - used.men),
    women: Math.max(0, pool.women - used.women),
    youths: Math.max(0, pool.youths - used.youths),
  };
}

export function labourDaysFromAssignment(
  kind: LabourKind,
  men: number,
  women: number,
  youths: number,
): number {
  const womanFactor = kind === "mostly_men" ? 0.6 : 1;
  const youthFactor = 0.4;
  return men + women * womanFactor + youths * youthFactor;
}

export function isLabourDayProject(project: Project): boolean {
  if (project.status !== "active") return false;
  if (project.tag === "hunt" || project.hunt) return false;
  return true;
}

function normalizeProjectRef(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, "_");
}

function summaryRefersToTheWork(summary?: string): boolean {
  if (!summary) return false;
  return /\b(the|that|this)\s+(work|mill|project|job)\b/i.test(summary);
}

/**
 * Match assign_labour / adjust_project refs: generated id, catalog key, or display name.
 * Does not guess among several active works; a lone labour-day work is used only when
 * the summary clearly means "the" work.
 */
export function resolveActiveProject(state: WorldState, projectIdRef: string, summary?: string): Project | undefined {
  const ref = projectIdRef.trim();
  if (!ref || ref === "unassigned") return undefined;
  const active = state.projects.filter((p) => p.status === "active");
  const byId = active.find((p) => p.id === ref);
  if (byId) return byId;

  const keyNorm = normalizeProjectRef(ref);
  const byKey = active.filter((p) => p.key === ref || normalizeProjectRef(p.key) === keyNorm);
  if (byKey.length === 1) return byKey[0];
  if (byKey.length > 1) return undefined;

  const nameNorm = ref.toLowerCase().trim();
  const byName = active.filter((p) => p.name.toLowerCase().trim() === nameNorm);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return undefined;

  const labourWorks = active.filter(isLabourDayProject);
  if (labourWorks.length === 1 && summaryRefersToTheWork(summary)) return labourWorks[0];
  return undefined;
}

export function projectDaysStillNeeded(project: Project): number {
  return Math.max(0, project.labourDaysRequired - project.labourDaysDone);
}

/**
 * Constitution §4.3 fill order for leftover extra days.
 * mixed: youths, then women, then men.
 * men_women: women, then men; youths last only on light craft (textile / pottery).
 * mostly_men: men first; never youths; women only as small leftover assist, and
 * not on quarry / tower / swamp drain.
 */
export function autoFillRoles(kind: LabourKind, projectKey: string): LabourRole[] {
  if (kind === "mixed") return ["youths", "women", "men"];
  if (kind === "men_women") {
    return LIGHT_YOUTH_ASSIST_KEYS.has(projectKey) ? ["women", "men", "youths"] : ["women", "men"];
  }
  if (MOSTLY_MEN_NO_WOMEN_KEYS.has(projectKey)) return ["men"];
  return ["men", "women"];
}

function coversNeed(kind: LabourKind, heads: LabourPool, remainingDays: number): boolean {
  return labourDaysFromAssignment(kind, heads.men, heads.women, heads.youths) + 1e-9 >= remainingDays;
}

/**
 * Extra heads (youths / women / men) to take from `available` so `already`
 * plus the result covers `remainingDays`, without dumping surplus people.
 */
export function leftoverHeadsForNeed(
  kind: LabourKind,
  projectKey: string,
  remainingDays: number,
  available: LabourPool,
  already: LabourPool = EMPTY_POOL,
): LabourPool {
  const added: LabourPool = { men: 0, women: 0, youths: 0 };
  if (remainingDays <= 1e-9) return added;
  const current: LabourPool = { ...already };
  const pool: LabourPool = { ...available };
  for (const role of autoFillRoles(kind, projectKey)) {
    if (role === "women" && kind === "mostly_men") {
      const still = remainingDays - labourDaysFromAssignment(kind, current.men, current.women, current.youths);
      if (still > MOSTLY_MEN_WOMAN_ASSIST_DAYS + 1e-9) continue;
    }
    while (pool[role] > 0 && !coversNeed(kind, current, remainingDays)) {
      current[role] += 1;
      added[role] += 1;
      pool[role] -= 1;
    }
  }
  return added;
}

export function labourCalledPhrase(men: number, women: number, youths: number): string {
  const parts: string[] = [];
  if (men) parts.push(`${men} ${men === 1 ? "man" : "men"}`);
  if (women) parts.push(`${women} ${women === 1 ? "woman" : "women"}`);
  if (youths) parts.push(`${youths} ${youths === 1 ? "youth" : "youths"}`);
  if (!parts.length) return "";
  const who =
    parts.length === 1 ? parts[0] : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
  return `${who} called this season`;
}

export function labourCalledSentence(workName: string, men: number, women: number, youths: number): string {
  const phrase = labourCalledPhrase(men, women, youths);
  if (!phrase) return "";
  const dest = workName.replace(/^(the|a|an)\s+/i, "");
  return `I have called ${phrase.replace(" called this season", "")} to the ${dest}.`;
}

function assignmentOn(state: WorldState, projectId: string): LabourAssignment | undefined {
  return state.labour.assigned.find((a) => a.projectId === projectId);
}

function writeAssignment(state: WorldState, projectId: string, heads: LabourPool): void {
  const existing = assignmentOn(state, projectId);
  if (existing) {
    existing.men = heads.men;
    existing.women = heads.women;
    existing.youths = heads.youths;
  } else if (heads.men || heads.women || heads.youths) {
    state.labour.assigned.push({ projectId, men: heads.men, women: heads.women, youths: heads.youths });
  }
}

export type AutoAssignResult = {
  projectId: string;
  name: string;
  added: LabourPool;
  total: LabourPool;
  sentence: string;
};

/**
 * Top up one labour-day work from the leftover extra-day pool.
 * Never reduces an assignment already on the row; never takes heads from another work.
 */
export function autoAssignLeftoverToProject(state: WorldState, projectId: string): AutoAssignResult | null {
  const project = resolveActiveProject(state, projectId) ?? state.projects.find((p) => p.id === projectId);
  if (!project || !isLabourDayProject(project)) return null;
  projectId = project.id;
  const kind = labourKindFor(project);
  const already = assignmentOn(state, projectId) ?? { men: 0, women: 0, youths: 0 };
  const remainingDays = projectDaysStillNeeded(project);
  const added = leftoverHeadsForNeed(kind, project.key, remainingDays, labourRemaining(state), already);
  const total: LabourPool = {
    men: already.men + added.men,
    women: already.women + added.women,
    youths: already.youths + added.youths,
  };
  if (added.men || added.women || added.youths) writeAssignment(state, projectId, total);
  const sentence = labourCalledSentence(project.name, total.men, total.women, total.youths);
  if (!added.men && !added.women && !added.youths) return sentence ? { projectId, name: project.name, added, total, sentence } : null;
  return { projectId, name: project.name, added, total, sentence };
}

/**
 * Oldest / first active labour-day work first. Skips hunts. Only tops up free remainder.
 */
export function autoFillLeftoverLabour(state: WorldState): string[] {
  const notes: string[] = [];
  for (const project of state.projects) {
    if (!isLabourDayProject(project)) continue;
    if (projectDaysStillNeeded(project) <= 1e-9) continue;
    const leftover = labourRemaining(state);
    if (leftover.men <= 0 && leftover.women <= 0 && leftover.youths <= 0) break;
    const result = autoAssignLeftoverToProject(state, project.id);
    if (!result) continue;
    const added = result.added;
    if (!added.men && !added.women && !added.youths) continue;
    if (result.sentence) notes.push(result.sentence);
  }
  return notes;
}

export type PendingLabourHint = {
  status: string;
  proposal: { type: string; projectId?: string; men?: number; women?: number; youths?: number; summary?: string };
};

export function pendingAssignLabourForNewProject(
  pending: PendingLabourHint[],
  newProjectId: string,
  activeProjectIds: Set<string>,
): { type: "assign_labour"; projectId: string; men: number; women: number; youths: number; summary?: string } | null {
  for (const item of pending) {
    if (item.status !== "pending") continue;
    const p = item.proposal;
    if (p.type !== "assign_labour") continue;
    const id = p.projectId;
    if (!id || id === "unassigned") continue;
    if (id === newProjectId || !activeProjectIds.has(id)) {
      return {
        type: "assign_labour",
        projectId: id,
        men: p.men ?? 0,
        women: p.women ?? 0,
        youths: p.youths ?? 0,
        summary: p.summary,
      };
    }
  }
  return null;
}
