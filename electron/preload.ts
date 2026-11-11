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
  answerCall: (accept: boolean) => ipcRenderer.invoke("game:answerCall", accept),
  musterAndRide: (bringIds: string[]) => ipcRenderer.invoke("game:musterAndRide", bringIds),
  battleContinue: () => ipcRenderer.invoke("game:battleContinue"),
  battleChoose: (key: "A" | "B") => ipcRenderer.invoke("game:battleChoose", key),
  battleRound: (orders: unknown[]) => ipcRenderer.invoke("game:battleRound", orders),
  scoutRole: (role: "narrower" | "finalizer") => ipcRenderer.invoke("game:scoutRole", role),
  scoutNarrow: (keep: number[]) => ipcRenderer.invoke("game:scoutNarrow", keep),
  scoutFinalize: (pick: number) => ipcRenderer.invoke("game:scoutFinalize", pick),
  deployFile: (unitId: string, cell: { row: number; col: number }) => ipcRenderer.invoke("game:deployFile", unitId, cell),
  deployRest: () => ipcRenderer.invoke("game:deployRest"),
  addressFile: (unitId: string, amount: number) => ipcRenderer.invoke("game:addressFile", unitId, amount),
  beginBattle: () => ipcRenderer.invoke("game:beginBattle"),
  dayEnd: (choice: "hold" | "reposition" | "withdraw", pick?: number) => ipcRenderer.invoke("game:dayEnd", choice, pick),
  grantFullCommand: (on: boolean) => ipcRenderer.invoke("game:grantFullCommand", on),
  setTutorial: (patch: { status?: "offered" | "active" | "done" | "declined"; step?: number }) =>
    ipcRenderer.invoke("game:setTutorial", patch),
  battleFinish: (disposition?: "settle" | "sell") => ipcRenderer.invoke("game:battleFinish", disposition),
  writeEnding: () => ipcRenderer.invoke("game:writeEnding"),
  raiseCall: (kind: "summons" | "raid" | "bandits") => ipcRenderer.invoke("game:raiseCall", kind),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: {
    provider?: string;
    providers?: Record<string, { apiKey?: string; model?: string }>;
    masterVolume?: number;
    musicVolume?: number;
    searchApiKey?: string;
    playLogEnabled?: boolean;
  }) => ipcRenderer.invoke("settings:set", patch),
  listModels: () => ipcRenderer.invoke("settings:listModels"),
  getLlmMeter: () => ipcRenderer.invoke("llm:getMeter"),
  quit: () => ipcRenderer.invoke("app:quit"),
  lab: {
    open: () => ipcRenderer.invoke("lab:open"),
    close: () => ipcRenderer.invoke("lab:close"),
    getView: () => ipcRenderer.invoke("lab:getView"),
    setConfig: (patch: unknown) => ipcRenderer.invoke("lab:setConfig", patch),
    paintCell: (row: number, col: number, terrain: string[], cliffBelow?: boolean) => ipcRenderer.invoke("lab:paintCell", row, col, terrain, cliffBelow),
    build: () => ipcRenderer.invoke("lab:build"),
    step: (orders: unknown[]) => ipcRenderer.invoke("lab:step", orders),
    autoRun: (maxRounds?: number) => ipcRenderer.invoke("lab:autoRun", maxRounds),
    rewind: (steps?: number) => ipcRenderer.invoke("lab:rewind", steps),
    dayEnd: (choice: "hold" | "reposition" | "withdraw") => ipcRenderer.invoke("lab:dayEnd", choice),
    reset: () => ipcRenderer.invoke("lab:reset"),
    exportScenario: () => ipcRenderer.invoke("lab:exportScenario"),
    importScenario: (text: string) => ipcRenderer.invoke("lab:importScenario", text),
    forge: (prompt: string) => ipcRenderer.invoke("lab:forge", prompt),
    approveForge: () => ipcRenderer.invoke("lab:approveForge"),
    rejectForge: () => ipcRenderer.invoke("lab:rejectForge"),
    discardSheet: (id: string) => ipcRenderer.invoke("lab:discardSheet", id),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type DesktopApi = typeof api;
