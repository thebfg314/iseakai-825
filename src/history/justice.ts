import justiceFile from "../../data/history/justice.json";
import { applyRenown } from "../combat/renown";
import { createRng, seedFromString } from "../combat/rng";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { rollRenownBand } from "./effects";
import { applyFlagOp } from "./flags";
import type { SeasonAt } from "./scheduler";
import { JusticeFileSchema, type HistoryState, type JusticeCase, type JusticeFile, type JusticeStance, type JusticeTable, type JusticeVerdict } from "./schema";
import { shockTrade } from "./trade";
import { moveVassalMood } from "./vassals";

/**
 * Justice (rank design 'Justice'; 03_HISTORY §10b). Not an income line: a lever that pays in
 * money and reputation in opposite directions. One or two cases a year, on average, come before
 * the lord, never more than one a season and none by obligation — a quiet year is a villa that
 * behaved, and the rest were small and the reeve settled them. Aldric brings
 * the case (Ermenald one with the church in it), the lord judges it in talk, and the speaker
 * emits `justice_verdict` from the closed list; a case left two seasons goes by default.
 *
 * From Count the lord also sets a stance for the officers who judge in his name: lenient, fair,
 * strict or extortionate. It scales the pleas' fines (revenue.ts), moves the people's loyalty
 * each year, and — at extortionate — draws the king's missi, who fine the court that profited.
 */

export type Justice = HistoryState["justice"];
export type JusticeTick = { beats: HistoryBeat[]; lines: string[]; opened: string | null };

let cached: JusticeFile | null = null;
export function justiceTable(): JusticeFile {
  if (!cached) cached = JusticeFileSchema.parse(justiceFile);
  return cached;
}

const SPEAKER_NAMES = { steward: "Aldric", chaplain: "Ermenald" } as const;
const KEEP_VERDICTS = 8;
const FAIRNESS_CAP = 12;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function rankOf(state: WorldState): number {
  return state.player.rankLevel ?? 1;
}

export function justiceState(state: WorldState): Justice {
  return state.history.justice;
}

export function justiceCase(id: string): JusticeCase | undefined {
  const t = justiceTable().tables;
  return [...t.villa, ...t.county, ...t.duke].find((c) => c.id === id);
}

export function tableOf(id: string): JusticeTable | null {
  const t = justiceTable().tables;
  if (t.villa.some((c) => c.id === id)) return "villa";
  if (t.county.some((c) => c.id === id)) return "county";
  if (t.duke.some((c) => c.id === id)) return "duke";
  return null;
}

/** The lord sets a stance only once he holds a county. */
export function stanceApplies(state: WorldState): boolean {
  return rankOf(state) >= 3;
}

/** The pleas' fines scale with the stance (revenue.ts reads this). */
export function stanceFinesFactor(state: WorldState): number {
  if (!stanceApplies(state)) return 1;
  return justiceTable().stances[justiceState(state).stance]?.fines ?? 1;
}

export function fairnessWord(fairness: number): string {
  if (fairness >= 6) return "known far about as a just lord";
  if (fairness >= 3) return "thought a fair judge";
  if (fairness <= -6) return "feared as a judge who sells his verdicts";
  if (fairness <= -3) return "thought a hard and partial judge";
  return "not yet known one way or the other as a judge";
}

/** Which table the season's case draws from: a duke's second case in a year is a county matter. */
export function tableFor(state: WorldState): JusticeTable {
  const r = rankOf(state);
  if (r <= 2) return "villa";
  if (r === 3) return "county";
  return justiceState(state).casesThisYear === 0 ? "duke" : "county";
}

