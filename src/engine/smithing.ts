import type { MechanicalProposal, Project, WorldState } from "./schema";
import { FORGE_PROJECT_KEYS, lookupProject } from "./projectCatalog";
import { markProjectSeason, stampProjectEnded } from "./projectProgress";
import { payFinishedProjectResult } from "./projectResult";
import { round1 } from "./util";

/**
 * Working days a full-time craftsman gives in one season: thirteen weeks
 * less Sundays and feast days. The smith reckons his pieces in these days;
 * the books turn them into seasons. (The old figure was the villagers' spare
 * days, about 20, which turned a two-season piece into nine.)
 */
export const SMITH_SEASON_DAYS = 70;

export function oneSmithSeasonDays(): number {
  return SMITH_SEASON_DAYS;
}

/** Seasons of one smith that a count of hearth days implies. */
export function seasonsOfOneSmith(forgeDays: number): number {
  const season = oneSmithSeasonDays();
  if (season <= 0) return 1;
  const days = Math.max(0, forgeDays);
  if (days <= season) return 1;
  return Math.ceil(days / season);
}

type MaterialBill = { lumber: number; iron: number; stone: number; forgeDays?: number };

/** Days at the hearth a live project still owes the smith, when the card named them. */
export function forgeDaysRequired(project: Pick<Project, "smithing" | "labourDaysRequired">): number {
  if (project.smithing?.forgeDaysRequired != null) return project.smithing.forgeDaysRequired;
  return project.labourDaysRequired;
}

/** True when the card named both his hearth days and days for the village. */
export function villageCalledOnSmithing(project: Pick<Project, "smithing" | "labourDaysRequired">): boolean {
  return project.smithing?.forgeDaysRequired != null && project.labourDaysRequired > 0;
}

/**
 * A workshop needs ordinary woodworking: timber and stone together, as the
 * forge, the bloomery, and the trip-hammer do, or timber with no iron in it.
 * A tool may use a wooden board or haft and still be his, so long as it is not that structure.
 */
export function isWoodworkingBuilding(bill: MaterialBill): boolean {
  if (bill.lumber > 0 && bill.stone > 0) return true;
  if (bill.lumber > 0 && bill.iron <= 0) return true;
  return false;
}

/**
 * His own hands: a new design that is a tool or a metal piece, or any card
 * that names days at the hearth. A catalogue work is never this — forge
 * buildings keep the village. A card with forgeDays 0 is village work only.
 */
export function isPersonalSmithing(key: string, bill: MaterialBill, tag?: string): boolean {
  if (lookupProject(key)) return false;
  if (bill.forgeDays != null) return bill.forgeDays > 0;
  if (isWoodworkingBuilding(bill)) return false;
  if (bill.iron > 0) return true;
  return bill.lumber <= 0 && bill.stone <= 0 && tag === "forge";
}

/** The smith's clock runs on this work (alone, or beside the village's days). */
export function isPersonalSmithProject(project: Pick<Project, "key" | "tag" | "materials" | "smithing">): boolean {
  if (project.smithing) return true;
  return isPersonalSmithing(project.key, project.materials, project.tag);
}

/** His clock runs and the village is not called: no spare days may be pointed at it. */
export function isSoloSmithProject(
  project: Pick<Project, "key" | "tag" | "materials" | "smithing" | "labourDaysRequired">,
): boolean {
  return isPersonalSmithProject(project) && !villageCalledOnSmithing(project);
}

/** Catalogue forge works, and a new workshop of that same kind. Not his solo clock. */
export function isVillageForgeBuilding(key: string, bill: MaterialBill, tag?: string): boolean {
  const catalog = lookupProject(key);
  if (catalog) return FORGE_PROJECT_KEYS.has(catalog.key);
  if (tag !== "forge") return false;
  return isWoodworkingBuilding(bill);
}

type StartProject = Extract<MechanicalProposal, { type: "start_project" }>;

function startBill(p: StartProject): MaterialBill & { labourDays: number } {
  const custom = p.customCosts;
  const catalog = lookupProject(p.projectKey);
  return {
    labourDays: custom?.labourDays ?? catalog?.labourDays ?? 0,
    lumber: custom?.lumber ?? catalog?.lumber ?? 0,
    iron: custom?.iron ?? catalog?.iron ?? 0,
    stone: custom?.stone ?? catalog?.stone ?? 0,
    forgeDays: custom?.forgeDays,
  };
}

