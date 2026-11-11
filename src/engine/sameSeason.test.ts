import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { withBeginShortfalls } from "./projectBegin";
import { resolveAgricultureAndProjects } from "./season";
import { WorldStateSchema, type MechanicalProposal, type WorldState } from "./schema";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "../session/game";

const JARGON = /customCosts|\breward\b|\bresult\b|finishesThisSeason|catalogue|proposal|JSON|start_project|projectKey/i;

function estate(): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.resources.softwood = 0;
  state.resources.hardwood = 0;
  return state;
}

function game(state: WorldState) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-season-"));
  return new GameController(state, dir, defaultAppSettings());
}

function coppice(labourDays: number, finishes?: boolean): MechanicalProposal {
  return {
    type: "start_project",
    summary: "Coppice the wood",
    projectKey: "coppice",
    name: "Coppicing",
    holdingId: "fontenay",
    customCosts: { labourDays, lumber: 0, iron: 0, stone: 0 },
    result: [{ resource: "timber", amount: 2 }],
    ...(finishes === undefined ? {} : { finishesThisSeason: finishes }),
  };
}

function shed(labourDays: number, finishes?: boolean): MechanicalProposal {
  return {
    type: "start_project",
    summary: "Raise a shed",
    projectKey: "timber_shed",
    name: "A timber shed",
    holdingId: "fontenay",
    customCosts: { labourDays, lumber: 2, iron: 0, stone: 0 },
    ...(finishes === undefined ? {} : { finishesThisSeason: finishes }),
  };
}

function wood(state: WorldState): number {
  return state.resources.softwood + state.resources.hardwood;
}

