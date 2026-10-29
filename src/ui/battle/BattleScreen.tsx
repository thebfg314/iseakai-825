import { useEffect, useRef, useState } from "react";
import { controlledUnitIds } from "../../combat/battle";
import type { Order } from "../../combat/battleTypes";
import { vignetteById } from "../../combat/vignettes";
import type { GameView } from "../../shared/types";
import { battleStatus, hostLine, narrationParagraphs, tierLabel } from "./battleView";
import { CommandPanel } from "./CommandPanel";
import { DeploymentPanel, NightfallCard, ScoutingPanel } from "./FullCommand";

export type FullCommandHandlers = {
  onScoutRole: (role: "narrower" | "finalizer") => void;
  onScoutNarrow: (keep: number[]) => void;
  onScoutFinalize: (pick: number) => void;
  onDeploy: (unitId: string, cell: { row: number; col: number }) => void;
  onDeployRest: () => void;
  onAddress: (unitId: string, amount: number) => void;
  onBegin: () => void;
  onDayEnd: (choice: "hold" | "reposition" | "withdraw", pick?: number) => void;
};

/**
 * The field, as a Rank-and-File horseman sees it (design doc §4.1): narration, a status line,
 * and the choice in front of him. No grid — that view belongs to the command tiers.
 */

type Props = {
  view: GameView;
  busy: boolean;
  onReturn: () => void;
  onMuster: (bringIds: string[]) => void;
  onContinue: () => void;
  onChoose: (key: "A" | "B") => void;
  onRound: (orders: Order[]) => void;
  onFinish: (disposition?: "settle" | "sell") => void;
  full: FullCommandHandlers;
};

