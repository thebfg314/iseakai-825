import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { proposalBlurb } from "../ui/ledgerCopy";
import { applyDevotionChurch, bishopBlocksBan, endow, excommunicationWait, purchase } from "./patronage";
import { historyPromptBlock } from "./promptBlocks";
import { decayGifts, giftFit, giveGift, setGivingLevel } from "./gifts";
import { resolveOccasion, tickOccasions } from "./occasions";
import { trackBishop } from "./standing";
import { assessUpkeep } from "./upkeep";
import type { Vassal } from "./vassals";

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function man(state: WorldState, over: Partial<Vassal> & Pick<Vassal, "id" | "bent">): Vassal {
  const v: Vassal = {
    id: over.id,
    name: over.name ?? over.id,
    holding: over.holding ?? "a villa",
    men: over.men ?? 3,
    mood: over.mood ?? 50,
    since: 1,
    group: false,
    angrySince: null,
    lastReason: null,
    bent: over.bent,
    gifts: [],
    grievances: over.grievances ?? [],
    snubbed: over.snubbed ?? false,
  };
  state.history.vassals.push(v);
  return v;
}

describe("giving and gifts", () => {
  it("leans the household by five percent, and generosity adds five percent of the gross", () => {
    const state = fresh();
    const base = assessUpkeep(state);
    setGivingLevel(state, "lean");
    const lean = assessUpkeep(state);
    expect(lean.householdYear).toBe(Math.round(base.householdYear * 0.95));
    expect(lean.householdYear).toBeLessThan(base.householdYear);
    setGivingLevel(state, "generous");
    const generous = assessUpkeep(state);
    expect(generous.householdYear).toBe(base.householdYear + Math.round(base.grossYear * 0.05));
  });

  it("a mail shirt lands harder on a fighter than a cup, and a wedding lands harder than an ordinary day", () => {
    expect(giftFit("mail", "fighter", "ordinary")).toBeGreaterThan(giftFit("cup", "fighter", "ordinary"));
    expect(giftFit("relic", "devout", "ordinary")).toBeGreaterThan(giftFit("mail", "devout", "ordinary"));
    expect(giftFit("mail", "fighter", "wedding")).toBeGreaterThan(giftFit("mail", "fighter", "ordinary"));
  });

  it("the warmth of a gift is gone after about four years", () => {
    const state = fresh();
    const v = man(state, { id: "audoin", bent: "fighter" });
    state.resources.denarii = 200;
    expect(giveGift(state, "audoin", "mail").ok).toBe(true);
    expect(v.mood).toBe(64);
    for (let i = 0; i < 16; i++) decayGifts(state);
    expect(v.gifts).toHaveLength(0);
    expect(v.mood).toBe(50);
  });

  it("a grievance stops a gift short of contentment, and a public snub stops it altogether", () => {
    const capped = fresh();
    const a = man(capped, { id: "audoin", bent: "fighter", grievances: ["judged"] });
    capped.resources.denarii = 200;
    giveGift(capped, "audoin", "mail");
    expect(a.mood).toBe(55);

    const snubbed = fresh();
    const b = man(snubbed, { id: "boso", bent: "fighter", snubbed: true });
    snubbed.resources.denarii = 200;
    giveGift(snubbed, "boso", "mail");
    expect(b.mood).toBe(50);
    expect(b.gifts).toHaveLength(0);
  });

  it("a gift in a negotiation is taken and remembered as a bribe", () => {
    const state = fresh();
    const v = man(state, { id: "audoin", bent: "court" });
    state.resources.denarii = 200;
    const r = giveGift(state, "audoin", "cup", "negotiation");
    expect(r.ok).toBe(true);
    expect(r.line).toContain("bribe");
    expect(v.gifts[0].bribe).toBe(true);
    expect(v.lastReason).toContain("bribe");
  });
});

