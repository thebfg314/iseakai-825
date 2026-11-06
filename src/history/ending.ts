import type { WorldState } from "../engine/schema";
import { RANK_TITLES } from "../combat/schema";
import { bodyAge, flagInt, flagTruthy, totalManses } from "./flags";
import { marriageEndingLine } from "./marriage";
import { hundredValue, hundredWord } from "./standing";
import { dukeTrackScore } from "./richard";

/**
 * The ending (03_HISTORY §13; scripts "Death of old age"). One screen: the
 * death, then the life, written by the model from the record, not from a
 * template. The engine supplies the facts; `endingFallback` is the chronicle
 * entry used when the model cannot be heard.
 */

export type EndingCause = NonNullable<WorldState["history"]["dead"]>["cause"];

const START_MANSES = 10;

/** Who is left to say it. */
export function endingVoice(state: WorldState): string {
  if (flagTruthy(state, "school_auxerre")) return "the boy he sent to Auxerre, a grown man now and a priest";
  if (flagTruthy(state, "crowned_king") || flagTruthy(state, "duke_by_counter_offer")) return "an old captain of his household";
  if (state.npcs.some((n) => n.id === "chaplain")) return "the priest who followed Ermenald at Fontenay";
  return "a grandson of the house";
}

export function deathParagraphFacts(state: WorldState): string {
  const dead = state.history.dead;
  const age = bodyAge(state, dead?.year ?? state.meta.year);
  const cause = dead?.cause ?? "old_age";
  const where =
    cause === "old_age"
      ? `in his bed at Fontenay, in ${state.meta.season} ${dead?.year ?? state.meta.year}`
      : cause === "battle"
        ? `in the field, ${state.meta.season} ${dead?.year ?? state.meta.year}`
        : cause === "wound"
          ? `of a maiming wound, ${state.meta.season} ${dead?.year ?? state.meta.year}`
          : cause === "execution"
            ? `put to death as a traitor by ${state.history.realm.king ?? "the king"}, ${dead?.year ?? state.meta.year}`
            : cause === "abandoned"
              ? `the last of his people gone, the villa empty, ${dead?.year ?? state.meta.year}`
              : cause === "captivity"
                ? "in his captors' hands"
                : `of a sickness, ${dead?.year ?? state.meta.year}`;
  const maim = state.player.wounds.filter((w) => w.narrativeFlags.includes("maiming")).map((w) => w.location);
  return `How it ended: ${cause.replace("_", " ")}, ${where}, aged about ${age}.${maim.length ? ` Maimings he carried: ${maim.join("; ")}.` : ""} He remembered the emperor Louis, which nobody else living does. He arrived in this world with no kin.`;
}

/**
 * What in this play differs from the historical record. Empty when he changed nothing
 * a chronicle would bother to name. The page should say the difference, or say there is none.
 */
export function divergenceFacts(state: WorldState): string[] {
  const out: string[] = [];
  if (flagTruthy(state, "robert_saved")) out.push("Robert the Strong lived past Brissarthe. In the true record he died there in 866, his helmet off in the heat.");
  if (flagTruthy(state, "bernard_saved")) out.push("Bernard of Septimania lived. In the true record Charles the Bald had him executed in 844, after three rebellions.");
  if (flagTruthy(state, "saved_gaucelm")) out.push("Gaucelm lived through the fall of Chalon. In the true record he was executed there in 834.");
  if (flagTruthy(state, "saved_gerberga")) out.push("Gerberga lived through the fall of Chalon. In the true record she was drowned there as a witch.");
  if (flagTruthy(state, "saved_adalard")) out.push("Count Adalard lived through the sickness of 837. In the true record he died of it.");
  if (flagTruthy(state, "vikings_sent_elsewhere")) out.push("Burgundy was spared the Northmen in 886. In the true record they burned through it.");
  const early = state.history.diffusion.innovations.filter((i) => i.spread !== "own_lands");
  for (const i of early) {
    out.push(`${i.name} is ${i.spread === "kingdom" ? "known across the kingdom" : "known in the country around his lands"}${i.creditedToPlayer ? ", and his name is on it" : ""}. The age he was born into did not have it for centuries.`);
  }
  if (flagTruthy(state, "duke_by_counter_offer")) out.push("Burgundy is a duchy under his house, by the magnates' bargain. In the true record the duchy comes later, and not to a man from one villa in the Morvan.");
  else if (flagTruthy(state, "crowned_king")) out.push("He died a king. No such king sits in the true record.");
  if (!out.length) out.push("Nothing he did turned the record aside. The kings, the deaths and the duchy fell out as they fell out.");
  return out;
}

