# 01_RULES
**Carolingian Minor Noble – Mechanical Procedures**  
**Version 1.0 – Prototype**

This document is second in authority after `00_CONSTITUTION.md`.  
It defines how the engine resolves a season, how the LLM may propose changes, and how player innovations become numbers.  
If this file conflicts with the Constitution, the Constitution prevails.

---

## 1. Time

Seasons cycle: Spring → Summer → Autumn → Winter → Spring (year + 1).  
One **Advance season** action is one turn. Mid-season dialogue does not advance time.

At game start the year is 825, season Spring, turn 1.

---

## 2. Season resolution order

When the player advances the season the engine MUST execute these steps in order:

1. **Standing orders** — convert standing orders into this season’s labour assignments and queued transfers where the text maps to a known action. Unparsed orders are passed to the LLM as intent only; they do not silently invent resources.
2. **Agriculture and stores** — resolve sowing, harvest, and livestock according to §3.
3. **Projects** — spend assigned callable labour-days on active projects; add progress; complete if labour and materials are satisfied.
3a. **History** — run the dated calendar for the incoming season (§11): oath beats, the land and price systems, due events delivered verbatim, duties, the ladder, diffusion timers, the age roll. If the lord dies here the closing page is written and the season report is the last.
4. **Events** — roll events according to §4, with the calendar's forced weather and with the "other" event suppressed when a dated event fired. The LLM then receives the rolled event ids and may return `event_effect` proposals. Validated event effects are applied without a second player confirm (the player already chose to advance).
5. **Modifiers** — tick temporary modifiers (`seasons_remaining -= 1`; remove at 0). Permanent modifiers stay.
6. **Market** — if any event or harvest marked the market dirty, the LLM may propose updated price ranges; otherwise the engine nudges grain prices from harvest quality and leaves the rest.
7. **Seasonal report** — the steward LLM produces `speech` plus optional `chronicle`. The UI shows narrative, applied mechanical effects, and any rejected proposals with reasons.

Hands-off play uses the same pipeline. There is no mid-season chat step.

---

## 3. Agriculture, labour, and livestock

### 3.1 Callable labour

Callable labour is **extra** days beyond the normal agricultural cycle (Constitution §4.3).  
The engine computes the pool each season:

- Adult men / women / youths on the estate × the season range midpoint (or a stored override).
- Prototype midpoints: Spring 15 / 10 / 3; Summer 10 / 8 / 2; Autumn 15 / 10 / 3; Winter 20 / 12 / 4.

Assignments that exceed the remaining pool are rejected.  
These extra days are already after harvest and field subsistence; assigning them to projects does not set harvest risk or cut yield. Events and Confirm may still apply a `harvest_risk` modifier.

### 3.2 Arable and the two-field default

Until a technique changes it, **half** of `fertile_arable` is treated as sown, half fallow.  
Sown acres are split among wheat, rye, barley, and oats as recorded on the holding (`sown` acres).

- Wheat and rye: sown in Autumn, harvested in Summer.
- Barley and oats: sown in Spring, harvested in Autumn.

Normal surplus per sown acre (Constitution §4.4) uses the range midpoint, then modifiers:

- Wheat 6, rye 7.5, barley 7.5, oats 5.5 modii/acre.

Seed is already reserved in those surplus figures. Do not subtract seed again.

Spring of a new game: autumn-sown wheat and rye are already in the ground from the previous year.

### 3.3 Other land

- **Meadow**: no tracked hay resource in the Constitution table. Winter livestock loss is reduced by meadow acres per cattle+horses (see §3.4).
- **Vineyard**: Autumn may add wine (0.4–0.8 barrels/acre, midpoint 0.6) after modifiers.
- **Orchard**: Autumn may add a small food surplus represented as `cheese` is wrong — prototype records orchard take as a note plus a small `honey`-like store is also wrong. Prototype: add 2–4 (mid 3) abstract `trade_goods` per orchard acre in Autumn (dried fruit / cider value), unless a custom resource for fruit exists.
- **Woodland**: Winter or idle seasons may add 0.05 cart-load softwood per woodland acre if labour remains; prototype grants a flat 1 softwood cart-load in Winter if woodland ≥ 10 acres.
- **Scrub / waste / swamp**: produce nothing until converted by a project.

