import { describe, expect, it } from "vitest";
import { HOLD_AT_ONCE_APOLOGY } from "./providerErrors";
import {
  eventEffectHasMechanics,
  looksLikeJsonDump,
  parseLlmResponse,
  parseProposal,
  playerFacingNpcSpeech,
  salvageSpeechFromLlmText,
} from "./parse";

const STEWARD_HUSBANDRY =
  "It makes good sense, my lord. We shall keep a three-field rotation, legumes and peas on the rest year, manure on the tired acres, and the best seed set aside.";

/** Playtest: speech complete, proposals cut after the first object's closing `}`. */
const TRUNCATED_AFTER_FIRST_PROPOSAL = `{ "speech": "${STEWARD_HUSBANDRY}",
  "chronicle": "The lord ordered a three-field rotation.",
  "emotion": "thoughtful",
  "proposals": [
    {
      "type": "set_standing_order",
      "summary": "Begin tracking peas (field legumes) in the estate stores",
      "text": "Three-field rotation with legumes",
      "active": true }`;

const TRUNCATED_MID_SPEECH = `{ "speech": "It makes good sense, my lord. We shall keep a three-field rotation`;

describe("parseLlmResponse", () => {
  it("extracts proposals from a clean JSON object", () => {
    const raw = JSON.stringify({
      speech: "We shall clear an acre.",
      emotion: "thoughtful",
      proposals: [
        {
          type: "start_project",
          summary: "Clear scrub",
          projectKey: "clear_scrub",
          holdingId: "fontenay",
        },
      ],
    });
    const parsed = parseLlmResponse(raw);
    expect(parsed.parseErrors).toEqual([]);
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]).toMatchObject({ type: "start_project", projectKey: "clear_scrub" });
  });

  it("salvages JSON with trailing commas and fenced markdown", () => {
    const raw = "```json\n{ \"speech\": \"Aye.\", \"proposals\": [ { \"type\": \"adjust_sowing\", \"summary\": \"More barley\", \"springBarleyShare\": 0.9, }, ], }\n```";
    const parsed = parseLlmResponse(raw);
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]).toMatchObject({ type: "adjust_sowing", springBarleyShare: 0.9 });
  });

  it("coerces give → consume and missing type from resource fields", () => {
    const parsed = parseProposal({
      summary: "Grain to the cell",
      resource: "rye",
      amount: 2,
      direction: "give",
    });
    expect(parsed.proposal).toMatchObject({
      type: "transfer_resources",
      direction: "consume",
      resource: "rye",
      amount: 2,
    });
  });

  it("keeps a named result for a work with no catalogue entry", () => {
    const parsed = parseProposal({
      type: "start_project",
      summary: "Burn for powder",
      projectKey: "gunpowder",
      customCosts: { labourDays: 8, lumber: 0, iron: 0, stone: 0 },
      result: { gunpowder: { amount: 2, unit: "pounds", name: "gunpowder" }, charcoal: 1 },
    });
    expect(parsed.error).toBeUndefined();
    expect(parsed.proposal).toMatchObject({
      type: "start_project",
      result: expect.arrayContaining([
        expect.objectContaining({ resource: "gunpowder", amount: 2, unit: "pounds" }),
        expect.objectContaining({ resource: "charcoal", amount: 1 }),
      ]),
    });
    const aliased = parseProposal({
      type: "start_project",
      summary: "Steel",
      projectKey: "steel",
      customCosts: { labourDays: 12, lumber: 0, iron: 4, stone: 0 },
      reward: [{ resource: "steel", amount: 3, unit: "pounds" }],
    });
    expect(aliased.proposal).toMatchObject({
      type: "start_project",
      result: [expect.objectContaining({ resource: "steel", amount: 3 })],
    });
  });

  it("coerces start_project without holdingId and fuzzy project key", () => {
    const parsed = parseProposal({
      type: "start_project",
      summary: "Clear the brush",
      projectKey: "clearing scrub",
    });
    expect(parsed.proposal).toMatchObject({ type: "start_project", projectKey: "clear_scrub" });
  });

  it("still returns speech when the wrapper schema is messy but proposals are present", () => {
    const raw = JSON.stringify({
      speech: "As you will.",
      emotion: { pose: "pleased" },
      proposals: {
        type: "add_modifier",
        summary: "Blessing",
        target: "mood",
        kind: "temp",
        source: "chapel",
        effect: { multiply: 1 },
      },
    });
    const parsed = parseLlmResponse(raw);
    expect(parsed.response.speech).toContain("As you will");
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]).toMatchObject({ type: "add_modifier", kind: "temporary", target: "mood" });
  });

  it("records parse errors and does not invent proposals for plain speech", () => {
    const parsed = parseLlmResponse("The rye stands well, my lord.");
    expect(parsed.proposals).toEqual([]);
    expect(parsed.parseErrors[0]).toMatch(/No JSON/);
    expect(parsed.response.speech).toContain("rye");
  });

  it("treats flavour-only event_effect as having no mechanics", () => {
    const parsed = parseProposal({
      type: "event_effect",
      eventId: "w-rain",
      summary: "It rained.",
    });
    expect(parsed.proposal).toBeDefined();
    expect(eventEffectHasMechanics(parsed.proposal!)).toBe(false);
  });

  it("keeps a valid empty proposals array as speech-only", () => {
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Good morrow.", proposals: [] }));
    expect(parsed.parseErrors).toEqual([]);
    expect(parsed.proposals).toEqual([]);
  });

  it("coerces a named expansion hire into register_npc", () => {
    const parsed = parseProposal({
      type: "hire",
      summary: "Bring in Otto",
      name: "Otto",
      role: "village_reeve",
    });
    expect(parsed.proposal).toMatchObject({
      type: "register_npc",
      isNew: true,
      npc: { id: "village_reeve", name: "Otto", role: "village_reeve", location: "fontenay" },
    });
  });

  it("coerces hire / flat fields into register_npc for a catalog specialist", () => {
    const parsed = parseProposal({
      type: "hire",
      summary: "Bring in Haimo",
      name: "Haimo",
      role: "carpenter",
    });
    expect(parsed.proposal).toMatchObject({
      type: "register_npc",
      isNew: true,
      npc: { id: "carpenter", name: "Haimo", role: "carpenter", location: "fontenay" },
    });
  });
});

