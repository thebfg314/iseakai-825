import type { ChatMessage, MechanicalProposal, PendingProposal, SeasonEffectLine, WorldState } from "../engine/schema";
import type { DialogueResult, GameView, SeasonResult } from "../shared/types";
import { applyProposal } from "../engine/applyDelta";
import { defaultEventStub, rollSeasonEvents, type RolledEvent } from "../engine/events";
import { applyMerchantRoll, rollMerchantVisit, syncTradeFromFeatures } from "../engine/merchant";
import { finishSeasonClock, resolveAgricultureAndProjects } from "../engine/season";
import { diffSeasonLedger, snapshotSeasonLedger, writeLastSeasonDeltas } from "../engine/seasonDeltas";
import { appendHistory } from "../engine/history";
import { cloneState, saveWorldState } from "../engine/state";
import { CHURCH_FEATURES, FORGE_FEATURES } from "../engine/projectCatalog";
import { labourPool, labourRemaining } from "../engine/labour";
import { newId, nextSeason } from "../engine/util";
import { PORTRAIT_NPCS, type AldricEmotion } from "../engine/emotion";
import path from "node:path";
import fs from "node:fs";
import { parseLlmResponse, playerFacingNpcSpeech, eventEffectHasMechanics } from "../llm/parse";
import { llmChat, type AppSettings } from "../llm";
import { fetchProviderBalance } from "../llm/credits";
import { consumeLastLlmCall, LlmMeterStore } from "../llm/usage";
import {
  npcBooksFollowUp,
  npcFactsFollowUp,
  npcUserPrompt,
  npcSystemPrompt,
  refereeSystemPrompt,
  repairPrompt,
  seasonUserPrompt,
  SPEECH_PASS_HINT,
} from "../llm/prompts";
import {
  CHECK_RECORDS_LINE,
  collectDrawers,
  missingCitedDrawers,
  parseToolRequest,
  stripToolMarkers,
  type ToolDrawer,
} from "../llm/toolProtocol";
import {
  booksHearFailureLine,
  HOLD_AT_ONCE_APOLOGY,
  INCOMPLETE_MODEL_JSON,
  isHoldAtOnceFailure,
} from "../llm/providerErrors";
import { introAlreadySpoken, introSpeechFor, markIntroSpoken } from "../engine/intros";
import { recordConfirmedTransaction } from "../engine/memory";
import { cannotFulfillReason, inferOrderProposals, looksLikeMechanicalOrder } from "../engine/orderIntent";
import {
  ensureGerulfInHousehold,
  isNegotiatorId,
  NEGOTIATOR_ID,
  normalizeHuntProposal,
  pendingHuntReports,
} from "../engine/hunts";
import {
  hireSummary,
  isEstateSmithNpc,
  matchHireableSpecialist,
  newlyUnlockedHires,
  recommendableHires,
  specialistAlreadyPresent,
  specialistById,
  specialistHireBlocked,
  specialistHireGrainRation,
  specialistNpc,
} from "../engine/specialists";

export type { DialogueResult, GameView, SeasonResult } from "../shared/types";

export class GameController {
  state: WorldState;
  pending: PendingProposal[] = [];
  messages: ChatMessage[] = [];
  sceneNpcId = "steward";
  saveDir: string;
  settings: AppSettings;
  historyTail: string[] = [];
  /** In-memory: expansion hires already recommended this session. Does not write world-state. */
  recommendedHireIds = new Set<string>();
  npcEmotions: Record<string, AldricEmotion> = {
    steward: "respectful",
    smith: "neutral",
    chaplain: "neutral",
    negotiator: "neutral",
  };
  meter = new LlmMeterStore("rfab");

