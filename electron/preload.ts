import { contextBridge, ipcRenderer } from "electron";

const api = {
  getView: () => ipcRenderer.invoke("game:getView"),
  newGame: () => ipcRenderer.invoke("game:new"),
  saveGame: () => ipcRenderer.invoke("game:save"),
  loadGame: () => ipcRenderer.invoke("game:load"),
  setScene: (npcId: string) => ipcRenderer.invoke("game:setScene", npcId),
  sendDialogue: (npcId: string, message: string) => ipcRenderer.invoke("game:sendDialogue", npcId, message),
  confirmProposal: (id: string) => ipcRenderer.invoke("game:confirmProposal", id),
  rejectProposal: (id: string) => ipcRenderer.invoke("game:rejectProposal", id),
  advanceSeason: () => ipcRenderer.invoke("game:advanceSeason"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: {
    provider?: string;
    providers?: Record<string, { apiKey?: string; model?: string }>;
    masterVolume?: number;
    musicVolume?: number;
  }) => ipcRenderer.invoke("settings:set", patch),
  listModels: () => ipcRenderer.invoke("settings:listModels"),
  getLlmMeter: () => ipcRenderer.invoke("llm:getMeter"),
  quit: () => ipcRenderer.invoke("app:quit"),
};

contextBridge.exposeInMainWorld("api", api);

export type DesktopApi = typeof api;
