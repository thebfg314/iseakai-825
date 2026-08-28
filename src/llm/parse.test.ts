import { describe, expect, it } from "vitest";
import { eventEffectHasMechanics, parseLlmResponse, parseProposal } from "./parse";

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
});