### 3.4 Livestock (prototype)

Each Spring: sheep may add wool (`sheep * 2` pounds, modified).  
Each Autumn: pigs +10% (rounded down) if woodland ≥ 10 (pannage); cattle/sheep/horses +5% if winter was not lethal (the +5% is added as sheep). If a holding has `monastery`, **after** that autumn increase consume **1 sheep** (the year's increase) when the flock is at least 1; skip if sheep are 0 (no crash, no hunger). Chapel-only estates do not pay the sheep. Do not take a sheep in other seasons.  
Each Winter: lose 5% of cattle and horses (rounded down, minimum 0) if meadow acres < (cattle + horses); else lose 0–1 animal on a 1-in-6. Pigs/sheep 2% if stores of oats+barley are empty.

Poultry and household smallstock remain untracked as lordly herds except the demesne `poultry` resource.

### 3.5 Household consumption (prototype)

Each season the lordly household and retainers consume a modest grain tithe from stores so the ledger moves:

- 0.5 modius of the most plentiful grain per household per season, taken from rye then wheat then barley then oats.
- If stores cannot meet this, set `hunger` (the people grow less glad; yield − next season).

This is a playable simplification, not a claim about Carolingian rations.

### 3.6 Tithe of an on-estate chapel or cell

If a holding has `chapel` or `monastery`, each season also consumes **0.15 modius of grain per household** as tithe to the house, plus **1 lb wool** when stores allow (customary render to the oratory or cell). Short grain tithe can cause hunger the same as household shortfall. A short wool year simply skips the wool render; it does not crash or set hunger.

If a holding has `monastery` (not chapel alone), once per year in Autumn the cell also takes **1 sheep** after the §3.4 herd increase — the year's animal-increase tithe. Skip if the flock is empty.

An active standing order that expressly withholds the grain tithe, the wool render, or that sheep causes the engine to skip that render. If the stores could have paid, that skip is church neglect (§3.7). A thin store is not neglect.

Religious events are more frequent when a monastery stands on the estate (weight 3).

### 3.7 The cell of Saint-Martin

Ermenald (the chaplain) proposes; the lord Confirms. The engine writes the books. Speech stays in the hall's language.

**Sponsored feast** (`sponsor_feast`, Ermenald only). One per season. The holy day he names follows the season: spring Easter or the Rogation Days, summer St John's Day, autumn Martinmas, winter Christmas.

- Plain: 12 denarii and 1 lb beeswax. The people take heart by 4, unless that would pass 80.
- Grand: 30 denarii, 1 lb beeswax, 1 barrel of wine, and a households' meal of 2 modii of grain or else 2 lb cheese. The people take heart by 8, with the same ceiling.

If the heart is already at 80 or above, the feast still costs its goods but does not lift them further, and does not lower them. Other joys may still pass 80. On the next Advance season, half of the joy that was actually given cools; half remains. A feast the chest or stores cannot pay is refused and changes nothing.

**Neglect.** The engine counts what it can see: a withheld tithe, wool render, or autumn sheep when the stores could pay; an order to work on Sunday or a feast day; goods taken from the cell. One slip displeases Ermenald and lowers the people's heart by 2. Three slips inside about a year (four seasons) bring a letter from the bishop of Autun to the count, written in the Customs books, a further drop of 5, and a lasting note Ermenald and the season's chronicle can see. A season kept well lets one slip fall away, and slips older than a year fall away on their own.

**Cell surplus.** Ermenald may sell a little beans, peas, beeswax, candles, or herbs at a fair price through Confirm. Amounts stay small (a modius or two, a pound, a bundle) and a second sale of the same good waits on the next season. He may also offer a brother to nurse the sick or teach a youth letters, for a few denarii. He does not sell in bulk.

**Alms in hunger.** If `flags.hunger` is set and `flags.regional_famine` is false, the cell may once give 3 modii, grudgingly. Ermenald remembers. A second request inside eight seasons is refused; after that, only 1 modius. If `regional_famine` is true (a flag a later event may set; the default is false, meaning the dearth is local), the cell gives nothing.

---

## 4. Random events

Catalogue: `02_EVENTS.md`. Engine data: `src/engine/eventCatalog.ts`.

Each season the engine rolls:

1. **Weather** — Spring/Summer/Autumn: category 1. Winter: category 2 (winter-only) instead. Always one weather event.
2. **One other category** among those eligible:
   - Unfinished / Ongoing Projects — only if `projects` has an incomplete item (weight 3)
   - Population & Mood — always (weight 2)
   - Religious — weight 3 if a monastery is on the estate; weight 2 if a chapel or monastery_nearby; else 1
   - Lordly & Political — always (weight 2)
   - External Threats — weight 1 inland; 3 if a threat is already active
   - Resource & Market — always (weight 2)
   - Special Land Features — only if a matching feature exists (weight 2)
3. **Merchant visit** — rolled **separately** from weather and the “other category” event. It is not an entry in `02_EVENTS.md` and does not consume that slot.

   The engine draws a base chance uniformly inside the current **incoming** season’s range, then adds access modifiers (Fontenay starts with **none**):

   | Season | Base chance |
   |--------|-------------|
   | Spring | 25–30% |
   | Summer | 40–45% |
   | Autumn | 40–50% |
   | Winter | 10–15% |

   | Modifier | Effect | Starting Fontenay |
   |----------|--------|-------------------|
   | Near a major river **or** a main road | +10–15% (one: +12%; both: +15%) | Off. Mill-leats and ordinary streams do **not** count. Ordinary pack-paths do **not** count. |
   | Landing stage **or** improved estate roads | +10% (once, even if both exist) | Off. Project `landing_stage` or `improve_road`. |
   | Good reputation / known surplus | +5–10% (engine uses +8%) | Off. |
   | Remote **or** troubled (`active_threat`) | −10–15% (one: −12%; both: −15%) | Off. |

   Chance is clamped to 2–90%. On success, `flags.merchant_present` and `merchant.present` are set, an NPC id `merchant` is added, and `merchant.stock` is filled with a thin pack of peddler wares. The visitor also receives a purse of about 1000 denarii buying power (plus any stored bonus for that name, soft-capped near 2000). The merchant leaves on the next season unless the roll succeeds again.

   **Trade:** Buys and sells go through the stall window (not LLM JSON). Confirm writes `resources` and merchant stock. Buy price sits above market mid; sell below, except goods sold this visit which may be bought back at the exact sale price. Large amounts step into worse bands after a demand-sized step. If the player drains that named visitor's purse, they gain +200 buying power on their next appearance. The player cannot Confirm a basket they cannot pay. `transfer_resources` **buy** and **sell** still require a merchant this season and follow the same stock, purse, and spread rules. `consume` / `gain` never need a merchant.

Pick uniformly inside the chosen category’s polarity: 50% negative, 30% positive, 20% mixed (if that polarity has entries). Then pick uniformly among those entries.

After the roll, the LLM must return `event_effect` proposals that change numbers. Flavour text alone is not a mechanical effect. If the LLM returns nothing valid, the engine applies the category’s default numeric stub (small resource or mood swing).

**The calendar overrides two of these rolls** (§11): in a season where a dated historical event fires, step 2 (the "other" category) is skipped; in the scripts' famine years the weather roll is replaced by the forced event from `data/history/tables/forced-weather.json`. The merchant roll is untouched.

---

## 5. Projects

Baseline costs: Constitution §4.5. Keys live in `src/engine/projectCatalog.ts`.

Progress is `labour_days_done / labour_days_required`.  
Materials (lumber as softwood+hardwood cart-loads, iron lb, stone cart-loads) are reserved when the project starts if stocks allow; otherwise the start is rejected. The books name only the stores actually set aside. Clearing scrub reserves nothing. Charcoal burning reserves timber for the mound and no iron or stone. A known catalogue key keeps those store charges even if a proposal names a higher iron or stone cost for them.

Callable labour assigned to a project this season is days of that kind of work, converted 1:1 into labour-days, with women counting 1.0 on listed “men + women” work and 0.6 on “mostly men” heavy work; youths 0.4. The figure cannot exceed the callable days of that kind still free this season. The books name those figures as days of work. A hands line names the work it belongs to (the id of the `start_project` in the same pack, or that work's catalogue key). If that work was not created, the days are not written onto a different work.

Completion applies the feature or the land change the catalogue already names (a mill standing, an acre of scrub become ploughland). That change is not a store payout.

A project may also name a one-time result: goods added to the stores when the work is marked finished. The chronicler reasons the cost, the days, and that result — for a catalogue work or for a new one with no catalogue entry, such as steel or gunpowder — in cart-loads, pounds, denarii, and days of work, and puts the same amounts on the proposal. Confirm keeps those figures. Costs are taken when the work begins, from what is already in store. The result is paid only when the days are done. Cancelling pays nothing. A project with no named result finishes without inventing goods. There is no yield table, and no baked share of the wood. Within one Confirm, works are applied in the order named. If an earlier work finishes inside this season — its days fit in one season of the spare labour the books already know, or the chronicler marked it as finishing this season — and it names a result, those goods are in the stores before a later work in that same Confirm pays its cost. If the getting or the using runs past the season, the later work cannot spend goods that are not in the barn, and nothing is invented. A work that does not finish this season does not feed a later cost. Two separate Confirms do not share that credit. Speech, the books line, and the payout use the same numbers. Clearing scrub still only makes farmland unless a real yield was named. Coppicing is not a catalogue work; it spends timber only when timber was named as a cost, and it pays the timber that was named as a result.

Custom projects are allowed if the proposal includes labour and material costs. The engine does not invent those costs. A new design may also name charcoal (cart-loads) and denarii; Confirm takes those figures and no others. A catalogue key keeps the charcoal the books already charge.

When someone refuses or delays a work because stores, labour, coin, or some other thing on the estate is short, the reply the lord hears names each short thing and the amount still needed before the work can begin. The units are the ones the books already use: lb of iron, cart-loads of charcoal, timber, or stone, denarii, days of work. A thing the estate already holds is not called short. If some is already on hand, the reply says the amount still wanted, not only the full cost of the finished work. Those figures are the begin-cost Confirm will take, minus what is already in store. Speech does not name one sum while the card takes another.

---

## 6. World-state file

Canonical facts live in `world-state.json` (schema: `data/world-state.schema.json`, runtime: Zod in `src/engine/schema.ts`).

The LLM never writes this file. It only returns proposals. The engine validates, applies or rejects, and appends one line to `history.log`.

---

## 7. Proposal (delta) schema

Every LLM response is JSON:

```json
{
  "speech": "in-character words the player reads",
  "chronicle": "optional court-chronicle paragraph",
  "proposals": []
}
```

Proposal `type` values:

| type | Who may propose | Notes |
|------|-----------------|-------|
| `assign_labour` | steward; chaplain if church project | men/women/youths to a project or `unassigned` |
| `set_standing_order` | steward; chaplain (religious custom) | persisted instruction |
| `start_project` | steward; smith if forge-related; chaplain if church-related | costs from catalogue or declared custom |
| `adjust_project` | steward; smith if that project is forge-related; chaplain if church-related | rush, cancel, labour this season |
| `adjust_sowing` | steward | Crop mix. `springBarleyShare` (0–1 of remaining spring capacity; rest oats), `autumnWheatShare` (0–1; rest rye). Mid-spring also fills remaining unsown acres so the ledger moves before Advance season. |
| `transfer_resources` | steward; merchant (buy/sell only); smith (metal/fuel/hides/trade_goods only); chaplain (alms, grain, wine, wax, linen, timber, stone, modest cell surplus) | buy / sell require a visiting merchant; consume / gain do not. Chaplain gain of beans, peas, wax, candles, or herbs is a small sale at a fair price. Chaplain gain of grain while the villa is hungry is cell alms (§3.7). |
| `sponsor_feast` | chaplain only | plain or grand holy day at the cell. One per season. See §3.7. |
| `add_modifier` | steward; smith (forge targets only); chaplain (mood, custom, accident_risk) | temporary or permanent |
| `remove_modifier` | steward | |
| `register_resource` | steward; smith (craft/metal) | new custom good |
| `register_feature` | steward; smith (forge-class); chaplain (chapel, monastery) | must set `isNew: true` |
| `register_npc` | steward; chaplain (monk/priest/novice/bishop) | must set `isNew: true`; player confirm required |
| `event_effect` | season referee only | auto-applied after Advance season |
| `history_choice` / `history_hook` / `history_outcome` / `history_scene` | steward, chaplain | names an option, hook, outcome or scene advance declared on a fired historical event (§11); the engine writes the flags and takes the costs on Confirm |
| `innovation_register` / `innovation_expose` | any portrait NPC | the diffusion ledger (`03_HISTORY` §12): legibility, reproduction, proof; how the thing was shown |

Mid-season proposals wait for explicit player Confirm or Deny. Each change may be confirmed or denied on its own; Confirm all writes every change still waiting. Denying a work also sets aside the hands and other changes proposed for that same work. If a work cannot be begun, those dependent changes are skipped with one explanation.  
Rejected proposals are logged and not applied.

If the model returns speech with no valid proposal, the engine repairs once, then may draft a conservative proposal from a clear order (sow / clear scrub / give grain / blessing). The player still Confirms. If nothing can be drafted, the UI shows a system line that the books are unchanged.

Flavour-only `event_effect` (id and summary, no resource/mood/nested) does **not** count as covering an event. The engine then applies the default numeric stub. Stubs pick a grain the estate actually holds so consume cannot silently fail.

### 7.1 Smith allow-list

The smith scene may only emit: `transfer_resources` (iron, charcoal, copper, tin, hardwood, hides, trade_goods, custom metal/craft goods), `start_project` / `adjust_project` for the catalogue forge works (forge, bloomery, trip-hammer), a custom `tag: forge`, or a new design that names its own costs under a project key that is not already a catalogue work, `add_modifier` targeting `specific_resource_output` or `project_speed` or `accident_risk` on forge work, `register_resource` (craft/metal), `register_feature` (`forge`, `mill_forge`, `bloomery`). A free key with its own costs is his forge work. It is not rejected merely because the key is not forge, bloomery, or the trip-hammer. A catalogue work that is not forge work (clearing scrub, a carpenter's shop, and the like) is rejected with reason `npc_not_authorized`. An iron plough is not the carpenter's to begin. Anything else is rejected with reason `npc_not_authorized`.

Bernard forges. He does not write the fields or the harvest. If the lord asks about the harvest, he sends the lord to Aldric and does not propose a yield. Forging a tool does not itself change what the fields yield.

His own smithing — a tool, or a metal piece that is not a building — does not take the village's spare days. The men's, women's, and youths' days are not filled onto it, and `assign_labour` cannot put them there. The clock is Bernard himself, the same way a road errand occupies Gerulf: the work is measured in seasons of one smith. The size is the custom cost the forge already uses. A cost no greater than the most spare days those tables give one man in a season finishes when the season turns, and then he is free. A cost he treats as more than that stays open across seasons. While it is unfinished he will not begin another of his own pieces, and he will not begin a building. Speech and Confirm say he is still at that work, and the next thing waits. A one-season piece does not block the season after it finishes.

Buildings and additions to the iron works that need ordinary woodworking keep the village's spare days. That includes the forge, a bloomery, a trip-hammer, and the same kind of workshop. Those are not his solo clock. Catalogue forge buildings are not stripped of labour.

Bernard does not put a bloomery on the table because charcoal and the chest look ready. He mentions it only while the lord is speaking with him, and only when the estate already holds every store the books will set aside to begin that work (timber, stone, and charcoal; clay is dug with the work and is not a store; the catalogue bloomery takes no coin). The mention says a bloomery could keep a steady supply of iron, and that the lord should ask if he would hear more. No card is written until the lord asks. Then Bernard explains the clay shaft, the bellows, bog ore, how slow the iron comes, and that bought iron still goes further, and a card may be proposed at those same costs. If the stores are short, he does not offer it. Aldric, if the lord asks him, sends the lord to Bernard and does not queue the work or speak Bernard's lines. Confirm and the turning of the season do not queue it.

### 7.2 Chaplain allow-list

The chaplain (capellanus / prior of an on-estate cell) may only emit: `transfer_resources` (denarii, grain, wine, honey, beeswax, linen, salt, timber, stone, custom tagged church|liturgy|alms|cell, and a modest sale of beans, peas, candles, or herbs), `sponsor_feast` (plain or grand), `start_project` / `adjust_project` / `assign_labour` for `timber_chapel`, `stone_chapel`, `small_cell`, or `tag: church`, `set_standing_order` (tithe, Sunday, burial, clerical hospitality), `add_modifier` on `mood`, `custom`, or `accident_risk`, `register_feature` (`chapel`, `monastery`), `register_npc` with role chaplain|priest|monk|novice|bishop. Anything else is rejected with reason `npc_not_authorized`. He does not run the demesne. Feast prices, the one-feast season, the 80 ceiling, neglect, and hunger alms are engine rules (§3.7), not numbers he may invent.

### 7.3 Merchant allow-list

While a merchant is present, the merchant scene may only emit `transfer_resources` with direction `buy` or `sell`. Buy is limited to `merchant.stock`. Anything else is rejected with reason `npc_not_authorized`. The steward may also propose buy/sell in the same season, under the same stock and presence rules.

---

## 8. Innovations and modifiers

When the player introduces knowledge that did not exist in 825:

1. The LLM judges feasibility (materials, tools, teachability, time, labour, accident, social/religious suspicion). Success is never automatic.
2. Typical success: a `start_project` and/or a **temporary** `add_modifier`. Permanent status requires `seasons_remaining` to run out with `promote_on_expire: true`, or an explicit later proposal after practice.
3. New goods: `register_resource` with unit and price range, then `transfer_resources` / production modifiers.
4. The engine stores modifiers. Later seasons apply them as numbers so the model cannot forget an ongoing trial.
5. A new tool is forged as a project. Forging it does not change yield, and finishing it does not either. The steward proposes one ordinary `add_modifier` only after the work is finished and the lord tells him to put the people onto it. He chooses the target from what the tool does (`grain_yield`, `labour_efficiency`, `spoilage`, `livestock_yield`, `project_speed`, or `specific_resource_output`). Other husbandry is whatever book change already fits: three-field rotation stays `adjust_sowing` (`rotation: three_field`), and legumes or spring manuring are the proposal he chooses. On land the estate already farms, each real improvement is modest — around a quarter more, not a doubling. That figure is judgment for each change. Several different improvements each keep their own figure. He does not grant the same improvement twice (the same source, or the same spoken reason). A different reason on `grain_yield` is a separate custom. If his speech names the figure, the modifier uses that figure. There is no per-invention yield constant.

### 8.1 Modifier targets (closed list)

`grain_yield`, `labour_efficiency`, `spoilage`, `project_speed`, `specific_resource_output`, `accident_risk`, `mood`, `market_price`, `livestock_yield`, `harvest_risk`.

Escape hatch: `custom` — stored and shown in the ledger and injected into prompts; it does **not** change engine numbers until mapped to a closed-list target.

### 8.2 Stacking

- `multiply` effects on the same target: multiply together (cap 0.4–2.5).
- Different improvements on the same target multiply together. An identical modifier (the same source, or the same spoken reason) is not written twice. A new reason on `grain_yield` is a separate custom.
- `add` effects: add (labour_efficiency add is extra fraction of pool).
- `set`: last applied wins (avoid except for market_price).
- `accident_risk` and `harvest_risk`: use the maximum of competing values.
- `mood`: no longer a parallel yield/labour dial. `add` of +1 nudges estate `peopleHappiness` by +3 when the custom is confirmed, and the same amount each Advance season while the modifier lasts (event `moodDelta` only uses the season tick, so it is not applied twice). Happiness is the source of truth: wretched effort 0.90, settled 1.00, joyful 1.10 (linear 0–100). That quiet multiplier scales agricultural yield, livestock yield, and project progress; callable labour heads on the books stay the same. Do not print a “happiness bonus” or extra labour-days line. Old saves that still carry mood modifiers keep working — they are read as happiness pressure, not as a second yield factor.

### 8.3 People coming and going

After the season happiness tick, the engine counts consecutive **joyful** seasons (`peopleHappiness` ≥ 75) and **wretched** seasons (≤ 24). Old saves start both streaks at 0.

- **Arrivals.** On the second consecutive joyful season, 15% chance a family seeks a place; +15% per further season, capped at 45%. Offered as a mid-season Confirm (`settle_households`): one household, a man, a woman, and a youth. Accept writes them into the demesne people; refuse turns them away. Unconfirmed, they lapse on the next Advance like other orders. The season report cannot take them in without Confirm.
- **Departures.** On the second consecutive wretched season, 20% chance a household slips away in the night; +20% per further season, capped at 55%. Applied at once — no Confirm. Households may fall to none. When no households (or no working-age people) remain, the villa is abandoned: the game ends.

These rolls are extra engine events. They do not consume the catalogue population slot. Player-facing copy is hall language only.

---

## 9. LLM role split

- **Steward / NPC scene** — voice of that person; mid-season; proposals need confirm.
- **Season referee** — Court Chronicler; may speak as the steward for the report; may emit `event_effect`.

Neither role may invent geography, named characters, or major resources without `register_*` and `isNew: true`.

Prompt packs send a slice of state, not the full Constitution, every call.

---

## 10. History log

Append-only UTF-8 text. Each line:

`ISO-8601 | turn | season | year | actor | APPLY|REJECT|EVENT|CHAT | summary`

---

## 11. History: the dated calendar of 825–911

Design and full detail: `03_HISTORY.md`. The rules the rest of this document depends on:

- **Source and delivery.** About a hundred dated events (`data/history/events/`) from the author's scripts are delivered **verbatim** by the engine at the start of their season, as chat messages from Aldric (`steward`) and Ermenald (`chaplain`) only, after the season report. The LLM never rewrites them; it talks about them afterwards from a **History block** in those two prompts (what the household knows, what it does not, the open choice, the hooks still live).
- **Choices and hooks are conversational.** The lord speaks; Aldric or Ermenald judges and proposes `history_choice`, `history_hook`, `history_outcome` or `history_scene`; the flag is written **on Confirm only**. An unanswered choice takes its `default` option when its deadline passes. Costs are taken from stores at Confirm; if the stores cannot pay, the card stays pending.
- **State.** `state.history`: a closed flag vocabulary (`data/history/flags.json`), what has fired, the realm line (emperor, king, count of Autun, whom the lord is sworn to), the land block (recorded value 6,500 d, true value, visibility, tenure and charter), famine prices, Vikings, duties, the ladder and quest, the diffusion ledger, the rank block (patron, counties, mint, royal fisc, last office take), the sworn men (`vassals`), the trade health, the life record, `away`, `dead`, `ending`. Old saves load with defaults.
- **Interaction with §4.** When a dated event fires the random "other" event is suppressed; famine years force the weather roll and multiply grain prices by the scripts' table.
- **Background systems** run inside the pass: oath beats on a change of count; land revaluation each spring and visibility events; army supply checks on tagged events; royal vassal duties (gated); Viking danger bands feeding the existing raid path; relic upkeep; tributes E-866/E-877 from manses and rank; Richard-as-rival on the Duke track; diffusion timers and espionage; the age roll.
- **Age and the ending.** The lord was 17 in 825. From spring 910 a seeded death roll runs each season and is certain by winter 911. On death (old age, battle or captivity) `advanceSeason` refuses to turn, and one closing page is written by the model from the record (`history.ending`), with a chronicle fallback when the model cannot be heard.
- **Rank** (`03_HISTORY.md` §10, `Isekai 825 Rank Progression — Holdings and Powers.md`). Renown makes the lord *eligible* (1 / 100 / 500 / 1,000 / 2,000 for Minor Noble / Viscount / Count / Duke / King); a hand grants the step — a scripted window (834-02, 835-02, 845-P1, the election Q-003) or, within 2–8 seasons of crossing the threshold, a generic summons from the count of Autun or the king, never while the lord is away, on the ladder, in the quest or under a strip's 12-season cooldown. Only a quest or an open throne makes a king. Each step grants from `data/history/ranks.json`: villas as real holdings held as benefices of the patron (3 / 12 / 45), chest, men, vassals (3 / 10, groups at Duke), the seat's wall, and from Count a county block per county (fisc manses, levy, yearly tolls, market, pleas, fisc dues, officers) paid a quarter each season into the chest, tolls and market scaled by the hidden trade health; the Chalon mint at Duke from 864; the royal fisc at King. Stripping (L-002) takes the office and the stripping hand's benefices and leaves owned land, men and chest. The Books carry a **Holdings** page for all of it; the Estate page sums every villa.
- **Trade health** (`03_HISTORY.md` §11.8a). A hidden 0–100 number for the Autun region, 55 in 825, never shown. The lord's works lift where it rests (road +3, bridge +5, landing +3, a watch +5, mills and workshops +3 each to four, lodging +2, vines by scale, a market +10 and a fair +8 when he has one, tolls kept low +5 or greedy −10 at Count+); the calendar and the season knock it (Viking danger −5/−15/−30 and a raid −10, famine −15, an army fed off the villa −10, bandits −10 unless a watch stands, a hard winter −8 for the season, the ransoms −10 for a year, Verdun −10, Fraxinetum −8) and abbeys and the new coin raise the baseline for good (Chalon +8, Tournus +10, Cluny +10). It recovers +3 a year, +5 in full peace. It sets whether a merchant comes (none below 20, half again as often at 76+), what he carries and how much coin he has, what wine, wool, hides and the other trade goods fetch in the Books' bands (grain stays with the famine table), and the tolls and market dues of a county. Gerulf and Aldric read it in words only; Aldric says when the roads change.
- **Vassals** (`03_HISTORY.md` §10a). From Viscount the lord has sworn men (3, then 10 at Count; a line per county's lords at Duke and King), each with a mood 0–100 shown as a figure under the people's happiness meter (content / steady / angry; the three icons in `art assets/UI/`). The engine moves them — led to victory +8 or defeat −8, a raid or bandit call refused −6, a step up +5, stripped −10, a feast +4, a benefice taken back −5 — and Aldric proposes `vassal_mood` for what happens in talk; moods fade a point a season toward the middle. Content men bring one more man each when the lord rides, angry men none and a county's lords a smaller file; a man angry a year may leave with his men and the villa he held of the lord; content men turn the king quest's doubters and shield the lord from being stripped by a word, angry men do the opposite.
- **Justice** (`03_HISTORY.md` §10b). One or two cases a year come before the lord at every rank, never two in a season — the rest were small and the reeve settled them. Aldric brings the case (Ermenald where the church is in it) at the season's start; the lord judges it in conversation, and the speaker emits `justice_verdict` from the case's closed list for the Confirm card. The tables follow the rank: a villa lord's quarrels (a moved boundary stone, a pig in the beans, a dead man's strip), a count's pleas opened with "you heard dozens; this is the one that will be remembered" (a killing between noble houses, a vassal accused by his tenants), a duke's one great case a year (two counts at war over a border, an appeal against his own officer, a case the king sent down). Each verdict pays what its row says — fines to the chest or out of it, the people's loyalty, the church's favour, the sworn men's mood, renown, the missi's notice — and moves the lord's running name as a judge; refusing to judge, or leaving a case two seasons, makes a feud that comes back in a few seasons and costs the people's trust. From Count the lord also sets a stance for the officers who judge in his name (lenient / fair / strict / extortionate: fines ×0.5–×2 on the pleas line, loyalty +2 to −3 a year, the church approving or condemning), and an extortionate court brings the king's missi, who take a tenth of the chest, renown and royal favour; a judge known as partial gives the king his pretext on the ladder. The same card (`set_stance`) sets the tolls low, customary or greedy. The Books' Holdings page shows the case before the hall, the stance, the lord's name as a judge and the last verdicts.
- **Administration** (`03_HISTORY.md` §10c). No new officers: Aldric grows with the lord. He can hold so many of the lord's own villas in his books by rank (1–2, 3–4, 10–16, 40–60; no limit as king), from the low end of each range — so a new count's twelve villas already stretch him and a new duke's forty-five more so. Over by one or two, the furthest villas pay a tenth less and Aldric sounds tired; by three to five, a fifth less and a villa's dues go uncollected each season; by six or more, three tenths less, a reeve keeps back what he pleases and the people mutter. He says so once at each step, and once when the books are in hand again. The fixes are spoken to him and written with his `steward_office` card: raise him (twice per rank; 100 d × rank and 5 d × rank a season, half the way to the range's top each time), let him hire clerks (120 d and 8 d a season for three villas, four clerks at most), or at Duke name a deputy over the outlying villas (400 d and 25 d a season for twelve; competent, ambitious, and some springs a tenth of the fisc's dues stay in his hand) — or hold less. The household's pay comes out of the chest each season; the Books' Officers section shows his style, villas against capacity, the deputy and what has gone uncollected.
- **Deferred.** The king's ladder and quest (`features.ladder`, `features.quest`) are built and tested but off.

---

**End of Rules (prototype)**
