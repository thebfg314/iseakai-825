import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { cancelForthcomingOrder, waitingForthcoming } from "./forthcoming";
import { inferDeferredRotation, inferOrderProposals, looksLikeRotationOrder } from "./orderIntent";
import { WorldStateSchema, type DeferProposal, type WorldState } from "./schema";
import { resolveAgricultureAndProjects } from "./season";
import { GameController } from "../session/game";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { customsBookEntries } from "../ui/booksView";
import { npcBooksFollowUp, stewardSystemPrompt, TOOL_PROTOCOL } from "../llm/prompts";

const THREE_FIELD_ORDER =
  "ok. Id like us to split our farming fields into a three-field rotation, rest one year under legumes (peas), put manure on the tired acres, and keep the best seed-selection back for sowing.";

function boot(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  extra?.(state);
  return state;
}

function tempGame(state = boot()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iseakai-"));
  return new GameController(state, dir, defaultAppSettings());
}

function threeFieldDefer(over: Partial<DeferProposal> = {}): DeferProposal {
  return {
    type: "defer_proposal",
    summary: "After this harvest: three-field rotation on the ploughland.",
    beat: "after_harvest",
    text: "After this harvest: three-field rotation on the ploughland.",
    proposal: {
      type: "adjust_sowing",
      summary: "Keep a three-field rotation.",
      holdingId: "fontenay",
      rotation: "three_field",
    },
    ...over,
  };
}

describe("forthcoming book orders", () => {
  it("Confirm deferred parks a visible order and does not change sowing yet", () => {
    const game = tempGame();
    const barleyBefore = game.state.holdings[0].sown.barley;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "The seed is already in, my lord. After this harvest we shall keep three fields.",
        proposals: [threeFieldDefer()],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Set a three-field rotation after harvest.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("defer_proposal");

    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.state.agriculture.rotation).toBe("two_field");
    expect(game.state.holdings[0].sown.barley).toBe(barleyBefore);
    expect(game.state.agriculture.springBarleyShare).toBe(0.6);
    const waiting = waitingForthcoming(game.state);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].status).toBe("waiting");
    expect(waiting[0].text).toMatch(/after this harvest/i);
    expect(waiting[0].text).toMatch(/three-field/i);
    const { forthcoming } = customsBookEntries(game.state);
    expect(forthcoming).toHaveLength(1);
    expect(forthcoming[0].title).toMatch(/yet to be kept/i);
    expect(forthcoming[0].body).toMatch(/After this harvest/);
    expect(forthcoming[0].body).not.toMatch(/defer_proposal|JSON|npcId/);
  });

  it("advances until after_harvest then applies the inner sowing change", () => {
    const state = boot();
    const parked = applyProposal(state, threeFieldDefer(), "steward");
    expect(parked.ok).toBe(true);
    expect(state.agriculture.rotation).toBe("two_field");

    resolveAgricultureAndProjects(state);
    expect(state.agriculture.rotation).toBe("two_field");
    expect(waitingForthcoming(state)).toHaveLength(1);

    state.meta.season = "summer";
    const lines = resolveAgricultureAndProjects(state);
    expect(state.agriculture.rotation).toBe("three_field");
    expect(waitingForthcoming(state)).toHaveLength(0);
    expect(state.holdings[0].sown.wheat).toBe(0);
    expect(state.holdings[0].sown.rye).toBe(0);
    expect(state.known_techniques.some((t) => t.name === "Three-field rotation")).toBe(true);
    expect(state.standing_orders[0].text).toMatch(/three-field rotation/);
    expect(lines.some((l) => /forthcoming order is kept/i.test(l.text))).toBe(true);

    state.meta.season = "autumn";
    resolveAgricultureAndProjects(state);
    const sown = state.holdings[0].sown;
    const arable = state.holdings[0].land.fertile_arable;
    expect(sown.wheat + sown.rye).toBeCloseTo(arable / 3, 1);
    expect(sown.barley).toBe(0);
    expect(sown.oats).toBe(0);
  });

  it("cancel before fire means the inner change never applies", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "After harvest, my lord.",
        proposals: [threeFieldDefer()],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Three-field rotation after this harvest.");
    game.confirmProposal(game.pending[0].id);
    const id = waitingForthcoming(game.state)[0].id;
    const cancelled = game.cancelForthcomingOrder(id);
    expect(cancelled.error).toBeUndefined();
    expect(waitingForthcoming(game.state)).toHaveLength(0);
    expect(customsBookEntries(game.state).forthcoming).toHaveLength(0);

    game.state.meta.season = "summer";
    resolveAgricultureAndProjects(game.state);
    expect(game.state.agriculture.rotation).toBe("two_field");
    expect(game.state.holdings[0].sown.wheat).toBe(0);
  });

  it("after N seasons fires on the Nth advance and not before", () => {
    const state = boot();
    applyProposal(
      state,
      threeFieldDefer({ beat: undefined, seasonsRemaining: 2, applyAfterSeasons: 2 }),
      "steward",
    );
    resolveAgricultureAndProjects(state);
    expect(state.agriculture.rotation).toBe("two_field");
    expect(waitingForthcoming(state)[0].seasonsRemaining).toBe(1);
    state.meta.season = "summer";
    resolveAgricultureAndProjects(state);
    expect(state.agriculture.rotation).toBe("three_field");
    expect(waitingForthcoming(state)).toHaveLength(0);
  });

  it("infers a deferred three-field order when the model speaks of later and emits nothing", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "The crops are still in, my lord. I will change it after harvest.",
        proposals: [],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, THREE_FIELD_ORDER);
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("defer_proposal");
    if (pending[0].proposal.type !== "defer_proposal") throw new Error("expected defer");
    expect(pending[0].proposal.proposal).toMatchObject({ type: "adjust_sowing", rotation: "three_field" });
  });

  it("still infers a deferred sowing when the model only set a standing order", () => {
    expect(looksLikeRotationOrder(THREE_FIELD_ORDER)).toBe(true);
    const inferred = inferOrderProposals(boot(), "steward", THREE_FIELD_ORDER);
    expect(inferred[0]?.type).toBe("defer_proposal");
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "We shall keep three fields after harvest.",
        proposals: [
          {
            type: "set_standing_order",
            summary: "Three-field custom",
            text: "Keep a three-field rotation after harvest.",
            active: true,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, THREE_FIELD_ORDER);
    const types = game.pending.filter((p) => p.status === "pending").map((p) => p.proposal.type);
    expect(types).toContain("set_standing_order");
    expect(types).toContain("defer_proposal");
  });
});

