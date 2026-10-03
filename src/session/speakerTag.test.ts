import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type MechanicalProposal } from "../engine/schema";
import { stampSpeakerTag } from "../engine/speakerTag";
import { parseProposal } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.resources.softwood = 20;
  state.resources.hardwood = 10;
  state.resources.iron = 60;
  return new GameController(state, dir, defaultAppSettings());
}

const roof: MechanicalProposal = {
  type: "start_project",
  summary: "Mend the oratory roof",
  projectKey: "oratory_roof_repair",
  name: "Oratory roof repair",
  holdingId: "fontenay",
  customCosts: { labourDays: 12, lumber: 1, iron: 0, stone: 0 },
};

describe("a speaker's untagged new design carries his own tag", () => {
  it("stamps church on the chaplain's work and forge on the smith's, and leaves the rest alone", () => {
    expect(stampSpeakerTag("chaplain", roof)).toMatchObject({ tag: "church" });
    expect(stampSpeakerTag("smith", roof)).toMatchObject({ tag: "forge" });
    expect(stampSpeakerTag("steward", roof)).toBe(roof);
    const tagged = { ...roof, tag: "village" };
    expect(stampSpeakerTag("chaplain", tagged)).toBe(tagged);
    const catalogue: MechanicalProposal = { type: "start_project", summary: "Clear scrub", projectKey: "clear_scrub", holdingId: "fontenay" };
    expect(stampSpeakerTag("chaplain", catalogue)).toBe(catalogue);
    const deferred: MechanicalProposal = {
      type: "defer_proposal",
      summary: "After harvest, the roof",
      trigger: { beat: "after_harvest" },
      proposal: roof,
    } as MechanicalProposal;
    const stampedDefer = stampSpeakerTag("chaplain", deferred);
    expect(stampedDefer.type === "defer_proposal" && stampedDefer.proposal).toMatchObject({ tag: "church" });
  });

  it("writes Ermenald's roof repair on Confirm even when the model sent tags: [\"church\"] or no tag at all", () => {
    const game = tempGame();
    const fromModel = parseProposal({ ...roof, tags: ["church"] });
    expect(fromModel.proposal).toMatchObject({ tag: "church" });
    game.ingestParsedDialogue("chaplain", { proposals: [fromModel.proposal!], parseErrors: [] }, "Mend the roof, then.");
    const card = game.pending.find((p) => p.status === "pending");
    expect(card?.proposal).toMatchObject({ type: "start_project", tag: "church" });
    const view = game.confirmProposal(card!.id);
    expect(view.error).toBeUndefined();
    expect(game.state.projects.find((p) => p.key === "oratory_roof_repair")).toMatchObject({ status: "active", tag: "church" });

    const bare = tempGame();
    bare.ingestParsedDialogue("chaplain", { proposals: [roof], parseErrors: [] }, "Mend the roof, then.");
    const bareCard = bare.pending.find((p) => p.status === "pending");
    expect(bareCard?.proposal).toMatchObject({ type: "start_project", tag: "church" });
    const bareView = bare.confirmProposal(bareCard!.id);
    expect(bareView.error).toBeUndefined();
    expect(bare.state.projects.find((p) => p.key === "oratory_roof_repair")?.status).toBe("active");
  });
});