function pickCase(state: WorldState, table: JusticeTable, turn: number): JusticeCase | null {
  const j = justiceState(state);
  const all = justiceTable().tables[table];
  let pool = all.filter((c) => !j.heard.includes(c.id));
  if (!pool.length) {
    // The table is spent: open it again, keeping only the other tables' marks.
    const ids = new Set(all.map((c) => c.id));
    j.heard = j.heard.filter((id) => !ids.has(id));
    pool = all;
  }
  if (!pool.length) return null;
  const rng = createRng(seedFromString(`${state.meta.region}:justice:pick:${turn}`));
  return pool[rng.int(0, pool.length - 1)];
}

/**
 * Whether a case comes this season: a roll in a quiet season, at most two a year, never two in a
 * season, and none forced — a year with no case is a villa that behaved, not a rule unmet.
 */
export function caseDue(state: WorldState, _at: SeasonAt, turn: number, quiet: boolean): boolean {
  const j = justiceState(state);
  const cadence = justiceTable().cadence;
  if (j.open) return false;
  if (state.history.dead || state.history.away) return false;
  if (state.battle_call) return false;
  if (j.casesThisYear >= cadence.perYearMax) return false;
  if (!quiet) return false;
  const rng = createRng(seedFromString(`${state.meta.region}:justice:due:${turn}`));
  return rng.chance(cadence.chancePerSeason);
}

/** The speaker's opening for the case: the framing line at Count and above, then the case itself. */
export function caseText(c: JusticeCase, table: JusticeTable): string {
  const framing = justiceTable().framing;
  if (table === "county") return `${framing.county} ${c.text}`;
  if (table === "duke") return `${framing.duke} ${c.text}`;
  return c.text;
}

/** Bring a case before the hall. Returns the speaker's beat. */
export function openCase(state: WorldState, c: JusticeCase, table: JusticeTable, turn: number): HistoryBeat {
  const j = justiceState(state);
  j.open = { caseId: c.id, table, speaker: c.speaker, openedTurn: turn, deadlineTurn: turn + justiceTable().cadence.deadlineSeasons - 1 };
  j.casesThisYear += 1;
  if (!j.heard.includes(c.id)) j.heard.push(c.id);
  return { npcId: c.speaker, eventId: `justice:${c.id}`, text: caseText(c, table) };
}

export type VerdictResult = { ok: boolean; reason?: string; lines: string[] };

/**
 * The lord's judgement on the open case. Fines to the chest (or paid out), fairness, the people,
 * the church, the sworn men, renown, the missi's notice; an unsettled quarrel becomes a feud.
 */
export function applyVerdict(state: WorldState, caseId: string, verdictId: string, at: SeasonAt, turn: number, opts?: { byDefault?: boolean }): VerdictResult {
  const j = justiceState(state);
  if (!j.open || j.open.caseId !== caseId) return { ok: false, reason: "No such case is before the hall.", lines: [] };
  const c = justiceCase(caseId);
  if (!c) return { ok: false, reason: "No such case is before the hall.", lines: [] };
  const v = c.verdicts.find((x) => x.id === verdictId);
  if (!v) return { ok: false, reason: `The judgement must be one of: ${c.verdicts.map((x) => x.id).join(", ")}.`, lines: [] };
  const lines = applyVerdictEffects(state, c, v, at, turn, `justice:${caseId}:${verdictId}`);
  j.verdicts.push({ caseId: c.id, title: c.title, verdictId: v.id, label: v.label, turn });
  if (j.verdicts.length > KEEP_VERDICTS) j.verdicts.splice(0, j.verdicts.length - KEEP_VERDICTS);
  j.open = null;
  state.history.record.push({
    year: at.year,
    season: at.season,
    text: opts?.byDefault ? `${c.title}: left unjudged; ${v.label.toLowerCase()}.` : `${c.title}: ${v.label.toLowerCase()}.`,
    thread: "justice",
  });
  return { ok: true, lines };
}

