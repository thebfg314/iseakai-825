import type { ChatMessage, MechanicalProposal, PendingProposal, SeasonEffectLine, WorldState } from "../engine/schema";
import type { DialogueResult, GameView, SeasonResult } from "../shared/types";
import { applyProposal } from "../engine/applyDelta";
import { defaultEventStub, rollSeasonEvents, type RolledEvent } from "../engine/events";
import { applyMerchantRoll, rollMerchantVisit, syncTradeFromFeatures } from "../engine/merchant";
import { finishSeasonClock, resolveAgricultureAndProjects } from "../engine/season";
import { appendHistory } from "../engine/history";
import { cloneState, saveWorldState } from "../engine/state";
import { CHURCH_FEATURES, FORGE_FEATURES } from "../engine/projectCatalog";
import { labourPool, labourRemaining } from "../engine/labour";
import { newId, nextSeason } from "../engine/util";
import { PORTRAIT_NPCS, type AldricEmotion } from "../engine/emotion";
import path from "node:path";
import { parseLlmResponse } from "../llm/parse";
import { llmChat, type AppSettings } from "../llm";
import {
  npcUserPrompt,
  npcSystemPrompt,
  refereeSystemPrompt,
  repairPrompt,
  seasonUserPrompt,
} from "../llm/prompts";

export type { DialogueResult, GameView, SeasonResult } from "../shared/types";

export class GameController {
  state: WorldState;
  pending: PendingProposal[] = [];
  messages: ChatMessage[] = [];
  sceneNpcId = "steward";
  saveDir: string;
  settings: AppSettings;
  historyTail: string[] = [];
  npcEmotions: Record<string, AldricEmotion> = {
    steward: "respectful",
    smith: "neutral",
    chaplain: "neutral",
  };