export function BattleScreen({ view, busy, onReturn, onMuster, onContinue, onChoose, onRound, onFinish, full }: Props) {
  const session = view.state.battle_session;
  const battle = view.state.battle;
  const scroller = useRef<HTMLDivElement>(null);
  const [bring, setBring] = useState<string[]>([]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [session?.narration.length, session?.pendingCard?.vignetteId, session?.pendingRout]);

  if (!session) return null;

  if (session.phase === "muster") {
    const call = view.state.battle_call;
    const owned = view.state.military.units.filter((u) => u.strength > 0);
    return (
      <div className="field">
        <header className="field-head">
          <h1>The Muster</h1>
          <button onClick={onReturn} disabled={busy}>
            Back to the hall
          </button>
        </header>
        <div className="field-muster">
          <p className="field-call">{call?.text}</p>
          {call?.kind === "history" ? (
            <p>{call.note}</p>
          ) : (
            <p>
              You ride as one <strong>Caballarius</strong> — your own horse, your own modest gear, one more mounted man in the line. You command no one.
            </p>
          )}
          {owned.length === 0 ? (
            <p className="muted">
              {call?.kind === "history"
                ? call.mode === "captain"
                  ? "You have no men to send under a captain. The contingent cannot go."
                  : "You have no units of your own to bring; the sector is someone else's army and you take your place in it."
                : "You have no units of your own to bring. Should you raise and pay for a full unit one day, you would ride at its head instead."}
            </p>
          ) : (
            <div className="field-owned">
              <h3>Bring your own men?</h3>
              {owned.map((u) => (
                <label key={u.id} className="lab-check">
                  <input type="checkbox" checked={bring.includes(u.id)} disabled={busy} onChange={(e) => setBring((b) => (e.target.checked ? [...b, u.id] : b.filter((x) => x !== u.id)))} />
                  {u.name} — {u.strength} men{u.veteran ? ", veterans" : ""}
                </label>
              ))}
              <p className="muted tiny">
                {call?.kind === "history"
                  ? "Your own files displace allied ones in the sector one for one; named allies and the king's engines stay. One file puts you in Sub-Command; a count with three, a duke or a king with any, commands the sector."
                  : "Bringing at least one full unit puts you in Sub-Command of your own men."}
              </p>
            </div>
          )}
          <div className="p-actions">
            <button className="primary" disabled={busy} onClick={() => onMuster(bring)}>
              {busy ? "Riding out…" : "Ride out"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const status = battle ? battleStatus(battle, session) : null;
  const card = session.pendingCard ? vignetteById(session.pendingCard.vignetteId) : null;
  const commanding = session.tier !== "rank_and_file";

  if (session.phase === "scouting" && session.scouting) {
    return (
      <div className="field">
        <header className="field-head">
          <h1>Choosing the Ground</h1>
          <span className="field-tier muted">{tierLabel(session.tier)}</span>
          <button onClick={onReturn} disabled={busy}>
            Back to the hall
          </button>
        </header>
        <ScoutingPanel session={session} busy={busy} onRole={full.onScoutRole} onNarrow={full.onScoutNarrow} onFinalize={full.onScoutFinalize} />
      </div>
    );
  }

  if (session.phase === "deployment" && battle) {
    return (
      <div className="field">
        <header className="field-head">
          <h1>Deployment</h1>
          <span className="field-status">{battle.battlefield.name} · {battle.battlefield.weather.replace("_", " ")}</span>
          <span className="field-tier muted">{tierLabel(session.tier)}</span>
          <button onClick={onReturn} disabled={busy}>
            Back to the hall
          </button>
        </header>
        <DeploymentPanel battle={battle} busy={busy} onDeploy={full.onDeploy} onDeployRest={full.onDeployRest} onAddress={full.onAddress} onBegin={full.onBegin} />
      </div>
    );
  }

  if (commanding && battle && session.phase === "fighting") {
    return (
      <div className="field">
        <header className="field-head">
          <h1>The Field</h1>
          {status && <span className="field-status">{status}</span>}
          <span className="field-tier muted">{tierLabel(session.tier)}</span>
          <span className="field-tier muted">Pool {battle.commandPool.remaining}/{battle.commandPool.total}</span>
          <button onClick={onReturn} disabled={busy} title="The fight waits while you are away">
            Back to the hall
          </button>
        </header>
        <div className="field-body cmd-body">
          <div className="field-scroll" ref={scroller}>
            {session.narration.map((n) => (
              <article key={n.id} className={`field-entry ${n.kind}`}>
                {n.kind === "orders" ? <p className="field-orders">“{n.text}”</p> : narrationParagraphs(n.text).map((p, i) => <p key={i}>{p}</p>)}
              </article>
            ))}
            {!session.openingDone && (
              <div className="field-card">
                <p className="muted">The hosts are drawing up. The marshal will send his orders down the line.</p>
                <button className="primary" disabled={busy} onClick={onContinue}>
                  {busy ? "…" : "Take your place"}
                </button>
              </div>
            )}
            {busy && <p className="field-waiting muted">{session.tier === "full_command" ? "The chronicler is writing…" : "The marshal is speaking…"}</p>}
          </div>
          {session.tier === "full_command" && battle.phase === "day_end" ? (
            <div className="cmd">
              <div />
              <div className="cmd-side">
                <NightfallCard session={session} busy={busy} onChoose={full.onDayEnd} />
              </div>
            </div>
          ) : (
            <CommandPanel battle={battle} session={session} controlled={controlledUnitIds(battle)} busy={busy} onRound={onRound} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <header className="field-head">
        <h1>{session.phase === "aftermath" ? "After the Battle" : "The Field"}</h1>
        {status && <span className="field-status">{status}</span>}
        <span className="field-tier muted">{tierLabel(session.tier)}</span>
        <button onClick={onReturn} disabled={busy} title="The fight waits while you are away">
          Back to the hall
        </button>
      </header>
      {battle && (
        <div className="field-hosts">
          <span>{hostLine(battle, "player")}</span>
          <span>{hostLine(battle, "enemy")}</span>
        </div>
      )}
      <div className="field-body">
        <div className="field-scroll" ref={scroller}>
          {session.narration.map((n) => (
            <article key={n.id} className={`field-entry ${n.kind}`}>
              {n.kind === "card" ? (
                <CardText text={n.text} />
              ) : n.kind === "choice" ? (
                <p className="field-choice-echo">— {n.text}</p>
              ) : (
                narrationParagraphs(n.text).map((p, i) => <p key={i}>{p}</p>)
              )}
            </article>
          ))}
          {busy && <p className="field-waiting muted">The chronicler is writing…</p>}
        </div>
        <aside className="field-side">
          {session.phase === "fighting" && card && (
            <div className="field-card">
              <h3>{card.title}</h3>
              {card.options.map((o) => (
                <button key={o.key} className="field-option" disabled={busy} onClick={() => onChoose(o.key)}>
                  <span className="field-option-key">{o.key}</span>
                  <span className="field-option-text">{o.text}</span>
                  <span className="field-option-mech">{o.mechanics}</span>
                </button>
              ))}
            </div>
          )}
          {session.phase === "fighting" && session.pendingRout && (
            <div className="field-card">
              <h3>The Line Gives Way</h3>
              <button className="field-option" disabled={busy} onClick={() => onChoose("A")}>
                <span className="field-option-key">A</span>
                <span className="field-option-text">Run with the rest and take your chances.</span>
                <span className="field-option-mech">Your fate is rolled on the same odds as your file's: escape, death, or capture.</span>
              </button>
              <button className="field-option" disabled={busy} onClick={() => onChoose("B")}>
                <span className="field-option-key">B</span>
                <span className="field-option-text">Turn and stand over the fallen banner.</span>
                <span className="field-option-mech">Personal HP Risk: High. If you come through unhurt: Renown +High. Then the same fate roll as A.</span>
              </button>
            </div>
          )}
          {session.phase === "fighting" && !card && !session.pendingRout && (
            <div className="field-card">
              <p className="muted">The fight goes on around you.</p>
              <button className="primary" disabled={busy} onClick={onContinue}>
                {busy ? "…" : "Ride on"}
              </button>
            </div>
          )}
          {session.phase === "aftermath" && (
            <div className="field-card">
              <h3>The Reckoning</h3>
              {battle && !battle.player.alive && <p className="field-dead">The lord did not leave the field.</p>}
              {battle?.player.fate === "captured" && <p className="field-dead">Taken, and ransomed from the chest.</p>}
              <p>
                Renown {session.renownDelta !== undefined && session.renownDelta >= 0 ? "+" : ""}
                {session.renownDelta ?? 0} · now {view.state.player.renown}
              </p>
              <p>
                Rank {view.state.player.rankLevel} · wounds {view.state.player.wounds.length} · strength {view.state.player.personal.hp}/{view.state.player.personal.maxHp}
              </p>
              {session.characterFlags.length > 0 && <p className="muted tiny">Remembered of you: {session.characterFlags.join(", ").replace(/_/g, " ")}.</p>}
              {session.prisonersHeld > 0 ? (
                <>
                  <p>
                    <strong>{session.prisonersHeld} captives</strong> are yours. Settle them on the land as unfree — more hands, fed from your grain, no place in the levy — or sell them.
                  </p>
                  <button className="primary" disabled={busy} onClick={() => onFinish("settle")}>
                    Settle them as unfree
                  </button>
                  <button disabled={busy} onClick={() => onFinish("sell")}>
                    Sell them ({session.prisonersHeld} denarii)
                  </button>
                </>
              ) : (
                <button className="primary" disabled={busy} onClick={() => onFinish()}>
                  Return to the hall
                </button>
              )}
            </div>
          )}
          {status && (
            <div className="field-tally">
              <div>Your file: {battle ? fileLine(battle, session) : ""}</div>
              <div>
                Your strength: {battle?.player.hp}/{battle?.player.maxHp}
                {battle?.player.dismounted ? " · on foot" : ""}
              </div>
              <div>
                Blows: dealt {battle?.player.personalDealt} · taken {battle?.player.personalTaken} · deeds {session.cardRenown >= 0 ? "+" : ""}
                {session.cardRenown}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function fileLine(battle: NonNullable<GameView["state"]["battle"]>, session: NonNullable<GameView["state"]["battle_session"]>): string {
  void session;
  const u = battle.units.find((x) => x.id === battle.player.attachedUnitId);
  if (!u) return "gone";
  if (u.status !== "active") return u.status;
  return `${Math.round((u.morale / u.maxMorale) * 100)}% heart, ${Math.round((u.hp / u.maxHp) * 100)}% whole${u.engagedWith.length ? ", in the press" : ""}`;
}

function CardText({ text }: { text: string }) {
  const [title, ...rest] = text.split("\n\n");
  return (
    <>
      <h3 className="field-card-title">{title}</h3>
      {rest.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
