import { afterEach, beforeEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { lintHistoryStructure } from "./lint";
import { historyContent, setHistoryContentForTests } from "./load";
import { historyPromptBlock } from "./promptBlocks";
import { runHistorySeasonPass } from "./season";

const TEST_EVENTS = [
  {
    id: "826-01",
    title: "A new count",
    arc: 1,
    type: "news",
    fires: { year: 826, season: "summer" },
    channel: ["steward"],
    script: [{ speaker: "steward", text: "Count Thierry is dead, my lord. His brother Bernard has Autun now." }],
    knows: ["Bernard is young and rarely in Autun."],
    doesntKnow: ["That Bernard will fall in 830."],
    hooks: [{ id: "gift_to_count", trigger: "Sends the new count a gift", effects: { flags: { count_gift_826: true, count_opinion: "+1" }, cost: { denarii: 10 } } }],
    onFire: { flags: { benefice_charter: false } },
    links: { momentum: 90 },
  },
  {
    id: "826-02",
    title: "A letter that needs a charter",
    arc: 1,
    type: "news",
    fires: { year: 826, season: "autumn" },
    requires: "count_gift_826",
    channel: ["chaplain"],
    script: [{ speaker: "chaplain", frame: "reads", text: "The count thanks you and sends a charter." }],
    onFire: { flags: { benefice_charter: true } },
    links: { momentum: 50 },
  },
  {
    id: "827-01",
    title: "A choice at Easter",
    arc: 1,
    type: "choice",
    fires: { year: 827, season: "spring" },
    channel: ["steward", "chaplain"],
    script: [
      { speaker: "chaplain", text: "The bishop asks for men." },
      { speaker: "steward", text: "My lord, we can send them or not." },
    ],
    variants: [{ when: "benefice_charter", replace: 1, text: "My lord, with the charter in hand we may refuse." }],
    choices: {
      deadlineSeasons: 1,
      options: [
        { id: "send", label: "Send men", effects: { flags: { favor_church: "+2" }, renown: "small" } },
        { id: "refuse", label: "Refuse", default: true, effects: { flags: { church_suspicion: "+1" } } },
      ],
    },
    record: "At Easter 827 the lord chose to {choice}.",
    links: { momentum: 40 },
  },
  {
    id: "827-02",
    title: "The flux in Autun",
    arc: 1,
    type: "news",
    fires: { year: 827, season: "summer" },
    channel: ["steward"],
    script: [{ speaker: "steward", text: "The count is sick." }],
    outcomes: {
      momentum: 40,
      canChange: "Boiled water, early.",
      windowSeasons: 1,
      options: [
        { id: "saved", label: "Saved", effects: { flags: { saved_adalard: true } } },
        { id: "died", label: "Died", default: true },
      ],
    },
    links: { momentum: 40 },
  },
  {
    id: "828-01",
    title: "Nights in camp",
    arc: 1,
    type: "live",
    fires: { year: 828, season: "spring" },
    channel: ["steward"],
    stages: [
      { id: "first", script: [{ speaker: "steward", text: "First night." }], advanceOn: "both" },
      {
        id: "second",
        script: [{ speaker: "steward", text: "Second night: the bribe." }],
        advanceOn: "speech",
        choices: {
          options: [
            { id: "take", label: "Take the silver", effects: { flags: { bribed_833: true }, gain: { denarii: 60 } }, ends: true },
            { id: "stay", label: "Stay", default: true, effects: { flags: { stood_to_the_end: true }, renown: 90 } },
          ],
        },
      },
      { id: "third", script: [{ speaker: "steward", text: "Third night." }], advanceOn: "season" },
    ],
    links: { momentum: 90 },
  },
  {
    id: "829-01",
    title: "Fontenoy stand-in",
    arc: 1,
    type: "battle",
    deferred: "battle",
    fires: { year: 829, season: "summer" },
    requires: "stood_to_the_end",
    channel: ["steward"],
    battle: { interimLine: "The lord rode with the count. What happened in the field is not yet written." },
    links: { momentum: 100, fixedPoint: true },
  },
  {
    id: "829-02",
    title: "A promotion window",
    arc: 1,
    type: "promotion",
    deferred: "promotion",
    fires: { year: 829, season: "autumn" },
    channel: ["steward"],
    promotion: { rewards: {} },
    links: { momentum: 50 },
  },
  {
    id: "830-01",
    title: "Carried until the charter",
    arc: 1,
    type: "news",
    fires: { year: 830, season: "spring" },
    requires: "villa_owned",
    carry: true,
    carryMax: 2,
    channel: ["steward"],
    script: [{ speaker: "steward", text: "Now that the villa is yours..." }],
    links: { momentum: 50 },
  },
];

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function seasonsFrom(state: WorldState) {
  const order = ["spring", "summer", "autumn", "winter"] as const;
  return {
    next() {
      const i = order.indexOf(state.meta.season);
      const incoming = i === 3 ? { year: state.meta.year + 1, season: order[0] } : { year: state.meta.year, season: order[i + 1] };
      const result = runHistorySeasonPass(state, incoming, state.meta.turn + 1);
      state.meta.year = incoming.year;
      state.meta.season = incoming.season;
      state.meta.turn += 1;
      return result;
    },
    to(year: number, season: (typeof order)[number]) {
      const all = [];
      while (state.meta.year < year || (state.meta.year === year && order.indexOf(state.meta.season) < order.indexOf(season))) {
        all.push(this.next());
      }
      return all;
    },
  };
}

describe("history scheduler and delivery", () => {
  beforeEach(() => setHistoryContentForTests({ events: TEST_EVENTS }));
  afterEach(() => setHistoryContentForTests(null));

  it("the test calendar passes the structural lint", () => {
    expect(lintHistoryStructure(historyContent())).toEqual([]);
  });

  it("loads old saves with an empty history block and defaults the age and manses", () => {
    const state = fresh();
    expect(state.history.fired).toEqual({});
    expect(state.player.ageAt825).toBe(17);
    expect(state.holdings[0].manses).toEqual({ free: 6, servile: 4, vacant: 4 });
    expect(state.history.realm.countOfAutun).toBe("Thierry");
  });

  it("fires an event verbatim in its season, with frames, and suppresses the random other event", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    const spring = clock.next(); // summer 825: nothing
    expect(spring.beats).toEqual([]);
    expect(spring.suppressOther).toBe(false);
    clock.to(826, "spring");
    const summer = clock.next(); // summer 826
    expect(summer.beats.map((b) => b.text)).toContain("Count Thierry is dead, my lord. His brother Bernard has Autun now.");
    expect(summer.suppressOther).toBe(true);
    expect(state.history.fired["826-01"]).toMatchObject({ year: 826, season: "summer" });
    // the realm tick moved the count, and the event announced it, so no generic oath beat
    expect(state.history.realm.countOfAutun).toBe("Bernard of Septimania");
    expect(summer.beats.filter((b) => b.eventId.startsWith("realm:"))).toHaveLength(0);
  });

  it("drops an event whose requires fail in its season, and carries one marked carry", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    clock.to(826, "winter");
    expect(state.history.dropped).toContain("826-02");
    expect(state.history.fired["826-02"]).toBeUndefined();
    clock.to(830, "summer");
    expect(state.history.dropped).not.toContain("830-01");
    state.history.flags.villa_owned = true;
    clock.next(); // autumn 830: within carryMax 2
    expect(state.history.fired["830-01"]).toBeDefined();
  });

  it("a hook taken by the lord's words sets flags and takes the cost; a later event then fires", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    clock.to(826, "summer");
    const denarii = state.resources.denarii;
    const r = applyProposal(state, { type: "history_hook", summary: "A gift to the count", eventId: "826-01", hookId: "gift_to_count" }, "steward");
    expect(r.ok).toBe(true);
    expect(state.resources.denarii).toBe(denarii - 10);
    expect(state.history.flags.count_gift_826).toBe(true);
    expect(state.history.flags.count_opinion).toBe(1);
    const again = applyProposal(state, { type: "history_hook", summary: "Again", eventId: "826-01", hookId: "gift_to_count" }, "steward");
    expect(again.ok).toBe(false);
    const autumn = clock.next();
    expect(autumn.beats.map((b) => b.text)).toContain("(reads) The count thanks you and sends a charter.");
    expect(autumn.beats[0].npcId).toBe("chaplain");
    expect(state.history.flags.benefice_charter).toBe(true);
  });

  it("variants swap a script block on condition; a choice opens, the LLM-named option applies, and defaults land at the deadline", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    clock.to(826, "winter");
    state.history.flags.benefice_charter = true;
    const spring = clock.next(); // spring 827
    expect(spring.beats.map((b) => b.text)).toContain("My lord, with the charter in hand we may refuse.");
    expect(state.history.openChoices).toHaveLength(1);
    const prompt = historyPromptBlock(state, "steward");
    expect(prompt).toContain("OPEN CHOICE");
    expect(prompt).toContain('send ("Send men")');
    expect(prompt).toContain("Doesn't know");
    const renown = state.player.renown;
    const r = applyProposal(state, { type: "history_choice", summary: "Send men", eventId: "827-01", optionId: "send" }, "chaplain");
    expect(r.ok).toBe(true);
    expect(state.history.flags.favor_church).toBe(2);
    expect(state.player.renown).toBeGreaterThanOrEqual(renown + 5);
    expect(state.history.record.at(-1)?.text).toBe("At Easter 827 the lord chose to send men.");
    expect(state.history.openChoices).toHaveLength(0);
    const twice = applyProposal(state, { type: "history_choice", summary: "Refuse", eventId: "827-01", optionId: "refuse" }, "steward");
    expect(twice.ok).toBe(false);

    // Default at the deadline on a fresh state
    const other = fresh();
    const c2 = seasonsFrom(other);
    c2.to(827, "spring");
    expect(other.history.openChoices).toHaveLength(1);
    const summer = c2.next();
    expect(other.history.chosen["827-01"]).toBe("refuse");
    expect(other.history.flags.church_suspicion).toBe(1);
    expect(summer.beats.some((b) => b.text.startsWith("The matter settled itself"))).toBe(true);
  });

  it("outcomes are judged by proposal within the window or default to the historical result", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    clock.to(827, "summer");
    expect(state.history.openOutcomes).toHaveLength(1);
    expect(historyPromptBlock(state, "steward")).toContain("OUTCOME TO JUDGE (momentum 40");
    const r = applyProposal(state, { type: "history_outcome", summary: "He lived", eventId: "827-02", outcomeId: "saved", reasoning: "boiled water" }, "steward");
    expect(r.ok).toBe(true);
    expect(state.history.flags.saved_adalard).toBe(true);
    expect(state.history.outcomes["827-02"]).toBe("saved");

    const other = fresh();
    const c2 = seasonsFrom(other);
    c2.to(827, "autumn");
    expect(other.history.outcomes["827-02"]).toBe("died");
    expect(other.history.flags.saved_adalard).toBeUndefined();
  });

  it("scenes step through stages by speech and by season, and an ending option closes early", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    const spring = clock.to(828, "spring").at(-1)!;
    expect(spring.beats.map((b) => b.text)).toContain("First night.");
    expect(state.history.scenes["828-01"]).toMatchObject({ stage: 0 });
    const adv = applyProposal(state, { type: "history_scene", summary: "On to the next night", eventId: "828-01", advance: true }, "steward");
    expect(adv.ok).toBe(true);
    expect((adv as { beats?: { text: string }[] }).beats?.map((b) => b.text)).toContain("Second night: the bribe.");
    expect(state.history.scenes["828-01"]).toMatchObject({ stage: 1 });
    expect(historyPromptBlock(state, "steward")).toContain('SCENE in progress, stage "second"');
    // The season does not move a speech-only stage.
    clock.next();
    expect(state.history.scenes["828-01"]).toMatchObject({ stage: 1 });
    const stay = applyProposal(state, { type: "history_scene", summary: "He stays", eventId: "828-01", advance: true, choiceId: "stay" }, "steward");
    expect(stay.ok).toBe(true);
    expect(state.history.flags.stood_to_the_end).toBe(true);
    expect(state.player.renown).toBe(91);
    expect(state.history.scenes["828-01"]).toMatchObject({ stage: 2 });
    clock.next();
    expect(state.history.scenes["828-01"]).toBeUndefined();

    const other = fresh();
    const c2 = seasonsFrom(other);
    c2.to(828, "spring");
    applyProposal(other, { type: "history_scene", summary: "", eventId: "828-01", advance: true }, "steward");
    const take = applyProposal(other, { type: "history_choice", summary: "Take it", eventId: "828-01", optionId: "take" }, "steward");
    expect(take.ok).toBe(true);
    expect(other.history.flags.bribed_833).toBe(true);
    expect(other.history.scenes["828-01"]).toBeUndefined();
  });

  it("deferred battles post one neutral line when the lord went; promotion windows are skipped", () => {
    const state = fresh();
    state.history.flags.stood_to_the_end = true;
    const clock = seasonsFrom(state);
    const summer = clock.to(829, "summer").at(-1)!;
    expect(summer.beats.map((b) => b.text)).toContain("The lord rode with the count. What happened in the field is not yet written.");
    expect(state.history.fired["829-01"]).toBeDefined();
    clock.next();
    expect(state.history.dropped).toContain("829-02");
    expect(state.history.fired["829-02"]).toBeUndefined();

    const home = fresh();
    const c2 = seasonsFrom(home);
    c2.to(829, "autumn");
    expect(home.history.fired["829-01"]).toBeUndefined();
    expect(home.history.dropped).toContain("829-01");
  });

  it("refuses history cards from the wrong speaker, unknown events, and unfired events", () => {
    const state = fresh();
    expect(applyProposal(state, { type: "history_hook", summary: "", eventId: "826-01", hookId: "gift_to_count" }, "smith").ok).toBe(false);
    expect(applyProposal(state, { type: "history_hook", summary: "", eventId: "nope", hookId: "gift_to_count" }, "steward").ok).toBe(false);
    expect(applyProposal(state, { type: "history_hook", summary: "", eventId: "826-01", hookId: "gift_to_count" }, "steward").reason).toMatch(/not yet come/);
  });

  it("the full calendar runs 825 → 911 without throwing and ends with the counts in order", () => {
    const state = fresh();
    const clock = seasonsFrom(state);
    clock.to(911, "winter");
    expect(state.history.realm.countOfAutun).toBe("Richard the Justiciar");
    expect(state.history.realm.king).toBe("Charles the Simple");
    expect(state.history.realm.emperor).toBeNull();
  });
});
