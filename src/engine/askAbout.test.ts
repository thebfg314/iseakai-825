import { describe, expect, it } from "vitest";
import { askAboutCue, compactOfferLine, isRevisionOf, pendingOfferScrap } from "./askAbout";
import type { MechanicalProposal } from "./schema";

const mill = (over: Partial<Extract<MechanicalProposal, { type: "start_project" }>> = {}): MechanicalProposal => ({
  type: "start_project",
  projectKey: "flour_mill",
  summary: "Raise a flour mill",
  holdingId: "fontenay",
  ...over,
});

const hunt = (over: Partial<Extract<MechanicalProposal, { type: "start_hunt" }>> = {}): MechanicalProposal => ({
  type: "start_hunt",
  goods: "pepper",
  resource: "pepper",
  amount: 2,
  quotedDenarii: 80,
  durationSeasons: 2,
  summary: "Seek pepper on the road",
  ...over,
});

describe("isRevisionOf", () => {
  it("matches the same start_project key or name", () => {
    expect(isRevisionOf(mill(), mill({ customCosts: { labourDays: 260, lumber: 12, iron: 60, stone: 8 } }))).toBe(true);
    expect(isRevisionOf(mill(), mill({ projectKey: "flour_mill", name: "Flour mill" }))).toBe(true);
    expect(isRevisionOf(mill({ name: "Flour mill" }), mill({ projectKey: "custom_mill", name: "Flour mill" }))).toBe(true);
    expect(isRevisionOf(mill(), mill({ projectKey: "clear_scrub", name: "Clear scrub", summary: "Clear an acre" }))).toBe(
      false,
    );
  });

  it("matches the same start_hunt target, not a different brief", () => {
    expect(isRevisionOf(hunt(), hunt({ quotedDenarii: 40, durationSeasons: 3 }))).toBe(true);
    expect(isRevisionOf(hunt(), hunt({ goods: "peppers", resource: "peppers" }))).toBe(true);
    expect(isRevisionOf(hunt(), hunt({ goods: "silk", resource: "silk", summary: "Seek silk" }))).toBe(false);
  });

  it("matches standing orders, project ids, and hires", () => {
    const order = {
      type: "set_standing_order" as const,
      text: "Tithe grain each season",
      active: true,
      summary: "Tithe",
      orderId: "tithe",
    };
    expect(isRevisionOf(order, { ...order, text: "Tithe grain and wool" })).toBe(true);
    expect(isRevisionOf(order, { ...order, orderId: "sunday", text: "Keep Sunday" })).toBe(false);

    const adjust = {
      type: "adjust_project" as const,
      projectId: "proj-1",
      summary: "Hasten the mill",
      rush: true,
    };
    expect(isRevisionOf(adjust, { ...adjust, rush: false, cancel: true })).toBe(true);
    expect(isRevisionOf(adjust, { ...adjust, projectId: "proj-2" })).toBe(false);

    const hire = {
      type: "register_npc" as const,
      isNew: true as const,
      summary: "Hire Colman",
      npc: { id: "quarry_master", name: "Colman", role: "quarry_master", location: "fontenay", notes: "", memories: [] },
    };
    expect(
      isRevisionOf(hire, {
        ...hire,
        npc: { ...hire.npc, notes: "Stone first." },
      }),
    ).toBe(true);
    expect(
      isRevisionOf(hire, {
        ...hire,
        npc: { ...hire.npc, id: "carpenter", name: "Haimo", role: "carpenter" },
      }),
    ).toBe(false);
  });
});

describe("askAboutCue", () => {
  it("writes a one-line immersive cue for mill and hunt", () => {
    const millCue = askAboutCue("Aldric", mill());
    expect(millCue).toMatch(/mill work/i);
    expect(millCue).toMatch(/Aldric/);
    expect(millCue).not.toMatch(/\n/);
    expect(millCue).not.toMatch(/JSON|pending|Confirm|projectKey/i);

    const huntCue = askAboutCue("Gerulf", hunt());
    expect(huntCue).toMatch(/hunt for pepper/i);
    expect(huntCue).toMatch(/purse/);
    expect(huntCue).toMatch(/Gerulf/);
    expect(huntCue).not.toMatch(/\n/);
  });
});

describe("pendingOfferScrap", () => {
  it("summarizes quoted coin, duration, and mill materials without dumping the object", () => {
    const millLine = pendingOfferScrap(mill());
    expect(millLine).toMatch(/PENDING OFFER UNDER DISCUSSION/);
    expect(millLine).toMatch(/flour_mill/);
    expect(millLine).toMatch(/230 days/);
    expect(millLine).toMatch(/stone/);
    expect(millLine).not.toMatch(/"type":/);

    const huntLine = compactOfferLine(hunt({ quotedDenarii: 80 }));
    expect(huntLine).toMatch(/80 denarii/);
    expect(huntLine).toMatch(/2 seasons/);
    expect(huntLine).toMatch(/pepper/);
  });
});