  constructor(state: WorldState, saveDir: string, settings: AppSettings, opts?: { resetUsage?: boolean }) {
    this.state = state;
    this.saveDir = saveDir;
    this.settings = settings;
    this.meter.setProvider(settings.provider);
    if (opts?.resetUsage) this.meter.reset();
    else this.loadUsage();
    if (!this.state.agriculture) {
      this.state.agriculture = { springBarleyShare: 0.6, autumnWheatShare: 0.45 };
    }
    ensureGerulfInHousehold(this.state);
    this.speakIntroIfNeeded("steward");
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
      messages: messagesForScene(this.messages, this.sceneNpcId),
      sceneNpcId: this.sceneNpcId,
      labour: { pool: labourPool(this.state), remaining: labourRemaining(this.state) },
      smithAvailable: this.smithAvailable(),
      chaplainAvailable: this.chaplainAvailable(),
      merchantAvailable: this.merchantAvailable(),
      sceneEmotion: this.npcEmotions[this.sceneNpcId] ?? "neutral",
      historyTail: this.historyTail.slice(-30),
      llmMeter: this.meter.snapshot(),
    };
  }

  persist() {
    try {
      saveWorldState(path.join(this.saveDir, "world-state.json"), this.state);
    } catch {
      /* ignore */
    }
    this.persistUsage();
  }

  private usagePath() {
    return path.join(this.saveDir, "llm-usage.json");
  }

  private loadUsage() {
    try {
      const file = this.usagePath();
      if (!fs.existsSync(file)) return;
      this.meter.loadSave(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
    } catch {
      /* ignore */
    }
  }

  private persistUsage() {
    try {
      fs.mkdirSync(this.saveDir, { recursive: true });
      fs.writeFileSync(this.usagePath(), JSON.stringify(this.meter.usedThisSave, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }

  async refreshCredits(): Promise<void> {
    this.meter.setProvider(this.settings.provider);
    const report = await fetchProviderBalance(this.settings);
    this.meter.setProvider(report.provider);
    if (report.skipped || report.failed) return;
    this.meter.applyBalance(report.remainingKnown ? report.remaining : undefined, report.provider);
  }

  private noteLlmUsage() {
    this.meter.setProvider(this.settings.provider);
    this.meter.applyCall(consumeLastLlmCall());
    this.persistUsage();
  }

  private async finishTalk(): Promise<DialogueResult> {
    await this.refreshCredits();
    return this.view();
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
    if (specialistById(npcId) && !this.state.npcs.some((n) => n.id === npcId)) return this.view();
    if (!this.state.npcs.some((n) => n.id === npcId) && npcId !== "merchant") return this.view();
    this.sceneNpcId = npcId;
    this.speakIntroIfNeeded(npcId);
    return this.view();
  }

  log(actor: string, kind: "APPLY" | "REJECT" | "EVENT" | "CHAT" | "SEASON", summary: string) {
    const line = appendHistory(this.saveDir, this.state, actor, kind, summary);
    this.historyTail.push(line);
  }

  npcName(id: string): string {
    return this.state.npcs.find((n) => n.id === id)?.name ?? id;
  }

  /** Engine-authored first meeting. Once per save (merchants: once per visitor name). */
  private speakIntroIfNeeded(npcId: string) {
    const text = introSpeechFor(npcId, this.state);
    if (!text || introAlreadySpoken(this.state, npcId)) return;
    markIntroSpoken(this.state, npcId);
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text,
      emotion: npcId === "steward" ? "respectful" : (this.npcEmotions[npcId] ?? "neutral"),
      at: new Date().toISOString(),
    });
  }

  async sendDialogue(npcId: string, playerText: string): Promise<DialogueResult> {
    if (npcId === "merchant" && !this.merchantAvailable()) {
      this.sceneNpcId = "steward";
      return { ...this.view(), error: "The merchant has left the district." };
    }
    if (specialistById(npcId) && !this.state.npcs.some((n) => n.id === npcId)) {
      this.sceneNpcId = "steward";
      return { ...this.view(), error: "That craftsman is not of this house." };
    }
    this.sceneNpcId = npcId;
    this.speakIntroIfNeeded(npcId);
    this.messages.push({
      id: newId("msg"),
      role: "player",
      npcId,
      text: playerText,
      at: new Date().toISOString(),
    });
    this.log("player", "CHAT", `${npcId}: ${playerText.slice(0, 120)}`);

    const speechSystem = npcSystemPrompt(npcId, this.state, { speechOnly: true });
    const system = npcSystemPrompt(npcId, this.state);
    const extra =
      npcId === "merchant"
        ? "You are visiting only this season. Request the merchant drawer if you need cart stock. Buy only from that stock. Sell any estate resource except denarii."
        : undefined;
    const scrapUser = npcUserPrompt(this.state, npcId, playerText, extra);
    const order = looksLikeMechanicalOrder(playerText, npcId);
    try {
      const spoken = await this.callLlm(
        [{ role: "system", content: speechSystem }, { role: "user", content: `${scrapUser}\n\n${SPEECH_PASS_HINT}` }],
        800,
        { requireProposals: false, allowRepair: false },
      );

      const tool = parseToolRequest(spoken.raw);
      if (tool.malformed) {
        throw new Error(INCOMPLETE_MODEL_JSON);
      }

      let fetched: ToolDrawer[] = [];
      let drawers: Record<string, unknown> | undefined;
      let answer = spoken;

      if (tool.requested) {
        this.pushCheckRecords(npcId);
        fetched = tool.drawers;
        drawers = collectDrawers(this.state, fetched, npcId);
        try {
          answer = await this.callLlm(
            [
              { role: "system", content: speechSystem },
              { role: "user", content: scrapUser },
              { role: "assistant", content: spoken.raw },
              { role: "user", content: `${npcFactsFollowUp(playerText, drawers)}\n\n${SPEECH_PASS_HINT}` },
            ],
            800,
            { requireProposals: false, allowRepair: false },
          );
          if (parseToolRequest(answer.raw).malformed) {
            throw new Error(INCOMPLETE_MODEL_JSON);
          }
        } catch (err) {
          this.noteTalkFailure(err, npcId);
          return this.finishTalk();
        }
      }

      if (!order) {
        this.pushNpcSpeech(npcId, answer);
        return this.finishTalk();
      }

      try {
        const booksUser = npcUserPrompt(this.state, npcId, playerText, extra, drawers);
        const booksMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: system },
          { role: "user", content: booksUser },
          { role: "assistant", content: answer.raw },
          { role: "user", content: npcBooksFollowUp(playerText) },
        ];
        let books = await this.callLlm(booksMessages, 900, {
          requireProposals: true,
          allowRepair: true,
          repairHint:
            "The lord gave an order that must change the ledger. proposals was empty or invalid. Emit at least one proposal (assign_labour, start_project, adjust_sowing, transfer_resources, add_modifier, set_standing_order, register_npc, or start_hunt) with real numbers.",
        });

        const missing = missingCitedDrawers(books.proposals, fetched);
        if (missing.length) {
          const repairFacts = collectDrawers(this.state, missing, npcId);
          books = await this.callLlm(
            [
              ...booksMessages,
              { role: "assistant", content: books.raw },
              repairPrompt(
                books.raw,
                ["Proposals cited stores or land that were not in the facts you were given."],
                `The engine fetched these missing drawers. Use only these numbers. Do not emit tool markers.\n${JSON.stringify(repairFacts)}`,
              ),
            ],
            900,
            { requireProposals: true, allowRepair: false },
          );
        }

        this.pushNpcSpeech(npcId, answer);
        this.ingestParsedDialogue(npcId, books, playerText);
        return this.finishTalk();
      } catch (err) {
        this.noteTalkFailure(err, npcId);
        return this.finishTalk();
      }
    } catch (err) {
      this.noteTalkFailure(err, npcId);
      return this.finishTalk();
    }
  }

  private pushNpcSpeech(
    npcId: string,
    spoken: { speech: string; chronicle?: string; emotion?: AldricEmotion },
  ) {
    if (spoken.emotion && PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = spoken.emotion;
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: stripToolMarkers(spoken.speech),
      chronicle: spoken.chronicle,
      emotion: PORTRAIT_NPCS.has(npcId) ? spoken.emotion ?? this.npcEmotions[npcId] : undefined,
      at: new Date().toISOString(),
    });
    if (npcId === "steward") this.flushHireRecommendations();
  }

  /** Engine string in the NPC's mouth — never a Books line, never a model call. */
  private pushCheckRecords(npcId: string) {
    if (PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: CHECK_RECORDS_LINE,
      emotion: PORTRAIT_NPCS.has(npcId) ? "thoughtful" : undefined,
      at: new Date().toISOString(),
    });
  }

  /** Engine string only — never call the model to apologize. */
  private noteTalkFailure(err: unknown, npcId: string) {
    if (isHoldAtOnceFailure(err)) {
      this.pushHoldAtOnceApology(npcId);
      return;
    }
    this.ledgerNote(booksHearFailureLine(this.npcName(npcId)), npcId);
  }

  /** Spoken by the NPC they were talking to — not a Books line. */
  private pushHoldAtOnceApology(npcId: string) {
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: HOLD_AT_ONCE_APOLOGY,
      emotion: PORTRAIT_NPCS.has(npcId) ? this.npcEmotions[npcId] : undefined,
      at: new Date().toISOString(),
    });
  }

  queueProposal(npcId: string, proposal: MechanicalProposal) {
    const filled = fillProposalDefaults(this.state, proposal);
    this.pending.push({
      id: filled.id ?? newId("prop"),
      npcId,
      proposal: { ...filled, id: filled.id },
      status: "pending",
    });
  }

  /** Testable: parse result → pending queue and ledger notes. Does not call the model. */
  ingestParsedDialogue(
    npcId: string,
    parsed: { proposals: MechanicalProposal[]; parseErrors: string[]; incomplete?: boolean },
    playerText: string,
  ) {
    if (parsed.incomplete) return;
    if (npcId === "steward") this.flushHireRecommendations();
    let proposals = dropHuntFeeDuplicates(dropHireFeeDuplicates(parsed.proposals.map(ensureSummary)));
    if (isNegotiatorId(npcId)) {
      proposals = proposals.filter((p) => p.type === "start_hunt").map((p) => (p.type === "start_hunt" ? normalizeHuntProposal(this.state, p) : p));
    }
    proposals = this.dropLockedOrUnauthorizedHires(npcId, proposals);
    let fromEngine = false;
    if (!proposals.length) {
      const inferred = inferOrderProposals(this.state, npcId, playerText);
      if (inferred.length) {
        proposals = inferred;
        fromEngine = true;
      }
    }
    for (const p of proposals) this.queueProposal(npcId, p);
    if (proposals.length) {
      const n = proposals.length;
      this.ledgerNote(
        fromEngine
          ? `The chronicler returned no valid ledger change. ${n} proposal${n === 1 ? " was" : "s were"} drafted from your order — Confirm writes them in the books.`
          : `${n} proposed ledger change${n === 1 ? "" : "s"} await Confirm. Nothing is written to the books until then.`,
        npcId,
      );
      return;
    }
    if (parsed.parseErrors.length) {
      this.ledgerNote(`No mechanical change was applied (${parsed.parseErrors[0]}). The books are unchanged.`, npcId);
      return;
    }
    if (looksLikeMechanicalOrder(playerText, npcId)) {
      const why = cannotFulfillReason(this.state, npcId, playerText);
      this.ledgerNote(
        why
          ? `No mechanical change was proposed. ${why}`
          : "No mechanical change was proposed. The reply was speech only; the ledger is unchanged. Give a concrete order (sow, start a work, give stores, assign labour, blessing, hire a craftsman) or Advance season.",
        npcId,
      );
    }
  }

  /** Engine-authored Aldric lines when an expansion hire first unlocks. Chat only; does not write the ledger. */
  flushHireRecommendations(fresh?: ReturnType<typeof recommendableHires>) {
    const toSpeak = (fresh ?? recommendableHires(this.state)).filter(
      (s) => !this.recommendedHireIds.has(s.id) && !specialistAlreadyPresent(this.state, s),
    );
    for (const spec of toSpeak) {
      if (this.recommendedHireIds.has(spec.id)) continue;
      this.recommendedHireIds.add(spec.id);
      this.npcEmotions.steward = "thoughtful";
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: "steward",
        npcName: this.npcName("steward"),
        text: spec.recommendSpeech,
        emotion: "thoughtful",
        at: new Date().toISOString(),
      });
    }
  }

  private dropLockedOrUnauthorizedHires(npcId: string, proposals: MechanicalProposal[]): MechanicalProposal[] {
    const kept: MechanicalProposal[] = [];
    for (const p of proposals) {
      if (p.type !== "register_npc") {
        kept.push(p);
        continue;
      }
      if (isEstateSmithNpc(p.npc)) {
        this.ledgerNote("Bernard already keeps the forge. He is not for hire.", npcId);
        continue;
      }
      const spec = matchHireableSpecialist(p.npc);
      if (!spec) {
        kept.push(p);
        continue;
      }
      if (npcId !== "steward") {
        this.ledgerNote("Aldric the steward keeps the household books and seeks craftsmen. Speak to him of hiring.", npcId);
        continue;
      }
      const blocked = specialistHireBlocked(this.state, spec);
      if (blocked) {
        this.ledgerNote(blocked, npcId);
        continue;
      }
      kept.push(p);
    }
    return kept;
  }

  private ledgerNote(text: string, npcId: string) {
    this.messages.push({
      id: newId("msg"),
      role: "system",
      npcId,
      text,
      at: new Date().toISOString(),
    });
  }

  confirmProposal(id: string): GameView & { error?: string } {
    const item = this.pending.find((p) => p.id === id && p.status === "pending");
    if (!item) return { ...this.view(), error: "No such pending proposal." };
    const before = cloneState(this.state);
    const result = applyProposal(this.state, item.proposal, item.npcId);
    this.state = result.state;
    item.status = result.ok ? "applied" : "rejected";
    item.rejectReason = result.reason;
    if (result.ok && item.proposal.type === "register_npc") {
      const spec = matchHireableSpecialist(item.proposal.npc);
      if (spec) this.npcEmotions[spec.id] = this.npcEmotions[spec.id] ?? "neutral";
    }
    this.log(item.npcId, result.ok ? "APPLY" : "REJECT", result.ok ? result.logLine : result.reason ?? result.logLine);
    this.ledgerNote(result.ok ? `Done: ${result.logLine}` : `Cannot be made so: ${result.reason}`, item.npcId);
    if (result.ok) {
      recordConfirmedTransaction(this.state, item.npcId, item.proposal, result.logLine);
      this.flushHireRecommendations(newlyUnlockedHires(before, this.state));
    }
    return this.view();
  }

  rejectProposal(id: string): GameView {
    const item = this.pending.find((p) => p.id === id && p.status === "pending");
    if (item) {
      item.status = "rejected";
      item.rejectReason = "Player rejected";
      this.log(item.npcId, "REJECT", item.proposal.summary);
      this.ledgerNote(`You declined: ${item.proposal.summary}`, item.npcId);
    }
    return this.view();
  }

  async advanceSeason(): Promise<SeasonResult> {
    const effects: SeasonEffectLine[] = [];
    this.pending = this.pending.map((p) => (p.status === "pending" ? { ...p, status: "rejected" as const, rejectReason: "Season advanced" } : p));

    const beforeSeason = cloneState(this.state);
    const ledgerBefore = snapshotSeasonLedger(beforeSeason);
    effects.push(...resolveAgricultureAndProjects(this.state));
    this.speakHuntReturns();
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
    const hireNote = hireRecommendationNote(newlyUnlockedHires(beforeSeason, this.state));
    try {
      const parsed = await this.callLlm(
        [
          { role: "system", content: refereeSystemPrompt() },
          {
            role: "user",
            content: seasonUserPrompt(
              this.state,
              rolled.map((e) => ({ id: e.id, resolvedText: e.resolvedText, polarity: e.polarity, category: e.category })),
              engineLines,
              merchantNote,
              hireNote,
              diffSeasonLedger(ledgerBefore, this.state),
            ),
          },
        ],
        2000,
        {
          requireProposals: true,
          repairHint:
            "Each rolled event MUST have an event_effect that changes numbers (resource+amount+direction, moodDelta, or nested proposals). Flavour-only event_effect is not enough.",
        },
      );
      this.applySeasonProposals(parsed.proposals, rolled, effects);

      const clock = finishSeasonClock(this.state);
      effects.push(...clock);
      writeLastSeasonDeltas(this.state, ledgerBefore);
      this.log("engine", "SEASON", `Now ${this.state.meta.season} ${this.state.meta.year}`);
      if (parsed.emotion) this.npcEmotions.steward = parsed.emotion;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: "steward",
        npcName: this.npcName("steward"),
        text: parsed.speech,
        chronicle: parsed.chronicle,
        emotion: parsed.emotion ?? this.npcEmotions.steward,
        at: new Date().toISOString(),
      });
      this.flushHireRecommendations(newlyUnlockedHires(beforeSeason, this.state));
      this.pushSeasonLedger(effects, parsed.parseErrors);
      this.sceneNpcId = "steward";
      await this.refreshCredits();
      return { ...this.view(), effects };
    } catch (err) {
      for (const ev of rolled) this.applyEventStub(ev, effects, "Default effect (no model)");
      effects.push(...finishSeasonClock(this.state));
      writeLastSeasonDeltas(this.state, ledgerBefore);
      if (isHoldAtOnceFailure(err)) {
        this.pushHoldAtOnceApology("steward");
      } else {
        this.messages.push({
          id: newId("msg"),
          role: "system",
          npcId: "steward",
          text: "Season advanced with the engine's own figures. The chronicler could not be heard.",
          chronicle: effects.map((e) => e.text).join("\n"),
          at: new Date().toISOString(),
        });
      }
      this.flushHireRecommendations(newlyUnlockedHires(beforeSeason, this.state));
      this.pushSeasonLedger(effects);
      this.sceneNpcId = "steward";
      await this.refreshCredits();
      return { ...this.view(), effects };
    }
  }

  /** Testable: referee JSON → auto-applied event effects + stubs for anything without numbers. */
  applySeasonProposals(proposals: MechanicalProposal[], rolled: RolledEvent[], effects: SeasonEffectLine[]) {
    const covered = new Set<string>();
    for (const raw of proposals.map(ensureSummary)) {
      const p = stripSeasonHires(raw, effects);
      if (!p) continue;
      if (p.type !== "event_effect") {
        const wrapped: MechanicalProposal = {
          type: "event_effect",
          eventId: rolled[0]?.id ?? "season",
          summary: p.summary,
          nested: [p],
        };
        const r = applyProposal(this.state, wrapped, "referee");
        this.state = r.state;
        effects.push({ kind: r.ok ? "apply" : "reject", text: r.ok ? r.logLine : r.reason ?? r.logLine });
        this.log("referee", r.ok ? "APPLY" : "REJECT", r.logLine);
        continue;
      }
      if (!eventEffectHasMechanics(p)) {
        effects.push({ kind: "info", text: `Flavour only for ${p.eventId}; using the default numeric effect.` });
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
      this.applyEventStub(ev, effects, "Default effect");
    }
  }

  private speakHuntReturns() {
    for (const report of pendingHuntReports(this.state)) {
      this.npcEmotions[NEGOTIATOR_ID] = report.emotion;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: NEGOTIATOR_ID,
        npcName: this.npcName(NEGOTIATOR_ID),
        text: report.text,
        emotion: report.emotion,
        at: new Date().toISOString(),
      });
    }
  }

  private applyEventStub(ev: RolledEvent, effects: SeasonEffectLine[], label: string) {
    const stub = defaultEventStub(ev, this.state);
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
    effects.push({ kind: r.ok ? "apply" : "reject", text: `${label}: ${r.logLine}` });
    this.log("referee", r.ok ? "APPLY" : "REJECT", `${label}: ${r.logLine}`);
  }

  private pushSeasonLedger(effects: SeasonEffectLine[], parseErrors?: string[]) {
    const lines = effects.filter((e) => e.kind === "apply" || e.kind === "info" || e.kind === "event").map((e) => e.text);
    const extra = parseErrors?.length ? `\nChronicler parse: ${parseErrors[0]}` : "";
    this.ledgerNote(`Season written to the books:\n${lines.join("\n")}${extra}`, "steward");
  }

  private async callLlm(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    maxTokens: number,
    opts?: { requireProposals?: boolean; repairHint?: string; allowRepair?: boolean },
  ): Promise<{
    speech: string;
    chronicle?: string;
    proposals: MechanicalProposal[];
    raw: string;
    emotion?: AldricEmotion;
    parseErrors: string[];
  }> {
    const raw1 = await this.llmRaw(messages, { maxTokens });
    let parsed = parseLlmResponse(raw1);
    if (parsed.incomplete) {
      throw new Error(INCOMPLETE_MODEL_JSON);
    }
    const allowRepair = opts?.allowRepair !== false;
    const needsRepair =
      allowRepair &&
      ((parsed.parseErrors.length > 0 && parsed.proposals.length === 0) ||
        (Boolean(opts?.requireProposals) && parsed.proposals.length === 0));
    if (needsRepair) {
      const errors = parsed.parseErrors.length
        ? parsed.parseErrors
        : ["proposals was empty but this turn must change the ledger."];
      const raw2 = await this.llmRaw(
        [...messages, { role: "assistant", content: raw1 }, repairPrompt(raw1, errors, opts?.repairHint)],
        {
          maxTokens,
          temperature: 0.2,
        },
      );
      parsed = parseLlmResponse(raw2);
      if (parsed.incomplete) {
        throw new Error(INCOMPLETE_MODEL_JSON);
      }
      return {
        speech: playerFacingNpcSpeech(raw2, parsed.response.speech),
        chronicle: parsed.response.chronicle,
        proposals: parsed.proposals.map(ensureSummary),
        raw: raw2,
        emotion: parsed.emotion,
        parseErrors: parsed.parseErrors,
      };
    }
    return {
      speech: playerFacingNpcSpeech(raw1, parsed.response.speech),
      chronicle: parsed.response.chronicle,
      proposals: parsed.proposals.map(ensureSummary),
      raw: raw1,
      emotion: parsed.emotion,
      parseErrors: parsed.parseErrors,
    };
  }

  private async llmRaw(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    try {
      return await llmChat(this.settings, messages, opts);
    } finally {
      this.noteLlmUsage();
    }
  }
}

