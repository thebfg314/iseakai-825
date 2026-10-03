import { describe, expect, it, vi } from "vitest";
import { NO_RESEARCH_KEY, parseTavily, ResearchCache, researchDrawer, searchWeb } from "./research";
import { parseResearchRequest, stripToolMarkers, hasMalformedToolMarker } from "./toolProtocol";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("research marker", () => {
  it("reads one or two plain questions and strips them from speech", () => {
    const raw =
      "A heavy plough, my lord? Let me reckon.\n<=-research: how much iron is in a medieval heavy plough share and coulter -=>\n<=-research: how many days does a smith take to forge a plough share -=>";
    const req = parseResearchRequest(raw);
    expect(req.requested).toBe(true);
    expect(req.malformed).toBe(false);
    expect(req.queries).toEqual([
      "how much iron is in a medieval heavy plough share and coulter",
      "how many days does a smith take to forge a plough share",
    ]);
    expect(stripToolMarkers(raw)).toBe("A heavy plough, my lord? Let me reckon.");
  });

  it("collapses the same question asked twice", () => {
    const req = parseResearchRequest("<=-research: iron in a plough -=>\n<=-research:  Iron in a  plough -=>");
    expect(req.queries).toEqual(["iron in a plough"]);
  });

  it("a chopped marker is malformed, like a chopped tool marker", () => {
    const req = parseResearchRequest("Let me think.\n<=-research: how much iron");
    expect(req.requested).toBe(false);
    expect(req.malformed).toBe(true);
    expect(hasMalformedToolMarker("Let me think.\n<=-research: how much iron")).toBe(true);
  });

  it("may share a reply with a ledger tool marker", () => {
    const raw = "<=-tool: forge -=>\n<=-research: weight of a plough coulter -=>";
    expect(parseResearchRequest(raw).queries).toEqual(["weight of a plough coulter"]);
    expect(stripToolMarkers(raw)).toBe("");
  });
});

describe("searchWeb", () => {
  it("returns the no-key note without touching the network", async () => {
    const fetchImpl = vi.fn();
    const out = await searchWeb("iron in a plough", "", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.unavailable).toBe(NO_RESEARCH_KEY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a Tavily answer and its sources", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe("iron in a plough");
      expect(body.include_answer).toBe(true);
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tvly-test");
      return jsonResponse({
        answer: "A medieval heavy plough carried roughly 10 to 20 pounds of iron in share and coulter.",
        results: [
          { title: "Medieval plough", url: "https://example.org/plough", content: "The share weighed about 5 lb and the coulter 8 to 12 lb." },
          { title: "Smithing", url: "https://example.org/smith", content: "A share took a day at the hearth." },
        ],
      });
    });
    const out = await searchWeb("iron in a plough", "tvly-test", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.unavailable).toBeUndefined();
    expect(out.answer).toMatch(/10 to 20 pounds/);
    expect(out.sources).toHaveLength(2);
    expect(out.sources[0]).toMatchObject({ title: "Medieval plough", snippet: expect.stringMatching(/5 lb/) });
  });

  it("a bad status or a hung call becomes a finding that says to judge for yourself", async () => {
    const bad = vi.fn(async () => jsonResponse({ error: "nope" }, 500));
    const out = await searchWeb("x", "tvly-test", { fetchImpl: bad as unknown as typeof fetch });
    expect(out.unavailable).toMatch(/answered 500/);

    const hung = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    });
    const slow = await searchWeb("x", "tvly-test", { fetchImpl: hung as unknown as typeof fetch, timeoutMs: 30 });
    expect(slow.unavailable).toMatch(/did not come back/);
  });

  it("parseTavily handles junk and empty results", () => {
    expect(parseTavily("q", "not json").unavailable).toMatch(/not JSON/);
    expect(parseTavily("q", JSON.stringify({ results: [] })).unavailable).toMatch(/nothing useful/);
  });
});

describe("ResearchCache and drawer", () => {
  it("buys a question once and never caches a failure", async () => {
    let calls = 0;
    const cache = new ResearchCache(async (q) => {
      calls += 1;
      return q === "fail" ? { query: q, sources: [], unavailable: "down" } : { query: q, answer: "ok", sources: [] };
    });
    await cache.lookup("Iron in a plough");
    await cache.lookup("iron in a  plough");
    expect(calls).toBe(1);
    await cache.lookup("fail");
    await cache.lookup("fail");
    expect(calls).toBe(3);
  });

  it("the drawer carries the note, answers, and what each source says", () => {
    const drawer = researchDrawer([
      { query: "a", answer: "A", sources: [{ title: "T", url: "u", snippet: "S" }] },
      { query: "b", sources: [], unavailable: "nothing" },
    ]);
    expect(drawer.note).toMatch(/craft knowledge/);
    expect(drawer.findings).toEqual([
      { question: "a", answer: "A", sources: [{ title: "T", says: "S" }] },
      { question: "b", findings: "nothing" },
    ]);
  });
});
