import type { PendingProposal } from "../engine/schema";
import type { GameView } from "../shared/types";

/** One-shot UI/SFX ride master, not the music slider. Matches the existing click. */
export const SFX_MASTER_FACTOR = 0.6;

export type MusicBed = "title" | "game" | "gameOver";

export function musicGain(s: { masterVolume?: number; musicVolume?: number }): number {
  return Math.min(1, Math.max(0, (s.masterVolume ?? 1) * (s.musicVolume ?? 0.55)));
}

export function sfxGain(masterVolume: number | undefined): number {
  return Math.min(1, Math.max(0, (masterVolume ?? 1) * SFX_MASTER_FACTOR));
}

/** Season fanfare and hall horn duck the music bed; pen, coins, and click do not. */
export function sfxDucksMusic(cue: "click" | "pen" | "coins" | "fanfare" | "horn" | "gameOver"): boolean {
  return cue === "fanfare" || cue === "horn";
}

export function musicBedFor(screen: "title" | "game", estateAbandoned: boolean): MusicBed {
  if (screen === "title") return "title";
  return estateAbandoned ? "gameOver" : "game";
}

export function seasonKey(meta: { year: number; season: string }): string {
  return `${meta.year}:${meta.season}`;
}

export function isMerchantBuySell(proposal: { type: string; direction?: string } | undefined): boolean {
  if (proposal?.type === "merchant_shop") return true;
  return proposal?.type === "transfer_resources" && (proposal.direction === "buy" || proposal.direction === "sell");
}

export function confirmWroteBooks(result: { error?: string; state?: unknown } | null | undefined): boolean {
  return Boolean(result && result.state && !result.error);
}

export function confirmSfx(
  proposal: { type: string; direction?: string } | undefined,
  result: { error?: string; state?: unknown } | null | undefined,
): { pen: boolean; coins: boolean } {
  if (!confirmWroteBooks(result)) return { pen: false, coins: false };
  return { pen: true, coins: isMerchantBuySell(proposal) };
}

type HornView = {
  merchantAvailable?: boolean;
  pending: Pick<PendingProposal, "status" | "proposal">[];
  state: {
    estateAbandoned?: boolean;
    flags: { merchant_present?: boolean };
    merchant: { present?: boolean };
    npcs: { wantsTalk?: boolean }[];
  };
};

/** One hall-horn blast covers merchant, wants-talk, and a family at the gate. */
export function hallHornDue(view: HornView): boolean {
  if (view.state.estateAbandoned) return false;
  if (view.merchantAvailable || (view.state.merchant.present && view.state.flags.merchant_present)) return true;
  if (view.state.npcs.some((n) => n.wantsTalk)) return true;
  if (view.pending.some((p) => p.status === "pending" && p.proposal.type === "settle_households")) return true;
  return false;
}

type AdvanceResult = {
  error?: string;
  state?: {
    estateAbandoned?: boolean;
    meta: { season: string; year?: number };
    flags: { merchant_present?: boolean };
    merchant: { present?: boolean };
    npcs: { wantsTalk?: boolean }[];
  };
  pending?: HornView["pending"];
  merchantAvailable?: boolean;
} | null | undefined;

export function advanceSeasonLanded(fromSeason: string | undefined, result: AdvanceResult): boolean {
  const to = result?.state?.meta.season;
  if (!to || result?.error) return false;
  if (fromSeason != null && to === fromSeason) return false;
  return true;
}

export function seasonAdvanceSfx(fromSeason: string | undefined, result: AdvanceResult): { fanfare: boolean; horn: boolean } {
  if (!advanceSeasonLanded(fromSeason, result) || !result?.state) return { fanfare: false, horn: false };
  if (result.state.estateAbandoned) return { fanfare: false, horn: false };
  const hornView: HornView = {
    merchantAvailable: result.merchantAvailable,
    pending: result.pending ?? [],
    state: result.state,
  };
  return { fanfare: true, horn: hallHornDue(hornView) };
}

export function enterGameHorn(view: Pick<GameView, "merchantAvailable" | "pending" | "state">): boolean {
  return hallHornDue(view);
}