/** Full store stays on the controller; the view only shows the active scene. */
export function messagesForScene(messages: ChatMessage[], sceneNpcId: string): ChatMessage[] {
  return messages.filter((m) => m.npcId === sceneNpcId);
}

function ensureSummary(p: MechanicalProposal): MechanicalProposal {
  if (p.summary) return p;
  return { ...p, summary: p.type };
}

function fillProposalDefaults(state: WorldState, p: MechanicalProposal): MechanicalProposal {
  if ((p.type === "start_project" || p.type === "adjust_sowing") && !p.holdingId) {
    return { ...p, holdingId: state.holdings[0]?.id };
  }
  if (p.type === "register_npc") {
    const spec = matchHireableSpecialist(p.npc);
    if (spec) {
      return {
        ...p,
        npc: specialistNpc(spec, p.npc.location || state.holdings[0]?.id || "fontenay"),
        summary: p.summary && p.summary !== p.type ? p.summary : hireSummary(spec),
      };
    }
  }
  if (p.type === "start_hunt") {
    return normalizeHuntProposal(state, p);
  }
  return p;
}

function isSpecialistHireProposal(p: MechanicalProposal | unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const rec = p as { type?: string; npc?: { id?: string; name?: string; role?: string } };
  return rec.type === "register_npc" && Boolean(matchHireableSpecialist(rec.npc ?? {}));
}

