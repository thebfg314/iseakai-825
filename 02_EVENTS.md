# 02_EVENTS
**Carolingian Minor Noble – Special Events Catalogue**  
**Version 1.0**

This document catalogues the special/random events used by the system.  
Events are organised by category. The LLM selects from the appropriate category (or categories) each season according to the rules in the Constitution and Rules documents.

**The dated calendar comes first (03_HISTORY).** The historical events of 825–911 are not drawn from this catalogue; the engine delivers them verbatim from `data/history/events/` at the start of their season. Two rules follow for the random events below:

- **Suppression.** In any season where a dated event fires (including an Ermenald-only entry such as a Church note), the random "other" event is **not rolled**. The weather event still rolls, or is forced (next point). A season with no dated event behaves as before.
- **Forced weather.** In the famine years of the scripts (841–845, 859–860, 867–869, 872–874, 895–897) the weather roll is replaced by the forced event in `data/history/tables/forced-weather.json`, with the crop effect doubled, reduced toward normal by the improvements present (drainage, three-field rotation, a barn or granary, a hardy-grain share). Famine prices and the season reports come from the same tables.

The categories below are otherwise unchanged. Where a random event and the calendar would say the same thing in one season (a Viking scare in 886, a sickness in a famine year), the calendar's version is the one the household tells.

---

## 1. Weather & Agricultural

**Seasonal rule**  
- Spring, Summer, Autumn: This category is fully active.  
- Winter: Skip this full category. Use the separate Winter-only subset instead (see below).

Events are crop/livestock-agnostic. After an event is chosen, the system randomly selects the affected crop or animal type from those the estate actually possesses.

### Negative
- Unseasonable frost damages the [random crop].
- Prolonged heavy rain or flooding affects the [random crop] or lower fields.
- Drought or extended dry spell stresses the [random crop].
- Violent storms damage standing crops or orchards/vineyards.
- Persistent damp encourages mould, rot, or disease in the [random crop] (standing or stored).
- Disease spreads among the [random livestock type].
- Predators take an unusual number of animals.
- Poor forage / hay conditions reduce animal condition or winter stores.
- River floods and deposits debris or silt on riverside land.

### Positive
- Exceptionally favourable weather produces a strong yield of the [random crop].
- Ideal conditions for the [random crop] at a critical growth stage.
- Excellent harvest or gathering weather for the [random crop].
- Abundant forage or mast year — animals (especially pigs) do unusually well.
- Mild conditions lead to low animal losses and good condition.
- Unexpectedly rich fruiting in orchard or vineyard.
- Beneficial silt deposit improves fertility on lower fields.

### Mixed / Situational
- Unusual weather shifts the timing of the [random crop] (early or late ripening), creating labour pressure.
- A sharp change in weather (wet after dry, or vice versa) creates both opportunities and risks for the [random crop].

---

## 2. Winter-Only Weather & Agricultural

These events replace the main Weather & Agricultural category during Winter.

### Negative
- Extreme cold kills or weakens livestock.
- Heavy snow or ice blocks roads and isolates the estate for a time.
- Stored grain or hay suffers from damp, mould, or vermin.
- Ice damages a mill, bridge, or water-wheel.
- Wolves become bolder and take more animals (or threaten people).
- A household fire spreads more easily in the dry, cold conditions.
- Disease spreads more easily in crowded winter quarters.

### Positive
- Mild winter with very low animal losses.
- Unusually good ice fishing or winter foraging.
- Hard freeze makes certain heavy work (hauling timber, moving stone) easier for a period.
- Clear, cold weather allows extra charcoal burning or other winter tasks to go especially well.

### Mixed
- A hard freeze followed by a sudden thaw creates both opportunities (easier hauling) and risks (flooding, damaged tracks).

---

## 3. Unfinished / Ongoing Projects

This category is only active (or heavily weighted) when one or more projects are currently underway.  
If multiple projects exist, the event targets one at random.  
The LLM may apply temporary modifiers (e.g. rushing a project makes negative events more likely for a season).

### Negative
- Structural accident or partial collapse on the current project.
- Key material runs short or proves defective.
- Important skilled worker is injured, falls ill, or leaves.
- Bad weather or flooding damages unfinished work.
- Theft or spoilage of materials staged for the project.
- Dispute or refusal among the labourers assigned to the project.
- Site proves worse than expected (soft ground, hidden water, poor stone, etc.).
- Tool breakage or equipment failure slows or halts progress.

