# 00_CONSTITUTION
**Carolingian Minor Noble – Grand Strategy System**  
**Version 1.1 – Binding Document**

This Constitution is the highest authority for the game.  
Every rule, prompt, world-state update, and AI decision must conform to it.  
If any later document or improvisation conflicts with this Constitution, this document prevails.

---

## 1. Purpose of the System

This is a single-character grand strategy / role-playing system set in Carolingian Francia.  
The player is one noble. The LLM acts as Court Chronicler and Referee only.  
The LLM never owns the canonical facts of the world.

The design goals are:

- Allow both deeply hands-on management and almost completely passive play.
- Support creative and even anachronistic player ideas while remaining grounded in 9th-century constraints.
- Keep a clear, auditable record of resources, events, and changes.
- Scale difficulty by starting rank (minor noble is the default and tightest difficulty).

---

## 2. Setting & Starting Position

- **Time**: Year 825, under Emperor Louis the Pious.
- **Place**: Carolingian Francia (region to be specified at game start).
- **Player**: A single living character – a minor noble.
- **Starting rank**: Minor noble (one main residence + a small number of dependent manses or a modest villa).  
  Higher ranks (richer local landholder → small count, etc.) are available as a difficulty slider for later campaigns.

The world is agricultural, hierarchical, and still in the process of becoming more feudal.  
Vertical bonds of dependency, labour services, and local custom matter more than later high-medieval institutions.

---

## 3. Core Principles (Non-Negotiable)

1. **The World State is sacred**  
   A structured file (JSON or equivalent) is the single source of truth.  
   The LLM may only propose changes. It may never silently invent or alter permanent facts.

2. **Hands-off is valid**  
   The player may issue standing orders or simply advance seasons.  
   Stewards then manage the estate according to contemporary best practice + any standing instructions.  
   The player still receives reports and lives from the surplus.

3. **Hands-on and innovation are allowed**  
   The player may give detailed natural-language instructions and introduce knowledge that did not exist in 825 (distillation, better metallurgy, gunpowder concepts, new record-keeping, etc.).  
   Success is never automatic. Feasibility is judged by:
   - Available materials and tools
   - Steward / craftsman skill and teachability
   - Time, labour, and resource cost
   - Risk of failure, accident, discovery, or social/religious suspicion

4. **Seasons are the basic unit of time**  
   Spring → Summer → Autumn → Winter.  
   Agricultural cycles, weather, military campaigning seasons, and feast days all matter.

5. **Transparency**  
   Every turn the LLM must produce:
   - Narrative (court chronicle style)
   - Clear mechanical effects / proposed state delta
   - Updated resource and market information when relevant

---

## 4. Wealth, Resources & Units

### 4.1 Coin
- Primary unit: silver **denarius** (denier)
- 12 denarii = 1 solidus
- 20 solidi = 1 libra (pound)
- Gold solidi exist but are rare and mostly ceremonial or high-status gifts.  
  A minor noble normally deals in denarii and solidi.

### 4.2 Resources, Units & Base Price Ranges

All prices below are **base local market ranges in denarii under normal conditions**.  
They fluctuate with season, harvest quality, scarcity, events, distance to markets, and demand.  
The LLM must maintain and update current price ranges each season or when major events occur.  
Player-invented goods receive their own price range when successfully created.