function stripSeasonHires(p: MechanicalProposal, effects: SeasonEffectLine[]): MechanicalProposal | null {
  if (isSpecialistHireProposal(p)) {
    effects.push({
      kind: "info",
      text: "Hiring waits on Confirm with Aldric; the season report cannot take a person into the household.",
    });
    return null;
  }
  if (p.type === "event_effect" && p.nested?.some(isSpecialistHireProposal)) {
    effects.push({
      kind: "info",
      text: "Hiring waits on Confirm with Aldric; the season report cannot take a person into the household.",
    });
    const nested = p.nested.filter((n) => !isSpecialistHireProposal(n));
    return { ...p, nested };
  }
  return p;
}

function hireRecommendationNote(fresh: ReturnType<typeof newlyUnlockedHires>): string | undefined {
  if (!fresh.length) return undefined;
  const names = fresh.map((s) => `${s.name} the ${s.role.replaceAll("_", " ")}`).join("; ");
  return `HIRE RECOMMENDATION (speech only; do NOT emit register_npc): ${names}. The lord must ask Aldric and Confirm.`;
}

function dropHireFeeDuplicates(proposals: MechanicalProposal[]): MechanicalProposal[] {
  const hires = proposals.filter((p) => p.type === "register_npc" && matchHireableSpecialist(p.npc));
  if (!hires.length) return proposals;
  const grainHire = hires.some((p) => {
    if (p.type !== "register_npc") return false;
    const spec = matchHireableSpecialist(p.npc);
    return Boolean(spec && specialistHireGrainRation(spec) > 0);
  });
  return proposals.filter((p) => {
    if (
      p.type === "transfer_resources" &&
      p.resource === "denarii" &&
      (p.direction === "consume" || p.direction === "buy")
    ) {
      return false;
    }
    if (
      grainHire &&
      p.type === "transfer_resources" &&
      (p.resource === "rye" || p.resource === "wheat" || p.resource === "barley" || p.resource === "oats") &&
      p.direction === "consume"
    ) {
      return false;
    }
    return true;
  });
}

