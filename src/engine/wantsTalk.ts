import { introAlreadySpoken, introSpeechFor } from "./intros";
import { CHURCH_PROJECT_KEYS, FORGE_PROJECT_KEYS } from "./projectCatalog";
import type { Project, WorldState } from "./schema";
import { hiredSpecialistMatchingProject } from "./specialists";

/**
 * Tab badge: this NPC has something to say.
 *
 * Set when:
 * - Starting household still owes a first-meeting intro (Bernard, Ermenald, Gerulf — not Aldric)
 * - A hunt or project they own just finished (a chat beat is posted on their tab)
 * - A Confirm card they proposed is waiting
 * - A new hire is confirmed (until their intro)
 * - A named merchant arrives (until first talk this visit)
 *
 * Clear:
 * - Opening their tab, or sending them a message, if they have no pending Confirm
 * - Confirm accepted, declined, or season-dismissed, if they have no remaining pending
 *   and they do not still owe a first-meeting intro
 *
 * Opening a tab does **not** clear a Confirm nag — the badge stays until the card is dealt with.
 * Not used for mood/loyalty or general season-fallout events.
 */

export function setNpcWantsTalk(state: WorldState, npcId: string, value = true): void {
  const npc = state.npcs.find((n) => n.id === npcId);
  if (npc) npc.wantsTalk = value;
}

export function npcHasPendingConfirm(pending: { status: string; npcId: string }[], npcId: string): boolean {
  return pending.some((p) => p.status === "pending" && p.npcId === npcId);
}

export function introStillOwed(state: WorldState, npcId: string): boolean {
  return Boolean(introSpeechFor(npcId, state) && !introAlreadySpoken(state, npcId));
}

/** Keep a Confirm nag; otherwise drop the badge (intros/news were shown by opening the tab). */
export function dismissNewsWantsTalk(
  state: WorldState,
  npcId: string,
  pending: { status: string; npcId: string }[],
): void {
  if (npcHasPendingConfirm(pending, npcId)) {
    setNpcWantsTalk(state, npcId, true);
    return;
  }
  setNpcWantsTalk(state, npcId, false);
}

/** After a Confirm is applied, declined, or season-lapsed. */
export function releaseConfirmWantsTalk(
  state: WorldState,
  npcId: string,
  pending: { status: string; npcId: string }[],
): void {
  if (npcHasPendingConfirm(pending, npcId)) {
    setNpcWantsTalk(state, npcId, true);
    return;
  }
  if (introStillOwed(state, npcId)) return;
  setNpcWantsTalk(state, npcId, false);
}

export function ownerNpcIdForCompletedProject(
  state: WorldState,
  project: Pick<Project, "key" | "tag" | "hunt">,
): string | undefined {
  if (project.hunt || project.tag === "hunt") {
    return state.npcs.some((n) => n.id === "negotiator") ? "negotiator" : undefined;
  }
  const byKey = hiredSpecialistMatchingProject(state, project, "key");
  if (byKey) return byKey;
  if (FORGE_PROJECT_KEYS.has(project.key) || project.tag === "forge") {
    if (state.npcs.some((n) => n.id === "smith" || n.role === "smith")) return "smith";
  }
  if (CHURCH_PROJECT_KEYS.has(project.key) || project.tag === "church") {
    if (state.npcs.some((n) => n.id === "chaplain" || n.role === "chaplain")) return "chaplain";
  }
  const byTag = hiredSpecialistMatchingProject(state, project, "tag");
  if (byTag) return byTag;
  return state.npcs.some((n) => n.id === "steward") ? "steward" : undefined;
}

export function flagCompletedProjectWantsTalk(state: WorldState, project: Project): string | undefined {
  const npcId = ownerNpcIdForCompletedProject(state, project);
  if (!npcId) return undefined;
  setNpcWantsTalk(state, npcId, true);
  return npcId;
}

export function completedProjectSpeech(npcId: string, projectName: string): string {
  switch (npcId) {
    case "smith":
      return `The forge work is done. ${projectName} stands.`;
    case "chaplain":
      return `The church work is finished. ${projectName} is ready.`;
    case "steward":
      return `The work is finished: ${projectName}.`;
    default:
      return `My work is finished: ${projectName}.`;
  }
}

export function completedProjectBeats(before: WorldState, after: WorldState): { npcId: string; text: string }[] {
  const beats: { npcId: string; text: string }[] = [];
  for (const proj of after.projects) {
    if (proj.status !== "completed") continue;
    if (proj.hunt || proj.tag === "hunt") continue;
    const prev = before.projects.find((p) => p.id === proj.id);
    if (!prev || prev.status === "completed") continue;
    const npcId = ownerNpcIdForCompletedProject(after, proj);
    if (!npcId) continue;
    beats.push({ npcId, text: completedProjectSpeech(npcId, proj.name) });
  }
  return beats;
}
