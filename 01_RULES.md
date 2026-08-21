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
4. **Events** — roll events according to §4. The LLM then receives the rolled event ids and may return `event_effect` proposals. Validated event effects are applied without a second player confirm (the player already chose to advance).
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
Assigning more than 80% of the male pool in Spring, Summer, or Autumn sets `harvest_risk` for that season (yield multiplier 0.85 unless a modifier says otherwise).

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
Each Autumn: pigs +10% (rounded down) if woodland ≥ 10 (pannage); cattle/sheep/horses +5% if winter was not lethal.  
Each Winter: lose 5% of cattle and horses (rounded down, minimum 0) if meadow acres < (cattle + horses); else lose 0–1 animal on a 1-in-6. Pigs/sheep 2% if stores of oats+barley are empty.

Poultry and household smallstock remain untracked as lordly herds except the demesne `poultry` resource.

### 3.5 Household consumption (prototype)

Each season the lordly household and retainers consume a modest grain tithe from stores so the ledger moves:

- 0.5 modius of the most plentiful grain per household per season, taken from rye then wheat then barley then oats.
- If stores cannot meet this, set `hunger` (mood −, yield − next season) via an engine-applied temporary modifier.

This is a playable simplification, not a claim about Carolingian rations.

### 3.6 Tithe of an on-estate cell

If a holding has `chapel` or `monastery`, each season also consumes **0.15 modius of grain per household** as tithe to the house, plus **0.5 lb beeswax** when stores allow (lights for the oratory). Short tithe can cause hunger the same as household shortfall.

Religious events are more frequent when a monastery stands on the estate (weight 3).

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

   Chance is clamped to 2–90%. On success, `flags.merchant_present` and `merchant.present` are set, an NPC id `merchant` is added, and `merchant.stock` is filled with a handful of peddler wares. The merchant leaves on the next season unless the roll succeeds again.

   **Trade:** `transfer_resources` **buy** and **sell** require a merchant this season. **Buy** may only take from `merchant.stock` (stock is reduced). **Sell** converts estate goods to denarii at market mid-price (or `pricePerUnit`). `consume` / `gain` never need a merchant.

Pick uniformly inside the chosen category’s polarity: 50% negative, 30% positive, 20% mixed (if that polarity has entries). Then pick uniformly among those entries.

After the roll, the LLM must return `event_effect` proposals that change numbers. Flavour text alone is not a mechanical effect. If the LLM returns nothing valid, the engine applies the category’s default numeric stub (small resource or mood swing).

---

## 5. Projects

Baseline costs: Constitution §4.5. Keys live in `src/engine/projectCatalog.ts`.

Progress is `labour_days_done / labour_days_required`.  
Materials (lumber as softwood+hardwood cart-loads, iron lb, stone cart-loads) are reserved when the project starts if stocks allow; otherwise the start is rejected.

Callable labour assigned to a project this season is converted 1:1 into labour-days, with women counting 1.0 on listed “men + women” work and 0.6 on “mostly men” heavy work; youths 0.4.

Completion applies the feature to the holding (mill, forge, chapel, converted acres, etc.).

Custom projects are allowed if the proposal includes labour and material costs. The engine does not invent those costs.

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
| `transfer_resources` | steward; merchant (buy/sell only); smith (metal/fuel/hides/trade_goods only); chaplain (alms, grain, wine, wax, linen, timber, stone) | buy / sell require a visiting merchant; consume / gain do not |
| `add_modifier` | steward; smith (forge targets only); chaplain (mood, custom, accident_risk) | temporary or permanent |
| `remove_modifier` | steward | |
| `register_resource` | steward; smith (craft/metal) | new custom good |
| `register_feature` | steward; smith (forge-class); chaplain (chapel, monastery) | must set `isNew: true` |
| `register_npc` | steward; chaplain (monk/priest/novice/bishop) | must set `isNew: true`; player confirm required |
| `event_effect` | season referee only | auto-applied after Advance season |

Mid-season proposals wait for explicit player Confirm or Reject.  
Rejected proposals are logged and not applied.

### 7.1 Smith allow-list

The smith scene may only emit: `transfer_resources` (iron, charcoal, copper, tin, hardwood, hides, trade_goods, custom metal/craft goods), `start_project` / `adjust_project` for forge, bloomery, trip-hammer, or custom `tag: forge`, `add_modifier` targeting `specific_resource_output` or `project_speed` or `accident_risk` on forge work, `register_resource` (craft/metal), `register_feature` (`forge`, `mill_forge`, `bloomery`). Anything else is rejected with reason `npc_not_authorized`.

### 7.2 Chaplain allow-list

The chaplain (capellanus / prior of an on-estate cell) may only emit: `transfer_resources` (denarii, grain, wine, honey, beeswax, linen, salt, timber, stone, custom tagged church|liturgy|alms), `start_project` / `adjust_project` / `assign_labour` for `timber_chapel`, `stone_chapel`, `small_cell`, or `tag: church`, `set_standing_order` (tithe, Sunday, burial, clerical hospitality), `add_modifier` on `mood`, `custom`, or `accident_risk`, `register_feature` (`chapel`, `monastery`), `register_npc` with role chaplain|priest|monk|novice|bishop. Anything else is rejected with reason `npc_not_authorized`. He does not run the demesne.

### 7.3 Merchant allow-list

While a merchant is present, the merchant scene may only emit `transfer_resources` with direction `buy` or `sell`. Buy is limited to `merchant.stock`. Anything else is rejected with reason `npc_not_authorized`. The steward may also propose buy/sell in the same season, under the same stock and presence rules.

---

## 8. Innovations and modifiers

When the player introduces knowledge that did not exist in 825:

1. The LLM judges feasibility (materials, tools, teachability, time, labour, accident, social/religious suspicion). Success is never automatic.
2. Typical success: a `start_project` and/or a **temporary** `add_modifier`. Permanent status requires `seasons_remaining` to run out with `promote_on_expire: true`, or an explicit later proposal after practice.
3. New goods: `register_resource` with unit and price range, then `transfer_resources` / production modifiers.
4. The engine stores modifiers. Later seasons apply them as numbers so the model cannot forget an ongoing trial.

### 8.1 Modifier targets (closed list)

`grain_yield`, `labour_efficiency`, `spoilage`, `project_speed`, `specific_resource_output`, `accident_risk`, `mood`, `market_price`, `livestock_yield`, `harvest_risk`.

Escape hatch: `custom` — stored and shown in the ledger and injected into prompts; it does **not** change engine numbers until mapped to a closed-list target.

### 8.2 Stacking

- `multiply` effects on the same target: multiply together (cap 0.4–2.5).
- `add` effects: add (labour_efficiency add is extra fraction of pool).
- `set`: last applied wins (avoid except for market_price).
- `accident_risk` and `harvest_risk`: use the maximum of competing values.

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

**End of Rules (prototype)**