function applyVerdictEffects(state: WorldState, c: JusticeCase, v: JusticeVerdict, at: SeasonAt, turn: number, seed: string): string[] {
  const j = justiceState(state);
  const lines: string[] = [];
  if (v.fines > 0) {
    state.resources.denarii = Math.round(state.resources.denarii + v.fines);
    lines.push(`${v.fines} d in fines to the chest.`);
  } else if (v.fines < 0) {
    const paid = Math.min(state.resources.denarii, -v.fines);
    state.resources.denarii = Math.round(state.resources.denarii - paid);
    if (paid > 0) lines.push(`${paid} d paid out of the chest.`);
  }
  j.fairness = clamp(j.fairness + v.fairness, -FAIRNESS_CAP, FAIRNESS_CAP);
  if (v.people) {
    applyPeopleHappinessDelta(state, v.people);
    lines.push(v.people > 0 ? "The people approve the judgement." : "The people mutter at the judgement.");
  }
  if (v.church) {
    applyFlagOp(state, "favor_church", `${v.church > 0 ? "+" : ""}${v.church}`);
    lines.push(v.church > 0 ? "The church approves." : "The church is displeased.");
  }
  if (v.vassals && (state.history.vassals ?? []).length) {
    moveVassalMood(state, v.vassals, `the lord's judgement on ${c.title.toLowerCase()}`, turn);
    lines.push(v.vassals > 0 ? "The sworn men approve." : "The sworn men take it ill.");
  }
  if (v.renown !== undefined) {
    const delta = typeof v.renown === "number" ? v.renown : rollRenownBand(v.renown, `${seed}:renown`);
    if (delta !== 0) {
      state.player.renown = applyRenown(state.player.renown ?? 1, delta);
      lines.push(delta > 0 ? `Renown rises by ${delta}.` : `Renown falls by ${-delta}.`);
    }
  }
  if (v.missi) {
    j.missiAttention += v.missi;
    lines.push("The king's missi will hear of it.");
  }
  if (v.feud) {
    const [lo, hi] = justiceTable().cadence.feudSeasons;
    const rng = createRng(seedFromString(`${seed}:feud`));
    j.feuds.push({ caseId: c.id, title: c.title, dueTurn: turn + rng.int(lo, hi) });
    lines.push("Nothing is settled; the quarrel will come back.");
  }
  return lines;
}

/** A case left unjudged past its deadline goes by default: the refusal if the table has one, else a plain lapse. */
function lapseCase(state: WorldState, at: SeasonAt, turn: number, out: JusticeTick): void {
  const j = justiceState(state);
  if (!j.open || turn <= j.open.deadlineTurn) return;
  const c = justiceCase(j.open.caseId);
  if (!c) {
    j.open = null;
    return;
  }
  const refuse = c.verdicts.find((v) => v.id === "refuse");
  if (refuse) {
    const r = applyVerdict(state, c.id, refuse.id, at, turn, { byDefault: true });
    out.lines.push(`${c.title} went unjudged; ${refuse.label.toLowerCase()}.`, ...r.lines);
    return;
  }
  // No refusal written: the matter lapses, which is its own small injustice.
  j.fairness = clamp(j.fairness - 1, -FAIRNESS_CAP, FAIRNESS_CAP);
  const [lo, hi] = justiceTable().cadence.feudSeasons;
  const rng = createRng(seedFromString(`justice:lapse:${c.id}:${turn}`));
  j.feuds.push({ caseId: c.id, title: c.title, dueTurn: turn + rng.int(lo, hi) });
  j.verdicts.push({ caseId: c.id, title: c.title, verdictId: "lapsed", label: "Left unjudged", turn });
  if (j.verdicts.length > KEEP_VERDICTS) j.verdicts.splice(0, j.verdicts.length - KEEP_VERDICTS);
  j.open = null;
  state.history.record.push({ year: at.year, season: at.season, text: `${c.title}: left unjudged.`, thread: "justice" });
  out.lines.push(`${c.title} went unjudged; the parties left the hall unsatisfied.`);
}