export function startIsPersonalSmithing(p: StartProject): boolean {
  if (lookupProject(p.projectKey)) return false;
  const bill = startBill(p);
  return isPersonalSmithing(p.projectKey, bill, p.tag);
}

/** His clock, and no days for the village on the same card. */
export function startIsSoloSmithing(p: StartProject): boolean {
  if (!startIsPersonalSmithing(p)) return false;
  return startVillageDays(p) <= 0;
}

/** Days the village gives to a card: on his own cards only when forgeDays is named beside them. */
export function startVillageDays(p: StartProject): number {
  const bill = startBill(p);
  if (!startIsPersonalSmithing(p)) return bill.labourDays;
  return bill.forgeDays != null ? bill.labourDays : 0;
}

/** Days at the hearth a card asks of him. A legacy card (no forgeDays) read its labourDays as his. */
export function startForgeDays(p: StartProject): number {
  const bill = startBill(p);
  return bill.forgeDays ?? bill.labourDays;
}

export function startIsVillageForgeBuilding(p: StartProject): boolean {
  return isVillageForgeBuilding(p.projectKey, startBill(p), p.tag);
}

export function personalSeasonsForStart(p: StartProject): number {
  return seasonsOfOneSmith(startForgeDays(p));
}

/** Drop spare-day rows that were pointed at his own solo piece. Those days go back to the pool. */
export function releaseVillageFromPersonalSmithing(state: WorldState): void {
  const solo = new Set(state.projects.filter((p) => isSoloSmithProject(p)).map((p) => p.id));
  if (solo.size === 0) return;
  state.labour.assigned = state.labour.assigned.filter((a) => !solo.has(a.projectId));
}

export function activePersonalSmithing(state: WorldState): Project | undefined {
  return state.projects.find((p) => p.status === "active" && isPersonalSmithProject(p));
}

/** A personal piece that will not finish in the season it was begun. */
export function longPersonalSmithing(state: WorldState): Project | undefined {
  return state.projects.find(
    (p) => p.status === "active" && p.smithing != null && p.smithing.durationSeasons > 1,
  );
}

export function hiredSmithName(state: { npcs: { id: string; name: string; role: string }[] } | undefined): string | undefined {
  if (!state) return undefined;
  const npc = state.npcs.find((n) => n.id === "smith" || n.role === "smith");
  const name = npc?.name?.trim();
  return name || undefined;
}

function theWork(name: string): string {
  const bare = (name.trim() || "that work").replace(/^(the|a|an)\s+/i, "");
  return `the ${bare.charAt(0).toLowerCase()}${bare.slice(1)}`;
}