describe("deferred proposal parsing and prompts", () => {
  it("parses defer_proposal and schedule_order wrapping adjust_sowing", () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "After harvest.",
        proposals: [
          {
            type: "schedule_order",
            summary: "After harvest: three-field rotation.",
            trigger: "after_harvest",
            proposal: { type: "adjust_sowing", rotation: "three_field", summary: "Three fields" },
          },
        ],
      }),
    );
    expect(parsed.proposals[0]).toMatchObject({
      type: "defer_proposal",
      proposal: { type: "adjust_sowing", rotation: "three_field" },
    });
  });

  it("flattens a nested defer once", () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Later.",
        proposals: [
          {
            type: "defer_proposal",
            beat: "after_harvest",
            proposal: {
              type: "defer_proposal",
              beat: "next_spring_sowing",
              proposal: { type: "adjust_sowing", rotation: "three_field", summary: "Three fields" },
            },
          },
        ],
      }),
    );
    expect(parsed.proposals[0]?.type).toBe("defer_proposal");
    if (parsed.proposals[0]?.type !== "defer_proposal") throw new Error("expected defer");
    expect(parsed.proposals[0].proposal.type).toBe("adjust_sowing");
  });

  it("teaches defer_proposal in steward prompts and the books follow-up", () => {
    const steward = stewardSystemPrompt(boot());
    expect(steward).toMatch(/defer_proposal/);
    expect(steward).toMatch(/after harvest/i);
    expect(steward).toMatch(/forthcoming order/i);
    expect(npcBooksFollowUp("three-field after harvest")).toMatch(/defer_proposal/);
    expect(TOOL_PROTOCOL).toMatch(/drawer/);
  });
});
