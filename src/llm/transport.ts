import { LlmTimeoutError } from "./types";

/** Whole request, headers to last byte. */
export const DEFAULT_TOTAL_MS = 180_000;
/** Longest silence tolerated between two chunks of a streamed reply. */
export const DEFAULT_IDLE_MS = 60_000;

export type SseEvent = { event?: string; data: string };

/**
 * Incremental Server-Sent Events parser. Feed it decoded text as it arrives;
 * it returns the complete events found so far and keeps any unfinished tail.
 */
export class SseParser {
  private buffer = "";

  push(text: string): SseEvent[] {
    this.buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev) events.push(ev);
    }
    return events;
  }

  /** Whatever is left when the body closes without a trailing blank line. */
  flush(): SseEvent[] {
    const block = this.buffer;
    this.buffer = "";
    const ev = parseBlock(block);
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): SseEvent | null {
  const dataLines: string[] = [];
  let event: string | undefined;
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}

export type RequestOpts = {
  totalMs?: number;
  idleMs?: number;
  providerLabel?: string;
  /** Called for each SSE event when the provider streams. */
  onEvent?: (ev: SseEvent) => void;
  /** Text gathered so far, attached to a timeout error so the caller may keep it. */
  partial?: () => string;
  /** Swap the global fetch (tests). */
  fetchImpl?: typeof fetch;
};

export type RequestResult = {
  ok: boolean;
  status: number;
  headers: Headers;
  /** True when the body was an event stream and `onEvent` received it. */
  streamed: boolean;
  /** Full body text when not streamed, or the error body on a non-2xx status. */
  text: string;
  elapsedMs: number;
};

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: string }).code;
  return name === "AbortError" || name === "TimeoutError" || code === "ABORT_ERR" || code === "UND_ERR_ABORTED";
}

/**
 * fetch with a total budget and an idle budget, reading an SSE body incrementally
 * when the provider sends one. A provider that ignores `stream: true` and answers
 * with plain JSON still works: the body is returned whole in `text`.
 */
export async function requestWithTimeout(url: string, init: RequestInit, opts: RequestOpts = {}): Promise<RequestResult> {
  const totalMs = opts.totalMs ?? DEFAULT_TOTAL_MS;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const label = opts.providerLabel ?? "Model";
  const started = Date.now();
  const controller = new AbortController();
  let timedOut: "total" | "idle" | null = null;

  const totalTimer = setTimeout(() => {
    timedOut = "total";
    controller.abort();
  }, totalMs);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = "idle";
      controller.abort();
    }, idleMs);
  };
  const clearTimers = () => {
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
  };
  const timeoutError = () => new LlmTimeoutError(timedOut ?? "total", Date.now() - started, opts.partial?.() ?? "", label);

  try {
    armIdle();
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(url, { ...init, signal: controller.signal });
    const headers = res.headers;
    const contentType = headers.get("content-type") ?? "";
    const streaming = res.ok && Boolean(opts.onEvent) && contentType.includes("text/event-stream") && res.body != null;

    if (!streaming) {
      armIdle();
      const text = await res.text();
      clearTimers();
      return { ok: res.ok, status: res.status, headers, streamed: false, text, elapsedMs: Date.now() - started };
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let done = false;
    while (!done) {
      armIdle();
      const chunk = await reader.read();
      done = chunk.done;
      if (chunk.value) {
        for (const ev of parser.push(decoder.decode(chunk.value, { stream: true }))) opts.onEvent!(ev);
      }
    }
    for (const ev of parser.push(decoder.decode())) opts.onEvent!(ev);
    for (const ev of parser.flush()) opts.onEvent!(ev);
    clearTimers();
    return { ok: true, status: res.status, headers, streamed: true, text: "", elapsedMs: Date.now() - started };
  } catch (err) {
    clearTimers();
    if (timedOut || isAbort(err)) throw timeoutError();
    throw err;
  }
}

/** Parse one SSE `data:` payload as JSON; `[DONE]` and junk return undefined. */
export function sseJson(ev: SseEvent): Record<string, unknown> | undefined {
  const data = ev.data.trim();
  if (!data || data === "[DONE]") return undefined;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
