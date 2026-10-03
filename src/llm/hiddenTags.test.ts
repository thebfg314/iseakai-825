import { describe, expect, it } from "vitest";
import { hasBooksTag, stripBooksTag } from "./hiddenTags";
import { parseLlmResponse } from "./parse";

describe("hidden [[books:yes|no]] tag", () => {
  it("reads yes and strips the tag from plain speech", () => {
    const out = stripBooksTag("Coppicing, my lord? Hazel and ash will take to it. [[books:yes]]");
    expect(out.books).toBe(true);
    expect(out.text).toBe("Coppicing, my lord? Hazel and ash will take to it.");
  });

  it("reads no, in any of the bracket spellings", () => {
    expect(stripBooksTag("Good morning, my lord.\n[[ books : no ]]").books).toBe(false);
    expect(stripBooksTag("Good morning, my lord. <<books:no>>").books).toBe(false);
    expect(stripBooksTag("Good morning, my lord. [BOOKS:false]").books).toBe(false);
    expect(stripBooksTag("Aye. [[books:true]]").books).toBe(true);
  });

  it("leaves untagged speech alone", () => {
    const out = stripBooksTag("The rye stands well.");
    expect(out.books).toBeUndefined();
    expect(out.text).toBe("The rye stands well.");
    expect(hasBooksTag("The rye stands well.")).toBe(false);
    expect(hasBooksTag("The rye stands well. [[books:no]]")).toBe(true);
  });

  it("the last tag wins when the model wrote two", () => {
    expect(stripBooksTag("[[books:no]] On second thought, aye. [[books:yes]]").books).toBe(true);
  });

  it("parseLlmResponse strips the tag from plain speech and reports it", () => {
    const parsed = parseLlmResponse("Send the children to the monks? A strange thing, but it can be done. [[books:yes]]");
    expect(parsed.books).toBe(true);
    expect(parsed.response.speech).toBe("Send the children to the monks? A strange thing, but it can be done.");
  });

  it("parseLlmResponse finds the tag inside a speech JSON string or after the brace", () => {
    const inside = parseLlmResponse(JSON.stringify({ speech: "Aye, my lord. [[books:yes]]", emotion: "pleased" }));
    expect(inside.books).toBe(true);
    expect(inside.response.speech).toBe("Aye, my lord.");

    const after = parseLlmResponse(`${JSON.stringify({ speech: "Only talk, my lord." })}\n[[books:no]]`);
    expect(after.books).toBe(false);
    expect(after.response.speech).toBe("Only talk, my lord.");
  });

  it("the tag and an emotion tag can share a reply", () => {
    const parsed = parseLlmResponse("As you say. [[emotion:pleased]] [[books:yes]]");
    expect(parsed.books).toBe(true);
    expect(parsed.emotion).toBe("pleased");
    expect(parsed.response.speech).toBe("As you say.");
  });
});
