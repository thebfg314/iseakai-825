import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type PendingProposal } from "../engine/schema";
import { ProposalsPanel } from "./ProposalsPanel";

function card(partial: Pick<PendingProposal, "id" | "proposal"> & Partial<PendingProposal>): PendingProposal {
  return {
    npcId: "steward",
    status: "pending",
    ...partial,
  };
}

describe("per-item confirm", () => {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));

  it("offers Confirm all, and greys hands until their work is confirmed", () => {
    const pending: PendingProposal[] = [
      card({
        id: "scrub-1",
        proposal: {
          type: "start_project",
          id: "scrub-1",
          summary: "Clear an acre of scrub",
          projectKey: "clear_scrub",
          holdingId: "fontenay",
        },
      }),
      card({
        id: "hands-1",
        proposal: {
          type: "assign_labour",
          summary: "Four men to the scrub",
          projectId: "scrub-1",
          men: 4,
          women: 0,
          youths: 0,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(ProposalsPanel, {
        pending,
        state,
        busy: false,
        onConfirm: () => {},
        onConfirmAll: () => {},
        onDeny: () => {},
        onAskAbout: () => {},
      }),
    );
    expect(html).toContain("Confirm all");
    expect(html).toContain("Deny");
    expect(html).toContain("Confirm that work first");
    expect(html).not.toMatch(/assign_labour|projectId|start_project|customCosts/);
    const confirmButtons = html.match(/<button[^>]*>Confirm<\/button>/g) ?? [];
    expect(confirmButtons).toHaveLength(2);
    expect(confirmButtons.filter((button) => button.includes("disabled"))).toHaveLength(1);
    expect(html.match(/<button[^>]*>Confirm all<\/button>/)?.[0]).not.toContain("disabled");
  });

  it("greys a denied work's hands so they cannot be confirmed", () => {
    const pending: PendingProposal[] = [
      card({
        id: "hands-1",
        status: "withheld",
        rejectReason: "You declined the clear scrub to arable (1 acre), so I have not called hands to it or changed it.",
        proposal: {
          type: "assign_labour",
          summary: "Four men to the scrub",
          projectId: "scrub-1",
          men: 4,
          women: 0,
          youths: 0,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(ProposalsPanel, {
        pending,
        state,
        busy: false,
        onConfirm: () => {},
        onConfirmAll: () => {},
        onDeny: () => {},
        onAskAbout: () => {},
      }),
    );
    expect(html).toContain("proposal blocked");
    expect(html).toContain("You declined the clear");
    expect(html).toContain("so I have not called hands to it or changed it.");
    expect(html.match(/<button[^>]*>Confirm<\/button>/)?.[0]).toContain("disabled");
    expect(html.match(/<button[^>]*>Deny<\/button>/)?.[0]).toContain("disabled");
    expect(html.match(/<button[^>]*>Confirm all<\/button>/)?.[0]).toContain("disabled");
    expect(html).not.toMatch(/assign_labour|withheld|projectId/);
  });
});