/** The facts the model writes from. Plain lines, grouped by the scripts' threads. */
export function endingFacts(state: WorldState): string[] {
  const h = state.history;
  const lines: string[] = [];
  const rank = Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
  lines.push(`Station: began a minor noble with one villa; ended ${RANK_TITLES[rank - 1]}${flagTruthy(state, "crowned_king") ? ", elected and crowned king" : ""}${flagTruthy(state, "duke_marquis") ? ", marquis of Burgundy" : ""}${flagTruthy(state, "duke_by_counter_offer") ? ", duke by the magnates' bargain" : ""}. Renown ${Math.round(state.player.renown ?? 1)}.`);
  const manses = totalManses(state);
  lines.push(`Land: ${manses} manses against ${START_MANSES} at the start; tenure ${h.land.tenure}${h.land.charter !== "none" ? `, ${h.land.charter} charter` : ""}${h.land.marriedLocal ? ", married into the district" : ""}${h.land.secondVilla ? ", a second villa" : ""}. Features: ${Array.from(new Set(state.holdings.flatMap((x) => x.features))).join(", ") || "none beyond the hall"}.`);
  const battles = state.battle_history;
  lines.push(`War: ${battles.length ? battles.map((b) => `${b.year} ${b.kind} (${b.tier}): ${b.outcome}`).join("; ") : "no battle of his own is written"}. Summonses answered: ${Object.entries(h.chosen).filter(([, v]) => v === "command" || v === "send_men" || v === "commanded" || v === "sent_men").map(([k]) => k).join(", ") || "none"}.`);
  const saved = ["saved_adalard", "bernard_saved", "robert_saved", "saved_gaucelm", "saved_gerberga"].filter((f) => flagTruthy(state, f));
  if (saved.length) lines.push(`Whom he saved: ${saved.map((s) => s.replace(/^saved_|_saved$/g, "")).join(", ")}.`);
  const loyalty = ["side_830", "pippin_833", "bribed_833", "perjury_833", "lothair_tainted", "fontenoy_charles", "fontenoy_pippin2", "sat_out_841", "oath_kept_lord", "betrayed_pippin2", "warned_pippin2", "richard_vassal", "resisted_880", "boso_sympathy", "side_893", "submitted_to_king", "rebel_king"]
    .filter((f) => h.flags[f] !== undefined && h.flags[f] !== false)
    .map((f) => `${f}=${String(h.flags[f])}`);
  lines.push(`Loyalty (the great choices of 830, 833, 840, 864, 880, 893): ${loyalty.join(", ") || "kept his head down"}.`);
  lines.push(`The land itself: fed the district in ${flagInt(state, "fed_hungry")} famine years, sold at famine prices in ${flagInt(state, "profiteer")}; refugee households taken in: ${flagInt(state, "sheltered_refugees")}; vacant manses now ${state.holdings.reduce((n, x) => n + (x.manses?.vacant ?? 0), 0)}.`);
  const inn = h.diffusion.innovations;
  lines.push(
    `Knowledge: ${inn.length ? inn.map((i) => `${i.name} (${i.spread === "own_lands" ? "stayed on his lands" : i.spread === "region" ? "spread to the region" : "reached the whole kingdom"}${i.writtenDown ? ", written down" : ", never written down"}${i.creditedToPlayer ? "" : ", not remembered as his"})`).join("; ") : "introduced nothing the age did not have, or kept it so close it left no mark"}.`,
  );
  const church = ["relics_held", "relics_returned", "cluny_witness", "lupus_correspondent", "eriugena_met", "school_auxerre", "excommunicated", "absolved_once", "church_enemy", "simony_taint"].filter((f) => flagTruthy(state, f));
  const churchStandingNow = hundredValue(state, "church");
  lines.push(`The Church receives him as ${hundredWord(churchStandingNow)}; ${church.join(", ") || "an ordinary parishioner"}.`);
  const marriage = marriageEndingLine(state);
  lines.push(marriage ?? "Marriage: he never married; no heir of his body stands to follow him.");
  lines.push(`People: household now: ${state.npcs.map((n) => `${n.name} (${n.role})`).join(", ")}.`);
  const duke = dukeTrackScore(state);
  lines.push(`What outlived him: Burgundy under ${h.realm.countOfAutun}${flagInt(state, "richard_standing") > 0 ? ` (Richard took ${flagInt(state, "richard_standing")} of the chances that build a duchy; the lord took ${duke.taken})` : ""}; ${duke.result} King at the end: ${h.realm.king ?? "none"}; emperor: ${h.realm.emperor ?? "none"}.`);
  const maim = state.player.wounds.filter((w) => w.narrativeFlags.includes("maiming"));
  if (maim.length) lines.push(`His body: ${maim.map((w) => w.location).join("; ")}.`);
  lines.push("Where this differs from the true record:");
  lines.push(...divergenceFacts(state).map((l) => `  ${l}`));
  return lines;
}

export function endingRecord(state: WorldState, max = 80): string[] {
  const rec = state.history.record;
  const slice = rec.length > max ? [...rec.slice(0, 20), ...rec.slice(rec.length - (max - 20))] : rec;
  return slice.map((r) => `${r.year} ${r.season}: ${r.text}`);
}

