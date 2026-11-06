import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { divergenceFacts, endingFallback } from "./ending";
import { executionCause, tickExecution } from "./execution";
import { promoteTo } from "./promotion";

/**
 * A failed rising ends in submission. Execution needs an aggravating factor.
 * The chronicle's last page names where the world differs from the record.
 */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const at = { year: 860, season: "summer" as const };

describe("execution as a traitor", () => {
  it("refusing the terms is enough: there is no kin to make the king think twice", () => {
    const s = fresh();
    s.history.flags.rebel_king = true;
    expect(executionCause(s, true, true)).toBe("he refused the terms that were offered");
    const r = tickExecution(s, at, 40);
    expect(r.died).toBe(true);
    expect(s.player.dead).toBe(true);
    expect(s.history.dead).toEqual({ cause: "execution", year: 860 });
    expect(r.beats[0].text).toMatch(/no kin to avenge/);
    expect(tickExecution(s, at, 41).died).toBe(false);
  });

  it("a first submission is a pardon and costs the office; a second rising is the block", () => {
    const s = fresh();
    s.player.renown = 600;
    promoteTo(s, 3, { patron: "the king", turn: 30 });
    s.history.chosen["L-002"] = "go";
    const spared = tickExecution(s, at, 40);
    expect(spared.pardoned).toBe(true);
    expect(s.player.dead).toBe(false);
    expect(s.history.mercy.pardons).toBe(1);
    expect(s.player.rankLevel).toBe(3);

    s.history.chosen["L-002"] = undefined as unknown as string;
    delete s.history.chosen["L-002"];
    s.history.quest.phase = "failed";
    s.history.quest.attempt = 1;
    const again = tickExecution(s, at, 44);
    expect(again.died).toBe(true);
    expect(s.history.dead?.cause).toBe("execution");
  });

  it("a first lost field is submission, not the block; allying with the enemy or killing a king is the block at once", () => {
    const lost = fresh();
    lost.player.renown = 200;
    lost.player.rankLevel = 2;
    lost.history.quest.phase = "failed";
    lost.history.quest.attempt = 1;
    const r = tickExecution(lost, at, 10);
    expect(r.pardoned).toBe(true);
    expect(lost.player.dead).toBe(false);
    expect(lost.player.rankLevel).toBe(1);

    const allied = fresh();
    allied.history.flags.allied_with_enemies = true;
    allied.history.quest.phase = "failed";
    allied.history.quest.attempt = 1;
    expect(tickExecution(allied, at, 10).died).toBe(true);

    const regicide = fresh();
    regicide.history.flags.killed_anointed_king = true;
    regicide.history.chosen["L-002"] = "go";
    expect(executionCause(regicide, false, false)).toBe("he killed an anointed king");
    expect(tickExecution(regicide, at, 10).died).toBe(true);
  });

  it("the magnates' bargain is not a failed rising", () => {
    const s = fresh();
    s.history.quest.phase = "failed";
    s.history.quest.attempt = 1;
    s.history.chosen["Q-003"] = "counter_offer";
    expect(tickExecution(s, at, 10).pardoned).toBe(false);
    expect(s.player.dead).toBe(false);
    expect(s.history.mercy.pardons).toBe(0);
  });
});

describe("the last page", () => {
  it("names a divergence when the record was turned aside, and says so when it was not", () => {
    const quiet = fresh();
    expect(divergenceFacts(quiet).join(" ")).toMatch(/changed little|Nothing he did/);
    const saved = fresh();
    saved.history.flags.robert_saved = true;
    saved.history.flags.vikings_sent_elsewhere = true;
    const facts = divergenceFacts(saved).join(" ");
    expect(facts).toMatch(/Robert the Strong lived/);
    expect(facts).toMatch(/866/);
    expect(facts).toMatch(/spared the Northmen in 886/);
    const page = endingFallback(saved);
    expect(page.death).toMatch(/died in his bed/);
    expect(page.summary).toMatch(/Robert the Strong/);
  });

  it("the fallback page matches the cause: the field, the block, the empty villa, the wound", () => {
    const battle = fresh();
    battle.history.dead = { cause: "battle", year: 841 };
    expect(endingFallback(battle).death).toMatch(/fell in the field/);
    const executed = fresh();
    executed.history.dead = { cause: "execution", year: 877 };
    expect(endingFallback(executed).death).toMatch(/traitor/);
    const empty = fresh();
    empty.history.dead = { cause: "abandoned", year: 830 };
    expect(endingFallback(empty).death).toMatch(/empty/);
    const wound = fresh();
    wound.history.dead = { cause: "wound", year: 850 };
    expect(endingFallback(wound).death).toMatch(/maiming/);
  });
});