function tickFeuds(state: WorldState, at: SeasonAt, turn: number, out: JusticeTick): void {
  const j = justiceState(state);
  const due = j.feuds.filter((f) => f.dueTurn <= turn);
  if (!due.length) return;
  j.feuds = j.feuds.filter((f) => f.dueTurn > turn);
  for (const f of due) {
    applyPeopleHappinessDelta(state, -3);
    state.history.record.push({ year: at.year, season: at.season, text: `The quarrel over ${f.title.toLowerCase()} came to blood.`, thread: "justice" });
    out.lines.push(`The quarrel over ${f.title.toLowerCase()}, never settled, has come to blood; the people grow uneasy.`);
    out.beats.push({
      npcId: "steward",
      eventId: `justice:feud:${f.caseId}`,
      text: `My lord, the matter of ${f.title.toLowerCase()} that was never settled has come to blood: a man hurt, a byre burned, and both sides saying the hall would not hear them. It is a feud now, and feuds are not judged; they are outlived.`,
    });
  }
}

function tickStanceYear(state: WorldState, at: SeasonAt, turn: number, out: JusticeTick): void {
  const j = justiceState(state);
  if (!stanceApplies(state)) return;
  if (j.stanceYear === at.year) return;
  const first = j.stanceYear === null;
  j.stanceYear = at.year;
  if (first) return; // The first year the office is held pays nothing: the stance was only just set.
  const s = justiceTable().stances[j.stance];
  if (!s) return;
  if (s.loyaltyPerYear) applyPeopleHappinessDelta(state, s.loyaltyPerYear);
  if (s.church) applyFlagOp(state, "favor_church", `${s.church > 0 ? "+" : ""}${s.church}`);
  if (s.missiPerYear) j.missiAttention += s.missiPerYear;
  if (j.stance === "lenient") {
    const rng = createRng(seedFromString(`${state.meta.region}:justice:disorder:${at.year}`));
    if (rng.chance(0.3)) {
      shockTrade(state, -4, "thieves on the roads under a lenient court", turn, 2);
      out.lines.push("A lenient court: thieves grow bold on the roads this year.");
    }
  }
  // The lord's own record as a judge tells on the people too.
  if (j.fairness >= 3) applyPeopleHappinessDelta(state, 1);
  else if (j.fairness <= -3) applyPeopleHappinessDelta(state, -1);
  out.lines.push(`The courts of the county judged ${j.stance === "extortionate" ? "for the chest" : `${j.stance}ly`} this year in the lord's name (loyalty ${s.loyaltyPerYear >= 0 ? "+" : ""}${s.loyaltyPerYear}).`);
}

function tickMissi(state: WorldState, at: SeasonAt, turn: number, out: JusticeTick): void {
  const j = justiceState(state);
  const m = justiceTable().missi;
  if (j.missiAttention < m.attentionBefore) return;
  j.missiAttention = 0;
  j.missiVisits += 1;
  const fine = Math.round(state.resources.denarii * m.fineShare);
  state.resources.denarii = Math.max(0, state.resources.denarii - fine);
  const renown = rollRenownBand(m.renown, `justice:missi:${turn}`);
  if (renown) state.player.renown = applyRenown(state.player.renown ?? 1, renown);
  state.history.duties.favour += m.favour;
  state.history.record.push({ year: at.year, season: at.season, text: "The king's missi sat in the county and fined the lord's court.", thread: "justice" });
  out.lines.push(`The king's missi came to the county court: ${fine} d taken from the chest, renown ${renown}, the king's favour falls.`);
  out.beats.push({
    npcId: "steward",
    eventId: `justice:missi:${turn}`,
    text: `My lord, the king's missi have sat in the county this season. They heard the complaints against your court — the fines, the compositions kept, the pleas sold — and they have taken ${fine} denarii of it for the king and written the rest in their report. The capitularies say a count keeps a third of the fines and sends the rest; they say we have kept more than a third. I did not argue with them.`,
  });
}