function sentenceWork(name: string): string {
  const phrase = theWork(name);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Bernard, in his own mouth. */
export function smithStillAtSpeech(workName: string): string {
  return `I am still at ${theWork(workName)}. The next thing waits until that work is finished.`;
}

/** Confirm, and the books. Names the smith only when he is already of the household. */
export function smithStillAtConfirm(state: WorldState, workName: string): string {
  const name = hiredSmithName(state);
  const who = name ?? "The smith";
  return `${who} is still at ${theWork(workName)}. The next thing waits until that work is finished.`;
}

export function villageNotCalledReason(state: WorldState, workName: string): string {
  const name = hiredSmithName(state);
  const who = name ? `${name}'s` : "the smith's";
  return `${sentenceWork(workName)} is ${who} own work. The village is not called to it.`;
}

function daysWord(n: number): string {
  const d = round1(n);
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
}

export function ownWorkBegunPhrase(state: WorldState, seasons: number, forgeDays?: number): string {
  const name = hiredSmithName(state);
  const who = name ?? "The smith";
  const hearth = forgeDays != null && forgeDays > 0 ? ` (${daysWord(forgeDays)} at the hearth)` : "";
  if (seasons <= 1) return `${who} will see to this himself this season${hearth}, and then he is free.`;
  return `${who} will stay at this until it is finished${hearth}. The next thing waits.`;
}

/**
 * The cost line on a card. villageDays > 0 means the card also calls the
 * village; otherwise the piece is his alone.
 */
export function ownWorkCostPhrase(seasons: number, smithName?: string, forgeDays?: number, villageDays = 0): string {
  const who = smithName?.trim() || "the smith";
  const hearth = forgeDays != null && forgeDays > 0 ? `${daysWord(forgeDays)} at the hearth` : "";
  const village = villageDays > 0 ? `The village gives ${daysWord(villageDays)} beside him.` : "The village is not called.";
  if (seasons <= 1) {
    const own = hearth ? `${hearth}: ${who}'s own work for this season.` : `This is ${who}'s own work for this season.`;
    return `${own} ${village}`;
  }
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const n = seasons < words.length ? words[seasons] : String(seasons);
  const own = hearth ? `${hearth}: this keeps ${who} ${n} seasons.` : `This keeps ${who} ${n} seasons.`;
  return `${own} The next thing waits until it is finished. ${village}`;
}

export function smithProgressLine(
  elapsed: number,
  duration: number,
  forge?: { done?: number; required?: number },
): string {
  const left = Math.max(0, duration - elapsed);
  const words = ["", "one season", "two seasons", "three seasons", "four seasons", "five seasons", "six seasons", "seven seasons", "eight seasons"];
  const count = (n: number) => (n < words.length ? words[n] : `${n} seasons`);
  const hearth =
    forge?.required != null && forge.required > 0
      ? `${daysWord(Math.min(forge.done ?? 0, forge.required))} of ${daysWord(forge.required)} at the hearth`
      : "";
  if (left <= 0) return hearth ? `${hearth} · finished` : "finished";
  if (elapsed <= 0) {
    const base = duration <= 1 ? "this season, then he is free" : `${count(duration)} of his own work`;
    return hearth ? `${hearth} · ${base}` : base;
  }
  const tail = left === 1 ? "finished when the season turns" : `${count(left)} yet`;
  return hearth ? `${hearth} · ${tail}` : `still at it · ${tail}`;
}

/**
 * Why a new start must wait. A one-season piece occupies him until the season
 * turns, the way a short errand occupies Gerulf, but it does not hold up a building.
 * A longer piece holds the next piece and the next building.
 */
export function smithStartRefusal(state: WorldState, p: StartProject): string | null {
  const current = activePersonalSmithing(state);
  if (!current) return null;
  if (startIsPersonalSmithing(p)) return smithStillAtConfirm(state, current.name);
  if (startIsVillageForgeBuilding(p) && longPersonalSmithing(state)) return smithStillAtConfirm(state, current.name);
  return null;
}

const BUILDING_ASK = /\b(bloomery|forge mill|trip[- ]hammer|workshop|building)\b/i;
const BEGIN_ASK = /\b(build|begin|start|raise|new)\b/i;
const PIECE_ASK = /\b(forge|fashion|hammer|tool|share|plough|plow|blade|lock|anvil|hinge|piece|make|build|begin|start)\b/i;
const ASSIGN_ASK = /\b(assign|spare days|men's work|women's work|youths' work|call the (?:men|women|youths)|put the (?:men|people|hands))\b/i;
const QUESTION = /^(how|what|why|who|where|when|tell me|report|status|explain|describe)\b/i;

/** Hall speech when an order asks him to start something he will not begin. Null if the order may proceed. */
export function smithSpeechForOrder(state: WorldState, playerText: string): string | null {
  const current = activePersonalSmithing(state);
  if (!current) return null;
  const t = playerText.trim();
  if (!t) return null;
  if (QUESTION.test(t) && !BEGIN_ASK.test(t)) return null;
  const building = BUILDING_ASK.test(t);
  if (building && BEGIN_ASK.test(t)) {
    return longPersonalSmithing(state) ? smithStillAtSpeech(current.name) : null;
  }
  if (PIECE_ASK.test(t) && !building) return smithStillAtSpeech(current.name);
  if (ASSIGN_ASK.test(t) && !building) return villageNotCalledReason(state, current.name);
  return null;
}

function refMatches(ref: string, candidate: string | undefined): boolean {
  if (!candidate?.trim()) return false;
  const a = ref.trim().toLowerCase().replace(/\s+/g, " ");
  const b = candidate.trim().toLowerCase().replace(/\s+/g, " ");
  return a === b || a.replace(/ /g, "_") === b.replace(/ /g, "_");
}

function activeByRef(state: WorldState, ref: string): Project | undefined {
  return state.projects.find(
    (p) => p.status === "active" && (p.id === ref || refMatches(ref, p.key) || refMatches(ref, p.name)),
  );
}

/** Hands pointed at a piece that is his alone (no village days named on the card). */
function assignIsPersonal(state: WorldState, projectId: string, proposals: MechanicalProposal[]): boolean {
  const live = activeByRef(state, projectId);
  if (live && isSoloSmithProject(live)) return true;
  for (const p of proposals) {
    if (p.type !== "start_project") continue;
    if (!startIsSoloSmithing(p)) continue;
    if (refMatches(projectId, p.id) || refMatches(projectId, p.projectKey) || refMatches(projectId, p.name)) return true;
  }
  return false;
}

/**
 * Drop village hands aimed at his own piece, and drop a start the busy rule refuses.
 * Speech is the line he should say; null when nothing was refused.
 */
export function guardSmithProposals(
  state: WorldState,
  proposals: MechanicalProposal[],
): { proposals: MechanicalProposal[]; speech: string | null } {
  const kept: MechanicalProposal[] = [];
  let speech: string | null = null;
  for (const p of proposals) {
    if (p.type === "assign_labour" && p.projectId !== "unassigned" && assignIsPersonal(state, p.projectId, proposals)) {
      continue;
    }
    if (p.type === "adjust_project" && p.labourThisSeason) {
      const live = activeByRef(state, p.projectId);
      if (live && isPersonalSmithProject(live)) {
        if (p.cancel || p.rush) {
          kept.push({ ...p, labourThisSeason: undefined });
        }
        continue;
      }
    }
    if (p.type === "start_project") {
      const why = smithStartRefusal(state, p);
      if (why) {
        const current = activePersonalSmithing(state);
        speech = current ? smithStillAtSpeech(current.name) : why;
        continue;
      }
    }
    kept.push(p);
  }
  return { proposals: kept, speech };
}

/** Advance his own pieces one season. A piece that fits in one season finishes as the season turns. */
export function resolvePersonalSmithing(state: WorldState): string[] {
  releaseVillageFromPersonalSmithing(state);
  const lines: string[] = [];
  const seasonDays = oneSmithSeasonDays();
  for (const proj of state.projects) {
    if (proj.status !== "active") continue;
    if (!proj.smithing && isPersonalSmithProject(proj)) {
      proj.smithing = {
        durationSeasons: seasonsOfOneSmith(proj.labourDaysRequired),
        seasonsElapsed: 0,
      };
    }
    if (!proj.smithing) continue;
    const village = villageCalledOnSmithing(proj);
    const hearthDone = proj.smithing.seasonsElapsed >= proj.smithing.durationSeasons;
    if (!hearthDone) {
      proj.smithing.seasonsElapsed += 1;
      if (proj.smithing.forgeDaysRequired != null) {
        proj.smithing.forgeDaysDone = round1(Math.min(proj.smithing.forgeDaysRequired, proj.smithing.seasonsElapsed * seasonDays));
      } else {
        // Legacy card: labourDays were his own days.
        proj.labourDaysDone = round1(Math.min(proj.labourDaysRequired, proj.smithing.seasonsElapsed * seasonDays));
      }
    }
    const left = proj.smithing.durationSeasons - proj.smithing.seasonsElapsed;
    if (left > 0) {
      markProjectSeason(state, proj);
      lines.push(smithStillAtConfirm(state, proj.name));
      continue;
    }
    if (proj.smithing.forgeDaysRequired != null) proj.smithing.forgeDaysDone = proj.smithing.forgeDaysRequired;
    else proj.labourDaysDone = proj.labourDaysRequired;
    if (village && proj.labourDaysDone < proj.labourDaysRequired) {
      // His part is done; the village still owes its days. advanceProjects marks the season.
      const owed = Math.max(0, round1(proj.labourDaysRequired - proj.labourDaysDone));
      lines.push(`${hiredSmithName(state) ?? "The smith"} has finished his part of ${theWork(proj.name)}; the village still owes ${owed} days of work.`);
      continue;
    }
    proj.status = "completed";
    stampProjectEnded(state, proj);
    lines.push(`${sentenceWork(proj.name)} is finished.`);
    const gained = payFinishedProjectResult(state, proj);
    if (gained) lines.push(gained);
  }
  return lines;
}

/** True when the smith's clock on a work has run out (or the work has no clock). */
export function smithClockDone(project: Pick<Project, "smithing">): boolean {
  return !project.smithing || project.smithing.seasonsElapsed >= project.smithing.durationSeasons;
}
