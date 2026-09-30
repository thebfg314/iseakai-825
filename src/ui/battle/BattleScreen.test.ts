import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import startingEstate from "../../../data/starting-estate.json";
import { labourPool, labourRemaining } from "../../engine/labour";
import { WorldStateSchema, type WorldState } from "../../engine/schema";
import { emptyMeter } from "../../llm/usage";
import { acceptCall, battleContinue, deployRest, musterAndRide, raiseCallDirect, scoutChooseRole, scoutNarrow, type BattleDeps } from "../../session/battle";
import type { GameView } from "../../shared/types";
import { BattleScreen, type FullCommandHandlers } from "./BattleScreen";

function viewOf(state: WorldState): GameView {
  return {
    state,
    pending: [],
    messages: [],
    sceneNpcId: "steward",
    labour: { pool: labourPool(state), remaining: labourRemaining(state) },
    smithAvailable: true,
    chaplainAvailable: true,
    merchantAvailable: false,
    sceneEmotion: "neutral",
    historyTail: [],
    llmMeter: emptyMeter("rfab"),
  };
}

const silent: BattleDeps = { chat: async () => { throw new Error("offline"); }, log: () => {} };
const noop = () => {};
const full: FullCommandHandlers = { onScoutRole: noop, onScoutNarrow: noop, onScoutFinalize: noop, onDeploy: noop, onDeployRest: noop, onAddress: noop, onBegin: noop, onDayEnd: noop };
const render = (s: WorldState) => renderToStaticMarkup(createElement(BattleScreen, { view: viewOf(s), busy: false, onReturn: noop, onMuster: noop, onContinue: noop, onChoose: noop, onRound: noop, onFinish: noop, full }));

describe("the field screen", () => {
  it("renders the muster, then the Rank-and-File card view", async () => {
    const s = WorldStateSchema.parse(structuredClone(startingEstate));
    raiseCallDirect(s, "summons", 3);
    acceptCall(s, silent);
    let html = render(s);
    expect(html).toContain("The Muster");
    expect(html).toContain("Ride out");
    musterAndRide(s, silent, []);
    await battleContinue(s, silent);
    html = render(s);
    expect(html).toContain("Rank and file");
    expect(html).toContain("field-option");
    expect(html).toContain("Personal HP Risk");
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });

  it("renders the command view with the marshal's order, the scoped grid, and an order form for owned files", async () => {
    const s = WorldStateSchema.parse(structuredClone(startingEstate));
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: true, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "summons", 5);
    acceptCall(s, silent);
    musterAndRide(s, silent, ["u1"]);
    await battleContinue(s, silent);
    const html = render(s);
    expect(html).toContain("Sub-command");
    expect(html).toContain("The marshal&#x27;s order");
    expect(html).toContain("Fontenay spears");
    expect(html).toContain("Advance the exchange");
    expect(html).toContain("Give order");
    expect(html).toContain("cmd-chip enemy");
    expect(html).toMatch(/steady|shaken|wavering/);
    expect(html).toContain("cmd-chip player mine");
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });

  it("renders the Full Command scouting duel, then deployment with Address the Troops", async () => {
    const s = WorldStateSchema.parse(structuredClone(startingEstate));
    s.player.fullCommandGranted = true;
    s.player.renown = 80;
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "summons", 7);
    acceptCall(s, silent);
    musterAndRide(s, silent, ["u1"]);
    expect(s.battle_session?.phase).toBe("scouting");
    let html = render(s);
    expect(html).toContain("Choosing the Ground");
    expect(html).not.toMatch(/undefined|NaN|\[object/);
    const sc = s.battle_session!.scouting!;
    if (sc.stage === "choose_role") {
      expect(html).toContain("Narrow: keep three of six");
      scoutChooseRole(s, "narrower");
    }
    html = render(s);
    expect(html).toContain("minimap-grid"); // maps appear once a role is set
    if (s.battle_session!.scouting!.stage === "narrow") scoutNarrow(s, [0, 1, 2]);
    else {
      const { scoutFinalize } = await import("../../session/battle");
      scoutFinalize(s, 0);
    }
    expect(s.battle_session?.phase).toBe("deployment");
    html = render(s);
    expect(html).toContain("Deployment");
    expect(html).toContain("Begin the battle");
    expect(html).toContain("Address");
    expect(html).toContain("Let the sergeants place the rest");
    deployRest(s);
    html = render(s);
    expect(html).not.toMatch(/undefined|NaN|\[object/);
  });
});