### Positive
- Unusually good progress — work advances faster than expected.
- A skilled outsider offers help or stays for a time.
- Materials prove better or more plentiful than planned.
- Favourable weather allows continuous, efficient work.
- A better method or useful shortcut is discovered during construction.

### Mixed / Situational
- The project reveals an unexpected opportunity (better stone, a spring, reusable old foundations, etc.).
- Progress is good but uncovers a new problem that must be solved before continuing.
- Labourers work hard but morale is strained by the pace or conditions.

---

## 4. Population & Mood

Weighting factors (recent labour demands, grain situation, punishments or generosity, recent disease, etc.) will be handled by the modifier system to be defined later.

### Negative
- Unrest or open grumbling among the households.
- Petition or complaint brought to the lord.
- Disease spreads among the people.
- Labour shortage (illness, people leaving, or too many away on service).
- High number of young children increasing pressure on food and women.
- Desertion or flight of one or more households.
- Dispute between households that threatens wider order.
- Exhaustion or low morale after heavy labour demands.

### Positive
- High morale and willingness to work extra.
- New household(s) arrive seeking a place.
- Successful birth season / healthy increase in the population.
- Skilled or hardworking newcomer joins the estate.
- Households offer extra labour or gifts out of goodwill.
- Quiet, orderly season with few complaints.

### Mixed / Situational
- A charismatic or troublesome individual gains influence among the people.
- Generational tension (young men restless, elders conservative).
- Religious enthusiasm or anxiety spreads through the households.
- A marriage, inheritance, or kinship dispute affects several households.

---

## 5. Religious & Monastery / Church

More likely if the estate has a chapel or is near a monastic house.  
Modifiers (piety reputation, recent donations, etc.) will be handled by the later modifier system.

### Negative / Demanding
- Monks or clergy request land, labour, or materials for their house.
- Accusation of neglecting tithes, Sunday observance, or proper burial.
- Demand to support a building project or feast at a nearby church/monastery.
- A wandering preacher or reformer stirs the people.
- Accusation of superstition, improper practices, or harbouring the wrong kind of person.
- Relic or holy object is lost, stolen, or disputed.
- Clergy intervene in a local dispute on the side of the peasants or a neighbour.

### Positive / Opportunity
- Favourable visit from a local abbot, prior, or priest.
- Opportunity to gain spiritual prestige by donating or founding something small.
- Monks offer technical or scholarly help (building advice, better record-keeping, etc.).
- A relic, blessing, or favourable sermon raises local morale.
- Invitation to a religious feast or ceremony that confers status.
- Clergy support the lord in a dispute or petition.

### Mixed / Situational
- A hermit or holy man settles nearby and becomes a local influence.
- Pressure to build or improve a chapel on the estate.
- Conflict between local custom and stricter religious expectations.
- A clerical appointment or death changes the relationship with the local church.
- Opportunity (or pressure) to send a son or relative into the Church.

---

## 6. Lordly & Political

Military summons should be limited and mostly local or small-scale. Major multi-year campaigns are rare in this period for a minor noble.

TODO: requiem or funeral masses, to soften the people's grief when levies die after a muster or war. Not built; the war hit stands until battles are in the game.

### Negative / Demanding
- Summons to limited military service or to join a local/regional muster.
- Demand for hospitality, supplies, or labour from the count or a missus.
- Dispute with a neighbouring landholder over boundaries, rights, or livestock.
- Fine, judgment, or unfavourable ruling from a higher authority.
- Pressure to take sides in a local conflict.
- Accusation or rumour that reaches the count’s ears.
- Heavy or unexpected taxation / renders demanded.

### Positive / Opportunity
- Favourable attention or small grant from the count or a royal agent.
- Invitation to a local assembly, hunt, or gathering that confers status.
- Opportunity to settle a dispute on advantageous terms.
- Neighbouring landholder seeks alliance, marriage connection, or mutual support.
- Recognition of a right, privilege, or improvement the player has made.
- Chance to perform a service that brings goodwill or a modest reward.

### Mixed / Situational
- News of wider political events (assemblies, succession matters, border actions) that may later affect the estate.
- A missus or royal agent passes through and inspects local conditions.
- Inheritance, marriage, or death among neighbouring families shifts local balances.
- Opportunity (or pressure) to act as a local mediator or witness.

