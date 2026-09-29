import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { labourPool, labourRemaining } from "./labour";
import { lookupProject } from "./projectCatalog";
import { WorldStateSchema, type WorldState } from "./schema";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "../session/game";
import { playerFacingReason } from "../ui/ledgerCopy";

const JARGON = /assign_labour|start_project|projectId|customCosts|proj-|pool men|no such work underway/i;

function boot(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  extra?.(state);
  return state;
}

function game(extra?: (s: WorldState) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-pack-"));
  return new GameController(boot(extra), dir, defaultAppSettings());
}

describe("clearing and charcoal store costs", () => {
  it("does not spend iron or stone on scrub or charcoal, and charcoal still piles timber", () => {
    expect(lookupProject("clear_scrub")).toMatchObject({ lumber: 0, iron: 0, stone: 0 });
    expect(lookupProject("charcoal_burning")).toMatchObject({ lumber: 2, iron: 0, stone: 0 });

    const state = boot();
    const iron = state.resources.iron;
    const stone = state.resources.stone;
    const wood = state.resources.softwood + state.resources.hardwood;
    expect(iron).toBe(8);

    const clearing = applyProposal(
      state,
      { type: "start_project", summary: "Clear an acre", projectKey: "clear_scrub", holdingId: "fontenay" },
      "steward",
    );
    expect(clearing.ok).toBe(true);
    expect(clearing.logLine).toMatch(/is begun/);
    expect(clearing.logLine).not.toMatch(/iron|stone|timber/i);
    expect(state.resources.iron).toBe(iron);
    expect(state.resources.stone).toBe(stone);

    const charcoal = applyProposal(
      state,
      {
        type: "start_project",
        summary: "Burn charcoal",
        projectKey: "charcoal_burning",
        holdingId: "fontenay",
        customCosts: { labourDays: 60, lumber: 2, iron: 10, stone: 1 },
      },
      "steward",
    );
    expect(charcoal.ok).toBe(true);
    expect(charcoal.logLine).toMatch(/timber/i);
    expect(charcoal.logLine).not.toMatch(/iron|stone/i);
    expect(state.resources.iron).toBe(iron);
    expect(state.resources.stone).toBe(stone);
    expect(state.resources.softwood + state.resources.hardwood).toBe(wood - 2);
    const mound = state.projects.find((p) => p.key === "charcoal_burning")!;
    expect(mound.materials).toEqual({ lumber: 2, iron: 0, stone: 0 });
    const scrub = state.projects.find((p) => p.key === "clear_scrub")!;
    expect(scrub.materials).toEqual({ lumber: 0, iron: 0, stone: 0 });
  });
});

describe("hands stay on the work they named", () => {
  it("does not move charcoal's men onto the clearing when the charcoal work is not begun", () => {
    const session = game((s) => {
      s.resources.softwood = 0;
      s.resources.hardwood = 0;
      s.resources.iron = 4;
    });
    session.queueProposal("steward", {
      type: "start_project",
      id: "scrub-1",
      summary: "Clear an acre of scrub",
      projectKey: "clear_scrub",
      holdingId: "fontenay",
    });
    session.queueProposal("steward", {
      type: "start_project",
      id: "char-1",
      summary: "Burn charcoal",
      projectKey: "charcoal_burning",
      holdingId: "fontenay",
    });
    session.queueProposal("steward", {
      type: "assign_labour",
      summary: "Sixty men to the work",
      projectId: "char-1",
      men: 60,
      women: 0,
      youths: 0,
    });
    session.queueProposal("steward", {
      type: "adjust_project",
      summary: "Hasten the charcoal",
      projectId: "charcoal_burning",
      rush: true,
    });

    const result = session.confirmAllProposals();
    expect(result.error).toBeUndefined();
    expect(session.state.projects.filter((p) => p.status === "active").map((p) => p.key)).toEqual(["clear_scrub"]);
    const clearing = session.state.projects.find((p) => p.key === "clear_scrub")!;
    const onClearing = session.state.labour.assigned.find((a) => a.projectId === clearing.id);
    expect(onClearing?.men ?? 0).not.toBe(60);
    expect(session.pending.filter((p) => p.status === "withheld")).toHaveLength(2);
    const skips = session.messages.filter((m) => /was not begun, so I have not called hands/i.test(m.text));
    expect(skips).toHaveLength(1);
    expect(skips[0].text).toMatch(/charcoal/i);
    expect(session.messages.some((m) => /no such work underway/i.test(m.text))).toBe(false);
    expect(skips[0].text).not.toMatch(JARGON);
  });

  it("puts the men on the charcoal mound when that work is begun in the same pack", () => {
    const session = game();
    session.queueProposal("steward", {
      type: "start_project",
      id: "scrub-1",
      summary: "Clear an acre of scrub",
      projectKey: "clear_scrub",
      holdingId: "fontenay",
    });
    session.queueProposal("steward", {
      type: "start_project",
      id: "char-1",
      summary: "Burn charcoal",
      projectKey: "charcoal_burning",
      holdingId: "fontenay",
    });
    session.queueProposal("steward", {
      type: "assign_labour",
      summary: "Four men to the charcoal",
      projectId: "char-1",
      men: 4,
      women: 0,
      youths: 0,
    });
    const result = session.confirmAllProposals();
    expect(result.error).toBeUndefined();
    const clearing = session.state.projects.find((p) => p.key === "clear_scrub")!;
    const mound = session.state.projects.find((p) => p.key === "charcoal_burning")!;
    expect(session.state.labour.assigned.find((a) => a.projectId === mound.id)?.men).toBeGreaterThanOrEqual(4);
    expect(session.state.labour.assigned.find((a) => a.projectId === clearing.id)?.men ?? 0).toBeLessThan(4);
  });
});

