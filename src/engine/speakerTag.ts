import type { MechanicalProposal } from "./schema";
import { lookupProject } from "./projectCatalog";

/**
 * The tag a speaker's own new designs carry when the model left it off.
 * The chaplain's roof repair is church work because the church asked for it;
 * the smith's new piece is forge work because he is the one making it.
 */
const SPEAKER_TAGS: Record<string, string> = {
  chaplain: "church",
  smith: "forge",
};

export function speakerProjectTag(npcId: string): string | undefined {
  return SPEAKER_TAGS[npcId];
}

/** Stamp the speaker's tag on an untagged start_project that is not a catalogue work. */
export function stampSpeakerTag(npcId: string, p: MechanicalProposal): MechanicalProposal {
  const tag = speakerProjectTag(npcId);
  if (!tag) return p;
  if (p.type === "defer_proposal") {
    const inner = stampSpeakerTag(npcId, p.proposal);
    return inner === p.proposal ? p : { ...p, proposal: inner as typeof p.proposal };
  }
  if (p.type !== "start_project") return p;
  if (p.tag?.trim()) return p;
  if (lookupProject(p.projectKey)) return p;
  return { ...p, tag };
}