| Resource              | Unit              | Base Price Range (denarii)      | Notes |
|-----------------------|-------------------|----------------------------------|-------|
| **Grains**            |                   |                                  |       |
| Wheat                 | Modius            | 4 – 8                            | Highest value grain |
| Rye                   | Modius            | 3 – 6                            | Common; ergot risk if damp/excess |
| Barley                | Modius            | 2 – 4                            | Good for beer & fodder |
| Oats                  | Modius            | 1 – 3                            | Mainly fodder & poorer bread |
| **Livestock**         |                   |                                  |       |
| Cattle                | Head              | 20 – 60                          | Oxen higher end |
| Sheep                 | Head              | 6 – 15                           |       |
| Pigs                  | Head              | 8 – 20                           |       |
| Horses                | Head              | 60 – 200+                        | Status & military value |
| Poultry               | Head              | 1 – 3                            |       |
| Bees                  | Hive              | 10 – 30                          |       |
| **Food & Drink**      |                   |                                  |       |
| Wine                  | Barrel / Modius   | 15 – 40                          |       |
| Cheese                | Pound             | 1 – 3                            |       |
| Honey                 | Pound             | 2 – 5                            |       |
| **Textiles**          |                   |                                  |       |
| Wool                  | Pound             | 1 – 3                            |       |
| Linen                 | Pound             | 2 – 5                            |       |
| **Timber & Fuel**     |                   |                                  |       |
| Softwood              | Cart-load         | 5 – 15                           |       |
| Hardwood              | Cart-load         | 8 – 20                           |       |
| Charcoal              | Cart-load         | 10 – 25                          | Essential for smithing |
| **Craft Materials**   |                   |                                  |       |
| Iron                  | Pound             | 3 – 8                            |       |
| Copper                | Pound             | 8 – 20                           | Rarer |
| Tin                   | Pound             | 12 – 30                          | Rarer |
| Salt                  | Pound             | 1 – 3                            | Critical for preservation |
| Stone                 | Cart-load         | 2 – 8                            | Mostly local; limited long-distance trade value. Mainly for the player’s own building projects. |
| Hides / Leather       | Piece             | 4 – 12                           |       |
| Beeswax               | Pound             | 3 – 8                            |       |
| **Manufactured**      |                   |                                  |       |
| Trade Goods           | Unit              | Fixed: 10 denarii each           | Produced by idle specialists. Quantity varies with skill, tools, and materials. |

**Notes on units**
- A **modius** is the standard Carolingian dry measure (roughly 40–55 litres). In game text it should be hyperlinked or briefly defined for the player.
- **Head** = individual animal.
- **Hive** = one beehive.
- **Pound** = Carolingian libra (approx. 400 g).
- **Cart-load** = a practical bulk measure for timber, charcoal, and stone.
- **Trade Goods** are deliberately abstract. They always sell for a fixed 10 denarii per unit. What varies is how many units a craftsman produces when not assigned to a specific project (skill, tools, and materials determine output quantity).

### 4.3 Population (separate from Resources)
Population is tracked independently:
- **Households / Manses** – the basic dependent tenant units.
- **Unfree / Mancipia** (optional) – more movable unfree persons who can be bought, sold, or freed.
- Derived labour pools: Adult Men, Adult Women, Youths.

**Household smallstock and dues**  
Peasant households keep their own chickens, gardens, and usually a few small animals (pigs, occasionally a goat).  
These are **not tracked** in the lord’s resource or herd lists.  

Small regular dues (chickens, eggs, the odd pig, etc.) and minor gifts of single animals are considered negligible for accounting purposes.  
They are ignored for herd totals and do not remove animals from the lord’s tracked demesne herds.  
Only significant transfers (multiple animals, formal gifts of breeding stock, etc.) affect the recorded numbers.

**Callable labour for special projects**  
These figures represent the days of labour the lord can demand for projects beyond the normal agricultural cycle without immediately endangering the harvest or essential maintenance.  
Youth numbers are already adjusted so that only about half the total youth population is treated as productive.

| Population Type | Spring | Summer | Autumn | Winter |
|-----------------|--------|--------|--------|--------|
| Adult Man       | 12–18  | 8–12   | 12–18  | 15–25  |
| Adult Woman     | 8–12   | 6–10   | 8–12   | 10–15  |
| Youth           | 2–4    | 2–3    | 2–4    | 3–5    |

**Division of labour (guidance for the LLM)**  

