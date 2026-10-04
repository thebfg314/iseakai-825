import type { ChatMessage } from "./schema";

/**
 * The opening tutorial: a scripted walk through the first season.
 * The script lives here as data so the renderer only has to draw boxes and
 * watch the game for the moments that move it along.
 */

export const TUTORIAL_STATUSES = ["offered", "active", "done", "declined"] as const;
export type TutorialStatus = (typeof TUTORIAL_STATUSES)[number];

export type TutorialState = { status: TutorialStatus; step: number };

/** Saves written before the tutorial existed are mid-game; do not interrupt them. */
export const TUTORIAL_DEFAULT_FOR_OLD_SAVES: TutorialState = { status: "declined", step: 0 };
/** A fresh estate asks. */
export const TUTORIAL_AT_NEW_GAME: TutorialState = { status: "offered", step: 0 };

/** DOM ids the boxes point at. */
export type TutorialAnchor =
  | "scene-tab-steward"
  | "scene-tab-smith"
  | "scene-tab-chaplain"
  | "scene-tab-negotiator"
  | "books-tabs"
  | "pending-proposals"
  | "talk-composer"
  | "advance-season";

/**
 * What moves a step forward. Only the game does: there is no Next button, so
 * every rule must be reachable by play alone and none may dead-end.
 * - scene: that speaker's tab is open.
 * - sent: the lord spoke a line after arriving at this step.
 * - answered: the named speaker has spoken since the lord arrived at this step.
 * - reply: the lord spoke after arriving, and the named speaker answered.
 * - confirmed: the table of proposals is clear (confirmed, denied, or nothing was proposed).
 * - season: the season advanced; the tutorial is finished.
 */
export type TutorialAdvance =
  | { kind: "scene"; npcId: string }
  | { kind: "sent"; npcId: string }
  | { kind: "answered"; npcId: string }
  | { kind: "reply"; npcId: string }
  | { kind: "confirmed" }
  | { kind: "season" };

export type TutorialStep = {
  id: string;
  /** Section heading shown on the box. */
  section: string;
  anchor?: TutorialAnchor;
  /** Narrator paragraphs. Bulleted lists are a paragraph starting with "• ". */
  paragraphs: string[];
  /** A line for the lord to send, and to whom. */
  say?: { npcId: string; text: string };
  /** Shown after the line. */
  after?: string[];
  /** A speaker still drafting while this step is read; the box notes the wait. */
  waitFor?: string;
  advance?: TutorialAdvance;
  /** Label for the forward button when the step is the last. */
  finishLabel?: string;
};

export const TUTORIAL_TITLE = "Opening Tutorial";
export const TUTORIAL_OFFER = "Would you like to go through the tutorial?";

const SECTION = {
  aldric: "1 · Aldric: the Three-Field Rotation",
  books: "2 · The Books",
  bernard: "3 · Bernard: the Heavy Mouldboard Plough",
  clearing: "4 · Aldric: Clearing Land for Charcoal",
  gerulf: "5 · Gerulf: Restocking the Iron",
  ermenald: "6 · Ermenald: the Easter Feast",
  wrap: "7 · Wrapping Up",
} as const;

