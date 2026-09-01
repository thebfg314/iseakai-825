import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "./settings";
import { fetchProviderBalance, providerBalanceHelp } from "./credits";

describe("fetchProviderBalance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips when no API key is configured", async () => {
    const report = await fetchProviderBalance(defaultAppSettings());
    expect(report).toMatchObject({ provider: "rfab", skipped: true, remainingKnown: false });
  });

  it("reads Reality Fabricator tokenBalance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, tokenBalance: 5000 }),
      }),
    );
    const settings = defaultAppSettings();
    settings.providers.rfab.apiKey = "rfab_test";
    const report = await fetchProviderBalance(settings);
    expect(report.remainingKnown).toBe(true);
    expect(report.remaining).toEqual({ value: 5000, kind: "tokens" });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(call[0]).toContain("/api/tokens/balance");
    expect(call[1].headers["X-API-Key"]).toBe("rfab_test");
  });

  it("reads OpenRouter key limit_remaining", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { limit_remaining: 3.5, limit: 10 } }),
      }),
    );
    const settings = defaultAppSettings();
    settings.provider = "openrouter";
    settings.providers.openrouter.apiKey = "sk-or-test";
    const report = await fetchProviderBalance(settings);
    expect(report.remaining).toEqual({ value: 3.5, kind: "usd" });
  });

  it("marks OpenAI as unsupported rather than inventing a balance", async () => {
    const settings = defaultAppSettings();
    settings.provider = "openai";
    settings.providers.openai.apiKey = "sk-test";
    const report = await fetchProviderBalance(settings);
    expect(report.unsupported).toBe(true);
    expect(report.remainingKnown).toBe(false);
    expect(providerBalanceHelp("openai")).toMatch(/tokens used this save/i);
  });

  it("returns failed on a network error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const settings = defaultAppSettings();
    settings.providers.rfab.apiKey = "rfab_test";
    const report = await fetchProviderBalance(settings);
    expect(report.failed).toBe(true);
    expect(report.remainingKnown).toBe(false);
  });
});
