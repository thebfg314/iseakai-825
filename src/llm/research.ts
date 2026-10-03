import { requestWithTimeout } from "./transport";

/**
 * The NPCs' hidden research tool. A speaker who is unsure of a real-world
 * quantity (iron in a plough share, days to burn a charcoal mound) asks in
 * plain words; the game searches and hands the findings back as a drawer.
 * Provider-independent: it never touches the chat model's own request.
 */

export const TAVILY_URL = "https://api.tavily.com/search";
export const RESEARCH_TIMEOUT_MS = 20_000;
export const MAX_RESEARCH_QUERIES = 2;
export const MAX_RESEARCH_RESULTS = 5;

export type ResearchSource = { title: string; url: string; snippet: string };

export type ResearchFinding = {
  query: string;
  /** Tavily's short synthesized answer, when it gives one. */
  answer?: string;
  sources: ResearchSource[];
  /** Why there are no findings: no key, a failed call, or an empty result set. */
  unavailable?: string;
};

export const NO_RESEARCH_KEY = "No research key is set; judge the figure yourself from what you know of the craft.";

type FetchLike = typeof fetch;

/** One search. Never throws: a failure comes back as a finding with `unavailable` set. */
export async function searchWeb(
  query: string,
  apiKey: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ResearchFinding> {
  const q = query.trim();
  if (!apiKey.trim()) return { query: q, sources: [], unavailable: NO_RESEARCH_KEY };
  if (!q) return { query: q, sources: [], unavailable: "The question was empty." };
  try {
    const res = await requestWithTimeout(
      TAVILY_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query: q,
          search_depth: "basic",
          include_answer: true,
          max_results: MAX_RESEARCH_RESULTS,
        }),
      },
      { totalMs: opts.timeoutMs ?? RESEARCH_TIMEOUT_MS, idleMs: opts.timeoutMs ?? RESEARCH_TIMEOUT_MS, providerLabel: "Research", fetchImpl: opts.fetchImpl },
    );
    if (!res.ok) {
      return { query: q, sources: [], unavailable: `The search service answered ${res.status}; judge the figure yourself.` };
    }
    return parseTavily(q, res.text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { query: q, sources: [], unavailable: `The search did not come back (${msg}); judge the figure yourself.` };
  }
}

export function parseTavily(query: string, text: string): ResearchFinding {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { query, sources: [], unavailable: "The search service sent something that was not JSON; judge the figure yourself." };
  }
  const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const answer = typeof rec.answer === "string" && rec.answer.trim() ? rec.answer.trim() : undefined;
  const results = Array.isArray(rec.results) ? rec.results : [];
  const sources: ResearchSource[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const snippet = typeof r.content === "string" ? r.content.trim().slice(0, 600) : "";
    if (!snippet && !title) continue;
    sources.push({ title, url, snippet });
    if (sources.length >= MAX_RESEARCH_RESULTS) break;
  }
  if (!answer && !sources.length) {
    return { query, sources: [], unavailable: "The search found nothing useful; judge the figure yourself." };
  }
  return { query, answer, sources };
}

/** Per-play memory so the same question is not bought twice. */
export class ResearchCache {
  private readonly found = new Map<string, ResearchFinding>();

  constructor(private readonly search: (query: string) => Promise<ResearchFinding>) {}

  async lookup(query: string): Promise<ResearchFinding> {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = this.found.get(key);
    if (hit) return hit;
    const finding = await this.search(query);
    // A missing key or a failed call is not worth remembering: the lord may add a key mid-play.
    if (!finding.unavailable) this.found.set(key, finding);
    return finding;
  }
}

/** The drawer the model reads. Plain words first, sources after. */
export function researchDrawer(findings: ResearchFinding[]): Record<string, unknown> {
  return {
    note:
      "Findings from outside this age, for your judgement only. Speak them as craft knowledge in this age's units. Never mention searching, sources, or the moderns.",
    findings: findings.map((f) =>
      f.unavailable
        ? { question: f.query, findings: f.unavailable }
        : {
            question: f.query,
            answer: f.answer,
            sources: f.sources.map((s) => ({ title: s.title, says: s.snippet })),
          },
    ),
  };
}
