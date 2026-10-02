/**
 * Hidden chain-of-thought the provider may send beside the reply the hall sees.
 * Empty when the model sent none. Never includes the API key.
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    return v
      .map(textOf)
      .filter(Boolean)
      .join("\n\n");
  }
  const o = asRecord(v);
  if (!o) return "";
  for (const key of ["thinking", "text", "summary", "content", "reasoning"]) {
    if (typeof o[key] === "string" && o[key].trim()) return String(o[key]).trim();
  }
  return "";
}

function pushUnique(parts: string[], raw: string) {
  const t = raw.trim();
  if (t && !parts.includes(t)) parts.push(t);
}

/** Reasoning fields on an OpenAI-style, Anthropic, RFAB, or Gemini body. */
export function extractReasoning(data: unknown): string {
  const root = asRecord(data);
  if (!root) return "";
  const parts: string[] = [];

  if (Array.isArray(root.content)) {
    for (const block of root.content) {
      const b = asRecord(block);
      if (!b) continue;
      if (b.type === "thinking" || b.type === "redacted_thinking" || b.type === "reasoning") {
        pushUnique(parts, textOf(b.thinking ?? b.text ?? b.summary ?? b.reasoning ?? ""));
      }
    }
  }

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  if (message) {
    pushUnique(parts, textOf(message.reasoning));
    pushUnique(parts, textOf(message.reasoning_content));
    pushUnique(parts, textOf(message.thinking));
    if (Array.isArray(message.reasoning_details)) pushUnique(parts, textOf(message.reasoning_details));
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const p = asRecord(part);
        if (!p) continue;
        if (p.type === "reasoning" || p.type === "thinking") {
          pushUnique(parts, textOf(p.text ?? p.reasoning ?? p.thinking ?? ""));
        }
      }
    }
  }

  pushUnique(parts, textOf(root.reasoning));
  pushUnique(parts, textOf(root.thinking));
  pushUnique(parts, textOf(root.reasoning_content));
  return parts.join("\n\n");
}

/** `<think>…</think>` blocks some models leave inside the reply text. */
export function reasoningFromContent(content: string): string {
  const blocks: string[] = [];
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const t = (match[1] ?? "").trim();
    if (t && !blocks.includes(t)) blocks.push(t);
  }
  return blocks.join("\n\n");
}

export function combineReasoning(data: unknown, content: string): string {
  return [extractReasoning(data), reasoningFromContent(content)].filter(Boolean).join("\n\n");
}
