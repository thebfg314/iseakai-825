import { describe, expect, it } from "vitest";
import {
  LlmMeterStore,
  addTally,
  consumeLastLlmCall,
  emptyTally,
  parseOpenRouterKey,
  parseRemainingFromHeaders,
  parseRfabBalance,
  parseUsageFromChatBody,
  rememberChatResponse,
  tallyDisplayTokens,
} from "./usage";

describe("parseUsageFromChatBody", () => {
  it("reads RFAB usage and tokensBilled", () => {
    const usage = parseUsageFromChatBody({
      success: true,
      content: "Aye.",
      usage: { inputTokens: 147, outputTokens: 5 },
      tokensBilled: 157,
    });
    expect(usage).toEqual({
      promptTokens: 147,
      completionTokens: 5,
      totalTokens: 152,
      billedTokens: 157,
    });
  });

  it("reads OpenAI-shaped usage", () => {
    expect(
      parseUsageFromChatBody({
        choices: [{ message: { content: "Hi" } }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }),
    ).toEqual({ promptTokens: 20, completionTokens: 8, totalTokens: 28 });
  });

  it("reads Anthropic-shaped usage", () => {
    expect(
      parseUsageFromChatBody({
        content: [{ type: "text", text: "Hi" }],
        usage: { input_tokens: 40, output_tokens: 12 },
      }),
    ).toEqual({ promptTokens: 40, completionTokens: 12, totalTokens: 52 });
  });

  it("returns undefined when there is no usage", () => {
    expect(parseUsageFromChatBody({ content: "Aye." })).toBeUndefined();
    expect(parseUsageFromChatBody(null)).toBeUndefined();
  });
});

describe("parse remaining credits", () => {
  it("reads RFAB tokenBalance", () => {
    expect(parseRfabBalance({ success: true, tokenBalance: 916083, totalTokensUsed: 86904 })).toEqual({
      value: 916083,
      kind: "tokens",
    });
  });

  it("reads OpenRouter key limit_remaining as USD credits", () => {
    expect(parseOpenRouterKey({ data: { limit_remaining: 4.2, limit: 10, usage: 5.8 } })).toEqual({
      value: 4.2,
      kind: "usd",
    });
  });

  it("does not treat an uncapped OpenRouter key as a remaining figure", () => {
    expect(parseOpenRouterKey({ data: { limit_remaining: null, limit: null, usage: 1.2 } })).toBeUndefined();
  });

  it("reads credit headers and ignores rate-limit remaining", () => {
    expect(parseRemainingFromHeaders({ "x-credits-remaining": "42" })).toEqual({ value: 42, kind: "credits" });
    expect(parseRemainingFromHeaders({ "x-token-balance": "1000" })).toEqual({ value: 1000, kind: "tokens" });
    expect(parseRemainingFromHeaders({ "x-ratelimit-remaining": "9847", "x-ratelimit-remaining-tokens": "80000" })).toBeUndefined();
  });
});

describe("LlmMeterStore", () => {
  it("accumulates session and save usage from a remembered chat call", () => {
    rememberChatResponse(
      { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      { "x-credits-remaining": "99" },
    );
    const store = new LlmMeterStore("openrouter");
    store.applyCall(consumeLastLlmCall());
    expect(store.usedThisSave).toMatchObject({ promptTokens: 10, completionTokens: 5, totalTokens: 15, calls: 1 });
    expect(store.usedThisSession.calls).toBe(1);
    expect(store.remainingKnown).toBe(true);
    expect(store.remaining).toEqual({ value: 99, kind: "credits" });
    expect(consumeLastLlmCall()).toBeNull();
  });

  it("prefers billed tokens for the displayed used count", () => {
    const tally = addTally(emptyTally(), { promptTokens: 10, completionTokens: 5, totalTokens: 15, billedTokens: 40 });
    expect(tallyDisplayTokens(tally)).toBe(40);
  });
});