- **Adult Men**: Heavy field work (ploughing, heavy digging, carting, felling large timber), construction involving heavy materials, most metalwork, hunting larger game, military service, and any work considered especially dangerous or requiring high physical strength (deep mining, major earthworks, etc.).  
- **Adult Women**: Textile production (spinning, weaving, dyeing), dairy work, food processing, gardening, poultry care, lighter field tasks (weeding, gathering, assisting at harvest), and many forms of indoor or skilled craft work. Women routinely perform hard physical labour, but the most dangerous and heaviest tasks are normally reserved for men.  
- **Youths**: Lighter and learning tasks — herding smaller animals, gathering, weeding, carrying, simple assistance in workshops or at harvest, watching younger children, and basic household chores. They are not assigned to the most dangerous work (deep mines, heavy felling, major construction) and parents resist such assignments.  

The LLM should respect these norms when adjudicating labour assignments. Player attempts to force inappropriate labour (especially dangerous work onto women or children) should face social resistance, reduced effectiveness, higher accident risk, or other consequences.

### 4.4 Land / Holdings (separate from Resources)
Land is not treated as a normal resource that is bought and sold like grain or iron.  
It is tracked as **Holdings**.

A Holding consists of:
- The physical land (see types below)
- The households attached to it
- Any special features (mill, forge, chapel, etc.)

**Land types tracked within Holdings:**

| Land Type          | Description & Notes |
|--------------------|---------------------|
| Fertile Arable     | Cleared, ploughed land in the grain rotation (includes the portion currently fallow). Primary source of grain. |
| Meadow             | Permanent grassland mown for hay (critical winter fodder for cattle and horses). Aftermath may be grazed. |
| Vineyard           | Specialized land for grape cultivation and wine production. |
| Orchard            | Fruit trees (apples, pears, plums, cherries, etc.) and nuts. |
| Woodland           | Managed or semi-managed forest. Source of timber, firewood, pannage for pigs, hunting. |
| Scrub / Brush      | Lightly wooded or overgrown land. Easier to clear than mature woodland but less immediately useful. |
| Waste              | Rough, unimproved open land (heath, poor grassland, rocky ground). Limited current use; moderate effort to improve. |
| Swamp / Marsh      | Wetland. Requires drainage before it can become productive. Distinct labour and technical requirements. |

**Expansion and improvement**  
Fertile arable can be increased by clearing woodland or scrub, improving waste, or draining swamp/marsh.  
These actions have different labour costs, time requirements, and technical needs.  
Player innovations or new techniques may make one type of conversion easier while leaving others difficult or impossible.

Holdings change through inheritance, gift, exchange, royal favour, seizure, or (rarely) purchase. They are not casual market goods.

**Land unit**  
The standard unit of land area in this game is the **acre** (used as a convenient modern equivalent of Carolingian measures for clarity).

**Normal grain yields (no disaster events)**  
Figures below are the **usable surplus** after next year’s seed has already been reserved.

| Grain  | Normal Surplus per Acre Sown | Sown In   | Harvested In              |
|--------|------------------------------|-----------|---------------------------|
| Wheat  | 4 – 8 modii                  | Autumn   | Late Summer / Early Autumn |
| Rye    | 5 – 10 modii                 | Autumn   | Late Summer / Early Autumn |
| Barley | 5 – 10 modii                 | Spring   | Autumn                    |
| Oats   | 3 – 8 modii                  | Spring   | Autumn                    |

Good land and favourable weather push toward the high end of the range; poorer land or mediocre weather toward the low end. These figures deliberately exclude major events (flood, drought, early frost, ergot, etc.), which are handled by the random event system.

### 4.5 Special Projects – Baseline Costs

These figures are baseline ranges for a minor noble’s estate under normal conditions.  
Poor sites, bad weather, or rushed work push costs toward or beyond the high end.  
Labour-days are full adult-male-equivalent days. Women and youths may assist on lighter tasks.  
“Mostly men” means the heavy and skilled core of the work is male.

