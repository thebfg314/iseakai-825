import fs from "node:fs";
import path from "node:path";
import { migrateStanding } from "../history/standing";
import { WorldStateSchema, type WorldState } from "./schema";
import { deepClone } from "./util";

export function loadWorldState(filePath: string): WorldState {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { history?: { flags?: Record<string, unknown>; standingV?: number } };
  if (raw.history && raw.history.standingV !== 1) migrateStanding(raw.history as Parameters<typeof migrateStanding>[0]);
  return WorldStateSchema.parse(raw);
}

export function saveWorldState(filePath: string, state: WorldState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

export function cloneState(state: WorldState): WorldState {
  return WorldStateSchema.parse(deepClone(state));
}
