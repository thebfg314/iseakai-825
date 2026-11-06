# 03_HISTORY
**Carolingian Minor Noble – Historical Events Layer**
**Version 0.1 – Design document for implementation**

This document turns three design sources into a build plan for the game as it stands in this repo:

| Source | What it holds | Where it lives |
| --- | --- | --- |
| *Isekai 825: Event Delivery Scripts* (Oct 7, 2026) | Every dated event 825–911 with its script, Knows / Doesn't know, hooks and flags; the background systems (natural events, land and value, supply check, royal vassal duties, tributes, minting, escalation ladder, king quest, the ending) | Author's copy; to be added to the repo (see §15) |
| *Isekai 825: Historical Event Arcs, 825–910* (Sep 24, 2026) | Momentum scale, rank tiers, the six crises, eight keystones and their dependent events, exposure by rank, per-arc timelines, quick-reference timeline | Same |
| *Isekai 825: Technology Diffusion Rules* (Oct 23, 2026) | How player-introduced knowledge escapes his lands; legibility / reproduction / proof; accelerators, brakes, espionage; what spread means in play and at the ending | Same |

Where the three disagree, the Delivery Scripts win (they say so themselves about momentum). Where this document disagrees with any of them, this document is wrong unless §2 records the decision.

Battles and rank promotions are **not** in this pass. The user will add the forced battles and the "what happens when the player gains a rank" flow later. This document leaves named hooks for both (§9, §10).

---

## 1. What the layer does

Every season start, the engine checks a dated calendar of historical events. Those that are due and whose requirements hold are **delivered verbatim** through Aldric (political) or Ermenald (religious), posted into their chat tabs with the wants-talk badge, exactly as engine-authored intros and project-completion beats are posted today. The LLM never rewrites a script. It only answers follow-ups, fed that event's Knows and Doesn't-know lists, and it detects when the lord's words amount to one of the event's declared hooks or choices, which it puts on the table as a Confirm card. The engine owns every flag, every coin, every renown point.

Underneath run background systems the scripts describe: forced weather and famine prices, army supply checks, the land and value system, royal vassal duties, Viking danger and tributes, the realm chain (emperor → king → count of Autun), the player's age, the escalation ladder and king quest, technology diffusion, and the closing summary.

---

## 2. Decisions taken (Oct 27, 2026)

These were put to the author before design began. They are binding for this pass.

| Question | Decision |
| --- | --- |
| Scope | **Every event** in the Delivery Scripts is integrated, all nine arcs plus the background systems. Delivery is phased (§14) but nothing is cut. |
| Delivery of the opening script | **Verbatim.** The engine posts the script word-for-word at season start. No LLM call for delivery. |
| Player choices and hooks | **All conversational.** The player speaks; the NPC's LLM judges whether a declared hook or choice was taken and emits a proposal; the engine shows a Confirm card; the flag is written only on Confirm. No choice buttons. |
| Letters, envoys, messengers, the deputy, the count | **Aldric and Ermenald relay everything.** No new speaker, no new portraits. A letter is read by Ermenald; an envoy's words are reported by Aldric ("He said, word for word, …"). Live scenes are narrated by Aldric or Ermenald as the lord's companion on the spot. |
| Battle events and promotion windows | Battles are fought on the grid from the Battle Force Tables (§9, delivered Oct 28). Promotion windows are **skipped until their own pass**: events that *are* a promotion window do not fire; events that lead to them (a summons with a choice) do fire, because later events read their flags. See §10 for the interim behaviour. |
| Land and value system | **Full.** Recorded value, true value, visibility, tenure, and the three outs of 830 with their real costs. |
| Seasons when the lord is away | **Narrative only.** The hall plays as normal; the text says he is away. |
| Momentum | **LLM-judged.** The entry's momentum and its "what the player can change" notes go to the LLM; the LLM proposes an outcome from a closed list the entry declares; the engine applies it. Fixed points carry no alternative outcomes. |
| Random events on a historical season | **Suppressed.** When a dated event fires, the season's random "other" roll is skipped. Forced weather replaces the weather roll in famine years. |
| Content format | **JSON** under `data/history/`, validated by zod at boot like `data/combat/`. |
| Player age | The character is a modern person moved to 825 by an unexplained device (the isekai premise). The game tracks **body age**, 17 in spring 825 by default (`player.ageAt825`, tunable). Death of old age follows the scripts (around 910–911). No birth year is shown to the player. |

---

## 3. Architecture

```
data/history/
  features.json                the switches (§14)
  flags.json                   the flag registry (§4.1)
  events/arc1.json … arc9.json, church.json, economy.json, natural.json, ending.json   dated events
  events/duties.json           D-001…D-010, the royal vassal duty results (rolled events, §6)
  events/quest.json            L-001…L-004 the ladder rungs, Q-001…Q-003 the king quest (rolled events)
  calendar/realm.json          counts of Autun, kings, emperors by year
  tables/forced-weather.json   famine years → forced event + multipliers
  tables/supply-check.json     the army supply appendix
  tables/viking-danger.json    raid chance by year band
  tables/duke-track.json       the opportunity menu and the open-throne factors
  tables/king-quest.json       trigger, strip/ban thresholds, the nine nobles, crown routes

src/history/
  schema.ts        zod schemas for every JSON file above + the state block
  load.ts          loads and validates data at boot; builds the id index; season ordinals
  conditions.ts    the requires/unless expression evaluator
  scheduler.ts     which events are due this season start
  deliver.ts       turns a fired event into chat messages + wantsTalk; engine re-delivery of rolled events
  hooks.ts         applies a confirmed hook/choice/outcome: flags, renown, coin, land, realm
  flags.ts         the flag store API (get/set/add, typed per registry); condition variables
  slots.ts         `{slot}` values in script text and costs (amounts, fees, prices)
  realm.ts         emperor / king / count of Autun by date; oath beats
  age.ts           body age, participation band, death of old age, `markDeath`
  land.ts          recorded value, true value, visibility, tenure, the three outs
  prices.ts        famine multipliers on state.market
  weather.ts       forced weather overrides
  supply.ts        army supply checks and countermeasures
  duties.ts        royal vassal duties roll → delivers D-00n
  vikings.ts       danger bands, winter camps, irregular tactics bookkeeping
  tributes.ts      E-866 / E-877 amounts from manses and rank
  relics.ts        relic upkeep and the return request
  richard.ts       Richard-as-rival: untaken Duke-track opportunities, `richard_standing`
  ladder.ts        the king's escalation ladder state machine
  quest.ts         the king quest (support gathering, battle stub, election)
  diffusion.ts     innovations register, spread timers, espionage
  ending.ts        the life record, the closing-page prompt and its fallback
  promptBlocks.ts  what the NPC and referee prompts receive
  lint.ts          cross-checks: every read flag has a setter; every requires parses; ids unique
```

Integration points in existing code:

| Where | Change |
| --- | --- |
| `src/engine/schema.ts` | Add `history` block to `WorldState` (§4), `ageAt825` on `player`, `manses` on `Holding`. New proposal types (§6). |
| `src/session/game.ts#advanceSeason` | Insert the history pass (§5). Suppress the random other-event when a dated event fired. Pass history lines to the referee prompt. |
| `src/engine/events.ts#rollSeasonEvents` | Accept a forced weather override and a `suppressOther` flag. |
| `src/llm/prompts.ts` | `stewardSystemPrompt` and `chaplainSystemPrompt` gain a **History block** (§7). The output contract lists the new proposal types with their rules. The referee prompt gets the season's fired events as engine lines. |
| `src/engine/applyDelta.ts` | Route the new proposal types to `src/history/hooks.ts`. |
| `src/engine/wantsTalk.ts` | A fired event badges its speaker. Existing clear rules apply. |
| `src/ui` | Minimal: the header shows the year's realm line ("Emperor Louis · King Pippin · Count Bernard of Autun"); the ledger shows history lines. No new panels in this pass. |
| `data/starting-estate.json` | `player.ageAt825: 17`; `holdings[0].manses: { free: 6, servile: 4, vacant: 4 }`; `history` defaults. |

---

## 4. State

Added to `WorldState` as `history`, with zod defaults so old saves load as "nothing has fired yet".

```ts
history: {
  /** Narrative flags. Booleans or small signed integers. Unset = false/0. */
  flags: Record<string, boolean | number>,
  /** Events delivered, with when. An event fires at most once unless `repeat`. */
  fired: Record<string, { year: number; season: Season; turn: number }>,
  /** Events whose season passed while `requires` failed; dropped unless `carry`. */
  dropped: string[],
  /** Open choices awaiting the lord's word, with their deadline. */
  openChoices: { eventId: string; opensTurn: number; deadlineTurn: number }[],
  /** Live scenes in progress: stage index and the turn it opened. */
  scenes: Record<string, { stage: number; openedTurn: number }>,
  /** Choices taken, hooks taken, outcomes judged, per event id. */
  chosen: Record<string, string>, hooksTaken: Record<string, string[]>, outcomes: Record<string, string>,
  openOutcomes: { eventId: string; stageId?: string; opensTurn: number; deadlineTurn: number }[],
  realm: {
    emperor: string | null; king: string | null; kingdom: string;
    countOfAutun: string; countSince: number;
    /** The lord the player has sworn to: "count" | "church" | "king" | "none". */
    swornTo: string;
  },
  land: {
    recordedValue: number;          // 6500 at start
    trueValue: number;              // 12 × yearly income, recomputed each spring
    yearlyIncome: number;           // last four closed seasons, valued at market mid
    visibility: number;             // 0–100
    tenure: "benefice" | "owned" | "precaria" | "forfeit_claimed";
    precariaRent?: { kind: "fixed" | "nona"; denarii?: number };
    charter: "none" | "count" | "royal";
    marriedLocal: boolean;
    secondVilla: boolean;
    claimDeadlineTurn: number | null;   // the 830 crisis deadline while a claim is open
  },
  prices: {
    severity: "normal" | "shortage" | "famine" | "severe"; grainMultiplier: number; untilTurn: number | null;
    eventSeverity: severity | null; base: Record<crop, { min; max }>; hungrySeasons: number;
  },
  weather: { forcedThisSeason: string | null; forcedSeverity: number },
  supply: { lastRoll: { turn: number; situation: string; lost: number } | null },
  vikings: { danger: "none" | "low" | "moderate" | "high"; campNear: boolean },
  duties: { lastRollTurn: number | null; favour: number; hostingSettledTurn: number | null },
  /** Duke-track opportunities Richard took because the lord did not (richard.ts). */
  richard: { taken: string[] },
  ladder: { stage: "none" | "warning" | "stripped" | "excommunicated" | "attempt" | "quest"; since: number | null },
  quest: {
    active: boolean; attempt: number;
    nobles: { motive: string; name: string; status: "unknown" | "won" | "refused" | "hedging" | "betrayer" }[];
    phase: "none" | "gathering" | "battle" | "election" | "crowned" | "submitted" | "failed";
    lastApproachTurn: number | null; phaseTurn: number | null;
  },
  diffusion: {
    innovations: {
      id: string; name: string; introducedTurn: number;
      legibility: "obvious" | "puzzling" | "opaque";
      reproduction: "trivial" | "craftsman" | "capital" | "programme";
      proof: "self" | "season" | "cycles" | "generation";
      exposure: ("taught" | "sold" | "public_use" | "battle_allies" | "monks_copied" | "shown_king" | "espionage")[];
      spread: "own_lands" | "region" | "kingdom"; spreadTurn?: number; spreadDueTurn: number | null;
      writtenDown: boolean; creditedToPlayer: boolean;
    }[];
    grainCut: boolean;              // the one-time 10% cut when a yield-raiser reaches the kingdom
    lastSpyYear: number | null;
  },
  /** The life record for the closing summary: short dated entries the engine writes on notable flags. */
  record: { year: number; season: Season; text: string; thread: string }[],
  away: { reason: string; untilTurn: number } | null,
  dead: { cause: "old_age" | "battle" | "illness" | "wound" | "captivity"; year: number } | null,
  /** The closing page (§13), written once. */
  ending: { death: string; summary: string; voice: string; byModel: boolean } | null,
}
```