function dropHuntFeeDuplicates(proposals: MechanicalProposal[]): MechanicalProposal[] {
  if (!proposals.some((p) => p.type === "start_hunt")) return proposals;
  return proposals.filter((p) => {
    if (
      p.type === "transfer_resources" &&
      p.resource === "denarii" &&
      (p.direction === "consume" || p.direction === "buy")
    ) {
      return false;
    }
    return true;
  });
}

function openingSpeech(state: WorldState): string {
  const h = state.holdings[0];
  const land = h?.land;
  const features = h?.features ?? [];
  const overgrown = (land?.scrub ?? 0) + (land?.waste ?? 0) + (land?.swamp ?? 0);
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
  return `My lord. It is ${state.meta.season} in the year ${state.meta.year}, at ${state.meta.region}. The villa holds ${land?.fertile_arable ?? 0} acres of arable — and ${overgrown} acres of scrub, waste, and swamp beside it, still yours to clear — ${state.population.households} households, and ${state.resources.denarii} denarii in the chest. ${sowing} The hall is timber, and tired; the barn beside it is sound enough.${forge}${church} I am Aldric, your steward. Say how you would have the land kept, or I will keep it as custom requires. When you wish the season to turn, give the word.`;
}

export function snapshotState(controller: GameController): WorldState {
  return cloneState(controller.state);
}
