import type { LlmMeter, RemainingKind } from "../llm/usage";
import { tallyDisplayTokens } from "../llm/usage";
import { PROVIDER_META, type LlmProvider } from "../llm/types";
import { providerBalanceHelp } from "../llm/credits";

export function formatInkCount(n: number): string {
  if (Number.isInteger(n) || Math.abs(n) >= 100) return Math.round(n).toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatRemaining(value: number, kind: RemainingKind): string {
  if (kind === "usd") {
    const abs = Math.abs(value);
    const formatted = abs.toLocaleString("en-US", { style: "currency", currency: "USD" });
    return value < 0 ? `-${formatted}` : formatted;
  }
  return formatInkCount(value);
}

export function remainingCaption(kind: RemainingKind): string {
  return kind === "tokens" ? "Tokens remaining" : "Credits left";
}

export function usedThisSaveCaption(): string {
  return "Used this save";
}

export function usedThisSessionCaption(): string {
  return "Used this session";
}

export function hudInkLine(meter: LlmMeter): string {
  const used = tallyDisplayTokens(meter.usedThisSave);
  const usedLabel = `${usedThisSaveCaption()}: ${formatInkCount(used)}`;
  if (meter.remainingKnown && meter.remaining) {
    return `${remainingCaption(meter.remaining.kind)}: ${formatRemaining(meter.remaining.value, meter.remaining.kind)} · ${usedLabel}`;
  }
  return usedLabel;
}

export function hudInkTitle(meter: LlmMeter): string {
  const session = tallyDisplayTokens(meter.usedThisSession);
  const save = tallyDisplayTokens(meter.usedThisSave);
  const provider = PROVIDER_META[meter.provider].label;
  const parts = [
    `${usedThisSaveCaption()}: ${formatInkCount(save)} tokens`,
    `${usedThisSessionCaption()}: ${formatInkCount(session)} tokens`,
    providerBalanceHelp(meter.provider),
  ];
  if (meter.remainingKnown && meter.remaining) {
    parts.unshift(`${remainingCaption(meter.remaining.kind)} (${provider}): ${formatRemaining(meter.remaining.value, meter.remaining.kind)}`);
  }
  return parts.join("\n");
}

export function settingsInkLines(meter: LlmMeter, provider: LlmProvider = meter.provider): string[] {
  const save = tallyDisplayTokens(meter.usedThisSave);
  const session = tallyDisplayTokens(meter.usedThisSession);
  const lines = [
    `${usedThisSaveCaption()}: ${formatInkCount(save)} tokens`,
    `${usedThisSessionCaption()}: ${formatInkCount(session)} tokens`,
    providerBalanceHelp(provider),
  ];
  if (meter.remainingKnown && meter.remaining) {
    lines.unshift(`${remainingCaption(meter.remaining.kind)}: ${formatRemaining(meter.remaining.value, meter.remaining.kind)}`);
  }
  return lines;
}
