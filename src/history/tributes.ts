import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { formatDenarii, slotValue } from "./slots";

/**
 * The Viking tributes (03_HISTORY §11.8). The shares themselves are slots
 * (slots.ts) read by the E-866 / E-877 scripts and their choices. This tick
 * repays the "advance it as a loan" option: the tenants' share comes back with
 * increase four seasons after the levy.
 */

export const LOAN_SEASONS = 4;
export const LOAN_INCREASE = 1.25;

const LEVIES: Array<{ event: string; tenantsSlot: string; year: number }> = [
  { event: "E-866", tenantsSlot: "tribute_866_tenants", year: 866 },
  { event: "E-877", tenantsSlot: "tribute_877_tenants", year: 877 },
];

export function tickTributes(state: WorldState, turn: number): { beats: HistoryBeat[]; lines: string[] } {
  const beats: HistoryBeat[] = [];
  const lines: string[] = [];
  for (const levy of LEVIES) {
    if (state.history.chosen[levy.event] !== "loan") continue;
    const fired = state.history.fired[levy.event];
    if (!fired || fired.turn + LOAN_SEASONS !== turn) continue;
    const principal = slotValue(state, levy.tenantsSlot) ?? 0;
    const back = Math.round(principal * LOAN_INCREASE);
    state.resources.denarii = (state.resources.denarii ?? 0) + back;
    lines.push(`The ${levy.year} tribute loan came back: ${back} denarii.`);
    beats.push({
      npcId: "steward",
      eventId: `${levy.event}:loan`,
      text: `My lord, the last of the ${levy.year} silver has come back from the tenants and the neighbours who borrowed it, with the increase: ${formatDenarii(back)} in all. Ermenald has said nothing about the increase, which is his way of saying something.`,
    });
  }
  return { beats, lines };
}