Also:

- `player.ageAt825: number` (default 17). `age(state) = ageAt825 + (year − 825)` with a half-year step at autumn.
- `Holding.manses: { free: number; servile: number; vacant: number }` (default 6 / 4 / 4 for Fontenay). Tributes and levies read `free + servile`; refugees settled reduce `vacant`.
- `flags.regional_famine` (already in state) is now set by the natural-events system.

### 4.1 Flag registry

Flags are a closed vocabulary. `data/history/flags.json` lists every flag with type (`bool` | `int`), who sets it, who reads it, and a one-line meaning, taken from the scripts' Flag registry and completed by `lint.ts` (every `requires` reference and every hook effect must name a registered flag; every registered flag must have at least one setter). The LLM never names a flag directly; it names a **hook id** or **choice id** declared on an event, and the engine writes the flags that hook declares.

---

## 5. The season pass

Inserted into `advanceSeason` after agriculture, projects and the clock-independent engine work, before the random roll. The clock has not yet turned at this point (`meta.year/season` is the closing season), so the pass computes `next = nextSeason(...)` and asks what fires at the start of `next`.

`runHistorySeasonPass(state, next, turn)` in `season.ts`, in this order (as built):

```
1. away → home beat                   an "away" that ends this season posts Aldric's line
2. realm.tick(next)                   count/king/emperor changes due this season → oath beat events
3. expireDeadlines                    open choices past deadline → the `default` option; outcomes → default; scenes advance on "season"
4. land.tick                          spring revaluation, visibility decay, the 830 claim deadline
5. prices.tick(next)                  famine severity by year table + event effects → state.market grain bands
6. hunger debuffs, weather.forcedFor  seed eaten, sickness; the forced-weather override for rollSeasonEvents
7. relics.tick, tributes.tick, vikings.tick, richard.tick
8. scheduler.due(next)                dated events whose fires ≤ next, not fired, not dropped, requires true, unless false
   - drop events whose season has passed and are not `carry`; sorted by `order` then id
   - deferred battle events raise a `history` call to arms (§9); deferred promotion events post their interim line instead (§10)
   - [Supply check] events roll losses after delivery
9. deliver(events)                    one chat message per script block, in order, to its speaker; wantsTalk
10. suppressOther = events.length > 0  → rollSeasonEvents skips the random "other" event
10a. trade.tick(next)                 the roads: raid, army fed, conditions, drift (§11.8a)
11. duties.tick(next)                 if royal_vassal and no dated event fired → roll D-001…D-010
12. ladder.tick → quest.tick          thresholds, rung moves, the quest's seasons (gated by `features`)
12a. promotion.tick → vassals.tick → justice.tick   the generic summons (§10); moods fade, a man may go (§10a); feuds, missi, stance year, one case (§10b)
12b. revenue.tick → administration.tick             the office's quarter (§10); the household's pay, overload, Aldric's complaint (§10c)
13. diffusion.tick                    espionage roll (spring), spread timers, the grain cut
14. age.tick(next)                    the death roll from 910; sets `history.dead`, result `died`
15. referee season prompt gets engine lines: "History: <id> was told by Aldric: <one-line summary>", plus each system's line
```

When `died` is true, `advanceSeason` writes the closing page (§13) before it returns; every later `advanceSeason` returns the error "The lord of Fontenay is dead. The chronicle of this house is closed."

Multiple events in one season (829-01 and 829-02; 841-02 and 841-V1) all fire, in the order they appear in the data file (`order` field breaks ties). Each event's script blocks are posted as separate messages so the Ermenald part lands in his tab and the Aldric part in his.

**Fires but no requires met in time.** The scripts say when an event fires. If its `requires` is false at that season, the event is dropped (recorded in `history.dropped`) unless `carry: true`, in which case it waits and fires the first season its requirements hold, up to `carryMax` seasons. Example: 832-01 requires `side_830 = bernard`; it does not carry. 834-02 requires the player to have ridden to court (a hook on 834-01); it carries one season.

**Keystone fallbacks.** The Arcs doc's rule (momentum 80+ happens anyway; 40–79 re-check requires; under 40 drop or replace) is encoded per event: `requires` holds the dependency, `fallback` names an alternative event id or `null` for "drop". Nothing in this pass can break a keystone yet (battles are deferred), but the data is shaped for it.

---

## 6. Event data model

One JSON object per event. The zod schema is the contract; this is the shape.

```jsonc
{
  "id": "832-01",
  "title": "A letter from Bernard",
  "arc": 1,                              // 1–9, "church", "economy", "natural", "ending"
  "type": "choice",                      // news | choice | summons | live | promotion | battle | levy | journey | hazard | background
  "fires": { "year": 831, "season": "winter" },   // the season START it is delivered
  "order": 2,                            // tie-break within a season
  "requires": "side_830 == 'bernard'",   // §6.1 grammar; omit = always
  "unless": null,
  "carry": false, "carryMax": 0,
  "fallback": null,
  "channel": ["chaplain", "steward"],    // speakers used, in order
  "form": "letter",                      // spoken | note | letter | envoy | summons | scene
  "source": "Bernard himself.",
  "slant": "Bitter, persuasive, and self-serving.",
  "script": [
    { "speaker": "chaplain", "frame": "reads the letter aloud", "text": "Bernard, by God's grace duke, …" },
    { "speaker": "steward",  "frame": "after", "text": "My lord, this is a dangerous letter. …" }
  ],
  "variants": [                          // optional script substitutions by condition
    { "when": "saved_adalard", "replace": 0, "text": "Count Adalard has given up the county. …" }
  ],
  "knows": ["Bernard is in the south, among his own people in Septimania.", "…"],
  "doesntKnow": ["That the emperor will move against Pippin with force in 832 …", "…"],
  "choices": {                           // "The choice" tables. Exactly one is taken.
    "deadlineSeasons": 1,
    "options": [
      { "id": "send_men",   "label": "Send men and horses to Pippin", "effects": { "flags": { "rebel_832": true, "favor_septimania": "+2" } }, "note": "Bernard's gratitude; serious danger when the revolt fails in autumn 832" },
      { "id": "hedge",      "label": "Reply warmly but send nothing", "effects": { "flags": { "hedge_832": true } }, "default": true },
      { "id": "refuse",     "label": "Refuse politely, citing the oath to the emperor", "effects": { "flags": { "oath_kept_emperor": true, "favor_septimania": "-1" } } },
      { "id": "inform",     "label": "Hand the letter to the emperor's men", "effects": { "flags": { "informer_832": true, "enemy_septimania": true } } }
    ]
  },
  "hooks": [                             // soft hooks; any number may be taken, each once
    { "id": "gift_to_kin", "trigger": "Player sends a message of support or a gift to Bernard's kin", "effects": { "flags": { "favor_septimania": "+1" }, "cost": { "denarii": 20 } } },
    { "id": "predict_late", "trigger": "Player predicts the relief army will be late", "effects": { "flags": { "prediction_spain": true } } }
  ],
  "outcomes": {                          // §8 — LLM-judged momentum results, closed list
    "momentum": 40,
    "canChange": "Stop the bleeding; boiled water with salt and honey; early in the season …",
    "options": [
      { "id": "saved",  "effects": { "flags": { "saved_adalard": true } }, "record": "Saved Count Adalard from the flux." },
      { "id": "died",   "effects": {}, "default": true },
      { "id": "rumour", "effects": { "flags": { "poison_rumor": true } } }
    ]
  },
  "stages": [ /* §8.2 live scenes */ ],
  "supplyCheck": false,
  "deferred": null,                      // "battle" → fought from the forces tables (§9) | "promotion" → §10 interim behaviour
  "rolled": false,                       // true = engine-delivered (duties, ladder, quest), never by the calendar
  "hookWindow": 2,                       // seasons the hooks stay open after delivery (default: see §17.6)
  "links": { "arc": 1, "momentum": 70, "keystone": "K1", "fixedPoint": false },
  "record": "Received Bernard's letter and {choice}."   // template for the life record
}
```

**Rolled events.** `events/duties.json` (D-001…D-010) and `events/quest.json` (L-001…L-004, Q-001…Q-003) carry `rolled: true` and a nominal `fires` of year 9999. The scheduler never picks them; `duties.ts`, `ladder.ts` and `quest.ts` deliver them through the same `deliver` path, so they get the same script posting, hooks, choices, Knows and hook windows as dated events. A rolled event may be delivered more than once (a duty rolled twice, a second quest attempt); re-delivery clears its `hooksTaken` and `chosen`.

**Slots.** `{slot}` in script text, `cost` and `gain` is filled by `slots.ts` at delivery and at apply: `{amount}`-style tribute shares, `{absolution_fee}` (max(120 d, 10% of recorded value, rounded to the solidus)), `{absolution_penance}` (half the fee), `{ally_price}` (120 d × rank). `Knows:` lines are filled too.