export const TUTORIAL_LINES = {
  rotation:
    "I'd like us to split our farming fields into thirds: fallow, spring crops, and winter crops, and rotate them each year. I'd also like us to plant a lot more legumes in the spring crop. We can use them to feed ourselves and our animals.",
  plough:
    "I'd like you to make the village a heavy mouldboard plough to improve our farming, using the following design. Forge a long, heavy coulter, a vertical knife, to hang from the beam ahead of the share so it slices the sod before the share reaches it. Make the share wider and one-sided instead of a simple spear point, so it undercuts the slice and lifts it onto a wooden board that turns the earth over. Shoe that board with thin iron plates where it rubs, and socket the share so a worn one can be pulled and a new one riveted on without rebuilding the whole plough.",
  clearing:
    "I'd like to assign some men to clear one of the overgrown woodland plots so we can farm it, and to turn the wood we gather into charcoal to restock Bernard's forge.",
  iron: "Gerulf, I need 10 pounds of iron no later than next season. How much do you think this will cost me if I send you out?",
  feast:
    "Hello, Ermenald. I'd like your support in celebrating my new position as lord during the coming Easter feast. What can we do to make this a memorable Easter for everyone?",
} as const;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "aldric-intro",
    section: SECTION.aldric,
    anchor: "scene-tab-steward",
    paragraphs: [
      "OK. This is Aldric, your steward. Think of him as a middle manager, and you are the CEO. You tell him what you want your people to do, and he will write it into law or tell you who you need to speak to in order to make it happen.",
      "First, let's have him make some simple changes to how we farm. Here's what you need to tell him:",
    ],
    say: { npcId: "steward", text: TUTORIAL_LINES.rotation },
    after: [
      "Switching from a two-field to a three-field rotation lets us grow food on two-thirds of our fields each year instead of half, so we grow more and earn more. Adding legumes puts nitrogen back into the soil, which keeps the new rotation sustainable. A few estates up north have already started trying this, but it's still a big step up for a villa like ours.",
    ],
    advance: { kind: "sent", npcId: "steward" },
  },
  {
    id: "books",
    section: SECTION.books,
    anchor: "books-tabs",
    waitFor: "steward",
    paragraphs: [
      "While Aldric drafts that, let's look at the books on the right. There are four tabs:",
      "• Estate lists your lands and the resources you own.",
      "• Labours shows all active projects and improvements you're working on.",
      "• Customs holds any standing orders you've set up.",
      "• Arms keeps track of your military assets.",
      "Terms you may be unfamiliar with are hyperlinked. Click any of them for an explanation.",
    ],
    advance: { kind: "answered", npcId: "steward" },
  },
  {
    id: "aldric-approve",
    section: SECTION.books,
    anchor: "pending-proposals",
    paragraphs: [
      "Aldric has drafted the change. Before approving any project, look over the proposal: what it costs, how long it will take, and how many worker hours it needs. If it looks right, approve it.",
    ],
    advance: { kind: "confirmed" },
  },
  {
    id: "bernard-tab",
    section: SECTION.bernard,
    anchor: "scene-tab-smith",
    paragraphs: [
      "Now let's talk to Bernard the blacksmith. Click his name here. Notice the exclamation point next to it. That means he has something to say to you this season. Right now it's just a hello, but keep an eye out for it in later seasons.",
    ],
    advance: { kind: "scene", npcId: "smith" },
  },
  {
    id: "bernard-line",
    section: SECTION.bernard,
    anchor: "talk-composer",
    paragraphs: [
      "This is Bernard. He will try to build anything made of metal or that depends on important metal parts. Let's have him improve our farming by making a heavy mouldboard plough. Tell him:",
    ],
    say: { npcId: "smith", text: TUTORIAL_LINES.plough },
    advance: { kind: "reply", npcId: "smith" },
  },
  {
    id: "bernard-approve",
    section: SECTION.bernard,
    anchor: "pending-proposals",
    paragraphs: [
      "Bernard will start right away using the village's stores of iron and charcoal. Check his proposal the same way you checked Aldric's, then approve it.",
    ],
    advance: { kind: "confirmed" },
  },
  {
    id: "clearing-tab",
    section: SECTION.clearing,
    anchor: "scene-tab-steward",
    paragraphs: [
      "That plough will use up a good share of our iron and charcoal, so let's start replacing both. We'll begin with the charcoal. Go back to Aldric.",
    ],
    advance: { kind: "scene", npcId: "steward" },
  },
  {
    id: "clearing-line",
    section: SECTION.clearing,
    anchor: "talk-composer",
    paragraphs: [
      "Have Aldric put some men to work clearing unused land. That gets the land ready for farming, and the wood they cut can be burned into charcoal for Bernard's forge. Tell him:",
    ],
    say: { npcId: "steward", text: TUTORIAL_LINES.clearing },
    advance: { kind: "reply", npcId: "steward" },
  },
  {
    id: "clearing-approve",
    section: SECTION.clearing,
    anchor: "pending-proposals",
    paragraphs: ["Look over the project and approve it. You'll see it appear in the Labours tab."],
    advance: { kind: "confirmed" },
  },
  {
    id: "gerulf-tab",
    section: SECTION.gerulf,
    anchor: "scene-tab-negotiator",
    paragraphs: ["Now for the iron. Click Gerulf's name here."],
    advance: { kind: "scene", npcId: "negotiator" },
  },
  {
    id: "gerulf-line",
    section: SECTION.gerulf,
    anchor: "talk-composer",
    paragraphs: [
      "This is Gerulf. He's the one you go to when you need to buy something and no merchant is visiting that season, or when you need things merchants aren't likely to carry. You'll pay a premium, but sometimes you have to spend money to make money. Let's send him out to replace the iron Bernard is using for the plough. Ask him:",
    ],
    say: { npcId: "negotiator", text: TUTORIAL_LINES.iron },
    advance: { kind: "reply", npcId: "negotiator" },
  },
  {
    id: "gerulf-approve",
    section: SECTION.gerulf,
    anchor: "pending-proposals",
    paragraphs: ["Gerulf's price depends on what he thinks he can find. If it seems reasonable, approve the project."],
    advance: { kind: "confirmed" },
  },
  {
    id: "ermenald-tab",
    section: SECTION.ermenald,
    anchor: "scene-tab-chaplain",
    paragraphs: ["Finally, let's visit the chaplain. Click Ermenald's name here."],
    advance: { kind: "scene", npcId: "chaplain" },
  },
  {
    id: "ermenald-line",
    section: SECTION.ermenald,
    anchor: "talk-composer",
    paragraphs: [
      "This is Ermenald, your local chaplain. The Catholic Church, or simply “The Church” as it was referred to at this time, was an incredibly important part of everyday life. You are expected to pay a tithe, a tenth of your estate's produce, to the Church, much as you send part of your wealth in taxes to the lord directly above you. Your power as a noble is seen as coming from God. The Church can't take your title away directly, but it can make your rule very difficult, whether through excommunication or through its influence with the lords above you.",
      "On the plus side, supporting the Church and fulfilling your duties to it generally makes people happier. You can even go all out and have Ermenald help you hold a great celebration for one of the many holy days throughout the year to lift everyone's mood.",
      "Let's ask Ermenald to help us celebrate our new position as lord with our people during the Easter feast this spring. Tell him:",
    ],
    say: { npcId: "chaplain", text: TUTORIAL_LINES.feast },
    advance: { kind: "reply", npcId: "chaplain" },
  },
  {
    id: "ermenald-approve",
    section: SECTION.ermenald,
    anchor: "pending-proposals",
    paragraphs: ["Look over his plans and approve the project."],
    advance: { kind: "confirmed" },
  },
  {
    id: "wrap",
    section: SECTION.wrap,
    anchor: "advance-season",
    paragraphs: [
      "That's a strong start. This season you have:",
      "• switched to a three-field rotation with more legumes,",
      "• commissioned a heavy mouldboard plough from Bernard,",
      "• started clearing woodland and making charcoal to restock the forge,",
      "• sent Gerulf to replace the iron, and",
      "• planned an Easter feast with Ermenald.",
      "The gains to your agriculture will compound season over season and help you fund bigger and more ambitious projects as they come along. When you're ready, advance to the next season using this button. Once the plough is finished, don't forget to tell Aldric to put it to work in the fields.",
    ],
    advance: { kind: "season" },
    finishLabel: "Finish",
  },
];

