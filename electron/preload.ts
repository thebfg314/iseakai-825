import { contextBridge, ipcRenderer } from "electron";

const api = {
  getView: () => ipcRenderer.invoke("game:getView"),
  newGame: () => ipcRenderer.invoke("game:new"),
  saveGame: () => ipcRenderer.invoke("game:save"),
  loadGame: () => ipcRenderer.invoke("game:load"),
  setScene: (npcId: string) => ipcRenderer.invoke("game:setScene", npcId),
  sendDialogue: (npcId: string, message: string) => ipcRenderer.invoke("game:sendDialogue", npcId, message),
  confirmProposal: (id: string) => ipcRenderer.invoke("game:confirmProposal", id),
  confirmAllProposals: () => ipcRenderer.invoke("game:confirmAllProposals"),
  rejectProposal: (id: string) => ipcRenderer.invoke("game:rejectProposal", id),
  cancelForthcomingOrder: (id: string) => ipcRenderer.invoke("game:cancelForthcomingOrder", id),
  askAboutProposal: (id: string) => ipcRenderer.invoke("game:askAboutProposal", id),
  confirmMerchantShop: (basket: {
    buyStall: Record<string, number>;
    buyBack: Record<string, number>;
    sell: Record<string, number>;
  }) => ipcRenderer.invoke("game:confirmMerchantShop", basket),
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