### 6.1 Condition grammar

Small, deterministic, no code evaluation:

```
expr   := term (("and" | "or") term)*
term   := "not" term | "(" expr ")" | atom
atom   := flag                       → truthy
        | flag op value              → ==, !=, >=, <=, >, <   (numbers, quoted strings, true/false)
        | "fired(" id ")"            → event delivered
        | "chose(" id "," option ")" → that choice taken
        | var op value               → engine variables, below
        | "feature(" name ")"        → any holding has the feature
```

Engine variables (`conditionVars` in `flags.ts`; `lint.ts` must list each): every canonical resource by id (`wheat`, `wine`, …), `year`, `season`, `rank`, `renown`, `age`, `units`, `men_under_arms`, `manses`, `vacant_manses`, `denarii`, `horses`, `households`, `tenure`, `charter`, `visibility`, `swornTo`, `king`, `emperor`, `count`, `severity`, `viking_danger`, `ladder` (stage), `quest` (phase), `quest_attempt`, `allies` (nobles won), `happiness` (the people's meter), `favour` (royal duties favour), `away`, `regional_famine`, `hunger`, `monastery_nearby`, `relics`, `villas`, `counties`, `vassals`, `vassal_mood`, `trade_health`, `justice_fairness`, `justice_stance`. A bare flag name reads the flag store.

Flags with string values (`side_830 = 'bernard'`, `chalon_834 = 'defended'`) are stored as strings; the registry types them as `enum` with the allowed words.

### 6.2 Effects vocabulary

Everything a hook, choice, outcome or stage may do. The engine applies these; the LLM only names the id.

| Key | Meaning |
| --- | --- |
| `flags` | `{ name: true \| false \| "+n" \| "-n" \| "word" }` |
| `renown` | `"small" \| "moderate" \| "large" \| number` or `"-small"` etc. Bands: small 5–15, moderate 25–50, large 75–150, rolled uniformly with the event seed. Fixed values are numbers (833-01 stage 5 = 90). |
| `cost` | `{ denarii?, horses?, grain?, … }` taken from stores; refused (card stays pending) if the stores cannot pay |
| `gain` | the same shape, added |
| `land` | `{ tenure?, charter?, visibility?: "+n", recordedValue?, marriedLocal?, secondVilla?, precariaRent? }` |
| `realm` | `{ swornTo? }` |
| `mood` | people's happiness delta (existing meter) |
| `modifier` | an `add_modifier` payload (famine debuffs, blessing) |
| `settle` | `{ households, skilled?: "smith" \| "mason" \| "vintner" }` → the existing settle-households path; refugees |
| `unit` | `{ raise?: { sheetId, men } }` (only where the scripts hand the player men) |
| `away` | `{ reason, seasons }` → narrative flag |
| `scene` | `{ open: id }` or `{ advance: true }` |
| `record` | a line for the life record |
| `innovation` | `{ register: {…} }` or `{ expose: id, how }` (§12) |
| `prices` | `{ severity, seasons? }` → the famine price table for a span (§11.4) |
| `promote` / `grant` / `forfeit` | rank steps, land and office handed over, benefices taken back (§10) |
| `trade` | `{ shift?, seasons?, baseline?, reason }` → trade health: a knock that recovers, a passing shock, or the regional baseline for good (§11.8a) |

### 6.3 New proposal types

Added to `PROPOSAL_TYPES` and the discriminated union. All go through the normal Confirm card.

| Type | Fields | Who may emit | Engine check |
| --- | --- | --- | --- |
| `history_choice` | `eventId`, `optionId`, `summary` | Aldric, Ermenald | event fired, choice open, option exists, not already chosen |
| `history_hook` | `eventId`, `hookId`, `summary` | Aldric, Ermenald | event fired within its hook window (default: until the next dated event on the same channel, min 2 seasons), hook not yet taken |
| `history_outcome` | `eventId`, `outcomeId`, `summary`, `reasoning` | Aldric, Ermenald | event has outcomes, window open, not resolved; fixed points have one option |
| `history_scene` | `eventId`, `advance: true`, optional `choiceId` | Aldric, Ermenald | scene open; the stage allows advance by speech |
| `innovation_register` | the innovation fields minus timers | any portrait NPC | id unique; the three factors present |
| `innovation_expose` | `innovationId`, `how` | any | innovation exists |
| `vassal_mood` | `vassalId` (an id from the HISTORY block, or `"all"`), `delta` −15..15, `reason` | Aldric (Ermenald, the referee) | the lord has sworn men; the id is one of them (§10a) |
| `justice_verdict` | `caseId`, `verdictId` | the speaker who brought the case | the case is the one before the hall; the verdict is on its closed list (§10b) |
| `set_stance` | `kind` justice\|tolls, `stance` (lenient\|fair\|strict\|extortionate, or low\|customary\|greedy) | Aldric | the lord holds a county (rank ≥ 3) |
| `steward_office` | `action` promote\|hire\|deputy, `name?` | Aldric | the chest can pay; promote twice per tier at most, four clerks, one deputy and only at Duke (§10c) |

The existing `transfer_resources`, `add_modifier`, `settle_households`, `raise_unit` remain the way costs and gains reach the books; the engine emits them itself when applying `effects`, so the LLM does not have to pair them.

---

## 7. What the LLM sees

### 7.1 The History block (Aldric and Ermenald system prompts)

Appended by `promptBlocks.ts`, scoped to keep tokens down:

```
HISTORY (engine truth; you may expand only from Knows, and must plead ignorance on Doesn't know)
Today: spring 832. Emperor Louis; our king Pippin of Aquitaine; Count Adalard of Autun (since 830). The lord swore to Adalard in 830. Body age 24.
Active events (last 3 seasons on your channel, or still open):
- 832-01 A letter from Bernard (winter 831). Source: Bernard himself, self-serving.
  Knows: … | Doesn't know: …
  OPEN CHOICE (deadline: end of this season): send_men | hedge | refuse | inform — when the lord decides, emit history_choice.
  Hooks: gift_to_kin ("sends a gift to Bernard's kin"), predict_late ("predicts the relief army will be late") — emit history_hook when his words plainly do this.
- 831-01 Bernard at Thionville (winter 831). Knows: … | Doesn't know: …
Standing facts the household knows: side_830 = bernard; benefice_charter; favor_septimania 2.
Rules: The scripts you were given were spoken already; do not repeat them. Never reveal a Doesn't-know item, even if the lord guesses right — you may say you have heard nothing of it. Never invent a flag, a reward, or a rank. If the lord's words fit no declared hook, it is talk: [[books:no]].
```

Only the events on that NPC's channel are expanded; the other channel's events appear as one line each so Aldric knows what Ermenald told the lord. Background systems add a line when relevant (prices, supply losses, a duty rolled, the ladder stage).

### 7.2 Momentum judging

For events with `outcomes`, the block adds:

```
OUTCOME TO JUDGE (momentum 40 — contingent; a well-placed noble could tip it): Count Adalard's flux.
What could change it: … (the entry's canChange text)
When the season's efforts are spoken and done, emit history_outcome with one of: saved | died | rumour, and a one-line reasoning.
Weigh what the lord actually did and paid for, his renown (N), his standing (…), and the momentum. Higher momentum means the historical result unless the effort was real and well-aimed. Fixed points cannot be judged; they are not offered.
```

The engine resolves unresolved outcomes at the window's end with the `default` option.

### 7.3 Referee (season report)

The referee prompt receives one engine line per fired event so Aldric's seasonal speech can refer to it without re-telling it, plus prices and supply lines. The referee may not emit history proposals.

### 7.4 Speech-only pass

The hidden `[[books:yes|no]]` tag already decides whether a books pass runs. A history hook or choice is "books:yes". The books pass then emits the history proposal. No change to that machinery.

---

## 8. Event shapes

### 8.1 News

Script posted; Knows/Doesn't-know active for follow-ups for the hook window; optional hooks. Most of the calendar.

### 8.2 Live scenes without combat

830-02 (the mutiny and the reckoning), 833-01 (the Field of Lies), 834-02 (audience), 834-03 branch A (foragers, refugees), 880-K1 (Richard takes Autun), 886-V2, the open throne. A scene is an event with `stages[]`:

```jsonc
"stages": [
  { "id": "pope",   "script": [{ "speaker": "steward", "text": "…" }], "advanceOn": "speech|season|both", "hooks": [...], "choices": {...} },
  { "id": "bribe",  "script": [...], "advanceOn": "speech", "choices": { "options": [ { "id": "take", "effects": { "flags": {"bribed_833": true, "perjury_833": true}, "renown": "-moderate", "gain": {"denarii": 60} }, "ends": true }, { "id": "stay", "default": true } ] } },
  …
]
```

Stage scripts are spoken by Aldric (the lord's steward rides with him as his clerk when the scene is away from home) or Ermenald where the scripts give him the line. A stage advances when the lord's words settle it (`history_scene`), or at the next season start if `advanceOn` allows, applying defaults. A scene may span seasons (830-02 runs spring → autumn 830; 880-K3 runs two years). `ends: true` on an option closes the scene early with that stage's flags. The scene's `exit` lists the flags set when it closes (e.g. `side_830`, `oath_kept_lord`).

Since the hall plays normally while the lord is "away", the scene's stage messages arrive at season starts like news, with speech-driven stages able to advance mid-season. That is the cost of the "narrative only" decision and it is acceptable: a scene is a sequence of beats, not a lock.

### 8.3 Choices

"The choice" tables. One option, a deadline (`deadlineSeasons`, default 1), a `default`. The engine applies the default at the deadline and posts a one-line Aldric note ("The matter settled itself: …").

### 8.4 Summons

A summons is a choice (go / stay / other side). Its "go" option would open a battle; see §9.

### 8.5 Promotion windows

834-02, 835-02, 845-A1, and the rank effects inside later entries. See §10.

### 8.6 Background systems

Not dated events; engine systems with their own data tables (§11). Where the scripts give Aldric a line (famine season reports, duty results, minting notes), those lines live in the tables and are posted verbatim.

---

## 9. Battles (the battle pass, delivered Oct 28, 2026)

Events tagged `deferred: "battle"` are fought on the grid when `features.historicalBattles` is true (it is). The forces for each are data, not code: `data/history/battles.json`, transcribed from `design/history/Battle_Force_Tables.md`, read by `src/history/battles.ts` and the session layer in `src/session/battle.ts`. With the switch off, or for a battle event with no forces entry, the old behaviour stands: one neutral Aldric line (*"…not yet written in this chronicle"*), the summons flags still recorded.

**The grid is the lord's sector.** Every entry gives the enemy roster the sector faces and one allied row per rank 1–5 (villa lord / viscount / count / duke / king; a missing row falls back to the highest defined below it). Each row has `slots`, the number of the lord's own files it assumes. Fewer files than that are made up from the row's `fill` (default: alternating Caballarii and Pedites); more displace allied files one for one from the end of the row, never a `fixed` one (named retinues: Gaucelm, Warin, Robert, Ranulf, Géran, the Saxon contingent, royal engines). Home defences (`home: true`) have no allies at any rank. Lines may carry `strength`, `morale` (a fraction of the sheet's), `disordered` (a fifth of the heart, `DISORDERED_MORALE_FRACTION − 0.05`), `tags`, and an `id` for results. One allied line per row is the `lord` file: at Rank-and-File the lord rides in it (`LORD_FILE_ID`); no extra "minor nobles' horse" is added for history battles.

**The call.** The scheduler delivers the event as written, then `openHistoricalBattle` raises a `battle_call` of kind `history` (`historyId`, `mode`, `note`, a seed from `region:id:year:season:turn`, optional `supply`). Nothing is raised for a dead, captive or maimed lord, while a fight is open, or while another history call is open (the second fight that season gives way). The call banner reads "The host musters." / "At the gate."; the buttons are *Ride out* / *Turn back* (*Bar the hall* for a home defence). **The season cannot turn while a history call is open** (`advanceSeason` refuses with "The host is waiting on your answer"); random calls still lapse as before. `raiseCallDirect` and the `call_to_arms` proposal refuse the kind: history calls come from the calendar only.

**How the lord goes** (`historyRideMode`, 03_HISTORY §11.2 bands): under 50, or 50–64, he rides `attached` in a file — in the 50–64 band every wound roll is taken twice (`woundRollMode = "extra"` before each round); at 65+, or with a permanent wound (`canLeadFile` false), he is `unattached`: no file, the same Sub-/Full-Command screen from behind the line. A summons answered with "send men under a captain" (the battle's `requires` names a `<flag> == 'sent_men'`) is fought by letter, mode `captain`: at least one file must go, the lord is not on the field; with no men to send the contingent does not go and the call clears.

**Tier.** No files: Rank-and-File if attached, Sub-Command otherwise. One or more: Sub-Command, or Full Command when the table says so (`fullCommand`, the king quest), the lord holds the grant, he is a duke or king, or a count bringing three files (`historicalTier`). Full Command runs the usual scouting duel and deployment with the table's field (`field.weather`, `roughness`, `terrain` weights, `name`) and its fixed fort.

**Forts.** `fort: {side, type, makeshift, points}` builds a face along that side's front row (Chalon, Toulouse inside, Vienne inside: the lord's wall; Brissarthe's church, the castles of 839, Toulouse and Vienne outside, Sens: the enemy's). Enemy forts are garrisoned (`garrisonWalls(battle, "enemy")`). Home defences get the villa's own wall, makeshift unless a palisade or stone wall has been built (`villaWallMakeshift`). `posture` sets the AI postures for allies and enemy.

**The abstract layer.** `abstract[]` is the rest of the battle arriving as morale events: `{round, side, morale, text}`, each applied once before the round it names (undisciplined files take 1.5× a loss), logged as kind `morale` and posted as an engine note in the session. Andernach's `ownDisordered` puts the lord's own non-veteran files to sleep in the camp with everyone else.

**Results.** `resultClass`: victory or enemy withdrawal → `won`; defeat → `lost`; anything else → `held`. After the ledger, `applyHistoricalResults` applies `results[class]` and `results.any` with the normal effects vocabulary (flags, renown, record), a `survivor` entry's effects when a named allied line (`a-<id>-*`) is still active or withdrawn (Chalon: Gaucelm; Brissarthe: Robert → `robert_saved`), and writes a plain record line if the table gave none. History itself stands: only what the tables name changes (Chalon `saved_city` / `defended` / `fell` with `oath_under_duress_834`, Brissarthe `robert_saved`, Argenteuil and the 898 foragers `irregular_tactics +1`, …); renown and losses are the lord's own, and Aldric's momentum line says the wider battle went as it did.

**Turning back** (`refuseHistoricalBattle`): `onRefuse` from the table or the default `count_opinion −2`, renown −moderate, a record line, `history.away` cleared; the king-quest field refused fails the quest. Barring the hall at a home defence takes the pre-rolled supply loss in full.

**Home defence through the supply path** (§11.5). When a supply check lands and the lord has men under arms, `runSupplyCheck` returns `militiaCall` with the rolled share instead of taking stores, and the season pass raises the event's supply entry (`supply: true`, `home: true`: 834-03, 841-H1, 841-02's host, 841-03, 898-V1) as a history call "At the gate". Won → nothing taken; held → half; lost or barred → the full share (`applySupplyLoss`). No men under arms → the loss roll as before. The check is skipped when the lord is already called to a greater field that season. 886–887's raids stay with the Viking raid calls; 911-F1 Chartres is news.