  constructor(state: WorldState, saveDir: string, settings: AppSettings) {
    this.state = state;
    this.saveDir = saveDir;
    this.settings = settings;
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "steward",
      npcName: this.npcName("steward"),
      text: openingSpeech(state),
      emotion: "respectful",
      at: new Date().toISOString(),
    });
  }

  view(): GameView {
    if (this.sceneNpcId === "merchant" && !this.merchantAvailable()) {
      this.sceneNpcId = "steward";
    }
    this.persist();
    return {
      state: this.state,
      pending: this.pending.filter((p) => p.status === "pending"),
      messages: this.messages,
      sceneNpcId: this.sceneNpcId,
      labour: { pool: labourPool(this.state), remaining: labourRemaining(this.state) },
      smithAvailable: this.smithAvailable(),
      chaplainAvailable: this.chaplainAvailable(),
      merchantAvailable: this.merchantAvailable(),
      sceneEmotion: this.npcEmotions[this.sceneNpcId] ?? "neutral",
      historyTail: this.historyTail.slice(-30),
    };
  }

  persist() {
    try {
      saveWorldState(path.join(this.saveDir, "world-state.json"), this.state);
    } catch {
      /* ignore */
    }
  }

  smithAvailable(): boolean {
    return (
      this.state.holdings.some((h) => h.features.some((f) => FORGE_FEATURES.has(f))) &&
      this.state.npcs.some((n) => n.role === "smith")
    );
  }

  chaplainAvailable(): boolean {
    return (
      this.state.holdings.some((h) => h.features.some((f) => CHURCH_FEATURES.has(f))) &&
      this.state.npcs.some((n) => n.role === "chaplain" || n.id === "chaplain")
    );
  }

  merchantAvailable(): boolean {
    return this.state.merchant.present && this.state.flags.merchant_present && this.state.npcs.some((n) => n.id === "merchant");
  }

  setScene(npcId: string): GameView {
    if (npcId === "smith" && !this.smithAvailable()) return this.view();
    if (npcId === "chaplain" && !this.chaplainAvailable()) return this.view();
    if (npcId === "merchant" && !this.merchantAvailable()) return this.view();
    this.sceneNpcId = npcId;
    return this.view();
  }

  log(actor: string, kind: "APPLY" | "REJECT" | "EVENT" | "CHAT" | "SEASON", summary: string) {
    const line = appendHistory(this.saveDir, this.state, actor, kind, summary);
    this.historyTail.push(line);
  }

  npcName(id: string): string {
    return this.state.npcs.find((n) => n.id === id)?.name ?? id;
  }

  async sendDialogue(npcId: string, playerText: string): Promise<DialogueResult> {
    if (npcId === "merchant" && !this.merchantAvailable()) {
      this.sceneNpcId = "steward";
      return { ...this.view(), error: "The merchant has left the district." };
    }
    this.sceneNpcId = npcId;
    this.messages.push({
      id: newId("msg"),
      role: "player",
      npcId,
      text: playerText,
      at: new Date().toISOString(),
    });
    this.log("player", "CHAT", `${npcId}: ${playerText.slice(0, 120)}`);

    const system = npcSystemPrompt(npcId);
    const extra =
      npcId === "merchant"
        ? `The merchant's carts hold: ${this.state.merchant.stock.map((s) => `${s.amount} ${s.resource}`).join(", ") || "nothing left"}. Buy only from that stock. Sell any estate resource except denarii.`
        : undefined;
    const user = npcUserPrompt(this.state, npcId, playerText, extra);
    try {
      const { speech, chronicle, proposals, raw, emotion } = await this.callLlm(
        [{ role: "system", content: system }, { role: "user", content: user }],
        1600,
      );
      if (emotion && PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = emotion;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId,
        npcName: this.npcName(npcId),
        text: speech,
        chronicle,
        emotion: PORTRAIT_NPCS.has(npcId) ? emotion ?? this.npcEmotions[npcId] : undefined,
        at: new Date().toISOString(),
      });
      for (const p of proposals) this.queueProposal(npcId, p);
      if (!proposals.length && /proposal/i.test(raw) === false) {
        /* chat only */
      }
      return this.view();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.messages.push({
        id: newId("msg"),
        role: "system",
        text: `${this.npcName(npcId)} cannot be heard (${error})`,
        at: new Date().toISOString(),
      });
      return { ...this.view(), error };
    }
  }

  queueProposal(npcId: string, proposal: MechanicalProposal) {
    this.pending.push({
      id: proposal.id ?? newId("prop"),
      npcId,
      proposal: { ...proposal, id: proposal.id },
      status: "pending",
    });
  }

  confirmProposal(id: string): GameView & { error?: string } {
    const item = this.pending.find((p) => p.id === id && p.status === "pending");
    if (!item) return { ...this.view(), error: "No such pending proposal." };
    const result = applyProposal(this.state, item.proposal, item.npcId);
    this.state = result.state;
    item.status = result.ok ? "applied" : "rejected";
    item.rejectReason = result.reason;
    this.log(item.npcId, result.ok ? "APPLY" : "REJECT", result.ok ? result.logLine : result.reason ?? result.logLine);
    this.messages.push({
      id: newId("msg"),
      role: "system",
      text: result.ok ? `Done: ${result.logLine}` : `Cannot be made so: ${result.reason}`,
      at: new Date().toISOString(),
    });
    return this.view();
  }

  rejectProposal(id: string): GameView {
    const item = this.pending.find((p) => p.id === id && p.status === "pending");
    if (item) {
      item.status = "rejected";
      item.rejectReason = "Player rejected";
      this.log(item.npcId, "REJECT", item.proposal.summary);
      this.messages.push({
        id: newId("msg"),
        role: "system",
        text: `You declined: ${item.proposal.summary}`,
        at: new Date().toISOString(),
      });
    }
    return this.view();
  }

  async advanceSeason(): Promise<SeasonResult> {
    const effects: SeasonEffectLine[] = [];
    this.pending = this.pending.map((p) => (p.status === "pending" ? { ...p, status: "rejected" as const, rejectReason: "Season advanced" } : p));

    effects.push(...resolveAgricultureAndProjects(this.state));
    syncTradeFromFeatures(this.state);
    const roll = rollSeasonEvents(this.state);
    const incoming = nextSeason(this.state.meta.year, this.state.meta.season);
    const merchantResult = rollMerchantVisit(this.state, incoming.season);
    const merchantNote = applyMerchantRoll(this.state, merchantResult);
    effects.push({ kind: "info", text: merchantNote });
    this.log("engine", "EVENT", merchantNote);
    const rolled: RolledEvent[] = [roll.weather, ...(roll.other ? [roll.other] : [])];
    for (const ev of rolled) {
      effects.push({ kind: "event", text: ev.resolvedText });
      this.log("referee", "EVENT", `${ev.id}: ${ev.resolvedText}`);
    }

    const engineLines = effects.map((e) => e.text);
    try {
      const { speech, chronicle, proposals, emotion } = await this.callLlm(
        [
          { role: "system", content: refereeSystemPrompt() },
          {
            role: "user",
            content: seasonUserPrompt(
              this.state,
              rolled.map((e) => ({ id: e.id, resolvedText: e.resolvedText, polarity: e.polarity, category: e.category })),
              engineLines,
              merchantNote,
            ),
          },
        ],
        2000,
      );
      const covered = new Set<string>();
      for (const p of proposals) {
        if (p.type !== "event_effect") {
          const wrapped: MechanicalProposal = {
            type: "event_effect",
            eventId: roll.weather.id,
            summary: p.summary,
            nested: [p],
          };
          const r = applyProposal(this.state, wrapped, "referee");
          this.state = r.state;
          effects.push({ kind: r.ok ? "apply" : "reject", text: r.ok ? r.logLine : r.reason ?? r.logLine });
          this.log("referee", r.ok ? "APPLY" : "REJECT", r.logLine);
          continue;
        }
        covered.add(p.eventId);
        const r = applyProposal(this.state, p, "referee");
        this.state = r.state;
        effects.push({ kind: r.ok ? "apply" : "reject", text: r.ok ? r.logLine : r.reason ?? r.logLine });
        this.log("referee", r.ok ? "APPLY" : "REJECT", r.logLine);
      }
      for (const ev of rolled) {
        if (covered.has(ev.id)) continue;
        const stub = defaultEventStub(ev);
        const r = applyProposal(
          this.state,
          {
            type: "event_effect",
            eventId: ev.id,
            summary: `Stub for ${ev.id}`,
            resource: stub.resource,
            amount: stub.amount,
            direction: stub.direction,
            moodDelta: stub.moodDelta,
          },
          "referee",
        );
        this.state = r.state;
        effects.push({ kind: r.ok ? "apply" : "reject", text: `Default effect: ${r.logLine}` });
      }

      const clock = finishSeasonClock(this.state);
      effects.push(...clock);
      this.log("engine", "SEASON", `Now ${this.state.meta.season} ${this.state.meta.year}`);
      if (emotion) this.npcEmotions.steward = emotion;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: "steward",
        npcName: this.npcName("steward"),
        text: speech,
        chronicle,
        emotion: emotion ?? this.npcEmotions.steward,
        at: new Date().toISOString(),
      });
      this.sceneNpcId = "steward";
      return { ...this.view(), effects };
    } catch (err) {
      for (const ev of rolled) {
        const stub = defaultEventStub(ev);
        const r = applyProposal(
          this.state,
          {
            type: "event_effect",
            eventId: ev.id,
            summary: `Stub for ${ev.id}`,
            resource: stub.resource,
            amount: stub.amount,
            direction: stub.direction,
            moodDelta: stub.moodDelta,
          },
          "referee",
        );
        this.state = r.state;
        effects.push({ kind: "apply", text: `Default effect (no model): ${r.logLine}` });
      }
      effects.push(...finishSeasonClock(this.state));
      const error = err instanceof Error ? err.message : String(err);
      this.messages.push({
        id: newId("msg"),
        role: "system",
        text: `Season advanced with engine defaults only. ${error}`,
        chronicle: effects.map((e) => e.text).join("\n"),
        at: new Date().toISOString(),
      });
      return { ...this.view(), effects, error };
    }
  }

  private async callLlm(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    maxTokens: number,
  ): Promise<{ speech: string; chronicle?: string; proposals: MechanicalProposal[]; raw: string; emotion?: AldricEmotion }> {
    const raw1 = await llmChat(this.settings, messages, { maxTokens });
    let parsed = parseLlmResponse(raw1);
    if (parsed.parseErrors.length && parsed.proposals.length === 0 && !looksLikeSpeechOnly(parsed.response.speech, raw1)) {
      const raw2 = await llmChat(this.settings, [...messages, { role: "assistant", content: raw1 }, repairPrompt(raw1, parsed.parseErrors)], {
        maxTokens,
        temperature: 0.2,
      });
      parsed = parseLlmResponse(raw2);
      return {
        speech: parsed.response.speech,
        chronicle: parsed.response.chronicle,
        proposals: parsed.proposals.map(ensureSummary),
        raw: raw2,
        emotion: parsed.emotion,
      };
    }
    return {
      speech: parsed.response.speech,
      chronicle: parsed.response.chronicle,
      proposals: parsed.proposals.map(ensureSummary),
      raw: raw1,
      emotion: parsed.emotion,
    };
  }
}