---

## 7. External Threats & Raids

Genuine Viking raids on most inland estates are still rare in 825 and should remain very low-probability.

### Stand-alone Negative
- Bandit or outlaw band begins operating in the area.
- Neighbouring violence spills over (raid, cattle-lifting, armed dispute).
- Wolves or predators become a serious local problem.
- Significant theft of livestock or stores.
- Armed men demand hospitality or payment under threat.
- Fire of suspicious or external origin.

### Stand-alone Positive / Resolution
- Local authorities or a neighbouring landholder catch or drive off a bandit group.
- A dangerous animal is killed by others or dies off naturally.
- Higher authority (count or missus) restores order in the district.

### Conditional / Reactive
(Only use when a threat is already active)
- Neighbouring landholders propose cooperation against the current threat.
- Opportunity or pressure to strengthen local watch or defences because of ongoing trouble.
- The count orders a local muster or special watch because of disorder.

---

## 8. Resource & Market

Merchant visits have their own separate seasonal check and are not part of this category.

### Negative
- Sudden scarcity or sharp price rise in a key material (iron, salt, etc.).
- Spoilage, theft, or loss of a significant portion of stored goods.
- Local market disrupted (bridge out, road blocked, fair cancelled).
- Poor quality or short measure in goods obtained from outside.
- Demand from a higher authority or neighbour for a specific resource the estate holds.

### Positive
- Unexpected abundance or good price for something the estate produces.
- Discovery or improved access to a local resource (better stone, clay, forage, etc.).
- Favourable opportunity to buy or sell at better than normal rates.
- A windfall of materials (washed-up timber, abandoned goods, etc.).

### Mixed / Situational
- A new or unusual good from the Middle East, North Africa, or further east appears on the local market.
- Shift in demand that makes one of the estate’s products more or less valuable.
- Opportunity to specialise in or temporarily corner a particular trade good.
- Information about distant prices or shortages that could be exploited (or that threaten local supply).

---

## 9. Special Land Features

These events are only eligible once the estate actually possesses the relevant feature.  
If the feature does not exist, the related events cannot fire.

### Mill (flour, fulling, or forge)
- Breakdown or damage to the wheel, dam, or machinery.
- Unusually productive season for the mill.
- Dispute over mill rights or tolls.
- Silting, flooding, or water shortage affecting the mill.

### Vineyard
- Excellent vintage.
- Vine disease or poor flowering.
- Theft of grapes or wine.
- Favourable or unfavourable attention related to the wine.

### Orchard
- Bumper fruit year.
- Late frost or pest damage to the trees.
- Opportunity to expand or improve the orchard.

### Chapel
- Need for repair or embellishment.
- Favourable religious attention because of the chapel.
- Pressure or opportunity related to the chapel’s upkeep or status.

### Woodland / Managed Forest
- Exceptional mast year (especially good for pigs).
- Illegal cutting or poaching.
- Storm damage to timber.

### Quarry, Clay Pit, or other Extraction Site
- Good or poor seam discovered.
- Accident or flooding in the working.
- Dispute over rights.

### Fish Pond / Weir
- Good or poor fish year.
- Damage to the works.
- Poaching.

---

**End of current catalogue**  
The active event categories are:

1. Weather & Agricultural  
2. Winter-Only Weather & Agricultural  
3. Unfinished / Ongoing Projects  
4. Population & Mood  
5. Religious & Monastery / Church  
6. Lordly & Political  
7. External Threats & Raids  
8. Resource & Market  
9. Special Land Features  

Plus the separate Merchant Visit check (seasonal chance + access modifiers; not a catalogue event).

---

## 10. Merchant Visit (separate roll)

Not a weather or “other category” event. The engine rolls this on its own each season using the **incoming** season:

- Spring 25–30%, Summer 40–45%, Autumn 40–50%, Winter 10–15%.
- Starting Fontenay has no river/road/landing/reputation bonuses and is not flagged remote.
- A mill-capable stream is not a merchant river. Improved pack-paths are the `improve_road` project (`improved_road` feature, +10% access).

On arrival the merchant has a limited stall. The player buys and sells at the stall window (spread prices, bulk steps, buyback at the sale price, purse of about 1000 denarii) until the next season.