/** Aldric explains the stance once, at the first county. */
function explainStance(state: WorldState, out: JusticeTick): void {
  const j = justiceState(state);
  if (!stanceApplies(state) || j.stanceExplained) return;
  j.stanceExplained = true;
  out.beats.push({
    npcId: "steward",
    eventId: "justice:stance",
    text: "One more thing, my lord, now that you hold a county. You can no longer hear every case yourself — a county has thousands of people. Your officers judge in your name, and how they judge is up to you: lenient, and the people love you and the fines are half; fair, which is the custom; strict, and the chest fills and the people cool; or for the chest outright, which is what the capitularies complain of and what the king's missi are sent to find. I have written the court as fair until you tell me otherwise.",
  });
}

/**
 * The season: feuds come due, the missi come if they have been given cause, an unjudged case
 * lapses, the stance pays its year, and one case may come before the hall.
 */
export function tickJustice(state: WorldState, at: SeasonAt, turn: number, opts: { quiet: boolean }): JusticeTick {
  const out: JusticeTick = { beats: [], lines: [], opened: null };
  if (state.history.dead) return out;
  const j = justiceState(state);
  if (j.year !== at.year) {
    j.year = at.year;
    j.casesThisYear = 0;
  }
  tickFeuds(state, at, turn, out);
  tickStanceYear(state, at, turn, out);
  tickMissi(state, at, turn, out);
  lapseCase(state, at, turn, out);
  explainStance(state, out);
  if (!caseDue(state, at, turn, opts.quiet)) return out;
  const table = tableFor(state);
  const c = pickCase(state, table, turn);
  if (!c) return out;
  out.beats.push(openCase(state, c, table, turn));
  out.opened = c.id;
  out.lines.push(`${SPEAKER_NAMES[c.speaker]} brings a case before the hall: ${c.title.toLowerCase()}.`);
  return out;
}

/** Set the officers' stance (Count+). Returns a refusal or null. */
export function setJusticeStance(state: WorldState, stance: JusticeStance): string | null {
  if (!stanceApplies(state)) return "The lord holds no county; there are no officers to judge in his name.";
  justiceState(state).stance = stance;
  return null;
}

/** The lines for Aldric's and Ermenald's HISTORY block. */
export function justiceLines(state: WorldState, speaker: "steward" | "chaplain"): string[] {
  const j = state.history.justice;
  if (!j) return [];
  const lines: string[] = [];
  if (j.open) {
    const c = justiceCase(j.open.caseId);
    if (c) {
      if (j.open.speaker === speaker) {
        const left = j.open.deadlineTurn - state.meta.turn;
        lines.push(
          `OPEN CASE ${c.id} "${c.title}" (deadline: ${left <= 0 ? "end of this season" : `${left + 1} seasons`}). You brought it; the lord judges it in talk — hear his questions, give him what the parties said, and when he has given judgement emit justice_verdict {caseId:"${c.id}", verdictId} with the one of these his words fit: ${c.verdicts.map((v) => `${v.id} ("${v.label}")`).join(" | ")}. If he will not hear it, that is a judgement too.`,
        );
      } else {
        lines.push(`${SPEAKER_NAMES[j.open.speaker]} has brought a case before the lord (${c.title.toLowerCase()}); it is his to see through.`);
      }
    }
  }
  if (stanceApplies(state) && speaker === "steward") {
    const s = justiceTable().stances[j.stance];
    lines.push(
      `The county's courts judge in the lord's name; the stance is ${s?.word ?? j.stance}. When the lord tells you how his officers should judge, propose set_stance {kind:"justice", stance: lenient|fair|strict|extortionate}; when he sets the tolls on the roads, set_stance {kind:"tolls", stance: low|customary|greedy}.`,
    );
    if (j.missiAttention > 0) lines.push("Word of the court's takings has reached the king's missi.");
  }
  if (j.verdicts.length || j.fairness !== 0) lines.push(`The lord is ${fairnessWord(j.fairness)}.`);
  return lines;
}