function ensureSummary(p: MechanicalProposal): MechanicalProposal {
  if (p.summary) return p;
  return { ...p, summary: p.type };
}

function looksLikeSpeechOnly(speech: string, raw: string): boolean {
  return Boolean(speech) && !raw.includes('"proposals"') && parseLlmResponse(raw).parseErrors.length === 0;
}

function openingSpeech(state: WorldState): string {
  const h = state.holdings[0];
  const land = h?.land;
  const features = h?.features ?? [];
  const scrubWaste = (land?.scrub ?? 0) + (land?.waste ?? 0);
  const sownCap = (land?.fertile_arable ?? 0) * 0.5;
  const sownNow = h ? h.sown.wheat + h.sown.rye + h.sown.barley + h.sown.oats : 0;
  const sowing =
    sownNow + 0.05 < sownCap
      ? "Wheat and rye already stand from last autumn's sowing, though the sown share is not full."
      : "Wheat and rye already stand from last autumn's sowing.";
  const forge = features.some((f) => f === "forge" || f === "mill_forge" || f === "bloomery")
    ? ` Bernard keeps a forge, but charcoal is down to ${state.resources.charcoal} cart-load${state.resources.charcoal === 1 ? "" : "s"} and iron to ${state.resources.iron} pounds.`
    : "";
  const church = features.includes("monastery")
    ? " A small cell of Saint-Martin stands by the hall — four monks and an oratory — and Father Ermenald serves as your chaplain."
    : features.includes("chapel")
      ? " Father Ermenald serves as your chaplain at a small timber oratory. There is no monastic house on the villa."
      : "";
  return `My lord. It is ${state.meta.season} in the year ${state.meta.year}, at ${state.meta.region}. The villa holds ${land?.fertile_arable ?? 0} acres of arable — and ${scrubWaste} acres of scrub and waste beside it — ${state.population.households} households, and ${state.resources.denarii} denarii in the chest. ${sowing} The hall is timber, and tired; the barn beside it is sound enough.${forge}${church} I am Aldric, your steward. Say how you would have the land kept, or I will keep it as custom requires. When you wish the season to turn, give the word.`;
}

export function snapshotState(controller: GameController): WorldState {
  return cloneState(controller.state);
}
