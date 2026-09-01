import { describe, expect, it } from "vitest";
import { emptyMeter } from "../llm/usage";
import { hudInkLine, remainingCaption, settingsInkLines } from "./scribeInk";

describe("scribe ink copy", () => {
  it("labels remaining RFAB tokens separately from used-this-save", () => {
    const meter = emptyMeter("rfab");
    meter.remainingKnown = true;
    meter.remaining = { value: 916083, kind: "tokens" };
    meter.usedThisSave.billedTokens = 157;
    meter.usedThisSave.totalTokens = 152;
    expect(remainingCaption("tokens")).toBe("Tokens remaining");
    expect(hudInkLine(meter)).toBe("Tokens remaining: 916,083 · Used this save: 157");
  });

  it("shows only used-this-save when the provider has no remaining balance", () => {
    const meter = emptyMeter("openai");
    meter.usedThisSave.totalTokens = 1240;
    expect(hudInkLine(meter)).toBe("Used this save: 1,240");
    expect(settingsInkLines(meter).join(" ")).toMatch(/does not give this game a remaining-balance/i);
    expect(settingsInkLines(meter).join(" ")).not.toMatch(/sk-|api[_-]?key|rfab_/i);
  });

  it("formats OpenRouter remaining as credits", () => {
    const meter = emptyMeter("openrouter");
    meter.remainingKnown = true;
    meter.remaining = { value: 4.2, kind: "usd" };
    expect(hudInkLine(meter)).toMatch(/^Credits left: \$4\.20/);
  });
});
