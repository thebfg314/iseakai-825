import fs from "node:fs";
import path from "node:path";
import type { WorldState } from "./schema";

export function historyPath(saveDir: string): string {
  return path.join(saveDir, "history.log");
}

export function appendHistory(
  saveDir: string,
  state: WorldState,
  actor: string,
  kind: "APPLY" | "REJECT" | "EVENT" | "CHAT" | "SEASON",
  summary: string,
): string {
  const line = `${new Date().toISOString()} | ${state.meta.turn} | ${state.meta.season} | ${state.meta.year} | ${actor} | ${kind} | ${summary.replace(/\s+/g, " ").trim()}`;
  try {
    fs.mkdirSync(saveDir, { recursive: true });
    fs.appendFileSync(historyPath(saveDir), line + "\n", "utf8");
  } catch {
    /* save dir may not exist yet in tests */
  }
  return line;
}

export function readHistory(saveDir: string, last = 40): string[] {
  try {
    const raw = fs.readFileSync(historyPath(saveDir), "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-last);
  } catch {
    return [];
  }
}
