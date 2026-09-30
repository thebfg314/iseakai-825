import type { BattleState, CommandTier, Side } from "../../combat/battleTypes";
import type { BattleSession } from "../../engine/schema";

/** Pure helpers for the field screen. */

export function tierLabel(tier: CommandTier): string {
  switch (tier) {
    case "rank_and_file":
      return "Rank and file";
    case "sub_command":
      return "Sub-command";
    case "full_command":
      return "Full command";
  }
}

export function battleStatus(battle: BattleState, session: BattleSession): string {
  if (session.phase === "aftermath") return `${battle.outcome ?? "ended"} after ${battle.round} round${battle.round === 1 ? "" : "s"}`;
  if (battle.round === 0) return "The hosts draw up";
  const when = battle.round <= 2 ? "The first exchanges" : battle.round <= 6 ? "The fight thickens" : battle.round <= 9 ? "The long afternoon" : "Toward evening";
  return `${when} · day ${battle.day}`;
}

/** "Our host: 3 standing, 1 broken" — what a man in the line can actually tell. */
export function hostLine(battle: BattleState, side: Side): string {
  const units = battle.units.filter((u) => u.side === side);
  const standing = units.filter((u) => u.status === "active").length;
  const broken = units.length - standing;
  const who = side === "player" ? "Our host" : "Their host";
  return `${who}: ${standing} ${standing === 1 ? "file" : "files"} standing${broken ? `, ${broken} broken` : ""}`;
}

export function narrationParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