**Rule of thumb for the LLM**  
Judge project scale by labour demand relative to the estate’s current callable labour pool:  
- Small: modest portion of one season’s free labour  
- Medium: most of one season or stretches into a second  
- Large: multiple seasons or heavy concentration of labour (risks neglecting normal work if rushed)

#### Water-Powered Works
| Project | Labour-days | Lumber (cart-loads) | Iron (lb) | Stone (cart-loads) | Main Labour | Outside Specialists |
|---------|-------------|---------------------|-----------|--------------------|-------------|---------------------|
| Flour mill (good site) | 180–280 | 8–14 | 40–80 | 2–6 | Mostly men | Millwright preferred |
| Flour mill (poor site) | 280–450 | 12–20 | 50–100 | 4–10 | Mostly men | Millwright almost required |
| Fulling mill | 160–250 | 7–12 | 30–60 | 2–5 | Mostly men | Millwright |
| Trip-hammer / forge mill | 200–320 | 8–15 | 60–120 | 3–8 | Mostly men | Millwright + smith |
| Water-lifting system | 80–160 | 4–8 | 20–50 | 1–4 | Mostly men | Optional |
| Fish pond with controlled flow | 60–120 | 2–5 | 5–15 | 0–3 | Men + youths | Rarely needed |
| Mill leat / small canal | 100–200 | 1–4 | 5–20 | 0–2 | Mostly men | Optional |

#### Agricultural & Land Improvement
| Project | Labour-days | Lumber | Iron | Stone | Main Labour | Outside Specialists |
|---------|-------------|--------|------|-------|-------------|---------------------|
| Clear scrub → arable (per acre) | 25–45 | 0–1 | 2–6 | 0 | Men + youths | None |
| Drain swamp/marsh (per acre) | 40–80 | 1–3 | 3–10 | 0–2 | Mostly men | Optional |
| Improve waste → meadow/pasture (per acre) | 15–30 | 0–1 | 1–4 | 0 | Men + youths | None |
| Irrigation ditches (per 100 yards) | 20–40 | 0–2 | 2–8 | 0–1 | Mostly men | None |
| Expand vineyard (per acre) | 30–50 | 1–3 | 2–6 | 0 | Men + women | Optional vine-dresser |
| Expand orchard (per acre) | 20–35 | 0–2 | 1–4 | 0 | Men + women + youths | None |
| Terracing (per acre) | 50–100 | 1–4 | 5–15 | 2–8 | Mostly men | None |
| Soil improvement / marling (per acre) | 15–30 | 0 | 1–3 | 0 | Men + youths | None |

#### Buildings & Infrastructure
| Project | Labour-days | Lumber | Iron | Stone | Main Labour | Outside Specialists |
|---------|-------------|--------|------|-------|-------------|---------------------|
| Timber manor hall (modest) | 250–400 | 15–25 | 40–80 | 2–6 | Mostly men | Master carpenter preferred |
| Partial stone hall | 400–700 | 10–20 | 60–120 | 15–30 | Mostly men | Mason + carpenter |
| Simple timber chapel | 150–250 | 8–14 | 20–40 | 2–6 | Mostly men | Carpenter |
| Stone chapel (small) | 350–550 | 6–12 | 40–80 | 20–40 | Mostly men | Mason required |
| Large barn | 120–200 | 10–18 | 20–40 | 1–4 | Mostly men | Carpenter |
| Stables | 80–140 | 6–12 | 15–30 | 1–3 | Mostly men | Carpenter |
| Blacksmith forge & workshop | 100–180 | 5–10 | 30–60 | 2–6 | Mostly men | Experienced smith if none present |
| Carpenter’s workshop | 60–100 | 4–8 | 10–25 | 0–2 | Mostly men | Optional |
| Textile workshop | 50–90 | 3–7 | 5–15 | 0–2 | Men (structure) + women | None |
| Bakehouse / brewery | 70–120 | 4–8 | 15–35 | 1–4 | Mostly men | Optional |
| Labourer housing (per dwelling) | 40–70 | 3–6 | 5–15 | 0–2 | Mostly men | None |
| Timber bridge (small) | 80–150 | 6–12 | 20–40 | 1–4 | Mostly men | Carpenter preferred |
| Simple stone bridge | 200–350 | 3–8 | 30–60 | 12–25 | Mostly men | Mason |
| Causeway (per 100 yards) | 30–60 | 1–4 | 5–15 | 2–8 | Mostly men | None |
| Landing stage | 40–80 | 3–7 | 10–25 | 1–4 | Mostly men | Carpenter |

