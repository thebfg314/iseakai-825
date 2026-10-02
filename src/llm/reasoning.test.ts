import { describe, expect, it } from "vitest";
import { combineReasoning, extractReasoning } from "./reasoning";

describe("hidden model reasoning", () => {
  it("reads OpenAI-style reasoning_content and Anthropic thinking blocks", () => {
    expect(
      extractReasoning({
        choices: [{ message: { content: "The rye stands.", reasoning_content: "I checked the barn first." } }],
      }),
    ).toBe("I checked the barn first.");

    expect(
      extractReasoning({
        content: [
          { type: "thinking", thinking: "The charcoal will not last." },
          { type: "text", text: "We are short of charcoal." },
        ],
      }),
    ).toBe("The charcoal will not last.");
  });

  it("keeps a think-tag beside a provider field", () => {
    const content = "<think>Count the iron.</think>\n{\"speech\":\"Enough iron.\"}";
    expect(combineReasoning({ reasoning: "The stores can bear it." }, content)).toBe(
      "The stores can bear it.\n\nCount the iron.",
    );
  });

  it("is empty when the model sent none", () => {
    expect(extractReasoning({ choices: [{ message: { content: "Only speech." } }] })).toBe("");
    expect(combineReasoning({}, "Only speech.")).toBe("");
  });
});
