import { afterEach, describe, expect, it, vi } from "vitest";
import { requestWithTimeout, SseParser, sseJson } from "./transport";
import { LlmTimeoutError } from "./types";
import { OpenAiStreamAccumulator, openaiCompatibleChat, usageFromOpenAi } from "./openaiCompat";
import { AnthropicStreamAccumulator } from "./anthropic";

function sseBody(chunks: string[], opts?: { delayMs?: number }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
}

function sseResponse(chunks: string[], opts?: { delayMs?: number }): Response {
  return new Response(sseBody(chunks, opts), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("SseParser", () => {
  it("joins data lines, keeps event names, and holds an unfinished tail", () => {
    const p = new SseParser();
    const first = p.push('event: message_start\ndata: {"a":1}\n\ndata: {"b":\ndata: 2}\n\ndata: {"c"');
    expect(first).toEqual([
      { event: "message_start", data: '{"a":1}' },
      { event: undefined, data: '{"b":\n2}' },
    ]);
    const second = p.push(':3}\n\n');
    expect(second).toEqual([{ event: undefined, data: '{"c":3}' }]);
    expect(p.flush()).toEqual([]);
  });

  it("accepts CRLF line endings and skips comments", () => {
    const p = new SseParser();
    expect(p.push(": keep-alive\r\ndata: {\"x\":1}\r\n\r\n")).toEqual([{ event: undefined, data: '{"x":1}' }]);
  });

  it("sseJson drops [DONE] and junk", () => {
    expect(sseJson({ data: "[DONE]" })).toBeUndefined();
    expect(sseJson({ data: "not json" })).toBeUndefined();
    expect(sseJson({ data: '{"ok":true}' })).toEqual({ ok: true });
  });
});

describe("requestWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers SSE events and reports the body as streamed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(['data: {"n":1}\n\n', 'data: {"n":2}\n\ndata: [DONE]\n\n']),
    );
    const seen: unknown[] = [];
    const res = await requestWithTimeout("https://x", {}, { onEvent: (ev) => seen.push(sseJson(ev)) });
    expect(res.ok).toBe(true);
    expect(res.streamed).toBe(true);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }, undefined]);
  });

  it("returns a plain JSON body whole when the provider did not stream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"hi"}}]}', { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await requestWithTimeout("https://x", {}, { onEvent: () => undefined });
    expect(res.streamed).toBe(false);
    expect(res.text).toContain('"hi"');
  });

  it("times out on silence mid-stream and hands back the partial text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('data: {"t":"half"}\n\n'));
          init?.signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    let partial = "";
    const promise = requestWithTimeout(
      "https://x",
      {},
      {
        idleMs: 30,
        totalMs: 5000,
        providerLabel: "Test",
        partial: () => partial,
        onEvent: (ev) => {
          const d = sseJson(ev);
          if (d && typeof d.t === "string") partial += d.t;
        },
      },
    );
    await expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
    await promise.catch((err: LlmTimeoutError) => {
      expect(err.kind).toBe("idle");
      expect(err.partialContent).toBe("half");
      expect(err.message).toMatch(/Test timed out/);
    });
  });

  it("maps a provider abort before headers to a total timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    await expect(requestWithTimeout("https://x", {}, { totalMs: 20, idleMs: 5000 })).rejects.toMatchObject({ kind: "total" });
  });
});

describe("OpenAiStreamAccumulator", () => {
  it("gathers content, reasoning, finish reason, and usage across chunks", () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { reasoning: "think " } }] });
    acc.push({ choices: [{ delta: { content: '{"speech":' } }] });
    acc.push({ choices: [{ delta: { content: '"hi"}' }, finish_reason: "stop" }] });
    acc.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } } });
    expect(acc.content).toBe('{"speech":"hi"}');
    expect(acc.reasoning).toBe("think ");
    expect(acc.finishReason).toBe("stop");
    expect(acc.usage).toEqual({ promptTokens: 10, completionTokens: 20, reasoningTokens: 5 });
  });

  it("records a mid-stream error object", () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ error: { code: 502, message: "upstream died" } });
    expect(acc.error).toBe("502: upstream died");
  });

  it("usageFromOpenAi returns undefined for an empty block", () => {
    expect(usageFromOpenAi({})).toBeUndefined();
    expect(usageFromOpenAi(undefined)).toBeUndefined();
  });
});

describe("AnthropicStreamAccumulator", () => {
  it("gathers text, thinking, stop reason, and usage", () => {
    const acc = new AnthropicStreamAccumulator();
    acc.push({ type: "message_start", message: { usage: { input_tokens: 40 } } });
    acc.push({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } });
    acc.push({ type: "content_block_delta", delta: { type: "text_delta", text: "Yes, " } });
    acc.push({ type: "content_block_delta", delta: { type: "text_delta", text: "my lord." } });
    acc.push({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 12 } });
    expect(acc.content).toBe("Yes, my lord.");
    expect(acc.reasoning).toBe("hmm");
    expect(acc.stopReason).toBe("max_tokens");
    expect(acc.usage).toEqual({ promptTokens: 40, completionTokens: 12 });
  });
});

describe("openaiCompatibleChat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams a reply and marks it truncated when finish_reason is length", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"speech\\":\\"cut"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":1,"completion_tokens":800}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const done = await openaiCompatibleChat({
      url: "https://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      chatOpts: { maxTokens: 800 },
      providerLabel: "Test",
    });
    expect(done.content).toBe('{"speech":"cut');
    expect(done.finishReason).toBe("length");
    expect(done.truncated).toBe(true);
    expect(done.usage?.completionTokens).toBe(800);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(800);
  });

  it("throws a truncation error when the cap was hit before any visible text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(['data: {"choices":[{"delta":{"reasoning":"..."},"finish_reason":"length"}]}\n\n', "data: [DONE]\n\n"]),
    );
    await expect(
      openaiCompatibleChat({ url: "https://x", apiKey: "k", model: "m", messages: [], providerLabel: "Test" }),
    ).rejects.toThrow(/ran out of tokens/);
  });

  it("still reads a one-shot JSON body from a provider that ignores stream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "plain" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const done = await openaiCompatibleChat({ url: "https://x", apiKey: "k", model: "m", messages: [], providerLabel: "Test" });
    expect(done.content).toBe("plain");
    expect(done.finishReason).toBe("stop");
    expect(done.truncated).toBe(false);
  });
});