**The king quest** (`field_against_the_king`, Q-002): `composeQuestSector` builds the sector from the supporters won (each motive a contingent; the household Elite Foot is the lord's file) and the king's side from the nobles lost (8/7/6/5 files for <4/4–5/6/7+ won: two Heavy Horse and Elite Foot at the core, any kingdom-spread innovation the lord let out, Caballarii and Pedites fill). At round three the betrayer Aldric warned of turns: his files leave the line and reappear on the enemy's reserve row, −6 (−9 undisciplined) heart to the sector. Lost → `quest.phase = "failed"`.

**Lint** (`checkForces`): every deferred battle has a non-supply entry when any entries exist; supply entries need an event with `supplyCheck` and `home`; `when` parses; every sheet exists; home rows are empty, others are not; results/survivor/onRefuse effects are checked and count as flag setters; a survivor id must be on an allied line.

## 10. Rank progression (the promotion pass)

Design: `Isekai 825 Rank Progression — Holdings and Powers.md`. Code: `src/history/promotion.ts`, `revenue.ts`, `ranks.ts`; data `data/history/ranks.json`; switch `features.promotions` (on). The battle ledger no longer promotes: `stickyRank` is gone from `session/battle.ts`, which notes instead that "the lord's name would now bear the rank of …".

**Eligible, then granted.** Renown at the thresholds (1 / 100 / 500 / 1,000 / 2,000) makes the lord *eligible* for a rank; a hand must grant it. Two ways:

- **Scripted windows.** Dated events of `type: "promotion"` carry a `promote` effect (below). 834-02 (the emperor's gratitude: `royal_vassal`, sworn to the king, a step if renown ≥ 100, and the land choice `own_villa` / `second_villa`), 835-02 (Crémieu: a step at the threshold, ×1.5 when `distrusted_834`, a royal charter if none, else 60 d; nothing twice if `promoted_834`), 845-P1 (Pippin's court, cap Count; the step's villas are Pippin's and 848-A1 `forfeit`s them), Q-003 (the election: `quest.ts` crowns through `promoteTo`; the counter-offer makes a duke). Lint: a dated promotion window must carry a `promote` or `grant` effect; `deferred: "promotion"` + `event.promotion` stay as the design note.
- **The generic summons** (`tickPromotion`, after the ladder and quest in the season pass). When `eligibleRank` (capped at Duke — the crown is never generic) exceeds the rank held, `history.rank.eligibleSince` is set and `dueTurn` rolled 2–8 seasons ahead (seed `summons:turn:rank:renown`). At the due turn, if the lord is home, alive, off the ladder, not in the quest, no call to arms is open, no scripted window fired in the last 2 seasons or falls in the next, and no cooldown runs, Aldric announces the summons (`rank:summons`) and the step is granted by the patron: the count of Autun for a viscount not sworn to the king, otherwise the king. The eligibility note goes to the referee lines when the threshold is crossed.

**The step** (`promoteTo(state, rank, {patron, turn})`, one account from Aldric per step, `history.record` "Raised to … by …"): `player.rankLevel` and the legacy `player.rank` label; villas up to the step's count (3 / 12 / 45, never fewer than one new) as real `Holding`s from the step's villa template (land ±15%, manses, autumn sowing, people added to the one population pool, stores) with `tenure: "benefice"`, `grantedBy: patron`, names from the Burgundian pool; the chest (600 / 4,000 / 30,000 / 80,000 d); the men as `OwnedUnit`s (9 caballarii; +30 in three units; +100 in four; the king's guard); the seat marked and palisaded if unwalled; vassals to the step's roster (3 / 10) as `history.vassals` at mood 50 (step 3 moves them); from Count a county block in `history.rank.counties` (name from the pool Beaune, Avallon, Chalon, Autun…, fisc 150 manses / 10 villas, levy, yearly tolls/market/pleas/fisc/officers); at Duke four counties, a vassal group per county, `holds_autun` with a stone wall at the seat and the Chalon mint (1,200 d/yr from 864); at King the royal fisc block (300,000 d/yr, host 5–20,000). The Autun variant is the Duke's fourth county; the realm calendar's count of Autun stays the narrative one.

**Office revenue** (`tickRevenue`, each season): a quarter of the yearly figures into the chest. Viscount: deputy's share 60 + court fines 40 a year. Count and above: per county tolls × trade multiplier (`trade.health / 55`, 0.4–1.6; Autun ×1.4) + market × trade + pleas × justice multiplier (the stance's fines factor, §10b) + fisc dues + mint, minus officers' pay; the royal fisc when king. `history.rank.lastRevenue` feeds the Books; the ledger line "The office paid … d".

**Stripping** (`demoteBy`, used by L-002 "go"): the office goes — counties beyond the rank kept, the mint, the crown, `holds_autun` — and the benefices held from the stripping hand (`forfeitFrom`); owned villas, the men and the chest stay; vassals trimmed to the rank's roster; `cooldownUntil = turn + 12` blocks the generic summons. Titles are otherwise sticky.

**Effects vocabulary added** (§6.2): `promote { patron, cap (2–4, default 4), scaleWhen, scale, mark, onPromote, onThanks }` — one step if renown ≥ next threshold × scale and next ≤ cap; `history.rank.windows[eventId]` records `promoted` or `thanks`; `mark` sets a bool flag (counts as a setter in lint); the nested lists apply after. `grant { patron, villas, tenure (benefice|owned), like (template rank), county }`. `forfeit { patron }`. Effects now return `beats` (Aldric's account of a grant) and every delivery path posts them. New condition variables: `villas`, `counties`, `vassals`, `vassal_mood`, `trade_health`; new flags `promoted_834`, `promoted_835`, `promoted_845`, `holds_autun` (engine).

**State** (§4): `history.rank { eligibleSince, dueTurn, cooldownUntil, patron, promotedTurn, windows, counties[], royalFisc, mint, lastRevenue }`, `history.vassals[] { id, name, holding, men, mood, since, group, grantedBy }`, `history.trade { health: 55 }`; `Holding.tenure / grantedBy / grantedTurn / seat`. Old saves default to a villa lord with none of it.

**Prompt and Books.** `rankLine` joins the History block (rank, patron, villas and benefices, counties, sworn men, the expected summons, last season's office take). The Books gain a **Holdings** page (`booksView.ts#holdingsBook`): rank and eligibility; villas with manses, tenure and the seat; vassals with men and mood word; the court; from Count the county blocks, fisc vs patrimony, public revenue itemised, officers, the levy; the mint at Duke; the royal fisc and the host at King. The Estate page sums the land and sowing of every villa.

**Assumptions.** A patron's fall takes his benefices only where the data says so (848-A1); a change of count by the realm calendar does not. Villas are not yet buyable outright in play (an owned grant exists in the vocabulary). The generic county is Beaune, then Avallon, Chalon and Autun at Duke; Autun's bishop as a party to the lord's court is carried by the justice tables' `church` values (§10b).

## 10a. Vassals (`vassals.ts`, `ui/VassalRow.tsx`, `ui/vassalsView.ts`)

Design: rank doc 'Vassals'. The men sworn to the lord once he has rank, in `history.vassals`: 3 named men at Viscount, 10 at Count (each with his own holding from the villa-name pool — never one of the lord's villas unless the data or a grant puts him there — 2–5 men, `grantedBy` the patron), and from Duke a **group** line per county (`county_<name>`, "The lords of Beaune", `men` = the county levy). Each has `mood` 0–100 (new men at 50), `angrySince`, `lastReason`. Words: content ≥ 65, angry < 35, steady between (`vassalMoodWord`). Tenants want feeding and protecting; vassals want rewarding and fearing.

**Movers.** Engine-detected (`noteVassalEvent`, `VASSAL_EVENTS`): led to victory +8 / defeat −8 / a field with nothing to show −2 (`applyLedger`, when `session.swornMen > 0`), left out of a victory the lord won without them −4; a raid or bandit call refused −6 (`refuseCall`; a summons away is the count's affair); a step up +5 to the men already sworn (`promoteTo`); stripped −10 (`demoteBy`); a feast at the hall +4 (grand ×2; `church.ts` sponsor_feast); a benefice forfeited takes the men on it and gives the rest −5 (`forfeitFrom`); a verdict's `vassals` value moves them all (§10b; judging for a sworn man against his tenants +6, against him −8); an heir confirmed +8 and protected +6 remain for Aldric's card. Spoken: Aldric's `vassal_mood` proposal (§6.3) for what happens in talk — a gift, a slight, a daughter's marriage — with the ids and moods listed in his HISTORY block (`vassalsLine`), and a rule not to double the engine's movers. Each season (`tickVassals`, after the promotion tick) moods fade 1 toward 50.

**Where it pays out.** *Muster* (`vassalMusterLines`, `musterAndRide`): when the lord rides himself (not when he sends a captain) the named men come as allied `caballarii` files of up to 30, content men bringing one more each and angry men none; a county's lords come as a `pedites_fyrd` file of a tenth of the levy × 1 / 0.75 / 0.4 by mood (cap 30); the premise names who sent no one; `session.swornMen` records it. *Defection:* a named man angry four seasons running rolls a seeded 25% a season to go over to another lord: he is struck from the books with his men, and if his holding is one of the lord's benefice villas it goes with him; `history.vassalsLost` keeps the name and the why; Aldric speaks (`vassals:left`) and the record notes it. *The king quest* (`resolveApproach`): with content men a refused or hedging noble is won half the time ("the lord's own sworn men speak for him"); with angry men a won noble hedges half the time. *The ladder* (`canStrip`): a lord whose sworn men are content cannot be stripped by a word, whatever the people think; one whose men are angry can be, whatever the people think; otherwise the people's happiness decides as before.

**The row.** Under the people's happiness meter (`App.tsx`, `.happiness-block`): one figure per named man up to 12 at Viscount and Count; at Duke and King a larger figure per county's lords plus the three named men who matter most (the angriest, then the strongest). The three PNGs in `art assets/UI/` (`happvass`, `neutvass`, `madvass`) by mood word (`VASSAL_ICONS`); the tooltip is the man, his holding, his mood, his men and the last thing that moved him. The Books' Holdings page lists them with the same words.

## 10b. Justice (`justice.ts`, `data/history/justice.json`)

Design: rank doc 'Justice'. Not an income line: a lever that pays in money and reputation in opposite directions. State in `history.justice`: `stance`, `stanceExplained`, `open` (the case before the hall: `caseId`, `table`, `speaker`, `openedTurn`, `deadlineTurn`), `heard`, `casesThisYear`/`year`, `fairness` (−12..12), `missiAttention`/`missiVisits`, `feuds`, `verdicts` (the last eight), `stanceYear`.

**Cadence** (`caseDue`, `justice.json` → `cadence`). One or two cases a year on average at every rank, never two in a season, never a second while one is open, and none by obligation: a quiet season (no dated event, duty, promotion, ladder or quest beat) rolls 45%, capped at two a year, so about one year in eleven passes with no case at all — ten well-behaved households needed no judgement, and the small matters were the reeve's. None while the lord is away, dead, or the call to arms is open. The table follows the rank (`tableFor`): villa lord and viscount draw the **villa** table (12 cases: the boundary stone, the pig in the beans, the dead man's strip, …), a count the **county** table (10: a killing between noble houses, the abbey's charter, a vassal accused by his tenants, …), a duke or king the **duke** table (6: two counts over a border, an appeal against his own officer, a case the king sent down) for the year's first case and the county table for a second, so the great cases stay at one a year. A table does not repeat a case until it is spent (`heard`). County and duke cases open with the framing line ("You hear dozens of cases … this is the one that will be remembered").

**Delivery.** `tickJustice` runs after the vassal tick. The case's `speaker` (Aldric; Ermenald where the church is in it — the betrothal, the widow, the forbidden degrees, the abbey's charter, sorcery, the bishop's cases, the immunity) posts the text as a beat (`justice:<caseId>`); the referee is told who brought it and not to decide it. The lord judges in talk: the speaker's HISTORY block carries `OPEN CASE <id> "<title>" (deadline)` with the closed verdict list `id ("label") | …` (`justiceLines`); the other speaker knows only that a case was brought. When the lord has given judgement the speaker emits **`justice_verdict { caseId, verdictId }`** (§6.3; a Confirm card "The lord's judgement — On the dead man's strip: the widow's household, who must eat"). `applyVerdict` writes what the verdict row says: `fines` to the chest (negative pays out), `fairness` ±1, `people` (the happiness meter), `church` (`favor_church`), `vassals` (`moveVassalMood`, all the sworn men — so judging for or against one of them is the judged-for/-against mover of §10a), `renown` (number or band), `missi` (attention), `feud`. A case left past its deadline (two seasons) goes by default (`lapseCase`): the table's `refuse` verdict if it has one, else a plain lapse (fairness −1, a feud, "Left unjudged" in the books). **Feuds** come due 2–6 seasons later: the people −3, Aldric's `justice:feud:<id>` beat, a record line; a feud is outlived, not judged.

**The stance** (Count+; `stanceApplies`, `setJusticeStance`, `set_stance` proposal). Aldric explains it once at the first county (`justice:stance`): the lord cannot hear every case; his officers judge in his name as he tells them — **lenient** (fines ×0.5, loyalty +2 a year, church +1 a year, 30% a year a bold-thieves trade shock −4 for two seasons), **fair** (×1, +1; the default), **strict** (×1.3, −1), **extortionate** (×2, −3, church −1, missi attention +1 a year). The pleas line of public revenue (`revenue.ts` `justiceMultiplier`) carries the factor; the year's loyalty and church effects land each spring from the second year of the office (`tickStanceYear`), with ±1 more for a lord whose `fairness` is ≥ 3 or ≤ −3. The same proposal with `kind:"tolls"` sets `trade.tollStance` (low / customary / greedy; §11.8a). **The missi** (`tickMissi`): at attention 2 they sit in the county — a tenth of the chest taken, renown −small, royal favour −1, attention reset, `missiVisits` +1, Aldric's account of the third of the fines the capitularies allow. **The ladder** (`canStrip`): a lord with `fairness` ≤ −4 can be stripped by a word, whatever his sworn men think — a count whose people dislike him is the one who can be stripped. `fairnessWord` gives the Books and the prompt the lord's name as a judge ("thought a fair judge", "feared as a judge who sells his verdicts"). Condition variables `justice_fairness` and `justice_stance` are readable by content.

**Books.** The Holdings page's Court section shows the officers' stance (Count+), the case before the hall and who brought it, cases heard this year, the lord's name as a judge, unsettled quarrels, the missi's visits, and the last four verdicts.

**Assumptions.** The verdict's `fines` are the lord's own court and are not scaled by the stance (the stance governs the officers' routine pleas). Autun's bishop as a party and the double `favor_church` weight of the design are carried by the county and duke tables' `church` values rather than a separate rule. Bribes are the `fines`/`missi` pairing on verdicts such as the mill-fee, the immunity sold and the distraint; there is no separate bribe card.

## 10c. Administration (`administration.ts`, `ranks.json` → `administration`)

Design: rank doc 'Administration — abstracted through Aldric'. No cast of new officers: Aldric grows with the lord, and the fisc's villas are run by the county's own officers (the `officers` pay line of §10), so the number that matters is **the lord's own villas** (`holdingsRun` = `state.holdings.length`) against **what Aldric can hold** (`capacity`). State in `history.administration`: `standing` (0–2, times the lord has raised him), `staff` (clerks), `deputy` (`{name, since}`, Duke+), `lastTier`, `paidTurn`, `leaked`.

**Capacity.** By rank a range `[low, high]` (1–2, 3–4, 10–16, 40–60, no limit at King): the lord starts at the low end and each raising of Aldric moves him half the way to the high end (`low + round(standing × (high − low) / 2)`); each clerk adds 3 (to four clerks); a deputy adds 12. So a new count's twelve villas against ten already stretch him (tier 1), a new duke's forty-five against forty more so (tier 2), and the grant itself is the prompt to see to the household. `stewardTitle` gives the Books his style by rank ("chief officer of the county, with staff in each villa, raised once by the lord's hand").

**Overload** (`overloadTier`, `ranks.json` → `administration.overload`). Over by 1–2: the furthest villas pay a tenth less, and Aldric sounds tired. 3–5: a fifth less, and a villa's dues go uncollected each season (4 d per villa over). 6+: three tenths less, 8 d per villa over kept back by a reeve, the people −1 a season — a villa running itself, and not honestly. The yield drop is a maintained pair of `permanent` multiply modifiers (`mod-administration-grain` on `grain_yield`, `mod-administration-livestock` on `livestock_yield`, source `administration`) whose value is 1 − drop × over / villas (`overloadFactor`; `syncOverload` each season and after every office action), so the harvest tables and the Customs page see it as any other custom of the hall. Aldric speaks once per step up (`administration:tier:<n>`; the complaint names the furthest villa and the fixes open to the lord) and once when the books are in hand again.

**The fixes** (`steward_office` proposal, §6.3; `officeCost`, `applyOfficeAction`; Aldric's card). `promote`: 100 d × rank once and 5 d × rank a season, twice at most per tier. `hire`: 120 d once and 8 d a season per clerk, four at most. `deputy` (Duke+, one): 400 d once and 25 d a season, +12 villas; he is competent and ambitious — each spring a 20% roll keeps back a tenth of last season's fisc line (`leaked`, Aldric's `administration:deputy:<year>` account). Or hold less. The household's pay is taken each season (`tickAdministration`, after the revenue tick; "The household's officers were paid N d"). The prompt line (`administrationLine`, Aldric only) gives his style, villas against capacity, the books' state in words, and the offers with their prices; nothing is said while a villa lord has one villa and no household.

**Books.** The Holdings page's Officers section (shown from Viscount, or whenever the books are strained or a household exists) gives Aldric's style and clerks, villas against capacity with the overload word, the deputy and his date, the season's pay, and what has gone uncollected or been kept back over the years.

**Assumptions.** Capacity counts the lord's own villas only; the fisc's are the office's and are already paid for in the county's `officers` line. Raising Aldric is the "promote Aldric" of the design and is capped within the rank's range; a new rank widens the range without resetting his standing. The deputy is a line in the books, not a portrait NPC; the design's "whether that becomes useful or dangerous is a thread" is left to the calendar.

---

## 11. Background systems

### 11.1 Realm and oaths (`realm.ts`, `calendar/realm.json`)

The game line from the scripts: emperors (Louis → Lothair as emperor 840–855 → Louis II → Charles the Bald 875–877 → Charles the Fat 881–887 → none), "our king" (Pippin of Aquitaine → Charles 832/840 → … → Odo 888 → Charles the Simple 898), counts of Autun (Bernard 826–830, Adalard 830–837, Warin 837–853, Isembard 853–858, Bernard Plantapilosa 858–861, Robert the Strong 861–866, Plantapilosa 866–872, short-term counts 872–879, Boso 879–880, Richard 880–921). A change of count fires an **oath beat**: an Aldric line (often already the event's script, e.g. 826-01, 837-03, 880-K1) and the default `swornTo = count`. Refusing is a hook where the scripts make it one (880-K1). `saved_adalard` changes 837-03's text via `variants`.

### 11.2 Age (`age.ts`)

`age = ageAt825 + (year − 825)`. Participation band (all / 50–65 / 65+) is exposed to the prompt and reserved for the battle pass. Death of old age: from the start of 910, roll each season with rising chance so death lands in 910–911 (the scripts: "around 910–911, aged about 102"); 911-F1 Chartres fires in autumn 911 if he is alive, and he dies by winter 911 at the latest. Then §13.

### 11.3 Land and value (`land.ts`)

- `recordedValue` 6,500 d, fixed unless a reassessment event changes it.
- `yearlyIncome` each spring: value the last four closed seasons' positive production deltas (grain after seed, wine, wool, livestock increase, trade goods, orchard, cell surplus) at market mid price; exclude purchases and sales. `trueValue = 12 × yearlyIncome`. The scripts' calibration (525 d / year unimproved) is a test target: a stub-LLM run of an unimproved villa should land within ±15%.
- `visibility` 0–100: +points for new features (mill +10, stone hall +15, palisade/wall +8, vines/orchard acres, horses above 4, hosting lavishly, relics held, gifts to court); −2 a year decay toward a floor set by features. When `visibility ≥ 60` and `trueValue ≥ 1.5 × recordedValue`, visibility events become eligible as that season's "other" event: the missus asks questions (hospitality cost + a note), a neighbour sues (a dispute with a cost or a flag), the count covets the villa (sets `count_covets`, which feeds the land crisis if tenure is still a benefice). Buying at the recorded price is only offered while `count_covets` is false.
- `tenure`: starts `benefice`. The 830 crisis sets `forfeit_claimed` on the Bernard path. The three outs are a choice on 830-02's crisis stage, each priced:
  - **Buy outright:** `recordedValue` in coin or valued goods (horses, weapons, cloth at market mid); needs the count's agreement (easier with `benefice_charter`, `loyalist_830`) and sets `tenure = owned`, `charter = royal` if a royal confirmation is bought (extra fee, flavour).
  - **Marry into a local family:** the `marry_local` hook is the neighbour's-daughter match of `marriage.ts` (the `hildegard` archetype): it sets `marriedLocal`, takes the bride-price (coin, then cattle and sheep at market mid), brings allodial acres and manses next to ours, marks her father among the neighbours as kin, and seats her in the hall as a standing advisor. A lord already married cannot take this door; a lord who marries `hildegard` or `theoderada` through Aldric while the claim stands lifts it the same way. The widow's dower and a match for love answer nothing at the count's court. The 829 kinship rules are text for the LLM.
  - **Put the villa under the Church:** `tenure = precaria`, `precariaRent` fixed (a few solidi a year) or `nona` (a ninth of produce on top of tithe, applied in `season.ts` beside the tithe), `favor_church +2`, `swornTo = church`. Ermenald brokers it.
  - Deadline: Aachen, February 831 (start of spring 831). If nothing is done, the count seizes the villa: the game continues on a reduced holding (vacant manses are what is lost first; the hall stays). This is the hard consequence the scripts imply and it should be stated to the player by Aldric at the deadline's approach.
- `outlaw_832` re-opens the same three outs until 837-03.
- Refugee families (834-03, 841 aftermath, famine years) fill `manses.vacant` through `settle_households` and raise income.

### 11.4 Natural events and prices (`weather.ts`, `prices.ts`, `tables/forced-weather.json`)

- Forced weather by year and season per the scripts' table (841–845 spring/winter heavy rain and hard winter; 859–860 winter; 867–869 spring/summer rain and flooding; 872–874 all seasons varying, locusts summer 873; 895–897 summer hail, winter hard). The forced event replaces the weather roll, and the engine doubles the crop effect in `defaultEventStub` for forced events, reduced toward normal by improvements present (drainage acres, three-field rotation, a barn/granary, hardy-grain share ≥ 0.6): each present improvement removes a quarter of the extra.
- Famine severity by year (N-841 shortage/famine with the peak in 842–843; N-859 shortage; N-867, N-872 famine; N-895 famine) sets `grainMultiplier` applied to `state.market` grain bands (cheap grains rise most: oats ×1.3 of the multiplier, barley ×1.2, rye ×1.1, wheat ×1.0 at the famine tier, per the Sens figures). `flags.regional_famine = severity ≥ famine`, which already shuts the cell's barn.
- Season reports: the scripts' season schedule lines for famine years are data; Aldric and Ermenald post them verbatim.
- Debuffs: labour loss when men are away (reserved for the battle pass), seed eaten when hunger persists two seasons (next year's sown acres cut), disease after hunger (population loss modifier), trade disruption (merchant chance −10 points in Viking years on the rivers). Each is a tagged modifier so it shows in the books.
- N-857 ergot: a news event with hooks (`ergot_aware`, standing practice as a `set_standing_order` the engine recognises by tag `ergot_sorting`); the home outbreak in a later wet year is a conditional event with the three framings as outcomes.
- Sky events 837-01 and 840-01: framings are outcomes judged by the LLM from how the lord spoke beforehand (a hook `predicted_comet` / `predicted_eclipse` recorded in the prediction window makes the framing options available).
- Profiteering: selling grain to a merchant at ≥ 2× normal during `famine` sets `profiteer +1` and `favor_church −1`; feeding the hungry (consume grain with reason alms during famine) sets loyalty and `fed_the_hungry +1`, both via existing proposals the engine inspects.

### 11.5 Army supply and looting (`supply.ts`, `tables/supply-check.json`)

Rolls once per season for events tagged `supplyCheck`, with the situation from the event (enemy main army within a day's march 80% / friendly 60% / foraging parties 30% / deserters after a battle 50%), +15 if `visibility ≥ 60`. Stores lost are the table's band, halved by hidden/dispersed stores (feature `storage_pits`, a new small project), protected for grain moved to the church (a hook), 20% friendly chance with a letter of protection (flag), 10% flat loss when paying foragers off (hook). A trained militia (any owned non-levy unit or a veteran levy) turns foraging parties and deserters into a fight at the gate instead of a loss roll: with the battle pass on and a `supply` forces entry for the event, a `history` call with the table's roster (§9, home defence); otherwise the old militia edge roll. It does nothing against a main army. `menUnderArms` sums the owned units' `strength` (an earlier reading of a nonexistent `men` field had kept the militia out of every fight).

### 11.6 Royal vassal duties (`duties.ts`, `events/duties.json`)

Only when `royal_vassal` (promotion pass), the lord is home and alive, and no dated event fired that season. `tickDuties` rolls 1–10 (seed `region:duty:year:season:turn`) and delivers the rolled event `D-00n`; each is an Aldric line plus effects (D-002 the missus: 5 d, and `missus_inspected` + `land_visible` when visibility ≥ 60; D-003/D-010 a season away; D-004 small renown; D-005 3 d; D-008 two horses sold for 24 d when he has them; D-009 wheat and wine). Every result but 1 and 7 adds `duties.favour +1` and `duty_performed +1`. D-007 (hosting the court) is a choice: meanly (−small renown; settles as favour −2, `duty_shirked +1`), adequately (default; wheat 6, rye 6, pigs 2, wine 4, 10 d; renown 25; favour +1), lavishly (double, 30 d; renown 50; visibility +10; favour +2) and opens the hook `petition_the_king` (requires `chose(D-007, lavishly)`). The hosting is settled the following season through `duties.hostingSettledTurn`.

### 11.7 Vikings (`vikings.ts`, `tables/viking-danger.json`)

- `viking_aware` from 841-V1 / 845-V1 hooks.
- Danger band by year (886–887 high; 888 moderate; 889–897 low; 898 moderate-high; 899–911 low). The band is a per-season raid chance that uses the existing `raid` `battle_call` and encounter (a Viking band is a raid with a Viking roster; add the sheet to `data/combat/units.json` in the battle pass; until then the existing raid roster stands in).
- Irregular tactics are hooks on the raid-year events (deny the countryside halves supply losses and costs a season of labour modifier; poisoning the camp is an outcome with a secrecy roll each season; disease-blankets is a character moment with a household-sickness risk and no effect).
- Relics (843-V1, 853-V1): accept/refuse choice with rank branches; `relics_held` raises visibility and, from 886, raid chance by one band; feeding the monks is an ongoing grain cost; the return request in the 880s is a conditional event.
- Winter camps and "who can attack" are reserved for the battle pass; the data lines live in the table.

### 11.8 Tributes, levies, minting (`tributes.ts`, `tables/tributes.json`)

- E-866 and E-877 compute the player's share from rank and the manse split, fill the `[amount]` slots in Aldric's script, and offer the five options as a choice with costs; "pay the tenants' share yourself" costs the per-manse total; "advance as a loan" returns with increase over four seasons; "buy up what neighbours sell" is a land hook gated by stored coin.
- 862-V1 bridge levy: labour / cartage / coin, ~15 d; a hook for sending skilled men.
- Minting notes are flavour lines by decade; the mint as a business is gated by rank (promotion pass) and written as a project key `mint` in data for then.

### 11.8a Trade health (`trade.ts`; rank design 'Trade health')

One hidden number for the home region, 0–100, Autun 825 = 55, in `history.trade`. The player never sees it; the Books carry no figure. Three layers: `baseline` (the region's resting level; raised for good by `trade.baseline` effects: Chalon's coin 864-V2 +8, Tournus 875-V1 +10, Cluny 910-E1 +10), `base` (the slow number — knocked by `trade.shift` effects and engine events, drifting back toward baseline + the lord's improvements at +0.75 a season, +1.25 when nothing is wrong, and down again at 0.75 when a boost has gone), and the passing layer: shocks with an end turn (`trade.shift` + `seasons`: E-866 and E-877 −10 for four seasons; a hard winter −8 for one) and conditions read each season (Viking danger high −30 / moderate −15 / low −5 from `history.vikings.danger`; famine −15, shortage −7 from `history.prices.severity`). `health` = base + shocks + conditions, clamped; `tickTrade` runs after the dated events and before the duties.

**Improvements** (`tradeImprovements`, from the features standing on every villa): road kept up `improved_road` +3; `bridge` +5; `landing_stage` +3; a watch (`watch_post`/`tower`/`gatehouse`/`stone_wall`) +5 and it turns a banditry roll aside; `market` +10 and `fair` +8 (features for a later licence hook; no project yet); mills and workshops +3 each up to four; `stables`/`guesthouse` +2; vines across the holdings ≥4 +2, ≥12 +4, ≥30 +6; at Count+ `tollStance` low +5 / greedy −10 (the stance is set by `setTollStance`; the Confirm card for it comes with the justice step).

**Engine knocks:** a Viking raid at the gate −10 and any supply-check event (an army fed off the country) −10 on the slow number (`season.ts` passes `raid` and `armyAtHome`); from the data, 843-02 Verdun −10 and 887-S1 Fraxinetum −8 (`shift`). Rolled catalog events (`noteRolledEventsForTrade`, called in `game.ts` after the roll and before the merchant roll): `th-bandits`/`th-armed`/`th-theft` −10 unless a watch stands; `pol-muster`/`th-muster` −10; `mkt-road` −5; `win-snow`/`win-cold` −8 for the season; `mkt-demand`/`mkt-exotic`/`mkt-distant` +3.

**What it does.** Merchant chance × `merchantTradeFactor` (0 below 20; (health−20)/35, so 1 at 55 and 1.6 at 76+; `merchant.ts`); the pack 4–6 lines at 75+, 2–3 and no fine wares below 35; the purse × health/55 within 0.5–1.5. The trade goods' bands (wine, wool, hides, honey, linen, cheese, trade goods, beeswax) are the books' bands × `tradeGoodsPriceFactor` (1 + (health−55)/150, 0.7–1.2), restored when within a few points of ordinary; grain stays the famine table's. Tolls and market dues at Count+ × health/55 within 0.4–1.6 (`revenue.ts`). The condition variable `trade_health` is readable by content.

**The readout** is diegetic only: `tradeLine` (the band word busy/fair/steady/thin/very thin/empty, the trend against last spring, the last cause, what draws trade here, this season's conditions) goes into Aldric's HISTORY block and Gerulf's system prompt with an instruction never to give a figure; Aldric speaks once when the band changes (`trade:change`), naming the cause when it worsened, and the ledger carries "Trade on the roads is … now." A stub run: ~58–60 in the quiet decades, the 840s war years and Verdun take it to the twenties, the 860s–870s climb to the high seventies on Chalon's coin and Tournus, 886–898 collapse it to 12–30, and the 900s recover toward the sixties.

### 11.9 Escalation ladder and king quest (`ladder.ts`, `quest.ts`, `tables/king-quest.json`)

Fully specified by the scripts; gated by `features.ladder` / `features.quest` (both off) because the trigger needs renown and holdings that only battles and promotions provide. Implemented and unit-tested with the switches forced on (`setHistoryContentForTests`), so the later passes only flip them.

**The ladder** (`tickLadder`; thresholds in `tables/king-quest.json`): stage `none` → `warning` when `renown ≥ 800 and (rank ≥ 3 or manses ≥ 40)` and at least 8 seasons have passed since the ladder last moved; delivers **L-001** (hooks `send_gifts` 100 d / `go_be_seen` a season away / `be_useful` 60 d, each → `submitted_to_king +1`, −small renown, back to `none`, `quest.phase = submitted`). Four seasons unanswered → the king strips him (**L-002**, needs the people's happiness < 50: `go` default → `rankLevel −1`, `stripped_by_king +1`, −large renown; `refuse` → `rebel_king`, the road), or the Church bans him (**L-003**, needs `favor_church < 3`: `excommunicated`, mood −4 a season until absolved; hooks `donation {absolution_fee}` / `give_land` precaria nona under the Church / `pilgrimage` two seasons away, 60 d / `penance {absolution_penance}`, −moderate renown; absolution sets `absolved_once`), or it comes to the road (**L-004**: `king_attempt`; choices `prepare` default / `make_public` → `quarrel_public` / `submit` → `submitted_to_king +1`, −moderate renown, a season away; hook `hunt_traitor`). Prepare or make it public → stage `quest`.

**The quest** (`tickQuest`): `startQuest` seats the nine nobles from the table (one king's man among money/land/office, seeded, already `refused`; the marriage seat follows `marriage.ts`: married to `theoderada`, it is her brother, near-certain, and `approach_marriage` wins him with a seeded ask — nothing, a son in office (`kin_office`), or a guarantee for his lands (`kin_guarantee`) — that, once given, brings his foot as well as his horse in `composeQuestSector`; married to anyone else, the seat is already `refused`; the grievance man hedges 50% over an old quarrel with her house) and delivers **Q-001**. Gathering: one `approach_<motive>` hook resolves a season (`money` costs `{ally_price}`; marriage/fear/divine need a first attempt; debt/protection/divine have `requires` from the lord's record); on a second attempt closed motives refuse, thin ones hold 50%; money can be outbid 30% (→ `hedging`, `quest_money_outbid`, `pay_again` wins him). `call_the_assembly` (requires `allies ≥ 4`) names a betrayer among the won (never a grievance man) and moves to the battle (**Q-002**, `deferred: "battle"`: the field against the king, §9, and a season away) and then the election (**Q-003**, `deferred: "promotion"`: delivered only when `features.promotions`; otherwise pushed to `dropped` with Aldric's interim beat). Election: `earned` (allies ≥ 6, favour ≥ 4, not banned) / `bought` (300 d, `simony_taint`) / `coerced` (40 men, `church_enemy`) → `crowned_king`, `crown_route`, rank 5; `counter_offer` (allies ≥ 4) → `duke_by_counter_offer`, rank ≥ 4, phase failed; `withdraw` → failed, `attempt +1`.

### 11.10 The Duke track and the open throne

`tables/duke-track.json` carries the compulsory beats, nine opportunities (each with `year`, `deadline`, `playerFlag`, what it buys, what Richard does instead, and Richard's line) and the open throne's elector factors. The player's side is hooks on the Arc 3 events, all gated `rank >= 4` (back Rudolph and marry Adelaide on 889-R1, support Louis of Provence on 890-R1, join the plot on 892-R1, shelter Charles on 894-R1, take Sens on 894-R2, the lay abbacies on 895-R1). **Richard-as-rival** (`richard.ts`, `tickRichard`): the season after an opportunity's deadline, if its `playerFlag` is unset and Richard has not already taken it, he takes it: `richard_standing +1`, an Aldric beat, a record line on the thread `richard`. `dukeTrackScore` reads the result for the ending (7+ of 9 taken, 4+, or fewer). The open throne of 887–888 is an `outcomes` block on 887-K2 (`odo` default; `self` requires `rank >= 3 and renown >= 800 and (objected_886 or march_886 == 'commanded')` and a clean record), with 888-K2's text varying on `king_888 == 'self'` and 893-K1 adding `hold_crown`.

---

## 12. Technology diffusion (`diffusion.ts`)

The Rules doc is for the LLM to judge; the engine keeps the ledger.

- When an NPC confirms a new technique, custom resource with tag `innovation`, or a project the LLM marks as anachronistic, the books pass may emit `innovation_register` with the three factors. The engine stores it with `spread = own_lands`.
- `innovation_expose { how }` is emitted when the lord teaches, sells, demonstrates publicly, uses it in a battle with allies (battle pass), lets monks copy it (a hook on the Church entries), or shows it at court. Each `how` sets a timer from the Rules' defaults (taught/sold 1 year; public use 5 years; monks copied: immediate region, kingdom in 1 year, `writtenDown = true`; opaque + programme: no timer without espionage). "Viking-only" exposure sets nothing.
- Espionage (`tickDiffusion`, each spring): for every opaque innovation with a public exposure and no timer running, roll base 10% + 10% per rival with a motive (`count_covets`; Richard once he has taken a Duke-track opportunity; the king once the ladder has begun), halved when the specialists are kept close (an NPC with a craftsman's role whose notes say loyal / married / land of his own / paid well). Success sets `spreadDueTurn = turn + 16` (four years), adds the exposure `espionage` and posts an Aldric beat.
- The timer's end moves `spread` to `region` then `kingdom` (region → kingdom: four years if written down, else at least four years and no shorter than the time it took to reach the region) and writes a record line on the thread `knowledge`. Spread is read by: the ending summary; the king-quest battle (both sides have it); prices (the first yield-raising method, by name, to reach the kingdom lowers the grain bands 10% once; `diffusion.grainCut`).
- The LLM's rules text (legibility / reproduction / proof, the worked examples) is a prompt block attached only when the books pass is about to register or expose an innovation, to save tokens.

---

## 13. The ending (`ending.ts`)

On death of old age (or an earlier death: `battleFinish` calls `markDeath(state, "battle" | "captivity")`), the game stops advancing and shows one screen: the death, then the summary, **written by the LLM from the record**, not from a template.

- `GameController.writeEnding()` (IPC `game:writeEnding`) runs once: it stores the chronicle fallback first, then asks the model with `endingSystemPrompt()` and `endingUserPrompt(state)`; a reply of more than 200 characters replaces the fallback (`byModel: true`; the first paragraph is the death, the rest the life). It then seals the play log (`finishPlay`). `advanceSeason` calls it when the pass reports `died`; the App calls it on load when the lord is dead and no page exists.
- The prompt receives the voice (`endingVoice`: the Auxerre boy grown and a priest, an old captain of the household for a king or a duke, the priest who followed Ermenald, or a grandson), the death facts, the facts by thread (Station, Land, War, whom he saved, Loyalty, the land itself, Knowledge, the Church, People, what outlived him — including `dukeTrackScore` and Richard's standing) and `endingRecord` (the first 20 and the last 60 record lines when there are more than 80). Target length: one short paragraph of death, three or four of summary; no numbers, no lists.
- The screen (`App.tsx`, the `ending-page` block) shows `history.ending.death`, the summary paragraphs and the voice, over the Title / New Game menu. `estateAbandoned` and the maimed ending keep their shorter texts.

---

## 14. Delivery plan

Everything below is in scope. Order is chosen so each step is testable and the content pattern is proven before the long tail is loaded. **All eight steps are delivered** (commits "History Step A" … "History Step H", Oct 2026), the battle pass of §9 after them (Oct 28, 2026), and the promotion pass of §10 (Oct 31, 2026). The trade, vassal, justice and capacity systems of the rank design follow in that order.

| Step | Builds | Done when |
| --- | --- | --- |
| A | Schema (`history` block, manses, age), flag registry, condition grammar, scheduler, verbatim delivery, wantsTalk, random suppression, History prompt block, the four `history_*` proposals, lint, dev jump hook (`history.jumpTo(year, season)` and `history.setFlags`) | Unit tests green; a stub-LLM run 825→911 with an empty calendar changes nothing. |
| B | Arc 1 and Arc 2 content (826-01 … 844-02), the land and value system, realm and oath beats, the 830 crisis with the three outs, supply checks for 834 and 841, deferred-battle and deferred-promotion interim lines | Every Arc 1–2 flag in the registry has a setter; a scripted playthrough of each of the six paths in the path review reaches 840 with the stated flags. |
| C | Natural events: forced weather, famine prices and reports, debuffs, N-857 ergot, sky events with framings; profiteering and alms detection | Stub run shows doubled crop effects in famine years, prices at the right multipliers, `regional_famine` set and cleared. |
| D | Arcs 3–6 content (841-V1 … 877-C1), relics, bridge levy, Viking danger bands, tributes E-866/E-877, Pippin II's men chain (839-02 → 840-03 → 864-V2) | All flags with setters; 864-V1 fixed point has a single outcome. |
| E | Arcs 7–9 content (878-K1 … 911-F1), Richard-as-rival tick, Duke track and open throne data, minting notes, Saracen/Magyar/far-horizon news, Church and scholars entries, 910-E1 Cluny | Calendar complete: every id in the scripts' Event index exists in data. |
| F | Royal vassal duties, escalation ladder, king quest (gathering, submission, absolution, second attempt), diffusion ledger and timers | State machines unit-tested with seeded states; gated by `features` until the later passes. |
| G | Age and death, the life record, the closing summary screen | A stub run ends in 910–911 with a record of the fired events; the summary prompt renders. |
| H | Docs: update `02_EVENTS.md` (random events now yield to the calendar), add the History block to `01_RULES.md`, keep `03_HISTORY.md` current | — |

Feature switches in `data/history/features.json`: `historicalBattles: true`, `promotions: true`, `ladder: false`, `quest: false`, `diffusion: true`.

**Left for the deferred passes.** The lint-as-test (`systems.test.ts`, "the content lint") pins the registered flags that nothing sets yet: battles — `witnessed_mutiny_830`, `pippin_restoration`, `letter_of_protection` (the forces tables now set `saved_gaucelm`, `saved_gerberga`, `oath_under_duress_834`, `robert_saved`; 834-02 sets `royal_vassal`, `villa_confirmed`, `second_villa`, `distrusted_834`). Any other unset flag fails the suite. Flags set by code rather than content carry `setBy: "engine"` in the registry (`forfeit_830`, `richard_standing`, `absolved_once`, `quest_money_outbid`, `duty_performed`, `duty_shirked`, `feast_sponsored`).

---

## 15. Testing

- **Scheduler:** fires exactly once; respects `requires`, `unless`, `carry`; drops and records; multiple events in one season keep order; a save mid-season does not re-fire.
- **Grammar:** every `requires` in data parses; evaluation table-tested.
- **Lint as a test:** unique ids; every read flag has a setter; every setter flag is registered; every `fallback` and `scene.open` id exists; every `channel` speaker exists in the starting household; every script block has a speaker and text.
- **Full-calendar stub run:** advance 825 → 911 with a stub LLM that answers "books:no" and defaults every choice. Assert: every event without `requires` fires in its season; the count of Autun matches the game line each year; prices follow the famine table; nothing throws; the ending fires.
- **Path runs:** six scripted flag sequences from the scripts' path review, driven by `history.setFlags` and `history_choice` proposals, asserting the 840 standing table.
- **Land:** the 825 villa values within ±15% of 525 d / year under the stub run; visibility event eligibility thresholds.
- **Supply:** seeded rolls hit the table bands; countermeasures apply; with men under arms the roll returns a militia call and takes nothing until the gate is fought.
- **Battles** (`history/battles.test.ts`, `session/battleFlow.test.ts` "History battle flow"): every deferred battle has a forces entry; `when` selection; row fallback; fill and displacement sparing fixed lines; tier by rank and mode; ride modes by age, wound and `sent_men`; the call's shape and the season block; refuse penalties and the barred hall; the abstract layer once per event; results, survivor and home-defence store settlement; the quest sector and the round-three betrayal; a Rank-and-File sector, a Sub-Command sector behind a makeshift stone wall, an enemy fort garrisoned, a duke's Full Command by right, a captain's contingent, an old man unattached, a home defence at the villa's wall, and a schema round-trip. Arc tests drive `runHistorySeasonPass` directly, so their clocks stand in for the hall and clear an open history call before the next season.
- **Prompt budget:** the History block for the busiest season (autumn 840: 840-02, 840-03, oath beat) stays under 1,800 tokens.
- Temporary scripts live in `/tmp`; the repo gets only `*.test.ts` beside the modules, as the codebase does today.

---

## 16. Source documents in the repo

The design sources are checked in so later sessions can read them without the author re-attaching them: `design/history/Event_Delivery_Scripts.md`, `design/history/Historical_Event_Arcs.md` (converted from .docx; table cells flattened), `design/history/Technology_Diffusion_Rules.md`, and `design/history/Battle_Force_Tables.md` (the rosters behind `data/history/battles.json`, §9). The combat design doc and the rank-and-file vignettes already sit at the repo root.

---

## 17. Assumptions

Confirmed by the author on Oct 27, 2026: the interim battle and promotion behaviour of §9–§10, and the source documents in §16. The rest stand as written unless the author says otherwise.

1. **Summons choices still fire** even though their battles do not (§9). Confirmed.
2. **Deadline default for the 830 land crisis:** the count seizes the villa's vacant manses first, the hall stays, play continues. The scripts imply a seizure but do not say what the player is left with.
3. **Live scenes are voiced by Aldric as the lord's clerk-in-camp**, Ermenald where the scripts give him the line. Follows from "household only"; if Aldric must stay home in some scenes, those stages become his letters, which the scripts also allow.
4. **Body age 17 in 825.** Changes nothing until the battle pass (participation bands) and the ending.
5. **Manse split 6 free / 4 servile, 4 vacant.** Tributes and the land system read it. The scripts suggest 4 of 10 vacant and the 6/4 split for the tribute example.
6. **Hook window:** a hook may be taken until the next dated event on the same channel, minimum two seasons. Some hooks are naturally longer (ergot sorting, predicting the eclipse); those declare `window` explicitly.
7. **Visibility thresholds** (60 and 1.5×) and the income valuation formula are tunables with the stated test targets, not canon.
8. **Random "other" suppression** applies to the whole season when any dated event fires, including Ermenald-only events. Weather still rolls (or is forced).
9. **Lines the source leaves unscripted** (the 884 funeral block, the duty results, the ladder rungs, the quest scenes, Richard's beats, the diffusion and home-coming notes) are engine-written in the scripts' register and flagged `notes: "engine-written"` in the data where they sit on an event.
10. **Two flags from the first registry draft were removed** (`hildebrand_hosted`, `bishop_jonas_met`): no line in the scripts sets or reads them.
11. **The death roll is seeded** by region, year, season and turn, so a given save dies at the same season on replay; across saves the death falls anywhere in 910–911.

**End of 03_HISTORY**