#### Defensive
| Project | Labour-days | Lumber | Iron | Stone | Main Labour | Outside Specialists |
|---------|-------------|--------|------|-------|-------------|---------------------|
| Timber palisade (per 100 yards) | 50–90 | 6–12 | 15–30 | 0–2 | Mostly men | None |
| Raised platform + wooden tower | 150–280 | 10–18 | 30–60 | 2–8 | Mostly men | Carpenter |
| Gatehouse / strong gate | 80–140 | 5–10 | 25–50 | 1–4 | Mostly men | Carpenter / smith |
| Watch post | 30–60 | 2–5 | 5–15 | 0–2 | Men + youths | None |

#### Resource Extraction & Processing
| Project | Labour-days | Lumber | Iron | Stone | Main Labour | Outside Specialists |
|---------|-------------|--------|------|-------|-------------|---------------------|
| Small stone quarry (opening) | 80–150 | 2–5 | 20–40 | — | Mostly men | Optional quarryman |
| Clay pit | 30–60 | 1–3 | 5–15 | 0 | Men + youths | None |
| Organized charcoal burning | 40–80 | 1–3 | 5–15 | 0 | Men + youths | None |
| Small bloomery | 100–180 | 3–7 | 20–50 | 1–4 | Mostly men | Experienced iron-worker preferred |
| Tannery | 60–110 | 3–7 | 10–25 | 0–2 | Mostly men | Optional tanner |
| Pottery kiln | 40–80 | 2–5 | 5–15 | 1–3 | Men + women | Optional potter |

---

## 5. Random Events

A structured random-event system operates every season.  
Categories include (but are not limited to):

- Weather & Agriculture (floods, drought, late frost, excellent harvest, cattle disease, ergotism from excess damp rye…)
- Local (fires, disputes, skilled arrivals or deaths, banditry…)
- Regional / Political (demands from the count or missi, market fairs, news of assemblies…)
- External threats (early Viking activity is rare in 825 but possible near rivers/coasts; frequency rises in later decades)

Events must produce clear mechanical effects on the World State.  
Hands-off play still experiences events; stewards simply react according to custom and standing orders.

---

## 6. Role of the LLM

The LLM is the **Court Chronicler and Referee**.

It must:
- Remain consistent with this Constitution and the current World State
- Never invent new permanent geography, characters, or major resources without declaring them as new and waiting for confirmation
- Clearly separate narrative flavour from mechanical proposals
- Adjudicate player innovations fairly against 9th-century material and social reality
- Maintain and update the market price ranges
- Generate and resolve seasonal events according to the rules

It must not:
- Secretly change the World State
- Ignore resource costs or risks
- Treat the player as an all-powerful modern manager

---

## 7. Hierarchy of Documents

1. This Constitution (highest)
2. 01_RULES.md (mechanical procedures)
3. Current World State file (canonical facts)
4. History log (append-only chronicle)
5. Prompt templates and any secondary documents

---

## 8. Amendment

This Constitution may only be changed by explicit player decision.  
Any proposed amendment must be written into a new version of this file and clearly marked.

---

**End of Constitution**  
All future work on this project begins from this document.
