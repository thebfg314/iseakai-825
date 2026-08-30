import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyMerchantRoll } from "./merchant";
import {
  compactMemorySummary,
  memoriesForMerchantName,
  memoriesForSpeaker,
  recordConfirmedTransaction,
} from "./memory";
import { NpcMemorySchema, NpcSchema, WorldStateSchema } from "./schema";
import { loadWorldState, saveWorldState } from "./state";

function boot() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const visit = {
  base: 0.3,
  bonus: 0,
  chance: 0.3,
  notes: [] as string[],
};

describe("npc memory schema", () => {
  it("parses a starting estate with empty memories", () => {
    const state = boot();
    expect(state.npcs.every((n) => n.memories.length === 0)).toBe(true);
    expect(state.merchant_memories).toEqual({});
    for (const npc of state.npcs) {
      expect(NpcSchema.parse({ id: npc.id, name: npc.name, role: npc.role, location: npc.location }).memories).toEqual(
        [],
      );
    }
  });

  it("parses a memory row and an npc that already has one", () => {
    const row = NpcMemorySchema.parse({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord bought four pounds of salt from the carts.",
    });
    expect(row.summary).toMatch(/salt/);
    const npc = NpcSchema.parse({
      id: "merchant",
      name: "Isaac",
      role: "merchant",
      location: "fontenay",
      memories: [row],
    });
    expect(npc.memories).toHaveLength(1);
    expect(npc.memories[0]).toEqual(row);
  });

  it("keeps summaries short and free of ledger jargon", () => {
    const text = compactMemorySummary(
      { type: "transfer_resources", summary: "transfer_resources", resource: "salt", amount: 4, direction: "buy" },
      "Bought 4 salt from Isaac for 8 denarii. The world-state JSON and register_npc fields stay off the page.",
    );
    expect(text).not.toMatch(/JSON|register_npc|world-state|transfer_resources/i);
    expect(text.length).toBeLessThanOrEqual(220);
  });
});

describe("confirm writes memory; speech-only does not", () => {
  it("records a confirmed deal on the proposing npc", () => {
    const state = boot();
    recordConfirmedTransaction(
      state,
      "steward",
      { type: "adjust_sowing", summary: "Sow more barley", holdingId: "fontenay", springBarleyShare: 0.85 },
      "Sowing plan: spring barley share 0.85.",
    );
    const aldric = state.npcs.find((n) => n.id === "steward")!;
    expect(aldric.memories).toHaveLength(1);
    expect(aldric.memories[0]).toMatchObject({ turn: 1, year: 825, season: "spring" });
    expect(aldric.memories[0].summary).toMatch(/barley/i);
    expect(state.npcs.find((n) => n.id === "smith")?.memories).toEqual([]);
  });
});

describe("merchant memories persist by visitor name", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps Isaac's last bargain after he leaves and returns", () => {
    const state = boot();
    state.flags.merchant_present = true;
    state.merchant.present = true;
    state.merchant.name = "Isaac";
    state.merchant.stock = [{ resource: "salt", amount: 6 }];
    state.npcs.push({
      id: "merchant",
      name: "Isaac",
      role: "merchant",
      location: "fontenay",
      memories: [],
    });

    recordConfirmedTransaction(
      state,
      "merchant",
      { type: "transfer_resources", summary: "Buy salt", resource: "salt", amount: 4, direction: "buy" },
      "Bought 4 salt from Isaac for 8 denarii.",
    );
    expect(memoriesForMerchantName(state, "Isaac")).toHaveLength(1);
    expect(memoriesForSpeaker(state, "merchant")[0].summary).toMatch(/salt/);

    applyMerchantRoll(state, { ...visit, arrived: false });
    expect(state.npcs.some((n) => n.id === "merchant")).toBe(false);
    expect(state.merchant.name).toBeUndefined();
    expect(memoriesForMerchantName(state, "Isaac")).toHaveLength(1);

    const isaacSlot = 5 / 8;
    vi.spyOn(Math, "random").mockReturnValue(isaacSlot);
    applyMerchantRoll(state, { ...visit, arrived: true });
    expect(state.merchant.name).toBe("Isaac");
    const isaac = state.npcs.find((n) => n.id === "merchant");
    expect(isaac?.memories).toHaveLength(1);
    expect(isaac?.memories[0].summary).toMatch(/salt/);
    expect(memoriesForSpeaker(state, "merchant")[0].summary).toMatch(/salt/);
  });
});

describe("world-state.json save and load restores memories", () => {
  it("round-trips steward and Isaac memories through the save file", () => {
    const state = boot();
    recordConfirmedTransaction(
      state,
      "steward",
      { type: "adjust_sowing", summary: "Sow more barley", holdingId: "fontenay", springBarleyShare: 0.85 },
      "Sowing plan: spring barley share 0.85.",
    );
    state.merchant.present = true;
    state.merchant.name = "Isaac";
    recordConfirmedTransaction(
      state,
      "merchant",
      { type: "transfer_resources", summary: "Buy salt", resource: "salt", amount: 4, direction: "buy" },
      "Bought 4 salt from Isaac for 8 denarii.",
    );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-mem-"));
    const file = path.join(dir, "world-state.json");
    saveWorldState(file, state);
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      npcs: { id: string; memories?: { summary: string }[] }[];
      merchant_memories: Record<string, { summary: string }[]>;
    };
    expect(raw.npcs.find((n) => n.id === "steward")?.memories?.[0].summary).toMatch(/barley/i);
    expect(raw.merchant_memories.Isaac[0].summary).toMatch(/salt/);

    const loaded = loadWorldState(file);
    expect(loaded.npcs.find((n) => n.id === "steward")?.memories[0].summary).toMatch(/barley/i);
    expect(loaded.merchant_memories.Isaac[0].summary).toMatch(/salt/);
  });
});
