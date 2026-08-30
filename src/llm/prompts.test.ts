import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { MERCHANT_VISITORS } from "../engine/merchant";
import { HIREABLE_SPECIALISTS } from "../engine/specialists";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import {
  chaplainSystemPrompt,
  merchantSystemPrompt,
  npcSystemPrompt,
  npcUserPrompt,
  refereeSystemPrompt,
  smithSystemPrompt,
  stewardSystemPrompt,
} from "./prompts";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function withMerchant(name: (typeof MERCHANT_VISITORS)[number]["name"]): WorldState {
  const state = boot();
  const visitor = MERCHANT_VISITORS.find((v) => v.name === name)!;
  state.flags.merchant_present = true;
  state.merchant.present = true;
  state.merchant.name = visitor.name;
  state.merchant.face = visitor.face;
  state.npcs.push({
    id: "merchant",
    name: visitor.name,
    role: "merchant",
    location: "fontenay",
    notes: visitor.notes,
    memories: [],
  });
  return state;
}

const HOUSEHOLD_NOTES = {
  steward:
    "Counts first, talks second. Loyal to the villa, and used to running everything up till the start of the game. Prepared to humor a witless noble who doesn't know how to run things but will be pleasantly surprised and very loyal if you do well. Gets very nervous when the treasury chest is low. Sends you to the right craftsman instead of pretending he can shoe a horse.",
  smith:
    "Proud of what the forge can do, honest about what it cannot but also enjoys technical challenges that stretch his skills. Iron and charcoal are usually short, so he hoards both. Speaks in short sentences but gets excited about new projects that he thinks will work.",
  chaplain:
    "Prior of the four monks at Saint-Martin. Says mass, writes letters, watches Sundays. Loyal to you, but the bishop of Autun is also in the room. Wary of strange arts and of work on feast days. Will bless a hire and still ask where the man's soul stands.",
} as const;

