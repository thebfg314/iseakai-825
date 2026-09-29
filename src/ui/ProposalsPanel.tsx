import type { GameView } from "../shared/types";
import type { PendingProposal } from "../engine/schema";
import { confirmGate } from "../engine/proposalPack";
import {
  CONFIRM_HELP,
  playerFacingSummary,
  proposalBlurb,
  proposalTypeName,
} from "./ledgerCopy";
import { GlossaryText } from "./GlossaryText";

export function ProposalsPanel({
  pending,
  state,
  busy,
  onConfirm,
  onConfirmAll,
  onDeny,
  onAskAbout,
}: {
  pending: PendingProposal[];
  state: GameView["state"];
  busy: boolean;
  onConfirm: (p: PendingProposal) => void;
  onConfirmAll: () => void;
  onDeny: (p: PendingProposal) => void;
  onAskAbout: (p: PendingProposal) => void;
}) {
  if (!pending.length) return null;
  const canConfirmAll = pending.some((p) => p.status === "pending" && !confirmGate(p, pending).blocked);
  return (
    <div className="proposals" id="pending-proposals">
      <h3>Proposed changes — Confirm writes the books</h3>
      <p className="proposal-help">
        <GlossaryText text={CONFIRM_HELP} />
      </p>
      <div className="proposal-toolbar">
        <button className="primary" disabled={busy || !canConfirmAll} onClick={onConfirmAll}>
          Confirm all
        </button>
      </div>
      {pending.map((p) => {
        const gate = confirmGate(p, pending);
        const withheld = p.status === "withheld";
        const hunt = p.proposal.type === "start_hunt" ? { hunt: true as const } : undefined;
        return (
          <div key={p.id} className={gate.blocked ? "proposal blocked" : "proposal"}>
            <div className="p-type">
              <GlossaryText text={proposalTypeName(p.proposal.type)} context={hunt} />
            </div>
            {playerFacingSummary(p.proposal) && (
              <div className="p-sum">
                <GlossaryText text={playerFacingSummary(p.proposal)} context={hunt} />
              </div>
            )}
            <div className="p-blurb">
              <GlossaryText text={proposalBlurb(p.proposal, state)} context={hunt} />
            </div>
            {gate.note && (
              <div className="p-note">
                <GlossaryText text={gate.note} />
              </div>
            )}
            <div className="p-actions">
              <button className="primary" disabled={busy || gate.blocked} onClick={() => onConfirm(p)}>
                Confirm
              </button>
              <button disabled={busy || withheld} onClick={() => onDeny(p)}>
                Deny
              </button>
              <button disabled={busy || withheld} onClick={() => onAskAbout(p)}>
                Ask about
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