describe("salvageSpeechFromLlmText", () => {
  it("does not salvage speech from a truncated dump cut after the first proposal }", () => {
    expect(salvageSpeechFromLlmText(TRUNCATED_AFTER_FIRST_PROPOSAL)).toBeNull();
    expect(salvageSpeechFromLlmText(TRUNCATED_MID_SPEECH)).toBeNull();
    expect(salvageSpeechFromLlmText('{ "proposals": [ { "type": "adjust_sowing" }')).toBeNull();
  });

  it("extracts speech from complete JSON, including escaped quotes and newlines", () => {
    const raw = JSON.stringify({
      speech: "Aye, my lord.\nWe shall keep the \"best\" seed.",
      emotion: "thoughtful",
      proposals: [],
    });
    expect(salvageSpeechFromLlmText(raw)).toBe("Aye, my lord.\nWe shall keep the \"best\" seed.");
  });

  it("returns plain speech when the payload is complete prose with no JSON", () => {
    expect(salvageSpeechFromLlmText("The rye stands well, my lord.")).toBe("The rye stands well, my lord.");
  });
});

describe("parseLlmResponse never shows JSON to the player", () => {
  it("treats the playtest truncated dump as incomplete — apology, no salvaged paragraph, no proposals", () => {
    const parsed = parseLlmResponse(TRUNCATED_AFTER_FIRST_PROPOSAL);
    expect(parsed.incomplete).toBe(true);
    expect(parsed.response.speech).toBe(HOLD_AT_ONCE_APOLOGY);
    expect(parsed.response.speech).not.toContain("It makes good sense");
    expect(parsed.proposals).toEqual([]);
    expect(playerFacingNpcSpeech(TRUNCATED_AFTER_FIRST_PROPOSAL, STEWARD_HUSBANDRY)).toBe(HOLD_AT_ONCE_APOLOGY);
    expect(looksLikeJsonDump(parsed.response.speech)).toBe(false);
  });

  it("uses the engine apology for any incomplete JSON blob", () => {
    const parsed = parseLlmResponse('{ "proposals": [ { "summary": "Begin tracking peas (field legumes) in the estate stores" }');
    expect(parsed.incomplete).toBe(true);
    expect(parsed.response.speech).toBe(HOLD_AT_ONCE_APOLOGY);
    expect(playerFacingNpcSpeech('{ "speech": ', "")).toBe(HOLD_AT_ONCE_APOLOGY);
  });

  it("strips a complete tool marker from spoken words", () => {
    expect(playerFacingNpcSpeech("The rye stands well.\n<=-tool: grain -=>")).toBe("The rye stands well.");
    const parsed = parseLlmResponse("Aye, my lord.\n<=-tool: grain, chest -=>");
    expect(parsed.incomplete).toBeFalsy();
    expect(parsed.response.speech).toBe("Aye, my lord.");
    expect(parsed.response.speech).not.toMatch(/<=-tool:/);
  });

  it("treats a chopped tool marker like incomplete JSON", () => {
    const parsed = parseLlmResponse("Let me see.\n<=-tool: grain, chest");
    expect(parsed.incomplete).toBe(true);
    expect(parsed.response.speech).toBe(HOLD_AT_ONCE_APOLOGY);
    expect(parsed.proposals).toEqual([]);
    expect(playerFacingNpcSpeech("<=-tool: grain")).toBe(HOLD_AT_ONCE_APOLOGY);
  });

  it("coerces a Gerulf hunt into start_hunt", () => {
    const parsed = parseProposal({
      type: "hunt",
      summary: "Seek pepper",
      goods: "pepper",
      quotedDenarii: 42,
      durationSeasons: 2,
    });
    expect(parsed.proposal).toMatchObject({
      type: "start_hunt",
      goods: "pepper",
      resource: "pepper",
      amount: 1,
      quotedDenarii: 42,
      durationSeasons: 2,
    });
  });

  it("keeps a hunt when the model omits the purse, and drops a numeric difficulty", () => {
    const omitted = parseProposal({
      type: "start_hunt",
      summary: "Fetch iron",
      goods: "iron",
      resource: "iron",
      amount: 4,
      durationSeasons: 1,
    });
    expect(omitted.proposal).toMatchObject({
      type: "start_hunt",
      quotedDenarii: 1,
      amount: 4,
    });
    expect(omitted.proposal && omitted.proposal.type === "start_hunt" ? omitted.proposal.difficulty : "set").toBeUndefined();

    const bogus = parseProposal({
      type: "start_hunt",
      summary: "Fetch iron",
      goods: "iron",
      difficulty: "14x",
      amount: 4,
      durationSeasons: 1,
    });
    expect(bogus.error).toBeUndefined();
    expect(bogus.proposal && bogus.proposal.type === "start_hunt" ? bogus.proposal.difficulty : "set").toBeUndefined();

    const hard = parseProposal({
      type: "start_hunt",
      summary: "Fetch iron",
      goods: "iron",
      difficulty: "Hard",
      amount: 4,
      quotedDenarii: 28,
      durationSeasons: 1,
    });
    expect(hard.proposal).toMatchObject({ difficulty: "difficult", quotedDenarii: 28 });
  });
});