describe("days of work in the books", () => {
  it("writes 60, 25, and 27 as days of work", () => {
    const state = boot();
    state.projects.push({
      id: "proj-scrub",
      key: "clear_scrub",
      name: "Clear scrub to arable (1 acre)",
      holdingId: "fontenay",
      labourDaysRequired: 35,
      labourDaysDone: 0,
      materials: { lumber: 0, iron: 0, stone: 0 },
      materialsReserved: true,
      status: "active",
    });
    const called = applyProposal(
      state,
      {
        type: "assign_labour",
        summary: "Days to the scrub",
        projectId: "proj-scrub",
        men: 60,
        women: 25,
        youths: 27,
      },
      "steward",
    );
    expect(called.ok).toBe(true);
    expect(state.labour.assigned).toContainEqual({ projectId: "proj-scrub", men: 60, women: 25, youths: 27 });
    expect(called.logLine).toBe(
      "I have set 60 days of the men's work, 25 days of the women's work, and 27 days of the youths' work this season to the Clear scrub to arable (1 acre).",
    );
    expect(called.logLine).not.toMatch(/I have called|60 men|25 women|27 youths/i);
    expect(called.logLine).not.toMatch(JARGON);

    const begun = applyProposal(
      boot(),
      { type: "start_project", summary: "Clear an acre", projectKey: "clear_scrub", name: "Clear scrub to arable (1 acre)", holdingId: "fontenay" },
      "steward",
    );
    expect(begun.ok).toBe(true);
    expect(begun.logLine).toMatch(/I have set \d+ days of the/i);
    expect(begun.logLine).not.toMatch(/I have called/i);
  });

  it("refuses days past the season's remaining work", () => {
    const state = boot();
    state.projects.push(
      {
        id: "proj-scrub",
        key: "clear_scrub",
        name: "Clear scrub to arable (1 acre)",
        holdingId: "fontenay",
        labourDaysRequired: 400,
        labourDaysDone: 0,
        materials: { lumber: 0, iron: 0, stone: 0 },
        materialsReserved: true,
        status: "active",
      },
      {
        id: "proj-char",
        key: "charcoal_burning",
        name: "Organized charcoal burning",
        holdingId: "fontenay",
        labourDaysRequired: 60,
        labourDaysDone: 0,
        materials: { lumber: 2, iron: 0, stone: 0 },
        materialsReserved: true,
        status: "active",
      },
    );
    const pool = labourPool(state).men;
    state.labour.assigned.push({ projectId: "proj-scrub", men: pool, women: 0, youths: 0 });
    const called = applyProposal(
      state,
      { type: "assign_labour", summary: "More men's days to the mound", projectId: "proj-char", men: 1, women: 0, youths: 0 },
      "steward",
    );
    expect(called.ok).toBe(false);
    expect(labourRemaining(state).men).toBe(0);
    const speech = playerFacingReason(called.reason!);
    expect(speech).toMatch(new RegExp(`${pool} days`));
    expect(speech).toMatch(/days of work/i);
    expect(speech).not.toMatch(JARGON);
    expect(state.labour.assigned).toEqual([{ projectId: "proj-scrub", men: pool, women: 0, youths: 0 }]);
  });
});

describe("confirm one change at a time", () => {
  it("confirms a single change and leaves the rest waiting", () => {
    const session = game();
    session.queueProposal("steward", {
      type: "start_project",
      id: "scrub-1",
      summary: "Clear an acre of scrub",
      projectKey: "clear_scrub",
      holdingId: "fontenay",
    });
    session.queueProposal("steward", {
      type: "assign_labour",
      summary: "Four men to the scrub",
      projectId: "scrub-1",
      men: 4,
      women: 0,
      youths: 0,
    });
    const start = session.pending.find((p) => p.proposal.type === "start_project")!;
    const hands = session.pending.find((p) => p.proposal.type === "assign_labour")!;
    const onlyStart = session.confirmProposal(hands.id);
    expect(onlyStart.error).toMatch(/Confirm that work first/i);
    expect(session.state.projects).toHaveLength(0);

    const begun = session.confirmProposal(start.id);
    expect(begun.error).toBeUndefined();
    expect(session.state.projects.some((p) => p.key === "clear_scrub")).toBe(true);
    expect(session.pending.filter((p) => p.status === "pending").map((p) => p.proposal.type)).toEqual(["assign_labour"]);

    const called = session.confirmProposal(hands.id);
    expect(called.error).toBeUndefined();
    const clearing = session.state.projects.find((p) => p.key === "clear_scrub")!;
    expect(session.state.labour.assigned.find((a) => a.projectId === clearing.id)?.men).toBeGreaterThanOrEqual(4);
  });

  it("denying a work sets its hands aside", () => {
    const session = game();
    session.queueProposal("steward", {
      type: "start_project",
      id: "scrub-1",
      summary: "Clear an acre of scrub",
      projectKey: "clear_scrub",
      holdingId: "fontenay",
    });
    session.queueProposal("steward", {
      type: "assign_labour",
      summary: "Four men to the scrub",
      projectId: "scrub-1",
      men: 4,
      women: 0,
      youths: 0,
    });
    const start = session.pending.find((p) => p.proposal.type === "start_project")!;
    session.rejectProposal(start.id);
    expect(session.state.projects).toHaveLength(0);
    const hands = session.pending.find((p) => p.proposal.type === "assign_labour")!;
    expect(hands.status).toBe("withheld");
    expect(hands.rejectReason).toMatch(/declined/i);
    expect(hands.rejectReason).not.toMatch(JARGON);
    expect(session.confirmProposal(hands.id).error).toMatch(/set aside|declined/i);
    const notes = session.messages.filter((m) => /declined/i.test(m.text));
    expect(notes).toHaveLength(1);
  });
});