describe("signed-off NPC personalities", () => {
  it("keeps only Aldric, Bernard, and Ermenald at boot, with signed-off notes", () => {
    const state = boot();
    expect(state.npcs.map((n) => n.id)).toEqual(["steward", "smith", "chaplain"]);
    expect(state.npcs.map((n) => n.name)).toEqual(["Aldric", "Bernard", "Ermenald"]);
    for (const npc of state.npcs) {
      expect(npc.notes).toBe(HOUSEHOLD_NOTES[npc.id as keyof typeof HOUSEHOLD_NOTES]);
    }
  });

  it("puts Aldric, Bernard, and Ermenald voice into their system prompts", () => {
    const aldric = stewardSystemPrompt(boot());
    expect(aldric).toContain("You are Aldric");
    expect(aldric).toMatch(/count first and talk second/i);
    expect(aldric).toMatch(/witless noble/i);
    expect(aldric).toMatch(/treasury chest is low/i);
    expect(aldric).toMatch(/shoe a horse/i);
    expect(aldric).toMatch(/Hiring a full-time specialist is YOUR work/i);

    const bernard = smithSystemPrompt();
    expect(bernard).toContain("You are Bernard");
    expect(bernard).toMatch(/proud of what the forge can do/i);
    expect(bernard).toMatch(/hoard both/i);
    expect(bernard).toMatch(/short sentences/i);
    expect(bernard).toMatch(/do not hire craftsmen/i);
    expect(bernard).toMatch(/speak to Aldric/i);

    const ermenald = chaplainSystemPrompt();
    expect(ermenald).toContain("You are Ermenald");
    expect(ermenald).toMatch(/four monks/i);
    expect(ermenald).toMatch(/bishop of Autun/i);
    expect(ermenald).toMatch(/feast days/i);
    expect(ermenald).toMatch(/where the man's soul stands/i);
    expect(ermenald).toMatch(/do not hire craftsmen/i);
  });

  it("puts each hireable specialist's notes and per-id prompt on the same personality", () => {
    const expected: Record<string, { notes: string[]; prompt: string[] }> = {
      quarry_master: {
        notes: ["Irish", "light Irish accent", "Misses the sea"],
        prompt: ["You are Colman", "Irish", "light Irish accent", "miss the sea"],
      },
      carpenter: {
        notes: ["Meticulous", "felled too green", "good enough"],
        prompt: ["You are Haimo", "meticulous", "felled too green", "good enough"],
      },
      mason: {
        notes: ["wall is a promise", "Treats raw stone", "buildings that fell"],
        prompt: ["You are Gerold", "wall is a promise", "treat raw stone", "buildings that fell"],
      },
      potter: {
        notes: ["Watches hands", "Does not care about rank", "clay here is only fair"],
        prompt: ["You are Hugo", "watch hands", "do not care about rank", "clay here is only fair"],
      },
      village_reeve: {
        notes: ["gentle giant", "hell and back", "peasants' man"],
        prompt: ["You are Otto", "gentle giant", "hell and back", "peasants' man"],
      },
      vinedresser: {
        notes: ["bouquets and aftertastes", "a lot of sensory", "flowery words"],
        prompt: ["You are Ambrosius", "bouquets and aftertastes", "a lot of sensory", "flowery words"],
      },
      head_seamstress: {
        notes: ["straight laced", "torn cuff", "conservative"],
        prompt: ["You are Hildegard", "straight laced", "torn cuff", "conservative"],
      },
      copper_smith: {
        notes: ["sycophant", "overworked and busy", "Lombard"],
        prompt: ["You are Lorenzo", "sycophant", "overworked and busy", "Lombard"],
      },
      captain: {
        notes: ["parade dress", "seen it all", "Cool headed"],
        prompt: ["You are Eberhard", "parade dress", "seen it all", "Cool headed"],
      },
    };

    for (const spec of HIREABLE_SPECIALISTS) {
      const want = expected[spec.id];
      expect(want, spec.id).toBeTruthy();
      for (const needle of want.notes) {
        expect(spec.notes, `${spec.id} notes`).toContain(needle);
      }
      expect(spec.notes).not.toMatch(/Meticulus|teats|allot |syncophant/);
      const prompt = npcSystemPrompt(spec.id);
      for (const needle of want.prompt) {
        expect(prompt, `${spec.id} prompt`).toContain(needle);
      }
      expect(prompt).toMatch(/do NOT manage|do not hire|Those belong to Aldric/i);
    }
  });

  it("uses the present merchant's name and voice, not a generic travelling-merchant blurb", () => {
    const generic = "You are a travelling merchant on the roads of Francia in 825. You speak of carts, tolls";
    for (const visitor of MERCHANT_VISITORS) {
      const prompt = merchantSystemPrompt(withMerchant(visitor.name));
      expect(prompt).toContain(`You are ${visitor.name}`);
      expect(prompt).toContain(visitor.voice);
      expect(prompt).not.toContain(generic);
      expect(npcSystemPrompt("merchant", withMerchant(visitor.name))).toBe(prompt);
    }
  });

  it("feeds only that NPC's memories into their system prompt", () => {
    const state = boot();
    state.npcs.find((n) => n.id === "steward")!.memories.push({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord ordered more barley sown on the remaining spring acres.",
    });
    state.npcs.find((n) => n.id === "smith")!.memories.push({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord asked for nails and confirmed the iron spend.",
    });

    const aldric = npcSystemPrompt("steward", state);
    expect(aldric).toMatch(/count first and talk second/i);
    expect(aldric).toContain("You remember these past dealings");
    expect(aldric).toContain("The lord ordered more barley sown");
    expect(aldric).not.toContain("asked for nails");
    expect(aldric).not.toMatch(/memory array/i);

    const bernard = npcSystemPrompt("smith", state);
    expect(bernard).toMatch(/proud of what the forge can do/i);
    expect(bernard).toContain("asked for nails");
    expect(bernard).not.toContain("more barley sown");

    const user = npcUserPrompt(state, "steward", "How fares the rye?");
    expect(user).not.toMatch(/"memories"/);
    expect(user).not.toMatch(/merchant_memories/);
  });

  it("tells Isaac of his own bargains, not Aldric's estate orders", () => {
    const state = withMerchant("Isaac");
    state.merchant_memories.Isaac = [
      {
        turn: 1,
        year: 825,
        season: "spring",
        summary: "The lord bought four pounds of salt from your carts.",
      },
    ];
    state.npcs.find((n) => n.id === "steward")!.memories.push({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord ordered more barley sown on the remaining spring acres.",
    });

    const isaac = npcSystemPrompt("merchant", state);
    expect(isaac).toContain("You are Isaac");
    expect(isaac).toContain("four pounds of salt");
    expect(isaac).not.toContain("more barley sown");
    expect(isaac).not.toMatch(/memory array|world-state\.json/i);
    expect(merchantSystemPrompt(state)).not.toContain("four pounds of salt");
  });

  it("tells the Court Chronicler never to mention JSON, emotion tags, or being an AI", () => {
    const referee = refereeSystemPrompt();
    expect(referee).toMatch(/Never mention JSON, emotion tags, or that you are an AI/i);
    expect(referee).toMatch(/Do NOT emit register_npc/i);
  });
});