describe("occasions", () => {
  it("a lavish honour spills a little onto the men who only watched", () => {
    const state = fresh();
    state.player.rankLevel = 3;
    const a = man(state, { id: "audoin", bent: "fighter" });
    const b = man(state, { id: "berengar", bent: "court" });
    state.history.occasions.open = { id: "occasion:9", kind: "wedding", vassalId: "audoin", turn: 9 };
    state.resources.denarii = 500;
    const r = resolveOccasion(state, "lavish");
    expect(r.ok).toBe(true);
    expect(a.mood).toBe(62);
    expect(b.mood).toBe(51);
    expect(state.history.occasions.open).toBeNull();
  });

  it("a token at a confirmation leaves the son unconfirmed, and gifts stop at the cap", () => {
    const state = fresh();
    const v = man(state, { id: "audoin", bent: "fighter" });
    state.history.occasions.open = { id: "occasion:9", kind: "confirm", vassalId: "audoin", turn: 9 };
    state.resources.denarii = 500;
    resolveOccasion(state, "token");
    expect(v.grievances).toContain("heir");
    expect(v.mood).toBe(46);
    giveGift(state, "audoin", "mail");
    expect(v.mood).toBe(55);
  });

  it("Christmas is one decision for every sworn man, and silence the next season is not a snub", () => {
    const state = fresh();
    const a = man(state, { id: "audoin", bent: "fighter" });
    const opened = tickOccasions(state, { year: 830, season: "winter" }, 10);
    expect(opened.beats[0].text).toContain("Christmas");
    const passed = tickOccasions(state, { year: 831, season: "spring" }, 11);
    expect(passed.lines[0]).toContain("not a public snub");
    expect(a.snubbed).toBe(false);
    expect(a.mood).toBe(50);
  });
});

describe("church patronage", () => {
  it("a feast moves the church for a minor noble and is only expected of a viscount", () => {
    const minor = fresh();
    expect(applyDevotionChurch(minor, "plain")).toBe("");
    expect(minor.history.flags.favor_church).toBe(51);
    const viscount = fresh();
    viscount.player.rankLevel = 2;
    expect(applyDevotionChurch(viscount, "grand")).toContain("expects");
    expect(viscount.history.flags.favor_church).toBeUndefined();
  });

  it("a chapel still moves a count; a repair does not", () => {
    const state = fresh();
    state.player.rankLevel = 3;
    state.resources.denarii = 2000;
    endow(state, "repair");
    expect(state.history.flags.favor_church).toBeUndefined();
    expect(state.history.flags.church_repaired).toBe(true);
    expect(state.peopleHappiness).toBe(52);
    endow(state, "chapel");
    expect(state.history.flags.favor_church).toBe(58);
    expect(state.history.flags.chapel_endowed).toBe(true);
  });

  it("a purchase delivers, and a low roll leaves simony alleged", () => {
    const stained = fresh();
    stained.resources.denarii = 200;
    const bad = purchase(stained, "judgment", 0);
    expect(bad.ok).toBe(true);
    expect(stained.history.flags.purchased_judgment).toBe(true);
    expect(stained.history.flags.simony_alleged).toBe(true);
    expect(bad.line).toContain("bought");

    const clean = fresh();
    clean.resources.denarii = 200;
    purchase(clean, "judgment", 0.99);
    expect(clean.history.flags.purchased_judgment).toBe(true);
    expect(clean.history.flags.simony_alleged).toBeUndefined();
  });

  it("a cold bishop hurries a ban, and a fast friend will not arrange one", () => {
    const state = fresh();
    state.player.rankLevel = 3;
    state.history.flags.favor_church = 30;
    trackBishop(state);
    expect(excommunicationWait(state, 4)).toBe(2);
    expect(bishopBlocksBan(state)).toBe(false);
    state.history.flags.bishop_trust = 80;
    expect(bishopBlocksBan(state)).toBe(true);
    state.history.flags.bishop_trust = 65;
    expect(excommunicationWait(state, 4)).toBe(8);
  });

  it("Ermenald carries the bishop once the lord is a count, and not before", () => {
    const villa = fresh();
    expect(historyPromptBlock(villa, "chaplain")).not.toContain("bishop of Autun");
    expect(historyPromptBlock(villa, "chaplain")).toContain("Ermenald's own mind");
    const count = fresh();
    count.player.rankLevel = 3;
    trackBishop(count);
    const block = historyPromptBlock(count, "chaplain");
    expect(block).toContain("bishop of Autun");
    expect(block).toContain("Do not invent a second priest");
    expect(proposalBlurb({ type: "church_purchase", aim: "absolution", summary: "" })).toContain("bought what should not be sold");
  });
});