export const TUTORIAL_SECTION_COUNT = new Set(TUTORIAL_STEPS.map((s) => s.section)).size;

export function tutorialStep(index: number): TutorialStep {
  const i = Math.min(TUTORIAL_STEPS.length - 1, Math.max(0, Math.floor(index) || 0));
  return TUTORIAL_STEPS[i];
}

export function isLastTutorialStep(index: number): boolean {
  return index >= TUTORIAL_STEPS.length - 1;
}

/** "Section 3 of 7". */
export function tutorialProgressLabel(index: number): string {
  const step = tutorialStep(index);
  const sections = [...new Set(TUTORIAL_STEPS.map((s) => s.section))];
  return `Section ${sections.indexOf(step.section) + 1} of ${sections.length}`;
}

/** Possessive name for the waiting note: "Waiting on Aldric…". */
export const TUTORIAL_NPC_NAMES: Record<string, string> = {
  steward: "Aldric",
  smith: "Bernard",
  chaplain: "Ermenald",
  negotiator: "Gerulf",
};

export function tutorialWaitingNote(npcId: string): string {
  return `Waiting on ${TUTORIAL_NPC_NAMES[npcId] ?? "them"}…`;
}

/** Where the Next button would be: what the game must do for the box to move on. */
export function tutorialNextHint(step: TutorialStep): string {
  const rule = step.advance;
  if (!rule) return "";
  const name = (id: string) => TUTORIAL_NPC_NAMES[id] ?? "them";
  switch (rule.kind) {
    case "scene":
      return `Moves on when you open ${name(rule.npcId)}'s tab.`;
    case "sent":
      return `Moves on when you speak to ${name(rule.npcId)}.`;
    case "answered":
      return `Moves on when ${name(rule.npcId)} answers.`;
    case "reply":
      return `Moves on when ${name(rule.npcId)} answers you.`;
    case "confirmed":
      return "Moves on when the proposal is confirmed or denied.";
    case "season":
      return "Ends when the season advances.";
  }
}

