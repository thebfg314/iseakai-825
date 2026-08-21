import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import startingEstate from "../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../src/engine/schema";
import { saveWorldState, loadWorldState } from "../src/engine/state";
import { DEFAULT_MODEL, listRfabModels, type RfabSettings } from "../src/llm/rfab";
import { GameController } from "../src/session/game";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow: BrowserWindow | null = null;
let controller: GameController | null = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultSaveDir() {
  return path.join(app.getPath("userData"), "save");
}

function clampVolume(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function loadSettings(): RfabSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Partial<RfabSettings>;
    return {
      apiKey: raw.apiKey ?? "",
      model: raw.model ?? DEFAULT_MODEL,
      masterVolume: clampVolume(raw.masterVolume, 1),
      musicVolume: clampVolume(raw.musicVolume, 0.55),
    };
  } catch {
    return {
      apiKey: process.env.RFAB_API_KEY ?? "",
      model: DEFAULT_MODEL,
      masterVolume: 1,
      musicVolume: 0.55,
    };
  }
}

function persistSettings(s: RfabSettings) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf8");
}

function newController(state: WorldState, saveDir: string): GameController {
  const settings = loadSettings();
  const c = new GameController(state, saveDir, settings);
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
  controller = newController(WorldStateSchema.parse(startingEstate), defaultSaveDir());
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

ipcMain.handle("game:advanceSeason", async () => requireGame().advanceSeason());

ipcMain.handle("settings:get", () => loadSettings());

ipcMain.handle("settings:set", (_e, patch: Partial<RfabSettings>) => {
  const next = { ...loadSettings(), ...patch };
  persistSettings(next);
  if (controller) controller.settings = next;
  return next;
});

ipcMain.handle("settings:listModels", async () => {
  const s = loadSettings();
  if (!s.apiKey) return [];
  return listRfabModels(s.apiKey);
});

ipcMain.handle("app:quit", () => {
  app.quit();
});
