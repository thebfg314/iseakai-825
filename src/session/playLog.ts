import fs from "node:fs";
import path from "node:path";
import type { ChatMessageParam, CompletionUsage } from "../llm/types";
import { newId } from "../engine/util";

export type PlayLogModelCall = {
  purpose: string;
  provider: string;
  model: string;
  messages: ChatMessageParam[];
  content: string;
  reasoning: string;
  /** Provider's finish reason ("stop", "length", "end_turn", "max_tokens"). Absent when it sent none. */
  finishReason?: string;
  usage?: CompletionUsage;
  elapsedMs?: number;
  /** Token cap the game asked for on this call. */
  maxTokens?: number;
  proposals?: unknown;
  parseErrors?: string[];
  hallSpeech?: string;
};

/** "Finish reason: length (reply cut at the token cap)" and the like, for the log. */
export function describeFinish(reason: string | undefined): string {
  if (!reason) return "(provider sent none)";
  const r = reason.toLowerCase();
  if (r === "length" || r === "max_tokens") return `${reason} (reply cut at the token cap)`;
  if (r === "stop" || r === "end_turn" || r === "stop_sequence") return `${reason} (whole reply)`;
  return reason;
}

function usageLine(usage: CompletionUsage | undefined): string {
  if (!usage) return "(provider sent none)";
  const parts: string[] = [];
  if (usage.promptTokens != null) parts.push(`${usage.promptTokens} prompt`);
  if (usage.completionTokens != null) parts.push(`${usage.completionTokens} completion`);
  if (usage.reasoningTokens != null) parts.push(`${usage.reasoningTokens} of those reasoning`);
  return parts.length ? parts.join(", ") : "(provider sent none)";
}

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
  filePath: string;
  readonly directory: string;
  private enabled: boolean;
  private closed = false;
  /** True once a file exists on disk. Turning logging off can still seal that file. */
  private fileStarted = false;
  /** This file was sealed because logging was switched off, so switching it on may open another. */
  private sealedBySwitch = false;
  private resumeNote = "";
  private calls = 0;
  private notes = 0;

  constructor(
    saveDir: string,
    private readonly heading: { year: number; season: string; turn: number; provider: string; model: string },
    private readonly secrets: string[] = [],
    private readonly startedAt = new Date(),
    enabled = true,
  ) {
    this.enabled = enabled;
    this.directory = playLogsDirectory(saveDir);
    this.filePath = path.join(this.directory, `play-${stamp(this.startedAt)}-${newId("play")}.txt`);
  }

  /**
   * Settings switch. Off seals a file already started and then writes nothing.
   * On again in the same play opens a new file for whatever happens next.
   * A play that already ended stays ended.
   */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    if (!on) {
      if (!this.closed && this.fileStarted) {
        this.finish("Play logging was turned off. The play itself goes on.", "Logging stopped");
        this.sealedBySwitch = true;
      }
      this.enabled = false;
      return;
    }
    this.enabled = true;
    if (this.closed && this.sealedBySwitch) {
      this.closed = false;
      this.fileStarted = false;
      this.sealedBySwitch = false;
      this.calls = 0;
      this.notes = 0;
      this.resumeNote = "Play logging was turned back on. Lines below are the rest of this play. The earlier file was sealed when logging was turned off.";
      this.filePath = path.join(this.directory, `play-${stamp(new Date())}-${newId("play")}.txt`);
    }
  }

  private ensure() {
    if (!this.enabled || this.closed) return;
    fs.mkdirSync(this.directory, { recursive: true });
    this.fileStarted = true;
    if (fs.existsSync(this.filePath)) return;
    const h = this.heading;
    const header = [
      "Play machinery log",
      "",
      "This file is for you, out of character. The hall never shows these words.",
      "It keeps what the game sent the model, what the model reasoned, the raw reply,",
      "tool calls, proposals, refusals, and what the books then did.",
      "Set one play's file beside another's to see how the model is behaving.",
      ...(this.resumeNote ? ["", this.resumeNote] : []),
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
    if (this.closed || !this.enabled) return;
    this.ensure();
    fs.appendFileSync(this.filePath, redact(block, this.secrets), "utf8");
  }

  recordModel(call: PlayLogModelCall) {
    if (!this.enabled || this.closed) return;
    this.calls += 1;
    const systems = call.messages.filter((m) => m.role === "system");
    const rest = call.messages.filter((m) => m.role !== "system");
    const lines: string[] = [
      "================================================================================",
      `Model call ${this.calls}: ${call.purpose}`,
      `When: ${new Date().toISOString()}`,
      `Provider: ${call.provider}`,
      `Model: ${call.model || "(none selected)"}`,
      `Elapsed: ${call.elapsedMs != null ? `${(call.elapsedMs / 1000).toFixed(1)}s` : "(not measured)"}`,
      `Token budget: ${call.maxTokens ?? "(adapter default)"}`,
      `Finish reason: ${describeFinish(call.finishReason)}`,
      `Tokens: ${usageLine(call.usage)}`,
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
    if (!this.enabled || this.closed) return;
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

  /** Seal this play. A second call does nothing. Other files in the folder stay. Logging off and never started writes no file. */
  finish(reason: string, heading = "Play ended"): string {
    if (this.closed) return this.fileStarted ? this.filePath : "";
    if (!this.enabled && !this.fileStarted) {
      this.closed = true;
      return "";
    }
    if (this.calls === 0 && this.notes === 0) this.ensure();
    this.append(
      [
        "================================================================================",
        heading,
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
