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
  it("pulls the steward paragraph from a truncated dump cut after the first proposal }", () => {
    const salvaged = salvageSpeechFromLlmText(TRUNCATED_AFTER_FIRST_PROPOSAL);
    expect(salvaged).toBe(STEWARD_HUSBANDRY);
    expect(salvaged).not.toMatch(/\{|"proposals"/);
  });

  it("handles escaped quotes and newlines inside speech", () => {
    const raw = `{ "speech": "Aye, my lord.\\nWe shall keep the \\"best\\" seed.", "proposals": [`;
    expect(salvageSpeechFromLlmText(raw)).toBe("Aye, my lord.\nWe shall keep the \"best\" seed.");
  });

  it("cuts an unclosed speech string at chronicle / emotion / proposals", () => {
    expect(salvageSpeechFromLlmText(`${TRUNCATED_MID_SPEECH}",\n  "chronicle": "cut off`)).toContain(
      "It makes good sense, my lord",
    );
    expect(salvageSpeechFromLlmText(`${TRUNCATED_MID_SPEECH}\n  "proposals": [`)).toContain("three-field rotation");
  });

  it("returns null for a dump with no salvageable prose", () => {
    expect(salvageSpeechFromLlmText('{ "proposals": [ { "type": "adjust_sowing" }')).toBeNull();
  });
});

describe("parseLlmResponse never shows JSON to the player", () => {
  it("parses the playtest truncated dump as the steward paragraph", () => {
    const parsed = parseLlmResponse(TRUNCATED_AFTER_FIRST_PROPOSAL);
    expect(parsed.response.speech).toBe(STEWARD_HUSBANDRY);
    expect(parsed.response.speech).not.toContain("{");
    expect(parsed.response.speech).not.toContain('"proposals"');
    expect(parsed.response.speech).not.toContain("Begin tracking peas");
    expect(looksLikeJsonDump(parsed.response.speech)).toBe(false);
  });

  it("uses the engine apology when nothing can be salvaged", () => {
    const parsed = parseLlmResponse('{ "proposals": [ { "summary": "Begin tracking peas (field legumes) in the estate stores" }');
    expect(parsed.response.speech).toBe(HOLD_AT_ONCE_APOLOGY);
    expect(playerFacingNpcSpeech('{ "speech": ', "")).toBe(HOLD_AT_ONCE_APOLOGY);
  });
});
