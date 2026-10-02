import fs from "node:fs";
import path from "node:path";
import type { ChatMessageParam } from "../llm/types";
import { newId } from "../engine/util";

export type PlayLogModelCall = {
  purpose: string;
  provider: string;
  model: string;
  messages: ChatMessageParam[];
  content: string;
  reasoning: string;
  proposals?: unknown;
  parseErrors?: string[];
  hallSpeech?: string;
};

/** One text file per play, beside the save. A later play writes a new file. */
export function playLogsDirectory(saveDir: string): string {
  return path.join(saveDir, "play-logs");
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    out = out.split(secret).join("[api key omitted]");
  }
  return out;
}

function roleLabel(role: string): string {
  if (role === "system") return "System information given to the model";
  if (role === "user") return "World-state pack and other instructions";
  if (role === "assistant") return "Earlier model reply fed back in";
  return role;
}

/**
 * Append-only machinery log for one play.
 * finish() seals it. It never deletes other files in the folder.
 */
export class PlayLog {
  readonly filePath: string;
  readonly directory: string;
  private closed = false;
  private calls = 0;
  private notes = 0;

  constructor(
    saveDir: string,
    private readonly heading: { year: number; season: string; turn: number; provider: string; model: string },
    private readonly secrets: string[] = [],
    private readonly startedAt = new Date(),
  ) {
    this.directory = playLogsDirectory(saveDir);
    this.filePath = path.join(this.directory, `play-${stamp(this.startedAt)}-${newId("play")}.txt`);
  }

  private ensure() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.existsSync(this.filePath)) return;
    const h = this.heading;
    const header = [
      "Play machinery log",
      "",
      "This file is for you, out of character. The hall never shows these words.",
      "It keeps what the game sent the model, what the model reasoned, the raw reply,",
      "tool calls, proposals, and refusals.",
      "",
      `Started: ${this.startedAt.toISOString()}`,
      `Estate: year ${h.year}, ${h.season}, turn ${h.turn}`,
      `Provider: ${h.provider}`,
      `Model: ${h.model || "(none selected)"}`,
      `File: ${this.filePath}`,
      "",
      "Each play has its own file in this folder. Starting another play does not delete this one.",
      "",
    ].join("\n");
    fs.writeFileSync(this.filePath, redact(header, this.secrets), "utf8");
  }

  private append(block: string) {
    if (this.closed) return;
    this.ensure();
    fs.appendFileSync(this.filePath, redact(block, this.secrets), "utf8");
  }

  recordModel(call: PlayLogModelCall) {
    this.calls += 1;
    const systems = call.messages.filter((m) => m.role === "system");
    const rest = call.messages.filter((m) => m.role !== "system");
    const lines: string[] = [
      "================================================================================",
      `Model call ${this.calls}: ${call.purpose}`,
      `When: ${new Date().toISOString()}`,
      `Provider: ${call.provider}`,
      `Model: ${call.model || "(none selected)"}`,
      "",
      "System information given to the model",
      "--------------------------------------",
      systems.length ? systems.map((m) => m.content).join("\n\n") : "(none)",
      "",
    ];
    if (rest.length) {
      for (const message of rest) {
        lines.push(roleLabel(message.role), "--------------------------------------", message.content, "");
      }
    }
    lines.push(
      "Model reasoning",
      "---------------",
      call.reasoning.trim() || "The model sent no separate reasoning with this reply.",
      "",
      "Raw model reply",
      "---------------",
      call.content.trim() || "(empty reply)",
      "",
    );
    if (call.proposals !== undefined) {
      lines.push("Proposals the books took from that reply", "-----------------------------------------", jsonBlock(call.proposals), "");
    }
    if (call.parseErrors?.length) {
      lines.push("Parse notes", "-----------", call.parseErrors.join("\n"), "");
    }
    if (call.hallSpeech !== undefined) {
      lines.push("Speech the hall was allowed to show", "----------------------------------", call.hallSpeech || "(none)", "");
    }
    this.append(`${lines.join("\n")}\n`);
  }

  note(title: string, body: string) {
    this.notes += 1;
    this.append(
      [
        "--------------------------------------------------------------------------------",
        `${title}`,
        `When: ${new Date().toISOString()}`,
        "",
        body.trim() || "(empty)",
        "",
      ].join("\n") + "\n",
    );
  }

  /** Seal this play. A second call does nothing. Other files in the folder stay. */
  finish(reason: string): string {
    if (this.closed) return this.filePath;
    if (this.calls === 0 && this.notes === 0) this.ensure();
    this.append(
      [
        "================================================================================",
        "Play ended",
        `When: ${new Date().toISOString()}`,
        reason.trim() || "The play ended.",
        `Model calls written: ${this.calls}`,
        "",
      ].join("\n"),
    );
    this.closed = true;
    return this.filePath;
  }
}

function jsonBlock(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