export function endingSystemPrompt(): string {
  return `You write the last page of a chronicle for a game set in Carolingian Burgundy, 825–911. The lord of Fontenay's life is over. Write what the household says of him, in two parts separated by a blank line. Part one: one short paragraph of how it ended, the scene as it happened, not a tally. Part two: three or four paragraphs of the life, drawn ONLY from the record and facts given — his station at the start and at the end, the land, the wars and whom he saved, the great choices of 830, 833, 840, 864 and 880 and what each cost, his people through the famines, what he knew and whether it spread or died with him, the church, who is left in the hall, and what Burgundy is now and whose. Then say plainly where this world differs from the true record (a man who should have died and lived, a burning that did not happen, a thing known centuries early, a duchy under another house), or say plainly that he changed little and the record stands. A chronicle entry, not a scoreboard: no numbers on the page, no lists, no headings. The voice is the person named, looking back at a life that covered the whole collapse of Charlemagne's empire from one villa in the Morvan. Do not invent events the record does not contain. Reply with a single JSON object only: {"speech": "<the death paragraph, a blank line, then the life>", "proposals": []}.`;
}

export function endingUserPrompt(state: WorldState): string {
  return [
    `Voice: ${endingVoice(state)}.`,
    deathParagraphFacts(state),
    "",
    "Facts:",
    ...endingFacts(state).map((l) => `- ${l}`),
    "",
    "The record, dated:",
    ...endingRecord(state).map((l) => `- ${l}`),
  ].join("\n");
}

/** The chronicle entry when the model cannot be heard. Plain, from the same facts. */
export function endingFallback(state: WorldState): { death: string; summary: string } {
  const dead = state.history.dead;
  const age = bodyAge(state, dead?.year ?? state.meta.year);
  const cause = dead?.cause ?? "old_age";
  const death =
    cause === "old_age"
      ? `The lord of Fontenay died in his bed in the ${state.meta.season} of ${dead?.year ?? state.meta.year}, an old man past any age the district had seen. He remembered the emperor Louis, and nobody else living did.`
      : cause === "battle"
        ? `The lord of Fontenay fell in the field in ${dead?.year ?? state.meta.year}, and was carried home to be buried by his own church.`
        : cause === "execution"
          ? `The lord of Fontenay was put to death as a traitor in ${dead?.year ?? state.meta.year}, and there was no kin to speak for him.`
          : cause === "abandoned"
            ? `The lord of Fontenay outlived his people. The villa stood empty in ${dead?.year ?? state.meta.year}, and there was no one left to work it.`
            : cause === "captivity"
              ? `The lord of Fontenay died in his captors' hands, the ransom never gathered.`
              : cause === "wound"
                ? `The lord of Fontenay died of a maiming wound in ${dead?.year ?? state.meta.year}, the hurt having gone bad.`
                : `The lord of Fontenay died of a sickness in ${dead?.year ?? state.meta.year}.`;
  const rank = RANK_TITLES[Math.max(1, Math.min(5, state.player.rankLevel ?? 1)) - 1];
  const manses = totalManses(state);
  const landWord = manses > START_MANSES ? "left the land larger than he found it" : manses < START_MANSES ? "left the land smaller than he found it" : "left the land as he found it";
  const inn = state.history.diffusion.innovations;
  const knowledge = !inn.length
    ? "He brought nothing to the land that the land did not already know, or kept it so close that it went with him."
    : inn.some((i) => i.spread === "kingdom")
      ? "What he knew did not die with him: it is done now across the kingdom by men who never heard his name, and in some places by men who did."
      : inn.some((i) => i.spread === "region")
        ? "What he knew is done now on the estates around his, and nowhere else; whether it lasts is for others to see."
        : "What he knew he kept behind his own walls, and the villa prospered by it, and a generation on it will be a villa like any other.";
  const duke = dukeTrackScore(state);
  const summary = [
    `He came to Fontenay a ${RANK_TITLES[0].toLowerCase()} with one villa, and he died a ${rank.toLowerCase()}. He ${landWord}, held ${state.history.land.tenure === "owned" ? "in his own right" : state.history.land.tenure === "precaria" ? "of the Church for life" : "of his lord"}.`,
    `He lived through the war of the brothers, the Northmen on the rivers, the famines, and the years when the kings ran out. ${state.history.record.filter((r) => r.thread !== "richard" && r.thread !== "knowledge").slice(-3).map((r) => r.text).join(" ")}`,
    knowledge,
    `Burgundy is ${state.history.realm.countOfAutun}'s now. ${duke.result} The king at the end was ${state.history.realm.king ?? "nobody"}, and the empire that was one man's when the lord was young is gone.`,
    divergenceFacts(state).join(" "),
  ].join("\n\n");
  return { death, summary };
}