/** What the box saw when the lord arrived at the step. */
export type TutorialEntry = {
  /** The scene whose messages were counted, and how many there were. Re-based when the scene changes. */
  messageScene: string;
  messageCount: number;
  turn: number;
};

export type TutorialWatch = {
  sceneNpcId: string;
  messages: readonly Pick<ChatMessage, "role" | "npcId">[];
  pendingCount: number;
  turn: number;
  busy: boolean;
};

export function tutorialEntryFrom(watch: TutorialWatch): TutorialEntry {
  return {
    messageScene: watch.sceneNpcId,
    messageCount: watch.messages.length,
    turn: watch.turn,
  };
}

/** Carry the entry forward: a new scene gets a fresh message baseline. */
export function tutorialEntryUpdate(entry: TutorialEntry, watch: TutorialWatch): TutorialEntry {
  if (watch.sceneNpcId === entry.messageScene) return entry;
  return { ...entry, messageScene: watch.sceneNpcId, messageCount: watch.messages.length };
}

/** What has been said on the scene since the lord arrived at the step. */
function sinceEntry(messages: TutorialWatch["messages"], from: number, npcId: string): { sent: boolean; answered: boolean; spoke: boolean } {
  let sent = false;
  let answered = false;
  let spoke = false;
  for (let i = Math.max(0, from); i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "player") sent = true;
    else if (m.role === "npc" && (m.npcId ?? npcId) === npcId) {
      spoke = true;
      if (sent) answered = true;
    }
  }
  return { sent, answered, spoke };
}

/** Whether the game has done the thing this step was waiting for. */
export function tutorialStepSatisfied(step: TutorialStep, entry: TutorialEntry, watch: TutorialWatch): boolean {
  const rule = step.advance;
  if (!rule) return false;
  const onScene = (npcId: string) => watch.sceneNpcId === npcId && watch.sceneNpcId === entry.messageScene;
  switch (rule.kind) {
    case "scene":
      return watch.sceneNpcId === rule.npcId;
    case "sent":
      return onScene(rule.npcId) && sinceEntry(watch.messages, entry.messageCount, rule.npcId).sent;
    case "answered":
      return !watch.busy && onScene(rule.npcId) && sinceEntry(watch.messages, entry.messageCount, rule.npcId).spoke;
    case "reply":
      return !watch.busy && onScene(rule.npcId) && sinceEntry(watch.messages, entry.messageCount, rule.npcId).answered;
    case "confirmed":
      return !watch.busy && watch.pendingCount === 0;
    case "season":
      return watch.turn !== entry.turn;
  }
}

/** The lord has spoken the step's line and the speaker has not yet answered. */
export function tutorialAwaitingReply(step: TutorialStep, entry: TutorialEntry, watch: TutorialWatch): boolean {
  if (!step.say) return false;
  if (watch.sceneNpcId !== step.say.npcId || watch.sceneNpcId !== entry.messageScene) return false;
  const seen = sinceEntry(watch.messages, entry.messageCount, step.say.npcId);
  return seen.sent && !seen.answered;
}

export function nextTutorialState(current: TutorialState, satisfiedStep: TutorialStep): TutorialState {
  if (satisfiedStep.advance?.kind === "season" || isLastTutorialStep(current.step)) {
    return { status: "done", step: current.step };
  }
  return { status: "active", step: current.step + 1 };
}
