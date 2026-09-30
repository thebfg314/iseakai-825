import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import startingEstate from "../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../src/engine/schema";
import { saveWorldState, loadWorldState } from "../src/engine/state";
import { listLlmModels } from "../src/llm/chat";
import { emptyMeter } from "../src/llm/usage";
import { mergeSettings, normalizeSettings, type SettingsPatch } from "../src/llm/settings";
import type { AppSettings } from "../src/llm/types";
import { GameController } from "../src/session/game";
import { LabController } from "../src/session/lab";
import { llmChat } from "../src/llm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow: BrowserWindow | null = null;
let controller: GameController | null = null;
/** Battle Lab session; forged units live only while it is open. */
let lab: LabController | null = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultSaveDir() {
  return path.join(app.getPath("userData"), "save");
}

function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as unknown;
    const next = normalizeSettings(raw);
    if (!raw || typeof raw !== "object" || !("providers" in (raw as object))) {
      persistSettings(next);
    }
    return next;
  } catch {
    return normalizeSettings(null);
  }
}

function persistSettings(s: AppSettings) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf8");
}

function newController(state: WorldState, saveDir: string, opts?: { resetUsage?: boolean }): GameController {
  const settings = loadSettings();
  const c = new GameController(state, saveDir, settings, opts);
  fs.mkdirSync(saveDir, { recursive: true });
  saveWorldState(path.join(saveDir, "world-state.json"), c.state);
  return c;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Isekai in the year of our lord 825",
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  controller = newController(WorldStateSchema.parse(startingEstate), defaultSaveDir());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function requireGame(): GameController {
  if (!controller) throw new Error("No game loaded.");
  return controller;
}

ipcMain.handle("game:getView", () => requireGame().view());

ipcMain.handle("game:new", () => {
  controller = newController(WorldStateSchema.parse(startingEstate), defaultSaveDir(), { resetUsage: true });
  return controller.view();
});

ipcMain.handle("game:save", async () => {
  const g = requireGame();
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "Save world state",
    defaultPath: path.join(g.saveDir, "world-state.json"),
    filters: [{ name: "World state", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return false;
  const dir = path.dirname(result.filePath);
  g.saveDir = dir;
  saveWorldState(result.filePath.endsWith(".json") ? result.filePath : path.join(dir, "world-state.json"), g.state);
  return true;
});

ipcMain.handle("game:load", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Load world state",
    filters: [{ name: "World state", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  const state = loadWorldState(file);
  controller = newController(state, path.dirname(file));
  return controller.view();
});

ipcMain.handle("game:setScene", (_e, npcId: string) => requireGame().setScene(npcId));

ipcMain.handle("game:sendDialogue", async (_e, npcId: string, message: string) => {
  return requireGame().sendDialogue(npcId, message);
});

ipcMain.handle("game:confirmProposal", (_e, id: string) => requireGame().confirmProposal(id));

ipcMain.handle("game:rejectProposal", (_e, id: string) => requireGame().rejectProposal(id));

ipcMain.handle("game:cancelForthcomingOrder", (_e, id: string) => requireGame().cancelForthcomingOrder(id));

ipcMain.handle("game:askAboutProposal", (_e, id: string) => requireGame().askAboutProposal(id));

ipcMain.handle("game:confirmMerchantShop", (_e, basket: {
  buyStall: Record<string, number>;
  buyBack: Record<string, number>;
  sell: Record<string, number>;
}) => requireGame().confirmMerchantShop(basket));

ipcMain.handle("game:advanceSeason", async () => requireGame().advanceSeason());

ipcMain.handle("game:answerCall", (_e, accept: boolean) => requireGame().answerCall(accept));
ipcMain.handle("game:musterAndRide", async (_e, bringIds: string[]) => requireGame().musterAndRide(bringIds ?? []));
ipcMain.handle("game:battleContinue", async () => requireGame().battleContinue());
ipcMain.handle("game:battleChoose", async (_e, key: "A" | "B") => requireGame().battleChoose(key));
ipcMain.handle("game:battleRound", async (_e, orders: unknown[]) => requireGame().battleRound(orders ?? []));
ipcMain.handle("game:scoutRole", (_e, role: "narrower" | "finalizer") => requireGame().scoutRole(role));
ipcMain.handle("game:scoutNarrow", (_e, keep: number[]) => requireGame().scoutNarrow(keep ?? []));
ipcMain.handle("game:scoutFinalize", (_e, pick: number) => requireGame().scoutFinalize(pick));
ipcMain.handle("game:deployFile", (_e, unitId: string, cell: { row: number; col: number }) => requireGame().deployFile(unitId, cell));
ipcMain.handle("game:deployRest", () => requireGame().deployRest());
ipcMain.handle("game:addressFile", (_e, unitId: string, amount: number) => requireGame().addressFile(unitId, amount));
ipcMain.handle("game:beginBattle", async () => requireGame().beginBattle());
ipcMain.handle("game:dayEnd", async (_e, choice: "hold" | "reposition" | "withdraw", pick?: number) => requireGame().dayEnd(choice, pick));
ipcMain.handle("game:grantFullCommand", (_e, on: boolean) => requireGame().grantFullCommand(on));
ipcMain.handle("game:battleFinish", (_e, disposition?: "settle" | "sell") => requireGame().battleFinish(disposition));
ipcMain.handle("game:raiseCall", (_e, kind: "summons" | "raid" | "bandits") => requireGame().raiseCall(kind));

ipcMain.handle("settings:get", () => loadSettings());

ipcMain.handle("settings:set", (_e, patch: SettingsPatch) => {
  const next = mergeSettings(loadSettings(), patch);
  persistSettings(next);
  if (controller) {
    controller.settings = next;
    controller.meter.setProvider(next.provider);
  }
  return next;
});

ipcMain.handle("settings:listModels", async () => {
  return listLlmModels(loadSettings());
});

ipcMain.handle("llm:getMeter", async () => {
  if (!controller) return emptyMeter(loadSettings().provider);
  await controller.refreshCredits();
  return controller.meter.snapshot();
});

ipcMain.handle("app:quit", () => {
  app.quit();
});

// ---------------------------------------------------------------------------
// Battle Lab
// ---------------------------------------------------------------------------

function requireLab(): LabController {
  if (!lab) lab = new LabController((messages, opts) => llmChat(loadSettings(), messages, opts));
  return lab;
}

ipcMain.handle("lab:open", () => {
  lab?.dispose();
  lab = new LabController((messages, opts) => llmChat(loadSettings(), messages, opts));
  return lab.view();
});
ipcMain.handle("lab:close", () => {
  lab?.dispose();
  lab = null;
  return true;
});
ipcMain.handle("lab:getView", () => requireLab().view());
ipcMain.handle("lab:setConfig", (_e, patch: unknown) => requireLab().setConfig(patch));
ipcMain.handle("lab:paintCell", (_e, row: number, col: number, terrain: string[], cliffBelow?: boolean) => requireLab().paintCell(row, col, terrain, cliffBelow));
ipcMain.handle("lab:build", () => requireLab().build());
ipcMain.handle("lab:step", (_e, orders: unknown[]) => requireLab().step(orders ?? []));
ipcMain.handle("lab:autoRun", (_e, maxRounds?: number) => requireLab().autoRun(maxRounds));
ipcMain.handle("lab:rewind", (_e, steps?: number) => requireLab().rewind(steps));
ipcMain.handle("lab:dayEnd", (_e, choice: "hold" | "reposition" | "withdraw") => requireLab().dayEnd(choice));
ipcMain.handle("lab:reset", () => requireLab().reset());
ipcMain.handle("lab:exportScenario", () => requireLab().exportScenario());
ipcMain.handle("lab:importScenario", (_e, text: string) => requireLab().importScenario(text));
ipcMain.handle("lab:forge", (_e, prompt: string) => requireLab().forgeUnit(prompt));
ipcMain.handle("lab:approveForge", () => requireLab().approveForge());
ipcMain.handle("lab:rejectForge", () => requireLab().rejectForge());
ipcMain.handle("lab:discardSheet", (_e, id: string) => requireLab().discardCustomSheet(id));