describe("same-season gather then use", () => {
  it("spends the earlier yield and leaves the barn when the barn could already pay", () => {
    const state = estate();
    state.resources.softwood = 3;
    const session = game(state);
    session.queueProposal("steward", coppice(8));
    session.queueProposal("steward", shed(10));
    const result = session.confirmAllProposals();
    expect(result.error).toBeUndefined();
    expect(session.pending.map((p) => p.status)).toEqual(["applied", "applied"]);
    expect(session.state.projects.find((p) => p.key === "coppice")!.resultPaid).toBe(true);
    expect(session.state.projects.find((p) => p.key === "timber_shed")!.materials.lumber).toBe(2);
    expect(wood(session.state)).toBe(3);
  });

  it("spends timber named by an earlier work that finishes this season, even from an empty barn", () => {
    const session = game(estate());
    session.queueProposal("steward", coppice(8));
    session.queueProposal("steward", shed(10));
    const result = session.confirmAllProposals();
    expect(result.error).toBeUndefined();
    expect(session.pending.map((p) => p.status)).toEqual(["applied", "applied"]);
    const cut = session.state.projects.find((p) => p.key === "coppice")!;
    const built = session.state.projects.find((p) => p.key === "timber_shed")!;
    expect(cut.result).toEqual([{ resource: "softwood", amount: 2 }]);
    expect(cut.resultPaid).toBe(true);
    expect(built.materials.lumber).toBe(2);
    expect(wood(session.state)).toBe(0);
    expect(session.state.custom_resources).toEqual([]);
    expect(session.messages.some((m) => JARGON.test(m.text))).toBe(false);

    const stopped = applyProposal(
      session.state,
      { type: "adjust_project", summary: "Stop the coppice", projectId: cut.id, cancel: true },
      "steward",
    );
    expect(stopped.ok).toBe(true);
    expect(cut.status).toBe("cancelled");
    expect(wood(session.state)).toBe(0);
    expect(stopped.logLine).not.toMatch(/stores gain/i);

    resolveAgricultureAndProjects(session.state);
    expect(wood(session.state)).toBe(0);
    expect(session.state.custom_resources).toEqual([]);
  });

  it("refuses the later work when the gathering does not finish this season, and invents nothing", () => {
    const session = game(estate());
    session.queueProposal("steward", coppice(400));
    session.queueProposal("steward", shed(10));
    const result = session.confirmAllProposals();
    expect(result.error).toBeUndefined();
    expect(session.pending.map((p) => p.status)).toEqual(["applied", "rejected"]);
    expect(session.state.projects.some((p) => p.key === "timber_shed")).toBe(false);
    const cut = session.state.projects.find((p) => p.key === "coppice")!;
    expect(cut.resultPaid).not.toBe(true);
    expect(wood(session.state)).toBe(0);
    expect(session.state.custom_resources).toEqual([]);
    const note = session.messages.map((m) => m.text).join(" ");
    expect(note).toMatch(/The coppicing is not done this season, so the next waits/);
    expect(note).not.toMatch(JARGON);

    resolveAgricultureAndProjects(session.state);
    expect(cut.status).toBe("active");
    expect(wood(session.state)).toBe(0);
    expect(session.state.custom_resources).toEqual([]);
  });

  it("does not let a use that runs past the season spend a yield that is not in the barn", () => {
    const session = game(estate());
    session.queueProposal("steward", coppice(8));
    session.queueProposal("steward", shed(400));
    session.confirmAllProposals();
    expect(session.pending.map((p) => p.status)).toEqual(["applied", "rejected"]);
    expect(session.state.projects.some((p) => p.key === "timber_shed")).toBe(false);
    expect(session.state.projects.find((p) => p.key === "coppice")!.resultPaid).not.toBe(true);
    expect(wood(session.state)).toBe(0);
    expect(session.state.custom_resources).toEqual([]);
    const note = session.messages.map((m) => m.text).join(" ");
    expect(note).toMatch(/A timber shed is not done this season, so the next waits/);
    expect(note).not.toMatch(JARGON);
  });

  it("follows the chronicler's mark when it says the gathering does or does not finish", () => {
    const held = game(estate());
    held.queueProposal("steward", coppice(8, false));
    held.queueProposal("steward", shed(10));
    held.confirmAllProposals();
    expect(held.pending.map((p) => p.status)).toEqual(["applied", "rejected"]);
    expect(wood(held.state)).toBe(0);
    expect(held.state.custom_resources).toEqual([]);
    expect(held.messages.map((m) => m.text).join(" ")).toMatch(/not done this season, so the next waits/);

    const marked = game(estate());
    marked.queueProposal("steward", coppice(400, true));
    marked.queueProposal("steward", shed(10));
    marked.confirmAllProposals();
    expect(marked.pending.map((p) => p.status)).toEqual(["applied", "applied"]);
    expect(marked.state.projects.find((p) => p.key === "coppice")!.resultPaid).toBe(true);
    expect(marked.state.projects.find((p) => p.key === "timber_shed")!.materials.lumber).toBe(2);
    expect(wood(marked.state)).toBe(0);
    resolveAgricultureAndProjects(marked.state);
    expect(marked.state.projects.find((p) => p.key === "coppice")!.status).toBe("active");
    expect(wood(marked.state)).toBe(0);
  });

  it("still takes a cost at the start and does not pay a result until that work is finished", () => {
    const state = estate();
    const alone = applyProposal(state, shed(10), "steward");
    expect(alone.ok).toBe(false);
    expect(wood(state)).toBe(0);
    expect(state.projects).toHaveLength(estate().projects.length);

    const cut = applyProposal(estate(), coppice(8), "steward");
    expect(cut.ok).toBe(true);
    expect(wood(cut.state)).toBe(0);
    const work = cut.state.projects.find((p) => p.key === "coppice")!;
    expect(work.resultPaid).not.toBe(true);
    const stopped = applyProposal(
      cut.state,
      { type: "adjust_project", summary: "Stop the coppice", projectId: work.id, cancel: true },
      "steward",
    );
    expect(stopped.ok).toBe(true);
    expect(work.status).toBe("cancelled");
    expect(wood(cut.state)).toBe(0);
    expect(stopped.logLine).not.toMatch(/stores gain/i);
  });

  it("says the next waits when speech would spend a yield the season cannot finish", () => {
    const state = estate();
    const waiting = withBeginShortfalls(
      "The coppice will put two cart-loads of timber in the barn this season, and the shed can begin on it.",
      state,
      [coppice(400), shed(10)],
    );
    expect(waiting).toMatch(/The coppicing is not done this season, so the next waits/);
    expect(waiting).not.toMatch(/in the barn/i);
    expect(waiting).not.toMatch(/can begin/i);
    expect(waiting).not.toMatch(JARGON);

    const ready = withBeginShortfalls("We still need two cart-loads of timber.", state, [coppice(8), shed(10)]);
    expect(ready).not.toMatch(/not done this season/i);
    expect(ready).not.toMatch(/still need/i);
    expect(ready).not.toMatch(JARGON);
  });

  it("burns the mound on coppice wood when the model sends the coppice as a keyless new design", () => {
    // Sonnet's reply from a real playthrough: the coppicing had customCosts and a result but no projectKey,
    // so the books dropped it and the mound was refused for want of 12 cart-loads of timber.
    const raw = JSON.stringify({
      speech: "Clear five acres of scrub, cut the coppice, then burn the mound.",
      proposals: [
        { type: "start_project", summary: "Clear five acres", id: "clear_scrub_fontenay_1", projectKey: "clear_scrub", holdingId: "fontenay", name: "Clear five acres of scrub", acres: 5, days: 100, customCosts: { labourDays: 100 }, finishesThisSeason: true },
        { type: "assign_labour", summary: "100 days to clearing", projectId: "clear_scrub_fontenay_1", men: 100, women: 0, youths: 0 },
        { type: "start_project", summary: "Coppice the woodland", id: "coppice_fontenay_1", name: "Coppice the woodland", holdingId: "fontenay", days: 30, customCosts: { labourDays: 30 }, result: [{ resource: "lumber", amount: 12 }], finishesThisSeason: true },
        { type: "assign_labour", summary: "30 days to coppicing", projectId: "coppice_fontenay_1", men: 30, women: 0, youths: 0 },
        { type: "start_project", summary: "Burn a charcoal mound", id: "charcoal_fontenay_1", projectKey: "charcoal_burning", holdingId: "fontenay", name: "Charcoal mound", days: 15, customCosts: { labourDays: 15, lumber: 12 }, result: [{ resource: "charcoal", amount: 4 }], finishesThisSeason: true },
        { type: "assign_labour", summary: "15 days to the mound", projectId: "charcoal_fontenay_1", men: 15, women: 0, youths: 0 },
      ],
    });
    const parsed = parseLlmResponse(raw);
    expect(parsed.parseErrors).toEqual([]);
    expect(parsed.proposals).toHaveLength(6);

    const state = estate();
    state.resources.softwood = 3;
    const session = game(state);
    for (const proposal of parsed.proposals) session.queueProposal("steward", proposal);
    const result = session.confirmAllProposals();
    expect(result.error).toBeUndefined();
    expect(session.pending.map((p) => p.status)).toEqual(Array(6).fill("applied"));
    const cut = session.state.projects.find((p) => p.key === "coppice_fontenay_1")!;
    const mound = session.state.projects.find((p) => p.key === "charcoal_burning")!;
    expect(cut.resultPaid).toBe(true);
    expect(mound.materials.lumber).toBe(12);
    // 100 days of clearing covers three acres and their brushwood (1.5 loads); it finishes this season
    // too, so the pack credits it beside the coppice. 3 + 1.5 + 12 − 12 for the mound.
    const clearing = session.state.projects.find((p) => p.key === "clear_scrub")!;
    expect(clearing.result).toEqual([{ resource: "softwood", amount: 1.5 }]);
    expect(clearing.resultPaid).toBe(true);
    expect(wood(session.state)).toBe(4.5);
    expect(mound.labourDaysRequired).toBe(15);
  });
});
