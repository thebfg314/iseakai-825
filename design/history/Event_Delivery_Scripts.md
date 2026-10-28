# Isekai 825: Event Delivery Scripts

Oct 7, 2026 · @Neil Jensen

## Status

**All nine arcs and every background system are written.** This document is content-complete for the 825–911 span.

| Part | State |
| --- | --- |
| Delivery rules, timing, battle participation, fixed points, rank and renown, age, chain of rank, counts of Autun | Done |
| Land and value system; natural events (prices, weather, famines); army supply appendix | Done |
| Arc 1: The emperor and his sons (825–840) | Done |
| Arc 2: War of the Brothers (840–844) | Done |
| Arc 3: Vikings on the rivers (841–911) | Done |
| Arc 4: Brittany breaks away (831–890) | Done |
| Arc 5: Aquitaine and Pippin II (838–864) | Done |
| Arc 6: Charles the Bald's reign (855–877) | Done |
| Arc 7: Boso, Richard and the making of Burgundy (877–901) | Done, including the Duke track |
| Arc 8: The kings run out (882–898) | Done, including the open throne of 888 |
| Arc 9: Saracens, Magyars and far horizons | Done |
| Church, councils and scholars | Done |
| Coinage, Viking tributes, minting | Done |
| Royal vassal duties; the king's escalation ladder; the king quest | Done |
| The end of the game | Done |

**Left to the implementer, by design:** the 40 rank-and-file vignette cards (combat doc §4.1), the LLM objective-generation system for Sub-Command (§4.2), the economy and muster formulas, and the specific acquisition mechanism for anachronistic tech (see the Technology Diffusion Rules doc).

## Note for the implementer: momentum scale

**This document uses momentum on a 1–100 scale. The combat system design doc uses 1–10. The 1–100 scale in this document is authoritative — convert the combat doc's values, not these.**

| Scale here | Meaning | Combat doc equivalent |
| --- | --- | --- |
| 90–100 | Structural; cannot be prevented, only prepared for | 9–10 |
| 70–89 | Driven by great powers; details bend, outcome does not | 7–8 |
| 40–69 | Contingent; a well-placed noble could tip it | 4–6 |
| 10–39 | Fragile; preventable with warning and organisation | 1–3 |
| 1–9 | Near-accident; almost any interference changes it | below 1 — use 1 |

**Conversion rule:** `combat_doc_value × 10 ≈ this document's value`. Where the combat doc's §2 refers to momentum thresholds ("high momentum 8–10"), read those as 80–100 here.

Separately, **fixed points** (see Delivery rules) are not a momentum value at all: they are events whose outcome cannot change regardless of momentum arithmetic.

## Delivery rules

Every historical event reaches the player through one of two household NPCs. Each entry below is a hard spec: when it fires, who delivers it, what that NPC knows, and what they don't.

| Channel | NPC | Covers | Usual form |
| --- | --- | --- | --- |
| Political | Aldric, steward | Kings, counts, wars, assemblies, levies, taxes, coin | Spoken report or a short note when the player is away |
| Religious | Ermenald, chaplain | Councils, bishops, saints and relics, feast and fast days, omens, church law | Conversation after Mass, or a reading from a letter |

### How slant works: honest steward, slanted sources

Aldric and Ermenald never lie to their lord. What they repeat, though, comes from someone, and that source has a side. Each entry names its **source** and **slant**:

- The NPC states the version they heard, and names where they heard it ("the count's men say...").
- If a second version is circulating, the NPC mentions it in a sentence or two, usually with an opinion of its own.
- The player can ask follow-ups. The NPC answers only from the entry's **Knows** list and admits ignorance on anything under **Doesn't know**.

This gives the world faction flavor without hiding facts from the player. Around Autun in 828–830, the default source leans toward Bernard of Septimania's family.

### Timing: messages arrive at the start of a season

The game delivers messages only at the start of each season, so every "Fires" line names a season start. An event that happens mid-season is reported at the start of the next season.

| Season | Months | Message arrives |
| --- | --- | --- |
| Winter | December–February | Start of December |
| Spring | March–May | Start of March |
| Summer | June–August | Start of June |
| Autumn | September–November | Start of September |

Live scenes (the 830 mutiny, the Field of Lies, Chalon, Fontenoy) open at the start of their season and play out within it.

### Battle participation

Every battle uses the game's standard renown rules, at one of three levels:

| Level | Requires | How it plays | Renown |
| --- | --- | --- | --- |
| Rank and file | Being present | A series of randomly drawn situation cards (a choose-your-own-adventure battle); each card can threaten the player's life or grant renown, depending on the response | Per card |
| Subcommand | Contributing full units | The player commands his own units within a larger command | Based on the imbalance between damage his units deal and damage they take |
| Full command | Enough units contributed, or high enough renown; the player can accept it or pass it to someone else | The player commands the battle | Same imbalance rule, across the whole command |

Each battle entry lists which levels are open and the kinds of situation cards it draws on.

### Fixed points in time

Some events are marked **fixed points**: their outcome cannot be changed, however well the player does. The player's choices still decide his own part in them (where he stands, whether he survives, what renown he earns), but not who wins. Fixed so far: the battle of Fontenoy (841); the capture of Pippin II (864).

### Age and participation

The player arrives at about 16–18 in 825 and the game ends with his death, around 910–911. There are no playable heirs.

| Age (approx.) | Years | Battle participation |
| --- | --- | --- |
| Up to 50 | 825 to about 857 | All three levels open |
| 50–65 | about 857–872 | Subcommand and full command; rank and file possible but dangerous (harsher life-threatening cards) |
| 65 and over | about 872–911 | Command from behind the lines, or send men under a captain; renown still counts units the player controls |

A child or trusted retainer can serve as the player's captain: an NPC, not a playable heir.

### Rank and renown

| Rank | Title | Renown required |
| --- | --- | --- |
| 1 | Minor Noble (start) | 1 |
| 2 | Viscount | 100 |
| 3 | Count | 500 |
| 4 | Duke | 1000 |
| 5 | King | 2000 |

- **Sticky titles:** losing renown never revokes a title. Holding a rank with renown below its threshold triggers a mishap table in the narrative layer (rivals, plots, disloyal vassals), not a stat penalty.
- **Renown per battle:** morale dealt minus morale taken, counting only units the player controls. No per-battle cap: one extraordinary battle can vault a player up the ladder.
- **Floor:** renown never drops below 1.
- **Units controllable:** depends on resources, not rank.
- **King:** reaching 2000 only makes the ambition plausible. Taking the throne needs its own narrative chain (a quest that, once triggered, ends a series of historical events). It lives outside this doc.
- **Linked numbers elsewhere:** the 100-renown anchor for "one solid subcommand battle" equals the Viscount threshold; the rank multiplier runs 1.0 / 1.5 / 2.0 / 2.75 / 3.5 across the five ranks; the Patron's Favor cap is defined by rank tier. Changing a threshold means checking those.
- **Titles and promotions:** promotions in the event entries (for example, 834-02 and 835-02) are offered when the player's renown meets the next threshold. "Royal vassal" is a status, not a rank: a direct bond to the emperor or king that can come with any rank.

#### Renown sizes in event entries

Event entries say small, moderate or large where a number isn't set. Narrative renown is deliberately scarce; most renown comes from battle through the uncapped morale formula (about 100 for one solid subcommand battle).

| Label | Renown |
| --- | --- |
| Small | 5–15 |
| Moderate | 25–50 |
| Large | 75–150 |

Fixed value: standing to the end at the Field of Lies (833-01, stage 5) is worth 90, just under the Viscount threshold, so one more deed or skirmish completes the rank-up. Renown losses use the same scale (the 833 bribe's moderate loss is 25–50).

### Chain of rank

Under the 817 succession plan, the counties of Autun, Avallon and Nevers belong to the kingdom of Aquitaine. So the player's chain runs: **the emperor** (Louis the Pious) → **our king** (Pippin of Aquitaine, the emperor's son) → **the count of Autun** → the player. NPCs call Pippin "our king" or "King Pippin"; the emperor outranks him, which is what makes Pippin's quarrels with his father so awkward for everyone in Autun.

### Counts of Autun (game line)

The sources disagree on exact dates; this is the game's simplified line. Each change gets a short Aldric note, and the player swears to the new count.

| Years (approx.) | Count | Notes |
| --- | --- | --- |
| 826–830 | Bernard of Septimania | The player's patron; stripped of Autun in the 830 revolt |
| 830–837 | Adalard | Invented; dies of the flux (or retires, if saved) in 837 |
| 837–853 | Warin | Defender of Chalon; dies around 853 (sources range 845–856) |
| 853–858 | Isembard | Warin's son; swears fidelity to Charles in 858 when Louis the German invades |
| 858–861 | Bernard "Hairy-foot" (Plantapilosa) | Bernard of Septimania's son, about 17, seizes Autun as his father's inheritance |
| 861–866 | Robert the Strong | Defends Autun against Louis the German and fights the Vikings; killed at Brissarthe in 866 |
| 866–872 | Bernard "Hairy-foot" again | Reconciled to the king (the sources also place Bernard of Gothia briefly in 864–865) |
| 872–879 | Several short-term counts | Including Bernard "le Veau" and Bernard of Gothia, who rebels in 877–878 |
| 879–880 | Boso | Briefly, before proclaiming himself king |
| 880–921 | Richard the Justiciar | To the end of the game |

Under Charles the Bald (from 840), "our king" is Charles; the chain is king → count of Autun → the player.

### Where the player becomes count

Kings did not create new counties: a new count was given an existing one that was vacant (by death, forfeiture or reshuffle). Counts often gathered several over time.

| Rank | County offered |
| --- | --- |
| Count (500 renown) | A vacant county near home, most likely a smaller neighbor: Auxois, Beaune, Nevers or Avallon. A distant frontier county (Aquitaine, the Breton march, Septimania) is possible, with Fontenay then run through Aldric. Never Autun at this rank. |
| Duke (1000 renown) | Autun, granted in addition to the player's first county, but only in a vacancy window (about 853, 858, 861, 866, the 870s, 879–880) and with a strong patron. |

**Replacing Richard:** a Duke-rank player who takes Autun around 879–880 takes Richard the Justiciar's place. This is allowed (Richard's rise is not a fixed point). It means the player played the politics well and timed his rise to a vacancy; the later Burgundy arc (Boso's kingdom, the Viking battles of 888 and 898, the duchy of Burgundy) then runs with the player in Richard's role.

### Entry fields

- **ID and date:** year-number, plus the in-game season it fires.
- **Channel and form:** who delivers it, and how.
- **Source and slant:** where the NPC got it, and whose side that favors.
- **Script:** the opening delivery, in character. The LLM can paraphrase but keeps every fact.
- **Knows:** facts the NPC can expand on when asked. Optional on short news entries; required wherever the player is likely to question the NPC.
- **Doesn't know:** facts the NPC must not reveal (future events, distant details, private motives). Optional on the same terms as Knows.
- **Hooks and flags:** what the player can do, and which game flags this sets.
- **Links:** arc and momentum from the Historical Event Arcs doc.

# Event index

Every event, chronologically. **ID suffixes by arc:** no suffix = Arc 1 or 2 (political spine); **-V** Vikings (Arc 3); **-B** Brittany (Arc 4); **-A** Aquitaine (Arc 5); **-C** Charles the Bald (Arc 6); **-K** kings and Burgundy (Arcs 7 and 8); **-S** Saracens (Arc 9); **-E** economy; **-N** natural events; **-F** the ending.

*Live* = a played scene rather than a delivered message. *FP* = fixed point.

| ID | Season | Event | Channel | Type |
| --- | --- | --- | --- | --- |
| 826-01 | Summer 826 | A new count at Autun | Aldric | News |
| 827-01 | Autumn 827 | Saracens at Barcelona | Aldric | News |
| 828-01 | Spring 828 | Barcelona and the disgraced counts | Aldric | News |
| 829-01 | Autumn 829 | The reform councils | Ermenald | News |
| 829-02 | Autumn 829 | The assembly at Worms | Aldric | News + choice |
| 830-01 | Winter 829–30 | The summons to Brittany | Count's messenger | Summons |
| 830-02 | Spring 830 | The mutiny and the reckoning | Live | **Live**, land crisis |
| 831-01 | Winter 831–32 | Bernard at Thionville | Aldric | News |
| 832-01 | Winter 831–32 | A letter from Bernard | Letter | Choice |
| 832-02 | Winter 832–33 | Pippin's fall | Aldric | News |
| 832-03 | Summer 832 | The count's summons | Summons | Battle |
| 833-01 | Spring/Summer 833 | The Field of Lies | Live | **Live**, no combat |
| 833-02 | Winter 833–34 | The emperor's penance | Ermenald | News |
| 834-01 | Spring 834 | The emperor restored | Aldric | News |
| 834-02 | Spring 834 | The emperor's gratitude | Live | Promotion window |
| 834-03 | Summer 834 | Lothair's war comes to Burgundy **\[Supply check\]** | Aldric + live | **Live**, two branches |
| 834-04 | Autumn 834 | Lothair submits | Aldric | News |
| 835-01 | Spring 835 | The reckoning at Thionville and Metz | Aldric + Ermenald | News |
| 835-02 | Summer 835 | The assembly at Crémieu | Live | Promotion window |
| 837-01 | Spring 837 | The comet | Ermenald | News + exploit |
| 837-02 | Summer 837 | The count is ill | Aldric | Intervention window |
| 837-03 | Autumn 837 | A new count at Autun | Aldric | News |
| 838-01 | Winter 838–39 | Charles comes of age | Aldric | News |
| 838-02 | Spring 839 | King Pippin is dead | Aldric | News |
| 839-01 | Summer 839 | The last division | Aldric | News |
| 839-02 | Autumn 839 | The Aquitaine campaign | Summons | Battle |
| 840-01 | Spring/Summer 840 | The sun goes dark | Ermenald | News + exploit |
| 840-02 | Autumn 840 | The emperor is dead | Aldric | News |
| 840-03 | Autumn 840 | Lothair demands oaths | Envoys | Choice |
| 840-04 | Winter 840–41 | The truce of Orléans | Aldric | News |
| 841-01 | Spring 841 | Warin's summons | Summons | Choice |
| 841-02 | Summer 841 | **Fontenoy** | Live | **Live, FP** |
| 841-03 | Autumn 841 | After Fontenoy | Aldric + Ermenald | News |
| 841-V1 | Summer 841 | Rouen burned | Aldric | News |
| 842-01 | Spring 842 | The comet and the oaths of Strasbourg | Ermenald + Aldric | News |
| 842-02 | Summer 842 | Lothair abandons Aachen; talks near Mâcon | Aldric | News + opportunity |
| 842-03 | Winter 842–43 | A truce, a poor harvest, a royal wedding | Aldric | News |
| 843-01 | Spring 843 → Summer 844 | The war for Toulouse | Summons | **Live**, three stages |
| 843-02 | Autumn 843 | The Treaty of Verdun | Aldric | News |
| 843-03 | Winter 843–44 | The pact of Coulaines | Aldric | News |
| 843-V1 | Autumn 843 | Bishop Gunhard killed at Nantes | Ermenald | News |
| 844-01 | Summer 844 | Bernard is dead | Aldric | News + cutscene |
| 844-02 | Autumn 844 | Ambush in the Angoumois | Aldric | News |
| 845-V1 | Summer 845 | Paris taken | Aldric | News |
| 845-A1 | Summer 845 | Pippin II recognised as king | Aldric | Promotion window |
| 845-B1 | Autumn 845 | **Ballon** | Summons | **Live** |
| 848-A1 | Summer 848 | Aquitaine turns | Aldric | News + choice |
| 851-B1 | Summer 851 | **Jengland** | Summons | **Live** |
| 852-A1 | Autumn 852, Summer 854 | Pippin shut away (and out again) | Aldric | News |
| 853-V1 | Winter 853–54 | Tours sacked; the relics of Saint Martin | Aldric + Ermenald | Choice |
| 855-A1 | Spring/Autumn 855 | A rotating door of kings | Aldric | News |
| 855-C1 | Autumn 855 | The middle kingdom splits | Aldric | News |
| 858-C1 | Summer 858 | Girart builds at Vézelay | Ermenald + Aldric | News |
| 858-C2 | Autumn 858 | Louis the German invades | Aldric | Loyalty test |
| 862-V1 | Autumn 862 | The bridge levy | Aldric | Levy |
| 863-C1 | Winter 863–64 | The boy king of Provence dies | Aldric | News |
| 864-V1 | Spring 864 | Pippin II rides with the Northmen | Aldric + Ermenald | Choice, **FP** |
| 864-V2 | Summer/Autumn 864 | Pippin taken; the assembly at Pîtres | Aldric | News + choice |
| 866-V1 | Summer 866 | **Brissarthe** | Summons | **Live** |
| 869-C1 | Autumn 869 → 870 | Lothair II dies; the race for his kingdom | Aldric | News |
| 870-C2 | Summer 870 | **The siege of Vienne** | Summons | **Live** |
| 875-C1 | Autumn 875 | The road to Rome | Invitation | Journey |
| 875-V1 | Spring 875 | The monks of Saint-Philibert at Tournus | Aldric + Ermenald | Choice |
| 876-C1 | Summer 876 | **Andernach** | Summons | **Live**, optional |
| 877-C1 | Summer/Winter 877 | Quierzy, and the king's death | Aldric + Ermenald | News |
| 878-K1 | Autumn 878 | The great men rebel | Aldric | News |
| 879-K1 | Summer 879 | The king dies; the boys divide the kingdom | Aldric | News |
| 879-K2 | Winter 879–80 | A king elected at Mantaille | Aldric | Choice |
| 880-K1 | Spring 880 | Richard takes Autun | Live | **Live**, oath |
| 880-K2 | Summer 880 | The campaign on the Saône | Summons | **Live** |
| 880-K3 | Autumn 880 → 882 | **The siege of Vienne** (Boso's) | Live | **Live**, 2 years |
| 881-V1 | Autumn 881 | Victory at Saucourt | Aldric | News |
| 882-K1 | Autumn 882 | Vienne falls | Aldric | News |
| 882-K2 | Autumn 882 | Louis III dies | Aldric | News |
| 884-K1 | Winter 884–85 | Carloman dies | Aldric + Ermenald | News |
| 885-K1 | Summer 885 | An emperor sent for | Aldric | News |
| 885-V1 | Winter 885–86 | Paris besieged | Aldric + Ermenald | News |
| 886-V1 | Summer 886 | The emperor's march | Summons | **Live** |
| 886-V2 | Autumn/Winter 886 | The emperor pays | Live | **Live**, rank branches |
| 887-K1 | Spring 887 | Boso dies | Aldric | News |
| 887-K2 | Winter 887–88 | The emperor deposed | Aldric | News |
| 887-S1 | Summer 887 | Fraxinetum | Aldric | Standing hazard |
| 887-V1 | Winter 886–87 | The Northmen in Burgundy **\[Supply check\]** | Aldric + live | **Live**, raids |
| 888-K2 | Spring 888 | A king who is not a Carolingian | Aldric | News, **open throne** |
| 888-V1 | Spring/Summer 888 | Bèze sacked; **Saint-Florentin** | Summons | **Live** |
| 893-K1 | Spring 893 | A second king crowned | Aldric | Choice |
| 897-K1 | Winter 897 → Spring 898 | The kings come to terms | Aldric | News |
| 898-K1 | Autumn 898, Summer 901 | Marquis of Burgundy; the slow squeeze | Aldric | Choice |
| 898-V1 | Winter 898–99 | **Argenteuil-sur-Armançon** | Summons | **Live** |
| 910-E1 | Autumn 910 | Cluny | Ermenald | News + opportunity |
| 911-F1 | Autumn 911 | Chartres | Aldric | News |

**Background systems, not dated events:** Viking danger in Burgundy (886–911), irregular tactics, the middle years (889–97), Richard's rise, the Duke track, Arc 4 news (831–890), Saracen and Magyar news, far horizons, the church and scholars entries, the Viking tributes (E-866, E-877), minting, royal vassal duties, the king's escalation ladder, the king quest, and the natural events (N-841, N-857, N-859, N-867, N-872, N-895).

# Flag registry

Flags set by one entry and read by another. Grouped by what they track.

| Flag | Set by | Read by |
| --- | --- | --- |
| `favor_septimania` | 827-01, 829-02, 826-01 | 832-01, 843-01, 844-01 |
| `enemy_septimania` | 830-02, 832-01 | 843-01, 844-01 |
| `marked_septimanian` | 829-02 | 830-02 |
| `oath_kept_lord` | 830-02 | 843-01, 844-01 |
| `benefice_charter` | 826-01 | 830-02 |
| `side_830` (rebel / bernard) | 830-02 | 832-01, 832-03, path review |
| `outlaw_832` | 832-03 | 837-03, land outs |
| `hedge_832`, `rebel_832`, `informer_832`, `oath_kept_emperor` | 832-01 | 832-02, 832-03, 833-01 |
| `warned_832` | 831-01 | 832-02 |
| `prediction_830`, `prediction_834` | 829-02, 833-02 | 830-02, 834-01 |
| `stood_to_the_end` | 833-01 | 834-01, 834-02, 834-03 |
| `bribed_833`, `perjury_833`, `followed_count_833` | 833-01 | 834-02, path review, king quest |
| `learned_rumor_empty` | 833-01 | — (flavour) |
| `pippin_833`, `pippin_restoration` | 833-01 | 839-02, 845-A1 |
| `chaplain_trust`, `chaplain_curious`, `chaplain_suspicious` | 829-01, 833-02, 837-01 | Church entries |
| `royal_vassal` | 834-02, 835-02 | 834-03, royal vassal duties, 870-C2 |
| `villa_owned`, `villa_confirmed`, `second_villa` | 834-02 | Land and value |
| `distrusted_834` | 834-02 | 835-02 |
| `chalon_834` | 834-03 | 837-03, 841-01 |
| `saved_gaucelm`, `saved_gerberga` | 834-03 | 834-04, 843-01, 844-01 |
| `oath_under_duress_834` | 834-03 | — |
| `saved_adalard` | 837-02 | 837-03 |
| `poison_rumor` | 837-02 | — |
| `count_opinion`, `count_trust` | 830-01, 832-03 | Later summonses |
| `favor_church`, `bishop_trust`, `church_suspicion`, `church_enemy`, `holy_reputation`, `learned_reputation` | 829-01, 840-01, 853-V1, 910-E1 | King quest, excommunication rung |
| `relic_refuge_offer`, `relics_held` | 843-V1, 853-V1 | 875-V1 |
| `tournus_host`, `tournus_carts`, `tournus_escort`, `tournus_friend` | 875-V1 | King quest |
| `viking_aware` | 841-V1, 845-V1 | 862-V1, 886-V2, E-866 |
| `ergot_aware` | N-857 | N-867, N-872 |
| `predicted_eclipse` | 840-01 | — |
| `pippin2_839`, `pippin2_840`, `pippin2_submitted`, `pippin2_fled` | 839-02, 840-03, 864-V2 | 841-01, 855-A1, 866-V1 |
| `betrayed_pippin2`, `warned_pippin2`, `pardoned_864` | 864-V1 | 864-V2 |
| `oath_charles_840`, `hedge_840`, `lothair_tainted`, `enemy_warin` | 840-03 | 841-01, king quest |
| `fontenoy_charles`, `fontenoy_pippin2`, `sat_out_841` | 841-01 | 841-02, 844-02 |
| `toulouse_warin`, `toulouse_bernard`, `sat_out_843` | 843-01 | 844-01, 845-A1 |
| `bernard_saved`, `charles_enemy`, `charles_disfavor` | 843-01 | 844-01 |
| `robert_saved` | 866-V1 | 866-V1 aftermath, counts of Autun |
| `served_832`, `served_839`, `chose_charles_839`, `chose_emperor_832`, `traitor_832` | 832-03, 839-02 | Path review |
| `loyalist_830`, `loyalist_858`, `perjury_858` | 830-02, 858-C2 | 834-02, 835-02, promotion windows |
| `boso_sympathy`, `boso_refused` | 879-K2 | 887-K1, 890 Provence |
| `richard_vassal`, `richard_respect` | 880-K1 | 898-K1, Duke track |
| `king_888`, `odo_king` | 888-K2 | 893-K1, 897-K1 |
| `reputation_shrewd` | 828-01, 832-02, 833-02 | — (reputation) |

**Implementation note:** flags are either booleans or small signed integers (`favor_septimania +1`, `count_opinion -1`). Treat an unset flag as false or zero. Where an entry offers a renown or favour delta rather than a flag, it is written inline in that entry.

## Land and value system

Every holding has two values: a **recorded value** frozen in old estate records, and a **true value** of 12 times its yearly income. The gap between them drives the land events.

### Money

The silver denarius (penny) is the only coin. The solidus (shilling) and pound are units of account: 12 denarii = 1 solidus; 240 denarii = 1 pound.

### The rules

- **Recorded value:** fixed by the 825 assessment at 6,500 denarii (about 541 solidi, or 27 pounds of silver) for the villa's 10 manses. It changes only when someone formally reassesses the land.
- **Yearly income:** the value, in denarii, of everything the villa yields to its lord in a year (demesne produce plus tenants' dues), minus seed kept back for next year. Measured **before** tithes and royal levies.
- **True value = 12 × yearly income.** Medieval land typically sold for 10–20 years of income; 12 sits at the low end because a buyer still owes tithes and levies, and takes on risk.
- **Tithes and levies** are paid on top. The tithe is a tenth of produce, owed to the church. Military service and royal levies are assessed per recorded manse, not on output, so improvements raise income without raising them.

Calibration, from a simulated year of play: the unimproved villa yields an average of 525.41 denarii a year, which gives 6,305 denarii at 12 times income, rounded up to 6,500. The 6,500 denarii would weigh about 11 kg in coin, so a real payment of that size would likely mix silver with horses, weapons or cloth valued in solidi.

### Starting condition (825)

The villa is run down after the famine of 820–824: several manses are vacant (*mansi absi*, in the inventories' own term), buildings are in poor repair and some fields have gone back to brush. Suggested start: 4 of 10 manses vacant.

| Villa state | Yearly income | True value | Recorded value |
| --- | --- | --- | --- |
| Unimproved (825 start) | 525 denarii | about 6,300 denarii | 6,500 denarii |
| Improved (mill, rotation, drainage) | more than 525 denarii | 12 × the new income | 6,500 denarii |

Balance note: 6,500 denarii is about 12 years of unimproved income. The player has five years before the 830 crisis, so buying the villa outright is only reachable through improvements, trade, or rewards from the 827–830 events.

Measure improved income the same way: run a year, average the result, multiply by 12.

### Visibility and reassessment

Track a visibility score that rises with visible wealth: a new mill, new vines, fine horses, generous gifts. When visibility is high and true value far exceeds recorded value, events can fire: a royal inspector (*missus dominicus*) asks questions, a neighbor sues over boundaries, or a count decides the villa is worth taking. Buying at the recorded price is cheapest before anyone notices.

# Natural events and disasters

A third category alongside politics and church: famines, hard winters, floods, disease and plagues of pests. Aldric reports harvests, prices and damage to the estate; Ermenald adds omens, disease and what the clergy are saying. These events follow the same season-start timing.

## Food prices

**Baseline:** the maximum prices Charlemagne set after the famine of 805–806, per modius (a dry measure of about 9 litres).

| Grain | Normal price per modius |
| --- | --- |
| Oats | 2 denarii |
| Barley or spelt | 3 denarii |
| Rye | 4 denarii |
| Wheat (prepared) | 6 denarii |

**Famine multipliers.** The annals of Sens, about 100 km from Fontenay, record prices in the famine of 868 at 16 times the ceiling for wheat, 22.5 times for rye, 26 times for barley and 30 times for oats. The cheap grains rise most because the poor all turn to them.

| Severity | Grain price multiplier | Notes |
| --- | --- | --- |
| Shortage | 2–3× | A poor harvest in one region |
| Famine | 4–8× | Several bad seasons, or bad weather plus war |
| Severe famine | 10–30× | Recorded at Sens in 868; cheaper grains rise most |

### Debuffs on top of weather

Weather sets the base harvest loss. These stack on top of it:

- **Requisition and foraging:** armies passing through take grain, livestock and horses. \[Supply check\]
- **Labor loss:** men away at muster through June–August miss the hay and grain harvests.
- **Looting:** deserters and bandits after battles.
- **Seed eaten:** hungry households eat next year's seed, cutting the following harvest.
- **Livestock loss:** hard winters kill animals; fewer oxen means less ploughing.
- **Trade disruption:** Viking fleets on the rivers block grain moving by water.
- **Disease after hunger:** dysentery and fevers spread among the weakened, cutting labor further.
- **Banditry and unrest:** the desperate steal; refugees arrive.

### The law and the church on profiteering

The capitularies condemned buying grain cheap at harvest to sell it dear in hard times as shameful profit, and lords were expected to keep their own people from starving. A player who sells at famine prices makes money and loses church favor and local loyalty. A player who feeds his people and neighbors gains loyalty, renown in the district, and refugee families to settle on vacant manses.

## Event N-841: The famine of 841–845

- **Runs:** five years, overlapping the War of the Brothers.
- **Severity:** famine (4–8×) in the worst years, shortage in the others. The sources don't say which year was worst; for the game, peak it after the war years strip the region (842–843). Momentum 30.

### Causes

| Cause | Years | Effect |
| --- | --- | --- |
| Heavy rain | 841–845 | Waterlogged fields, rotting crops, poor sowing |
| Hard winters | 841–845 | Livestock losses, killed winter crops, firewood shortage |
| Armies crossing the region | 840–841 | Requisition and foraging around Burgundy and Fontenoy |
| Men away at muster | Summer 841, 842–844 | Labor loss at harvest |
| Deserters and looters | Summer 841 | Stolen stores and livestock |
| Viking raids on the rivers | 841 Rouen, 843 Nantes, 845 Paris | Grain trade on the Seine and Loire disrupted |
| Seed eaten in hungry winters | 842–845 | Each bad year shrinks the next harvest |
| Disease among the hungry | 842–845 | Fewer hands, higher deaths |

### Season schedule (each year 841–845)

| Season start | Message |
| --- | --- |
| Spring | Aldric: state of the winter crops, seed stores, and the sowing outlook |
| Summer | Aldric: rain, crop condition, and grain prices in Autun |
| Autumn | Aldric: the harvest report; Ermenald: tithes, alms, and the hungry at the church door |
| Winter | Aldric: stores against the winter, prices, refugees and thefts |

### What the player can do

- Drainage and ridged fields against the rain; crop rotation and legumes to keep yields up.
- Keep a seed reserve and build a granary.
- Grow hardier grains (oats, barley, rye) alongside wheat.
- Buy grain early, before prices climb.
- Protect the harvest from foragers and looters with a trained militia.
- Feed the hungry: loyalty, renown in the district, and refugee families for vacant manses. Or sell at famine prices: profit, at the cost of church favor and local loyalty.

## Forced weather events

In a historical famine year the weather is not rolled: a **forced weather event** replaces the season's normal random event and applies **double the usual crop effect**. The debuffs listed under N-841 (requisition, labour loss, eaten seed, disease, trade disruption) stack on top as usual.

| Years | Forced event | Seasons affected |
| --- | --- | --- |
| 841–845 | Heavy rain; hard winters | Every spring and winter |
| 859–860 | A severe winter | Winter only |
| 867–869 | Heavy rain and flooding | Spring and summer |
| 872–874 | Rain, hail, drought, hard winter; locusts in 873 | All four, varying by year |
| 895–897 | Hail; hard winter | Summer and winter |

A player whose land improvements (drainage, ridging, rotation, hardy grains, granaries) are in place reduces the doubled effect toward the normal one; an unimproved villa takes it in full.

## Event N-857: The burning sickness

- **Fires:** start of autumn 857 (news). The outbreak at home, if used, belongs in a wet famine year (867–869 or 872–874).
- **Channel and form:** Aldric with the news; Ermenald with the horror of it.
- **What it is:** ergotism, from rye infected with a fungus that grows in wet seasons. It is **not contagious**: the Rhineland outbreak cannot travel to Burgundy. But the cause is everywhere, Burgundy grows rye, and the famine years in this game are wet years.

> (Aldric) Word from the Rhineland, my lord, from around Xanten. A sickness nobody can name. It begins with burning in the hands and feet, as if they were held in a fire, and then the flesh goes black and dies on the living body. Fingers, feet, whole limbs dropping away. Others fall down in fits, or see things that are not there. Hundreds of them. Six hundred miles off, thank God.
>
> (Ermenald) They are calling it a holy fire, my lord, a judgement. I have read of nothing like it.

### The clue

The description is recognisable to a player with modern knowledge: burning limbs, gangrene, convulsions and visions. He can inspect his own rye for the dark spurs in the ears and have them sorted out before milling.

| Player's response | Effect |
| --- | --- |
| Ignores it | Nothing now. In a later wet year, the outbreak may be at Fontenay |
| Inspects the rye and finds nothing | Peace of mind; sets `ergot_aware` |
| Inspects, finds ergot, orders it sorted before milling | The household is saved from something nobody knows happened. `ergot_aware`; a standing practice that protects the villa for the rest of the game |

### The outbreak at home (optional, a wet famine year)

Households in the district begin to sicken; the player's own people are spared if `ergot_aware` and the sorting practice are in place.

| Player's approach | Effect |
| --- | --- |
| Explains the cause plainly (bad grain, a sickness of the rye) and orders sorting | Neighbours' households saved; enormous local standing; Ermenald is awed |
| Frames it as God's mercy answering prayer, with the sorting done quietly | Church favour, `holy_reputation`; the cure spreads more slowly |
| Is careless about how it looks | Suspicion: how did he know? `church_suspicion`, rumours of sorcery |

- **Links:** Natural events, momentum 20.

## Event N-859: The hard winter

- **Fires:** start of winter 859–860. Forced weather event.

> A winter like nothing in living memory, my lord. The rivers hard enough to cart over, birds dropping dead out of the air, and the beasts dying in the byres for all we can do. We will be counting what is left of the herd in March, and short of oxen for the ploughing after that.

- **Effects:** livestock losses (fewer oxen means less ploughing next year, so a second-year penalty), firewood shortage, winter crops killed. Severity: shortage, 2–3× prices.
- **Player levers:** fodder stored, byres improved, firewood laid in, beasts brought under cover.
- **Links:** Natural events, momentum 40.

## Event N-867: Flood and famine

- **Runs:** 867–869. Forced weather: heavy rain and flooding, spring and summer.
- **Severity:** famine (4–8×). Momentum 30.

| Season | Report |
| --- | --- |
| Spring 867 | Rain since Candlemas and no sign of it stopping; the low fields are under water and the sowing is ruined |
| Summer 868 | **Ermenald:** a comet, night after night, and the rivers still rising. "I do not say it is a sign, my lord. I say only that I have seen one before, and what followed." |
| Autumn 868 | The harvest is half what it should be. Prices in Autun have doubled since Easter and will double again |
| Winter 868–869 | They are dying in the villages, my lord. Not of the flux. Of nothing. Of having had nothing since autumn |

- **Causes to list:** heavy rain across western Europe; flooding; cattle disease; springs and rivers rising and damaging buildings and crops.
- **Sky event:** the comet of 868 uses the framings from 840-01.
- **Links:** Natural events, momentum 30.

## Event N-872: The years of hail and locusts

- **Runs:** 872–874. Forced weather, varying by year: rain, hail, drought, hard winter.
- **Severity:** famine (4–8×), the worst stretch of the player's middle years. Momentum 30.

| Season | Report |
| --- | --- |
| Summer 872 | Hail the size of hens' eggs through the Auxois; the standing corn flattened in an hour |
| Summer 873 | **Locusts.** "My lord, come and see. Come and see the sky." A swarm out of the east, settling on what the hail left. This is the one the chroniclers recorded; play it as a set piece |
| Autumn 873 | Nothing to harvest in half the district. Men are eating the seed corn and know it |
| Winter 873–874 | Deaths, debt, and land going begging. Those with grain can buy a manse for a cartload |

- **Opportunity:** the player with full granaries can buy land cheaply from ruined neighbours, or feed them and gain loyalty instead (see the profiteering note under Food prices). This is the single best chance in the game to expand holdings by charity or by purchase.
- **Links:** Natural events, momentum 30.

## Event N-895: The last famine

- **Runs:** 895–897, during the Odo–Charles civil war. Forced weather: hail, hard winter.
- **Severity:** famine (4–8×). Momentum 25.

> My lord, hail again, and a winter to follow it, and two kings too busy with each other to care. We have seen this before, you and I. The difference is that this time we knew it was coming and the granary is full.

- **Note:** this is the payoff famine. A player who has spent seventy years on drainage, rotation, hardy grains and storage should come through it barely touched while the district suffers. Momentum 25 because by now it is largely in the player's hands.
- **Links:** Natural events, momentum 25.

### Later natural events (for their arcs)

| Years | Event |
| --- | --- |
| 857 | Burning sickness in the Rhineland, probably ergotism from spoiled rye |
| c. 859–860 | A notoriously hard winter |
| 867–869 | Famine after heavy rain and flooding; comet in 868 |
| 872–874 | Famine with rain, hail, a hard winter, drought and locusts in 873 |
| 895–897 | Famine with hail and a hard winter |

## Appendix: Army supply and looting

Events tagged **\[Supply check\]** roll on this table at the start of the season. Prosperity cannot make a villa immune to a main army; it can make it resilient.

| Situation | Chance per season | Stores lost |
| --- | --- | --- |
| Enemy main army camps within a day's march | 80% | 50–100% |
| Friendly main army camps within a day's march | 60% | 25–50% |
| Armies 1–3 days away (foraging parties) | 30% | 10–30%; none if the militia wins |
| Deserters and bandits after a nearby battle | 50% | 20–50% of stores plus coin if they win; nothing if the militia drives them off |
| Prosperous villa (large, visible stores) | +15% to each chance above | — |

### Countermeasures

| Measure | Effect |
| --- | --- |
| Hidden and dispersed stores (storage pits, caches across the manses) | Halve the stores lost |
| Grain moved to a fortified place or into a church's keeping | Protects what was moved; churches are usually, not always, spared |
| A letter of protection from your lord or king (while serving in his army) | Friendly army: chance drops to 20% |
| Paying foragers off with a portion | Lose 10% instead of rolling |
| A trained militia | Turns foraging parties and deserters into fights; no effect on a main army |

### Distance notes

- **Chalon, 834:** about 50 km; Lothair's army living off the Saône valley. Foraging parties at least; a main army within a day's march is possible.
- **Fontenoy, 841:** about 120 km; the main armies converged near Auxerre and probably never came within a day's march of Fontenay. Foraging parties before the battle, deserters after it.

## Event 826-01: A new count at Autun

- **Fires:** summer 826.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** the count's household at Autun. Mourning for the old count, excitement about the new one. No rival version.

### Script

> My lord, Count Thierry of Autun is dead, God rest him. The county goes to his brother, our own patron, Lord Bernard. And it never rains but it pours for that family: this same year the emperor made Bernard count of Barcelona and Girona as well, on the Spanish frontier. So the man who gave you this villa now rules the county you live in. That's a fine thing for us, my lord. Though I doubt we'll see much of him; Barcelona is a long way off, and he'll leave Autun to his officers.

### Knows (can expand when asked)

- Thierry and Bernard are sons of the famous Count William of Toulouse, Charlemagne's cousin, who fought the Saracens and ended his days as a monk at the abbey he founded, Gellone.
- Bernard is young, ambitious, and now holds counties at both ends of the empire.
- Autun will be run day to day by Bernard's deputy (an invented viscount; see 830-02).

### Doesn't know

- The revolt that is already stirring in the Spanish March (it reaches Fontenay in 827-01).
- How high Bernard will rise, or how far he will fall.

### Hooks and flags

- Player rides to Autun to congratulate the new count's officers and asks for the villa grant to be written down in a charter: sets `benefice_charter`. A written grant strengthens every land option in 830.
- Player sends a gift: `favor_septimania +1`.
- **Links:** Arc 1, momentum 90.

## Event 827-01: Saracens at Barcelona

- **Fires:** start of autumn 827 (reports the summer's raids). Sets `heard_spanish_march`, which Event 828-01 relies on.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** messengers and travelers on the Rhône–Saône road, and men of Bernard of Septimania's kin near Autun. Alarmed and incomplete: nobody yet knows how it will end.

### Script

> My lord, bad tidings from the south. You may have heard there's been trouble in the Spanish March since last year: a Goth named Aizo rose against our own Count Bernard, who was given Barcelona the same year he inherited Autun. Now Aizo has called in the Saracens. An army from Córdoba has come over the mountains and is burning the country around Barcelona. The emperor has ordered our King Pippin and the counts Hugh of Tours and Matfrid of Orléans to raise an army and go to Bernard's aid. The king is calling up the southern counties nearer the March; ours isn't called this time, thank God, and the count is fighting with his southern men. But his household at Autun is anxious, and they'll remember who showed concern.

### Knows (can expand when asked)

- Aizo's revolt began in 826; he was once a hostage at the emperor's court.
- Bernard became count of Barcelona in 826, and count of Autun the same year after his brother Thierry died. He is young, ambitious, from a famous fighting family, and rarely in Autun; his officers govern for him.
- The Saracen army reached the Barcelona area this summer.
- The relief army is still gathering in Aquitaine.

### Doesn't know

- Whether Barcelona will hold, or the later attack on Girona.
- That the relief army will arrive too late, or that anyone will be punished for it.

### Hooks and flags

- Player sends a message of support, or a gift, to Bernard's kin: `favor_septimania +1`; Aldric's 828 report becomes warmer and more detailed.
- Player predicts the relief army will be late: `prediction_spain` set; pays off as `reputation_shrewd +1` when 828-01 fires.
- **Links:** Arc 1, momentum 85.

## Event 828-01: Barcelona and the disgraced counts

- **Fires:** spring 828, after the February assembly at Aachen.
- **Channel and form:** Aldric, spoken report at the villa (or a short note if the player is away).
- **Source and slant:** men of Bernard of Septimania's household passing through Autun, and the count's people. Pro-Bernard. A second version, sympathetic to Hugh and Matfrid, is heard from travelers out of the Loire country.

* **Requires:** `heard_spanish_march` (Event 827-01). If it is missing, Aldric opens with "There's been fighting in the Spanish March this past year" and explains Aizo's revolt from the start.

### Script

> My lord, there is news from the assembly at Aachen, and it is not good news for everyone. You'll remember the troubles in the Spanish March I told you of: Aizo's revolt against Count Bernard, and the Saracens of Córdoba he called in. Last summer their army burned the country around Barcelona, then went on to Girona. The emperor ordered our King Pippin and the counts Hugh of Tours and Matfrid of Orléans to raise an army and relieve him. They came so slowly that the Saracens had already gone home with their plunder.
>
> Count Bernard held Barcelona all the same, and the emperor has not forgotten it. At Aachen, Hugh and Matfrid were stripped of their counties and offices for their slowness. Bernard's men passing through Autun say he alone did his duty while great lords dawdled. I'll grant they are hardly impartial. Travelers from the Loire tell it differently: that Hugh and Matfrid were made to pay for a defeat that was everyone's fault, our own king's included. Either way, my lord, Count Bernard's star is rising, and two of the greatest men in the empire are now out of favor.

### Knows (can expand when asked)

- Aizo's revolt began in 826; he was once a hostage at the emperor's court.
- The Saracen army came from Córdoba under the emir's general, raided around Barcelona in summer 827 and attacked Girona that autumn. The district of Ausona (Vic) was laid waste.
- Bernard is a son of the famous Count William of Toulouse, who fought the Saracens under Charlemagne. His brother Gaucelm holds counties in the south.
- Hugh of Tours is Lothair's father-in-law. (Aldric can remark that the co-emperor will not be pleased.)
- There were strange red lights in the night sky before the defeat; people called it an omen.
- There was trouble on the eastern frontier too, with the Bulgars.

### Doesn't know

- That Bernard will become chamberlain in 829, or the rumors about him and Empress Judith.
- That Hugh and Matfrid will help lead a revolt in 830.
- Exact numbers of troops or dead; precise dates beyond the season.
- What was said privately at court.

### Hooks and flags

- Player opinion of Bernard: ask Aldric how to win favor with the Septimanian family. Sets `opinion_bernard` when the player states a view.
- Player remarks on Lothair's likely anger: Aldric agrees cautiously. A player who predicts trouble earns `reputation_shrewd +1` if it comes true in 830.
- Unlocks the 829 events: Worms assembly and Bernard's promotion.
- **Links:** Arc 1, momentum 85.

## Event 829-01: The reform councils

- **Fires:** start of autumn 829, reporting the Paris council of 6 June; delivered in the same season as 829-02.
- **Channel and form:** Ermenald, after Sunday Mass, reading from notes of the Paris decrees copied for the clergy of the diocese.
- **Source and slant:** clergy at Autun under Bishop Modoin, and a copy of the Paris council's decisions. Reform-minded and pro-bishop: Ermenald approves of the decrees and gently applies them to his own lord. No rival version; some lay lords simply grumble.

### Background for the designer

After the Spanish disaster, Bulgar raids and bad omens of 827–828, Louis ordered fasting and called four great church councils for 829, at Mainz, Paris, Lyon and Toulouse, to find out why God was angry and what to amend. Autun belongs to the province of Lyon, so Bishop Modoin would have gone to Lyon, but nothing survives of what was said there or at Toulouse. The Paris council (four archbishops, about 25 bishops), led in spirit by Jonas of Orléans, left detailed decisions that circulated widely, so Ermenald works from those.

### Script

> My lord, you asked what came of the bishops' gatherings. The emperor called them because God is plainly displeased with us: the defeat in Spain, the Bulgars in the east, the lights in the sky. Four councils met this summer. Our own bishop went to Lyon, but the copies we have are from Paris, where Bishop Jonas of Orléans and his brothers wrote at length.
>
> Their judgment is that the troubles come from sin, high and low. The emperor rules as God's minister, and must answer for every unjust count and every bribed judge in his name. Bishops are rebuked too: for worldliness, for neglecting their flocks, for treating the Church's goods as their own family's wealth.
>
> And they speak to men like you, my lord. Keep the Lord's Day holy: no markets, no court cases, no field work on Sunday; they are asking the emperor to forbid it by law. Pay the tithe in full. Do not take the Church's lands or treat its priests as your servants. Marry lawfully, keep no concubines, and do not wed within the forbidden degrees of kinship. Judge the poor fairly; God hears their complaints. I will say, as your chaplain, that our church here could stand to be better honored. But I do not say it as a rebuke.

### Knows (can expand when asked)

- Why the councils were called: the disasters of 827–828 seen as signs of God's anger, with fasting ordered beforehand.
- The four meeting places, and that Paris covered the provinces of Reims, Sens, Tours and Rouen.
- Bishop Jonas of Orléans was the leading mind at Paris; he also wrote a book of advice on Christian living for laymen, addressed to Count Matfrid, now disgraced. (Ermenald may find this ironic.)
- The broad themes: king as God's minister; bishops' duties; Sunday rest and the request to ban Sunday markets and lawsuits; Church property; marriage rules; justice for the poor.
- Bishop Modoin of Autun is a learned man, once a poet at Charlemagne's court, who signs his verse "Naso" after Ovid.

### Doesn't know

- What was decided at Lyon or Toulouse (not even the designer knows).
- That the emperor will be forced into public penance by bishops in 833.
- Court politics behind the councils, or that some bishops are quietly unhappy with Empress Judith's circle.

### Hooks and flags

- Player honors the villa church (repairs, gifts, a fair tithe): `favor_church +1`; Ermenald's opinion rises.
- Player keeps Sunday markets or work going: Ermenald objects; `favor_church -1`.
- Player asks to meet Bishop Modoin: unlocks an Autun visit; Modoin is a natural audience for a learned player.
- Player proposes a practical cause for the disasters (weather, bad leadership) rather than sin: Ermenald is uneasy but interested. Sets `chaplain_curious` if handled tactfully; `chaplain_suspicious` if not.
- **Links:** Church section, 829 reform councils, momentum 80.

## Event 829-02: The assembly at Worms

- **Fires:** start of autumn 829, reporting the August assembly at Worms. Requires 828-01.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** Bernard's kin and clients around Autun, who are jubilant. A darker whisper, from people sympathetic to Lothair and his adviser Wala, abbot of Corbie, is spreading too. Aldric repeats it reluctantly and quietly.

### Script

> My lord, the emperor has done something that will set tongues wagging for years. At Worms he has given young Charles, the empress's boy, only six years old, a kingdom of his own: Alemannia, Alsace, Rhaetia and a part of Burgundy. That land was meant for his elder brothers, and King Lothair has been sent off to Italy. And our own count, Bernard, the defender of Barcelona, is made chamberlain. He's the second man in the empire now, keeper of the palace and the emperor's ear.
>
> His people hereabouts are ringing bells. But I'd be a poor steward if I didn't tell you the rest. There's ugly talk on the roads, from men who favor Lothair: that Bernard has bewitched the emperor, and worse, that he is too close to the empress herself. I don't repeat it as truth, my lord. I repeat it because others are repeating it, and that sort of talk ends in swords.

### Knows (can expand when asked)

- The lands granted to Charles; Lothair sent to Italy; Bernard made chamberlain.
- The emperor's elder sons were promised their shares in 817; this breaks that arrangement.
- Hugh and Matfrid, disgraced last year, are Lothair's men; Wala of Corbie is Lothair's mentor and a stern critic of the court.
- The rumor of Bernard and Judith, and that it is coming from Lothair's side.

### Doesn't know

- Which part of Burgundy is meant; Aldric thinks it is the lands toward the Jura, not Autun, but isn't sure.
- That the elder sons will rise next spring.
- Whether the rumor is true (no one does).

### Hooks and flags

- Player congratulates Bernard's kin: `favor_septimania +1`, but sets `marked_septimanian` (rebels will remember in 830).
- Player repeats the rumor: `favor_septimania -2`; Lothair's partisans warm to the player.
- Player tells Aldric to stop spreading it: Aldric approves; no flag.
- Player predicts the sons will rebel: sets `prediction_830`.
- **Links:** Arc 1, momentum 80.

## Event 830-01: The summons to Brittany

- **Fires:** start of winter 829–830 (a summons for a spring muster). Requires 829-02.
- **Channel and form:** Aldric, bringing the count's messenger in to deliver the summons, then advising in private.
- **Source and slant:** official summons, plus Aldric's own read of the mood. No faction slant; Aldric is simply worried.
- **Design note:** the sources describe a general muster for the Breton campaign; whether Burgundian contingents were called is not recorded. Calling the player is a game assumption that fits the period.

### Script

> (Messenger) By order of the emperor, through Count Bernard's officers at Autun: every man bound to serve is to join the host against the Bretons, and present himself at the muster in the west after Easter, with horse, shield, lance and arms, food for three months and clothing for six.
>
> (Aldric, after he has gone) A campaign in Lent, my lord, with the roads still deep in mud, and against the Bretons, who have beaten better armies in their bogs. Men are grumbling already. Half the grumbling is about the season; the other half is about who they'll be marching for. Count Bernard's enemies say this war is his idea, to keep the great men busy while he rules the palace. And we are his men, my lord. Every eye in that camp will know it. I'd go, my lord, refusing the emperor is no small thing. But I'd go with eyes open, and I'd keep our men close.

### Knows (can expand when asked)

- The service owed: the lord in person with a small mounted following, armed, with supplies.
- Lent is a holy season; campaigning in it offends many.
- Bretons have defied the emperor before, and the last campaign there, in 824, was hard.
- The talk that Bernard is behind the war.

### Doesn't know

- That the muster will turn into a mutiny.
- Where the other great men will stand.

### Hooks and flags

- Player prepares thoroughly (spare horses, good supplies, disciplined men): `well_equipped` set; gives options in 830-02.
- Player tries to avoid service (illness, payment, excuse): the count notes it; `count_opinion -1`. The player misses 830-02 entirely and hears it from Aldric afterward.
- **Links:** Arc 1, momentum 80.

## Event 830-02: The mutiny and the reckoning (live scene)

The player's count is Bernard of Septimania himself, count of Autun since about 826, and the revolt is aimed squarely at him. He is at court as chamberlain, so the Autun contingent marches under his deputy (an invented NPC; suggest a viscount from Bernard's household). The army never fights a battle; the player's real decision comes at home, when the rebels demand oaths.

This is the first **live scene**: narrated through NPCs on the spot, with Aldric's letters covering home while the player is away.

**The new count: Adalard.** The record is blank for Autun between Bernard's fall in 830 and Warin in the late 830s, so the game invents him. Adalard is a cautious pragmatist: he takes Autun from the new regime in 830, crosses over at the Field of Lies in 833 with almost everyone else, and stays home during Lothair's war in 834. Like other nobles of the period, he has no surname; he is "Adalard, count of Autun."

### Sequence

| Step | When | What happens | Momentum |
| --- | --- | --- | --- |
| 1 | April 830 | The muster in the west, near Rennes. Rumors about Bernard and the empress sweep the camp; the host refuses to march and drifts toward Pippin at Paris. | 75 |
| 2 | April | The Autun men are "Bernard's creatures" and are jeered, threatened, and shut out of the rebels' councils. The deputy leads them home to hold Autun for the count. | 60 |
| 3 | May | **Tutorial battle.** On the road home through the Morvan, the column finds deserters from the broken host plundering a village. The deputy and player attack. (Invented local action; momentum 15.) | 15 |
| 4 | May–June | News reaches Autun: the emperor taken at Compiègne, the empress shut in a convent at Poitiers, Bernard fled to Barcelona, his brother Herbert blinded, his cousin Odo stripped of Orléans. Autun is declared forfeit. | 75 |
| 5 | Summer | Envoys of the new regime arrive and demand that Bernard's vassals swear to it. **The choice.** | 50 |
| 6 | October | Assembly at Nijmegen: the emperor's eastern supporters come armed and he takes back his authority. Lothair goes back to Italy; rebel leaders are condemned. Bernard is **not** restored to Autun or court. | 75 |

### The two outcomes

The player's whole villa is a benefice from Bernard, so his fall puts all 10 manses at stake. Bernard is never restored to Autun, and the record of who held Autun between 830 and the late 830s is blank. The game can therefore let the new count keep the county after the emperor recovers in October.

|  | Side with the rebels: serve the new count | Stay loyal to Bernard |
| --- | --- | --- |
| Legal basis | Royal law let a vassal leave his lord for serious cause, including failing to defend him. Bernard fled to Barcelona and left his men exposed. The player formally renounces him and commends himself to the new count. | The player keeps his oath to Bernard, an exile with no power in Autun. |
| Land | Kept: the new count confirms the benefice to his new man. | **Land crisis:** the new count claims the villa as Bernard's forfeited property. See the three outs below. |
| Honor | Lawful, not perjury, but Bernard's kin call it desertion (`enemy_septimania`). | High: `oath_kept_lord`. Bernard's family owes the player. |
| Later | Tied to the new count's fortunes. Bernard's family returns to power in the south from 835, but never to Autun. | Valuable to the Septimanian family later, especially Bernard's sons. |

### The land crisis: three outs

The crisis opens when the new count's envoys arrive (summer 830). Suggested deadline: the emperor's assembly at Aachen, February 831.

1. **Buy the villa outright at the old recorded price.** Forfeited land is in the hands of the new count and, above him, the crown. The player pays the recorded value (see Land and value system) for a sale that turns the benefice into owned land. The count must agree, and a royal confirmation charter makes it secure. Much easier with `benefice_charter` and with `loyalist_830`.
2. **Marry into a local family.** A neighbor's daughter brings her own allods: land the player's household owns outright, as a fallback if the benefice is lost. The real protection is her kin: a count thinks twice before seizing land from a man with powerful in-laws. The 829 church rules on marriage within kinship degrees apply. Sets `married_local`.
3. **Put the villa under the Church.** The bishop of Autun or a nearby abbey petitions to take the villa under its protection, then grants it back to the player as a *precaria*: tenure for life, sometimes extended to heirs, for a yearly rent in whatever is agreed: coin, grain, wine or wax. Two rent options: a small fixed rent (a few denarii or solidi a year), or the nona, a ninth of the villa's produce on top of the tithe, the rule for laymen holding church land by royal order. The player then serves the church instead of a lay lord, riding in the bishop's or abbot's contingent when the army is called. The player stays a layman; no vows or orders are needed. Ermenald brokers it. Sets `precaria_church` and `favor_church +2`.

**Does anyone loot?** The rebels of 830 did not sack towns. Their "loot" was confiscation: the offices and lands of Bernard, his kin and his followers were taken and handed out. That is the temptation of the rebel path, and its risk, because the grants vanish when the emperor comes back. Ordinary plunder comes from the breaking-up of the army: deserters and foragers, as in the tutorial battle.

**Is staying loyal more honorable?** Mostly, but not simply. Every free man had sworn fidelity to the emperor, and breaking that oath was perjury: a sin as well as a crime. But the rebels said they were rescuing the emperor from Bernard and the empress, and respected churchmen such as Abbot Wala of Corbie backed them. In spring 830, joining them was not plain treason in most people's eyes; in hindsight, after Nijmegen, loyalists clearly look better.

There is a second loyalty in play: a vassal's faith to his own lord, here Bernard. The emperor himself will not restore Bernard, so the cleanest outcome is keeping faith with the emperor while not tying yourself too closely to the fallen count.

### Choosing differently from your lord

Bernard has fled, so the real split is between the player, the deputy and the neighbors:

- The deputy holds Autun for Bernard as long as he can. A player who commends himself to the new count is a deserter in his eyes and to Bernard's kin (`enemy_septimania`).
- A loyal player surrounded by neighbors who switched will face pressure: a neighbor backed by the new count may try to seize disputed fields or a mill. This is a second small fight opportunity (momentum 20).

### Renown opportunities

| Opportunity | When | Renown |
| --- | --- | --- |
| Keep your men together while the host dissolves | April | Small |
| Tutorial battle: drive off deserters plundering a village | May | Moderate |
| Defend Fontenay or a neighbor against a rebel-backed land grab | Summer | Moderate |
| Escort Bernard's family or followers to safety | May–June | Moderate (high risk) |
| Carry messages for the loyalists | Summer | Small |
| Ride armed to Nijmegen | October | Large |

### Hooks and flags

- Sets `side_830` = rebel or bernard.
- Honor tags: `oath_kept_emperor`, `oath_kept_lord`, or `perjury_830`.
- Emperor plus Nijmegen sets `loyalist_830`: rewards and patronage in 831.
- Rebel sets `rebel_830`: gains reversed in 831; feeds into the 833 revolt.
- If `prediction_830` is set: `reputation_shrewd +1`.
- Autun has no count after 830. Designer choice: leave it in royal hands, or (at higher ranks) make it an opening for the player. Historically, Warin holds it from the late 830s or 840s, depending on the source.
- **Links:** Arc 1, keystone K1.

## Event 831-01: Bernard at Thionville

- **Fires:** start of winter 831–832, reporting the October assembly at Thionville.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** depends on `side_830`. On the Bernard path, Aldric hears it from Bernard's remaining people and is sympathetic. On the rebel path, he hears it from the new count's household and is cool toward Bernard.

### Script

> My lord, news from Thionville. Lord Bernard came before the emperor in person to clear his name of all those charges, and he spoke with him face to face. But he was not given back his place at court, nor Autun. The empress and young Charles keep their distance from him now. They say he left in a black mood.
>
> And there's more trouble brewing. Our King Pippin has quarreled with his father the emperor again; he was ill received at court and rode home without leave. A son who leaves his father's court without permission is halfway to rebellion, my lord.

### Knows (can expand when asked)

- At the February 831 assembly the empress cleared herself by oath and returned to court; the emperor made a new plan to divide the empire among his sons.
- Bernard spoke to the emperor at Thionville but was not restored.
- Pippin feels cheated and slighted; there is talk that Bernard is in touch with him.

### Doesn't know

- That Bernard is actively urging Pippin to revolt.
- What the emperor will do about Pippin.

### Hooks and flags

- Player asks Aldric whether Bernard will turn against the emperor: Aldric fears so. A player who warns the emperor's men sets `warned_832` (useful on either path).
- **Links:** Arc 1, momentum 75.

## Event 832-01: A letter from Bernard

- **Fires:** start of winter 831–832, in the same season as 831-01, after Pippin's revolt begins in November 831. **Only if `side_830` = bernard.** On the rebel path, skip this entry; 832-02 covers the news.
- **Channel and form:** a sealed letter carried by one of Bernard's riders. Ermenald reads it aloud if the player can't read Latin. Aldric advises afterward.
- **Source and slant:** Bernard himself. Bitter, persuasive, and self-serving.

### Script

> (The letter) Bernard, by God's grace duke, to his faithful man at Fontenay, greeting. You kept faith with me when others ran to the new men. I do not forget it. The emperor is ruled by those who hate me and who lied about me, and they have cheated King Pippin of his rights as they cheated me. Pippin will not bear it, and he is right. I ask you, as my man: send what horses and men you can to our king in Aquitaine, or at least hold yourself ready. When right is restored, Autun will remember who stood with us, and so will I.
>
> (Aldric, after) My lord, this is a dangerous letter. Lord Bernard is asking you to take up arms for our king against his father. In plain words, against the emperor. If it goes badly, a letter like that can hang a man. You owe him faith, but you also swore to the emperor. Whatever you decide, I'd decide it quickly, and I'd think hard about what to do with that parchment.

### Knows (can expand when asked)

- Bernard is in the south, among his own people in Septimania.
- Pippin has gone back to Aquitaine in defiance of his father.
- Aldric (and Ermenald) both feel the pull of the player's oath to Bernard and his oath to the emperor.

### Doesn't know

- That the emperor will move against Pippin with force in 832, or that Bernard's lands in the south are already being attacked by Berengar of Toulouse, a loyalist.
- How the revolt will end.

### The choice

| Option | Result | Flags |
| --- | --- | --- |
| Send men and horses to Pippin | Bernard's gratitude; serious danger when the revolt fails in autumn 832 | `rebel_832`, `favor_septimania +2` |
| Reply warmly but send nothing ("hold yourself ready") | Keeps Bernard's goodwill without committing; the classic hedge | `hedge_832` |
| Refuse politely, citing the oath to the emperor | Honorable; Bernard is hurt but respects it | `oath_kept_emperor`, `favor_septimania -1` |
| Hand the letter to the emperor's men | Rewarded by loyalists; Bernard's family become enemies | `informer_832`, `enemy_septimania` |

- **Renown:** none directly; this is a loyalty test. Sending men to Pippin could lead to minor skirmishing in Aquitaine (optional live scene).
- **Links:** Arc 1 and Arc 5, momentum 70.

## Event 832-03: The count's summons

- **Fires:** start of summer 832, as the emperor gathers an army for Aquitaine. Comes after 832-01 and before 832-02.
- **Channel and form:** the new count of Autun's messenger, delivered with Aldric present. A live scene follows.
- **Source and slant:** official. On the Bernard path, the summons is deliberate: the count knows exactly whose man the player was.
- **Design note:** the forces that fought Bernard directly were southern loyalists under Berengar of Toulouse. The emperor's own army marched into Aquitaine against Pippin, and a Burgundian count calling his men to it is plausible. The skirmishes in each branch are invented local action (momentum 15–25).

### Script

> (Messenger) The emperor marches into Aquitaine to bring our King Pippin to obedience. By order of the count of Autun, you will join his contingent at the muster, armed and provisioned, before the feast of Saint John.
>
> (Aldric, after, on the Bernard path) He's testing you, my lord. He knows you kept faith with Lord Bernard, and now he wants to see whether you'll ride with the emperor against Bernard's friends. If you go, Bernard will hear of it. If you don't, the count will call it treason, and he'll have the law on his side.

### Branches

| Path so far | What happens | Fighting | Renown | Flags |
| --- | --- | --- | --- | --- |
| Rebel path (`side_830` = rebel) | Ordinary service with your own count; no test. You ride with the royal host into Aquitaine. | A skirmish with Pippin's partisans holding a fortified estate | Small to moderate | `served_832` |
| Bernard path, joined Bernard (`rebel_832`) | You are already gone south. Ignoring the summons makes you an outlaw at home. You ride with Bernard's men against Berengar of Toulouse's loyalists in the Roussillon. | Raids and skirmishes far from home; risk of capture | Moderate, high risk | `outlaw_832`, `favor_septimania +1` |
| Bernard path, hedged (`hedge_832`) | The summons forces your hand: obey and ride against Bernard's cause, or refuse and be named a traitor. | If you obey: the same skirmish as the rebel path | Small to moderate if you obey | `chose_emperor_832` or `traitor_832` |
| Bernard path, refused Bernard or informed | You obey willingly; the count is satisfied and Bernard's people hear of it. | The skirmish with Pippin's partisans | Moderate, plus favor with the count | `served_832`, `count_trust +1` |

### Hooks

- An outlaw player (`outlaw_832`) has angered Count Adalard by refusing his summons, so the villa is no longer safe under him. The player must secure it independently of Adalard through one of the three land outs from 830-02: put it under the Church, marry into a local family, or buy it outright. The outlaw status ends when Warin takes Autun in 837.
- Every branch ends when Pippin and Bernard submit in the autumn (832-02).
- **Links:** Arc 1 and Arc 5, momentum 70.

## Event 832-02: Pippin's fall

- **Fires:** start of winter 832–833.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** travelers and the new count's household. Mostly factual; tone depends on the player's 832-01 choice (worried if `rebel_832`, relieved otherwise).

### Script

> My lord, it's over in Aquitaine. In the spring Louis of Bavaria rose against his father too, but the emperor marched east and brought him to heel quickly. Then he turned on Aquitaine. By autumn King Pippin and Lord Bernard were both made to come before him. The emperor took Aquitaine from our King Pippin and gave it to young Charles, so the boy is our king now, and sent Pippin off as a prisoner to Trier, though they say he slipped his guards on the road and is loose again. As for Lord Bernard: he is accused of breaking faith and stripped of everything, Barcelona, Septimania, all of it. Count Berengar of Toulouse has his lands now.

### Knows (can expand when asked)

- Louis the German's brief revolt in spring 832, put down without a great battle.
- Charles, now nine, is king of Aquitaine in name.
- Pippin escaped on the way to Trier; Aquitaine is restless.
- Bernard has lost all his offices and lands; Berengar of Toulouse, a loyalist, benefits.

### Doesn't know

- That the three elder sons will unite and depose the emperor next summer (Field of Lies, 833).
- Where Bernard is now.

### Hooks and flags

- If `rebel_832`: the new count's men investigate who helped Pippin. Consequences depend on how many men the player sent and whether the letter survives. A good fit for a short tense scene with Ermenald or Aldric about burning it.
- If `informer_832` or `oath_kept_emperor`: favor with the loyalists; a natural moment to ask for a royal charter (supports the land outs in 830-02).
- If `warned_832`: `reputation_shrewd +1`.
- **Links:** Arc 1 and Arc 5, momentum 75.

## Event 833-01: The Field of Lies (live scene)

- **Fires:** the summonses arrive at the start of spring 833 and the live scene opens at the start of summer 833. The player chooses between two summons: the emperor's (through the count, or directly) or our King Pippin's (see "The other side" below). The emperor's army meets the three elder sons on the Rotfeld near Colmar, in Alsace, in late June.
- **Channel and form:** live scene in camp, over several nights. NPCs: the count of Autun, fellow vassals, the sons' agents, and finally the emperor himself.
- **Source and slant:** the player's own eyes. The pressure comes from all sides.

### What happened

Lothair, Pippin and Louis the German united against their father and brought Pope Gregory IV with them. Among them is Pippin, the player's own king: the player's king and his emperor are on opposite sides of the field. The pope crossed to the emperor's camp to negotiate. Over the following days, through bribes, threats and promises, nearly everyone sworn to the emperor slipped across to the sons. When Louis was almost alone, he told his last followers: "Go to my sons," saying it would be a pity if any man lost life or limb for his sake. He surrendered without a blow. The place became known as the Field of Lies, for the oaths broken there.

### Stages

The player can cross over at any stage. The later they leave, the greater the honor.

| Stage | What happens | Leaving now | Honor and renown | Flags |
| --- | --- | --- | --- | --- |
| 1. The pope's visit | Pope Gregory IV, brought by the sons as a peacemaker, crosses to the emperor's camp. The camp is awed and frightened. Two things happen. The rumor: word spreads through the camp that the pope will excommunicate the emperor and his bishops if they resist; it is only a rumor, and the pope threatens no one. The emperor's bishops: they answer defiantly that if the pope came to excommunicate, he will go home excommunicated himself. A player who asks the right people (Ermenald, a bishop's clerk) can learn the threat is empty. | Too early to leave without shame | — | `learned_rumor_empty` if the player investigates |
| 2. The bribe (night) | An agent of the sons offers a purse of silver to cross over tonight. | Take the bribe and cross | Lowest. **Renown loss (moderate)** once word spreads that the player sold his oath; perjury | `bribed_833`, `perjury_833`, renown penalty, gain the silver |
| 3. The threat (night) | A rival vassal from the sons' camp warns that those who stay will lose their lands, and maybe their eyes, as Bernard's brother did in 830. | Cross out of fear | Low. **Renown loss (small)**; perjury | `perjury_833`, small renown penalty |
| 4. The count goes over (day) | The count of Autun crosses with most of his men and sends word for the player to follow. Now the player's lord and his emperor point in opposite directions. | Follow your lord | Neutral: obeying your lord is defensible | `followed_count_833` |
| 5. The emperor releases you | The emperor, nearly alone, tells his last followers to go to his sons, so no one is harmed for him. | Cross on the emperor's command | Highest: kept faith to the end, released by the emperor himself | `stood_to_the_end`, large renown |

**Renown:** no combat; renown here is for loyalty under pressure. Stage 5 is the largest renown award of the decade so far, but it pays out in 834, once the emperor is restored. In the meantime, the sons' party watches the player closely.

### The other side: Pippin's camp

In spring 833 two summons reach the region: the emperor's, calling loyal men to his army, and our King Pippin's, calling his own men to join his brothers. A player who answers the king's summons (likely if `rebel_832`, or by choice) watches the Field of Lies from the sons' side.

**Narration, not combat.** The player sees the pope ride across to the emperor's camp and back. Then, night after night, torches move across the field as the emperor's men come over: first a few, then whole companies, then counts with their banners. The camp is uneasy and astonished: everyone expected a battle, and not one man stands to fight for the emperor. On the last day, the emperor himself walks across the field to his sons with a handful of companions. Some in Pippin's camp cheer; many are quiet. NPCs may voice the shock: a veteran who says he never thought to see an emperor abandoned, a priest who calls it a day of shame for everyone who swore an oath.

**No perjury.** Following your own king is defensible, like following your count. No renown penalty.

**Renown:** very modest, for faithful service to the king. Promotion at this point is unlikely: there were no deeds to notice, and Pippin's rewards go mainly to the great men who brought him troops.

| Player standing | Chance of any reward from Pippin | Most likely form |
| --- | --- | --- |
| Unknown, low renown | about 10% | A gift passed down through the count |
| Moderate renown, or known to Pippin from 832 | about 30% | Benefice confirmed, or a small grant |
| High renown and a patron at Pippin's court | about 55% | A small grant, and a case for viscount if the count backs it |

**What comes next:** in early 834 Pippin turns against Lothair and marches to free his father. A player who follows him helps restore the emperor and lands on the winning side again. That march is a much better chance to be noticed than 833. Sets `pippin_833`; in 834, `pippin_restoration` if the player marches with him.

**Long-term cost:** Pippin dies in 838. His men become Pippin II's party, which loses to Charles in the 840s, so a Pippin man faces a hard choice in 840.

### Afterward (summer–autumn 833)

- The emperor is held at Saint-Médard in Soissons; in October he is forced to do public penance and lay down his arms (a natural Ermenald event).
- Empress Judith is sent to Tortona in Italy; young Charles is held at the abbey of Prüm.
- Lothair rules as emperor. Those who stood to the end are distrusted; those who took bribes are rewarded, for now.

### Hooks and flags

- `stood_to_the_end`: unlocks major rewards when Louis is restored (March 834), and a strong case for a royal charter for the villa.
- `bribed_833`: the silver is kept, but the renown loss and the perjury mark stay with the player, and the restored emperor remembers who sold their oath.
- `followed_count_833`: neutral with the emperor, trusted by the count.
- Leads into 834: Louis's restoration and the siege of Chalon-sur-Saône, where all paths can end up fighting on the same side.
- **Links:** Arc 1, momentum 75.

## Event 833-02: The emperor's penance

- **Fires:** start of winter 833–834, reporting the November penance at Soissons.
- **Channel and form:** Ermenald, privately, after Vespers. He is shaken and chooses his words carefully.
- **Source and slant:** clergy who were at Soissons, passed on through the bishop's household. Ermenald's own view is troubled: he respects the bishops, but this frightens him.

### Background for the designer

After the Field of Lies, Louis was held at the abbey of Saint-Médard in Soissons. In autumn 833, bishops led by Archbishop Ebbo of Reims made him confess a list of crimes in the church of Saint Mary at Soissons, lay his sword belt on the altar, and put on the garb of a penitent. A man under public penance could not bear arms or rule, so this was meant to end his reign for good. Lothair's party called it a just judgment; the emperor's supporters called it an outrage.

### Script

> My lord, I have news from Soissons, and I hardly know how to tell it. The bishops, led by the archbishop of Reims, have made the emperor do public penance. They gave him a written list of his sins: that he broke the oaths everyone swore to the old division of the empire; that he made his people swear contradictory oaths; that he called the army out in Lent; that he punished men without judgment; and the death of his nephew Bernard of Italy, years ago, who died after being blinded on his order. He read it out before the altar, in tears they say, then laid his sword belt on the altar and put on the penitent's robe.
>
> A penitent cannot carry arms or rule, my lord. They mean it to be the end of him. The bishops say they acted for the good of his soul and the realm. Perhaps. But I was taught that the Lord's anointed is not ours to cast down, and I cannot shake the thought that half the men who wrote that list had sworn to him only a year before. Pray for him. And forgive me: I would rather not speak of it again tonight.

### Knows (can expand when asked)

- Archbishop Ebbo of Reims led the bishops; Lothair's party supports it.
- The main charges on the list, as above.
- What public penance means: no arms, no rule, a life of atonement.
- The emperor is held at Saint-Médard; the empress is in Italy; young Charles is held at the abbey of Prüm.

### Doesn't know

- That the emperor's other sons will free him in a few months and he will be restored (March 834).
- That Ebbo will be forced to retract and be deposed (835).

### Hooks and flags

- Player who says the penance is unjust: Ermenald is relieved to hear it said aloud; `chaplain_trust +1`. Dangerous if repeated to the wrong people while Lothair rules.
- Player who argues it was justified: Ermenald falls quiet; `chaplain_trust -1`.
- Player with `stood_to_the_end`: Ermenald says the emperor's last loyal men are spoken of with respect, quietly, even now.
- Player who predicts the emperor will be restored: sets `prediction_834`.
- **Links:** Arc 1, momentum 75.

## Event 834-01: The emperor restored

- **Fires:** March 834.
- **Channel and form:** Aldric, spoken report. Ermenald adds a word about the church's role (optional).
- **Source and slant:** travelers and Adalard's household. Relief, and some nervousness among those who sided with Lothair.

### Script

> My lord, the wheel has turned again. Lothair treated his father so shamefully, dragging him about, trying to make a monk of him, that the emperor's other sons, our King Pippin and Louis of Bavaria, have turned against their brother. Our king has his kingdom back, too. Lothair fled south toward Burgundy, and on the first of March the emperor was restored at Saint-Denis and girded with his sword again. The empress is coming back from Italy, and young Charles is freed. Count Adalard says nothing, but I hear his household is busy writing letters of congratulation.

### Knows (can expand when asked)

- Lothair has fled toward Vienne and Burgundy with his army and supporters, including Count Matfrid and Lambert of Nantes in the west.
- Men who stood by the emperor in 833 are being sought out and thanked.
- Lothair is not finished.

### Doesn't know

- That Lothair's war will reach Chalon this summer.

### Hooks and flags

- If `stood_to_the_end` or `loyalist_830`: Aldric suggests the player ride to the emperor while gratitude is fresh. Leads to 834-02.
- If `bribed_833`: Aldric is uneasy; those who sold their oaths are being remembered too.
- **Links:** Arc 1, momentum 80.

## Event 834-02: The emperor's gratitude

- **Fires:** spring 834, if the player rides to the emperor's court after 834-01.
- **Channel and form:** live scene, an audience with Louis the Pious or his officials.
- **Source and slant:** the emperor, who remembers who stood by him.

### Rewards by standing

| Player's record | Reward | Flags |
| --- | --- | --- |
| `stood_to_the_end` and high renown | Made a royal vassal (*vassus dominicus*): a direct vassal of the emperor, owing him service personally. A royal charter turning the villa into the player's own land, or a second villa as a benefice. Eligible for viscount rank. | `royal_vassal`, `villa_owned` or `second_villa` |
| `stood_to_the_end`, modest renown | A royal charter confirming the villa; the emperor's goodwill | `villa_confirmed` |
| `followed_count_833` | Polite thanks; nothing more | — |
| `bribed_833` or `perjury_833` | Cold reception; no reward; the emperor's officials make a note | `distrusted_834` |

**Design note:** grants to loyal men after the restoration are well attested in general; the specific grant is a game reward. Renown thresholds for each tier should match your rank system.

### Hooks

- `royal_vassal` means the player owes service to the emperor directly, not only through Count Adalard. This is why a royal vassal gets Warin's call in 834-03 even though Adalard stays home.
- A charter here resolves the 830 land crisis for good.
- **Links:** Arc 1, momentum 60.

## Event 834-03: Lothair's war comes to Burgundy \[Supply check\]

- **Fires:** opens at the start of summer 834 with Aldric's warning; the Chalon siege falls during the summer.
- **Channel and form:** Aldric's report, then a live scene on one of two branches.
- **Source and slant:** refugees, merchants on the Saône road, and (for royal vassals) a letter from Count Warin.

### Aldric's warning

> My lord, bad news from the west and worse from the east. Lothair's men, Count Matfrid and Lambert of Nantes, met the emperor's army near the Breton border and cut it to pieces. Count Odo, who was Lord Bernard's cousin, is dead, with his brother the count of Blois, the count of Maine, and even the abbot of Saint-Martin at Tours. And Lothair himself is in the Saône valley with his army, living off the land. Count Adalard has shut himself up in Autun and says it is not our quarrel. I'd look to our own walls, my lord.

### Branch A: stay home (default)

Adalard keeps out of the war, and so does the player unless he is a royal vassal. But Lothair's army is in the region, and its foragers and stragglers don't care whose quarrel it is.

| Beat | What happens | Fighting | Momentum |
| --- | --- | --- | --- |
| Foragers | Small bands (10–20 men) strip villages for food and horses. Two or three local fights; a trained militia and a watch post turn them away, an untrained household may lose livestock or a barn. | Small skirmishes | 20 |
| The stronger company | A larger band (30–40) tests Fontenay itself. Enough to take an unprepared villa; beatable with a trained militia and a defensible position. | The branch's main fight | 15 |
| Chalon falls | Smoke on the horizon; news of the sack, of Gaucelm's beheading, and of the nun Gerberga drowned in the Saône. | — | 45 |
| Refugees | Families from the Chalon district arrive with what they can carry. Each family the player takes in can be settled on a vacant manse, raising the villa's income. Some may bring skills (a smith, a mason, a vintner). | — | 30 |

**Renown:** small to moderate, for defending the villa and neighbors. The real gain is economic: resettled manses and goodwill.

**Lesson:** sometimes it is not your fight. A player who stays home, defends well and welcomes refugees can come out of 834 richer and safer than one who marched off to war.

### Branch B: Warin's letter (royal vassals)

- **Requires:** `royal_vassal` from 834-02. Optional: allow other players to volunteer and ride to Chalon on their own.

> (Letter) Warin, count, to the emperor's faithful man at Fontenay, greeting. Lothair marches on Chalon with all his strength. I hold the city for our lord the emperor, with Gaucelm, son of the great Count William, and his kin. You are the emperor's man as I am. Come with every man and horse you can, and come quickly.

| Beat | What happens (historical track) | Momentum |
| --- | --- | --- |
| Arrival | The player reaches Chalon days before Lothair. Time to strengthen walls, stock water and food, and organize the defense. | — |
| The siege | Several days of assault. Historically the city held only a few days, then was taken and burned. | 45 |
| The fall | Warin surrenders and swears to Lothair to save his life. Gaucelm is beheaded; Gerberga is drowned in the Saône. | 45 |

**What the player can change** (momentum 45 makes this genuinely open):

- Stronger defenses, fire precautions, or a well-timed sally can hold the city long enough for Lothair to move on.
- Smuggling Gaucelm and Gerberga out before the fall saves Bernard's kin and earns the Septimanian family's lasting gratitude (`saved_gaucelm`, `saved_gerberga`).
- If the city falls with the player inside: swear to Lothair under duress like Warin (`oath_under_duress_834`), or escape over the walls (risky, high renown).

**Renown:** large. This is the decade's first real battle and the moment for everything the player built from 825 onward.

### Hooks and flags

- Sets `chalon_834` = stayed\_home, defended, saved\_city, or fell.
- Refugees settled raise the villa's income; recompute true value.
- **Links:** Arc 1, keystone K1 aftermath, momentum 45.

## Event 834-04: Lothair submits

- **Fires:** autumn 834.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** general relief; Adalard's household congratulates itself on staying out of it.

### Script

> My lord, it's finished. After Chalon, Lothair turned west, but the emperor came against him with a great army, and they met on the Loire near Blois. Lothair didn't dare fight. He came before his father, bowed, and was sent back over the mountains to Italy, to stay there. His great men go with him, Count Matfrid among them. Count Adalard is all smiles now, and talks as if he'd been the emperor's man all along.

### Knows (can expand when asked)

- Lothair is confined to Italy; his supporters north of the Alps have lost their offices.
- The empress and young Charles are back at court.
- The great men who died fighting Lothair (Odo, William of Blois, Guy of Maine), and the dead of Chalon.

### Doesn't know

- That a fever will sweep through Lothair's followers in Italy and kill several of them, Matfrid and Wala among them (836).
- That the emperor will be formally re-crowned at Metz in February 835.

### Hooks and flags

- Players with `saved_gaucelm` or `saved_gerberga` receive messengers from Bernard's family; it is the start of a lasting alliance.
- Players with `chalon_834` = stayed\_home and settled refugees see the harvest of the new manses this autumn.
- **Links:** Arc 1, momentum 85.

## Event 835-01: The reckoning at Thionville and Metz

- **Fires:** March 835.
- **Channel and form:** Aldric for the politics; Ermenald adds the church side.
- **Source and slant:** official news from the assemblies; satisfaction among loyalists.

### Script

> (Aldric) My lord, the emperor has settled accounts. At Thionville in February, before forty-odd bishops, Archbishop Ebbo of Reims, the man who forced the emperor's penance at Soissons, had to stand up and admit the emperor never committed the crimes he was charged with. Then they deposed him. And at Metz, at the end of the month, the emperor was crowned again in the cathedral, before everyone.
>
> (Ermenald) And my lord, it touches us directly. Archbishop Agobard of Lyon, our own bishop's superior, has been deposed too, along with the bishops of Vienne and Narbonne, for siding with Lothair. Agobard has fled to Italy. I never thought to see the day.

### Knows

- Ebbo's public confession and deposition; the Metz re-crowning (28 February 835).
- Agobard of Lyon, Bernard of Vienne and Bartholomew of Narbonne are deposed; Lothair's churchmen are out.
- Lothair is sick in Italy; several of his great men are dying of fever there.

### Hooks

- A player who corresponded with Agobard (see the Church section of the arcs doc) is now tied to a disgraced man; Ermenald advises discretion.
- **Links:** Arc 1, Church section, momentum 85.

## Event 835-02: The assembly at Crémieu (second promotion window)

- **Fires:** start of summer 835. The emperor holds an assembly at Crémieu, near Lyon: close enough for Burgundian lords to attend.
- **Channel and form:** Aldric suggests attending; live scene at the assembly.
- **Source and slant:** the emperor's court.

### What happens

- The emperor rules on Bernard's claim to his old southern lands. Berengar of Toulouse, who held them, dies on the road to the assembly; Bernard is restored to Septimania and Barcelona and is given Toulouse. His family is back in power in the south, though never again in Autun.
- The emperor rewards and promotes men who served well.

### Promotion rule

| Condition | Result |
| --- | --- |
| Promoted in 834-02 | No second promotion here; the emperor's goodwill continues |
| Not promoted in 834-02, renown at or above the next rank's threshold | Promotion at Crémieu (for example, royal vassal or viscount), plus a charter for the villa if not already secured |
| `distrusted_834` (took the bribe or broke an oath) | Promotion possible, but the renown threshold is higher |
| Renown below threshold | Thanks and a small gift; no promotion |

This gives players who left the Field of Lies early, but earned renown elsewhere (Chalon, defending Fontenay, 832 service), a fair second chance.

### Hooks

- Players with `saved_gaucelm`, `saved_gerberga` or `oath_kept_lord` meet a restored and grateful Bernard here.
- **Links:** Arc 1, momentum 70.

## Event 837-01: The comet

- **Fires:** start of spring 837 (the comet is visible in March and April).
- **Channel and form:** Ermenald, at night, pointing at the sky; Aldric adds the court gossip the next day.
- **Source and slant:** what everyone can see, plus reports from court. Ermenald is frightened.

### Script

> (Ermenald) My lord, come and see. A great comet, crossing the sky night after night, brighter than any I have known. Signs like this come before the deaths of kings and the fall of kingdoms. We should pray.
>
> (Aldric, next day) They say the emperor himself was badly shaken. He asked his learned men what it meant, prayed through the night, gave alms and had masses said all over the empire.

### Knows

- It is the most spectacular comet in living memory. (Historically, Halley's Comet passed unusually close to Earth in 837.)
- The emperor's fear and his acts of penance.

### Hooks

- A player who explains the comet as a natural, returning body: Ermenald is unsettled (`chaplain_curious` or `chaplain_suspicious`, as in 829-01). A player who predicted it in advance gains large prestige, or suspicion of sorcery.
- A player who calmly organizes prayers and alms gains favor with the church.
- **Links:** Famines and sky section, momentum 100.

## Event 837-02: The count is ill

- **Fires:** start of summer 837. This is the player's warning; the death report (837-03) comes a season later, in autumn. Adalard lingers through the summer, better one week and worse the next, and dies before the season ends unless the player intervenes.
- **Channel and form:** Aldric, a brief spoken report.
- **Source and slant:** market talk in Autun and a servant from the count's household. The household itself is saying nothing: a sick count invites trouble.

### Script

> My lord, a word you may want to hear. Count Adalard has taken the flux. His people are keeping it quiet, but one of his grooms told our man at the market that he's been abed four days, passing blood, and that the physicians have bled him twice. These things can drag on for weeks. It's going around the town too; two of the canons have it. God keep him, my lord. A strong man can come through it. Or not.

### The window

The player has the summer season to act. The earlier in the season, the better the odds.

| Factor | Effect |
| --- | --- |
| Access | Adalard's own vassals are admitted. An `outlaw_832` player is turned away at the gate unless Ermenald gets him in through the bishop's household. |
| Treatment | Stop the bleeding; give boiled or clean water with salt and honey or sweetened wine to replace lost fluids; rest; keep the sickroom and his food clean. |
| Resistance | The household physician and the monks who tend him will object to a layman overruling them. Persuasion, renown, or Ermenald's backing helps. |
| Timing | Acting early in the season gives the best chance; by late summer he is too far gone for treatment to do much. |

- **Base chance:** momentum 40 (60% chance to save him), adjusted by timing and how much of the treatment the household allows.
- **Success:** `saved_adalard`. He lives, weakened, and retires (see 837-03).
- **Failure:** he dies anyway. If the player was at his bedside, a rumor may spread that the stranger poisoned him (`poison_rumor`); good standing with the household or the church squashes it.
- **No action:** he dies at the end of the summer; 837-03 fires normally in autumn.
- **Links:** momentum 40.

## Event 837-03: A new count at Autun

- **Fires:** autumn 837, a few weeks after the warning in 837-02.
- **Channel and form:** Aldric, spoken report.
- **Design note:** sources disagree on when Warin took Autun: some lists put it around 837, others in 844. Around 837 fits the game well, since Warin is the defender of Chalon and the player may already know him. Adalard dies of dysentery ("the flux") in late summer 837, one of the commonest killers of the age. A player with modern medical knowledge who reaches him in time (clean water, rehydration with salted and sweetened drinks, keeping him away from bleeding) might save him (momentum 40); if so, he survives but is left weak, unable to ride hard or lead the levy, so he gives up the county and retires to his family estates (and later, perhaps, a monastery). Either way, Autun is a royal office, not an inheritance: Adalard leaves no grown son, his neutrality in 834 earned his family no claim on the emperor, and the emperor gives the county to Warin. A saved Adalard becomes a grateful ally with family land and kin (\`saved\_adalard\`).

### Script

> My lord, Autun has a new master. The emperor has given the county to Count Warin, the same Warin who held Chalon against Lothair, and who already has Mâcon and Chalon. He'll be the greatest lord between the Loire and the Saône. You'll have heard Count Adalard took the flux at the end of the summer. He lingered most of the summer, they say, better one week and worse the next, until it took him at the end. God rest him. His people are packing. Everyone who stood with the emperor in the bad years will be remembered now, I think.

If `saved_adalard`, replace Aldric's line about the flux with:

> Count Adalard has given up the county. He lived, thanks to you, my lord, but he can barely sit a horse, and a count who can't ride to war or to court is no count at all. He's going home to his family's lands, and he asked me to tell you his door is always open to you. He has no son to follow him, so the emperor chose for himself.

### Knows

- Warin's record: defended Chalon in 834, surrendered to save his life, and returned to the emperor's side.
- Warin also holds Mâcon and Chalon; he is the region's great man.
- At an assembly at Aachen this year, the emperor gave young Charles a great stretch of land between Frisia and the Seine; Louis of Bavaria is angry about it.

### Hooks

- Players with `chalon_834` = defended or saved\_city, or `royal_vassal`, are known to Warin: a strong patron. Good timing for a viscount appointment under him.
- Players who stayed home in 834 start fresh with Warin.
- **Links:** Arc 1 and Arc 2, momentum 60.

## Event 838-01: Charles comes of age

- **Fires:** start of winter 838–839, reporting the September assembly at Quierzy.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** Warin's household (or Adalard's, if he still holds Autun). Approving of young Charles.

### Script

> My lord, at Quierzy the emperor girded young Charles with a sword. He's fifteen, a man now, and the emperor gave him Maine and the lands between the Seine and the Loire. Louis of Bavaria, meanwhile, has been stripped of everything but Bavaria for complaining too loudly. He won't take that quietly. And there's talk about Lord Bernard too: men from his southern counties came to Quierzy with ten complaints against him. He's never short of enemies, that one.

### Knows

- Charles's coming of age and new lands; Louis the German's losses and anger.
- Complaints against Bernard from the Goths of his southern counties.

### Doesn't know

- Louis the German's revolt, which breaks out within months.

### Hooks

- Players attached to Charles's circle (through Judith, Warin or 834 rewards) see their patron rising.
- **Links:** Arc 1, momentum 80.

## Event 838-02: King Pippin is dead

- **Fires:** start of spring 839, reporting Pippin's death on 13 December 838.
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** travelers from Aquitaine and Warin's household.
- **Design note:** under the 817 succession plan, Pippin's kingdom of Aquitaine included the counties of Autun, Avallon and Nevers. Pippin is the player's own king (see Chain of rank), which gives his death and the fight over his kingdom a local edge.

### Script

> My lord, our King Pippin is dead, at Poitiers, before Christmas. The emperor has already declared that Aquitaine, and our county with it, goes to young Charles. But the Aquitanian lords don't want a boy from the north; they've proclaimed Pippin's own son, another Pippin, as their king. So there'll be war in Aquitaine again, and the emperor isn't young anymore.

### Knows

- Pippin's death; the emperor's grant of Aquitaine to Charles; the Aquitanians backing Pippin II.
- Louis the German is in revolt in the east.

### Doesn't know

- The emperor's campaigns of 839–840, his death in 840, or the war between the brothers that follows.

### Hooks

- Possible summons to the emperor's Aquitaine campaign in 839 (another service and renown opportunity).
- Players who backed Pippin in 832 (`rebel_832`) are approached by Pippin II's supporters.
- **Links:** Arc 1 and Arc 5, momentum 80.

## Event 839-01: The last division

- **Fires:** start of summer 839, reporting the assembly at Worms (30 May).
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** Warin's household. Approving.

### Script

> My lord, the emperor has made peace with Lothair at last, and divided everything between him and young Charles. Lothair gets the east, Charles the west, and Charles's share runs from the Breton march all the way to Provence, Lyon and Geneva. So our county is Charles's, in the end. Louis of Bavaria is left with Bavaria and nothing else, and he's furious. And in Aquitaine, the Gascons have risen for young Pippin, our late king's son, and pushed all the way up to the Loire.

### Knows

- The Worms division; Autun falls in Charles's share.
- Louis the German's anger; Pippin II's supporters advancing to the Loire.

### Hooks

- Leads to the summons in 839-02.
- **Links:** Arc 1, momentum 80.

## Event 839-02: The Aquitaine campaign

- **Fires:** start of autumn 839. The emperor marches into Aquitaine with young Charles to put down Pippin II.
- **Channel and form:** a summons from Warin (or directly from the emperor for royal vassals); live scene on campaign.
- **Source and slant:** official.

### Branches

| Path | What happens | Renown | Flags |
| --- | --- | --- | --- |
| Emperor's or Charles's man (`royal_vassal`, `stood_to_the_end`, Warin's man) | Serve in the campaign; the emperor holds an assembly where Aquitanian lords swear to Charles; sieges of castles held by Pippin II's men. | Small to moderate | `served_839`; Charles notices loyal men |
| Pippin's man (`pippin_833`) | Pippin II's people ask his father's old followers to stand with the son. Choose: answer Warin's summons and serve Charles (a clean break), or slip away to Pippin II (a rebel again). | Small for serving; none for joining Pippin II until the 840s | `chose_charles_839` or `pippin2_839` |
| Stay-at-home player | Ordinary service under Warin, or pay to avoid it (`count_opinion -1`). | Small | — |

- **Design note:** the sieges are invented at the level of detail; the campaign, the oaths to Charles and Pippin II's resistance are historical.
- **Links:** Arc 1 and Arc 5, momentum 70.

## Event 840-01: The sun goes dark

- **Fires:** start of spring 840 is the prediction window (Ermenald mentions the coming Rogation processions). The eclipse itself (5 May, during the Litanies) is narrated at the start of summer 840, with Ermenald's reaction.
- **Channel and form:** live moment, then Ermenald.
- **Source and slant:** everyone sees it. Ermenald is terrified.

### Script

> (Ermenald, after) My lord, the sun was taken from the sky at midday and the stars came out. In the middle of the Litanies, with the whole parish walking behind the cross. I have never been so afraid. God is showing us something, and I fear it is the death of someone great.

### Hooks

- A player who predicted the exact day gains enormous prestige, or suspicion of sorcery (`predicted_eclipse`). Check whether Autun was inside the band of totality on an eclipse map; if not, it is a deep partial eclipse, still frightening. See "Exploiting the event" below.
- The emperor, already ill, takes it as an omen; within weeks he is dead (840-02).
- **Links:** Sky section, momentum 100.

### Exploiting the event

A player who knows the date in advance will try to use it. The outcome depends on how the prediction is framed. The same framings apply to Halley's Comet in 837 (837-01).

| Framing | What the player says | Church reaction | Result |
| --- | --- | --- | --- |
| Prophecy | "I foresaw it" | Most dangerous. Councils condemned soothsayers and weather-magicians; in 847 a synod at Mainz had a woman named Thiota publicly flogged for prophesying the end of the world. Expect an investigation. | Renown gain, with a high risk of `church_suspicion` |
| Private revelation | "God showed it to me in prayer" | Risky. The church distrusted unauthorized visions, but it is harder to condemn outright; some see a holy man, others a fraud. | Mixed: renown plus `holy_reputation` or `church_suspicion` |
| Learning | "I calculated it from the order God set in the heavens" | Safest. Carolingian scholars studied the heavens through the computus (Bede's tradition), and Louis kept a learned adviser his biographer calls "the Astronomer." Framed this way, it looks like rare learning, not magic. | Small renown, `learned_reputation`, possible interest from court scholars and an invitation to court |
| The quiet play | Warn the bishop or Ermenald privately beforehand | The church leads calm prayers and alms when the sky goes dark; the bishop gets the credit. | Small renown, `bishop_trust +2`, `chaplain_trust +1`: the best long-term move |

Major renown stays tied to battle. Sky events give small renown plus favor (or suspicion) with the church and court.

## Event 840-02: The emperor is dead

- **Fires:** start of autumn 840, reporting his death on 20 June; delivered just before Lothair's envoy (840-03).
- **Channel and form:** Aldric, then Ermenald at a memorial Mass.
- **Source and slant:** official news through Warin; real grief, and real fear.

### Script

> (Aldric) My lord, the emperor is dead. He went east in the spring to drive Louis of Bavaria back, and did it, but he was already sick, worn out from fasting all Lent, and the darkening of the sun shook him badly. He died on an island in the Rhine near Ingelheim, on the twentieth of June, with bishops around him. Before he died he sent his crown and sword to Lothair, on condition that he protect the empress and young Charles and keep to the division made at Worms. Whether Lothair keeps that promise... well. Every lord in the empire will be asked to swear to someone before long, my lord. We had best decide to whom.

### Knows

- The illness, the campaign against Louis the German, the place and date of death.
- The crown and sword sent to Lothair, with conditions.
- The Worms division of 839 and Charles's claim to the west.

### Doesn't know

- That Lothair will ignore the division and claim the whole empire.
- The war between the brothers and Fontenoy (841).

### Hooks

- Opens Arc 2 (War of the Brothers): envoys arrive demanding oaths. Players who never sided with Lothair are courted by Charles; Lothair's envoys are received with suspicion (see the Lothair rule in the path review).
- **Links:** Arc 1 and keystone K2, momentum 95.

## Path review, 825–840

Six main paths run through the first crisis. Most end 840 in a clear position; four gaps need entries.

### Where each path stands in 840

| Path | Key flags | Status in 840 | Open questions |
| --- | --- | --- | --- |
| Emperor's loyalist | `stood_to_the_end`, `royal_vassal`, `loyalist_830` | Strongest. Rewarded in 834–835, known to Warin and Charles; likely royal vassal or viscount. Natural member of Charles's party in 840. | Royal vassals owe service most years; only 832, 834 and 839 have summons written. |
| Pippin's man | `pippin_833`, `pippin_restoration` | Modest gains. In 839 chose Charles (clean break) or Pippin II (rebel again). | Covered by 839-02. |
| Bernard's man | `side_830` = bernard, then `hedge_832`, `oath_kept_emperor`, `informer_832` or `rebel_832` | Varies. Kept faith: valued by Bernard after his 835 return. Informer: Bernard's enemy, the emperor's friend. | **Gap:** the outlaw branch (`outlaw_832`) has no way back. |
| Adalard's man (rebel path of 830) | `side_830` = rebel, `followed_count_833` | Safe through 834, then loses his patron when Adalard dies in 837. | **Gap:** no scene where the player re-commends himself to Warin. |
| Bribe-taker | `bribed_833`, `distrusted_834` | Has silver, lower renown, distrust. Can redeem himself through Chalon (834) or service in 839. | Covered. |
| Stay-at-home builder | `chalon_834` = stayed\_home | Richer villa (refugees, resettled manses), little renown. | Covered. |

### Gaps to fill

1. **Outlaw recovery (834).** The outlaw flag in 832-03 comes from ignoring the count's summons in the emperor's name while away fighting for Bernard's cause, not from following Pippin as such. (A softer alternative label: "in disgrace, lands under threat.") A player who angers Adalard by refusing his summons must secure the villa independently of him through the three land outs in 830-02 (the Church, marriage, or buying the land). The issue ends when Warin takes Autun in 837.
2. **Re-swearing to Warin (837).** A peaceful handover: Adalard's men, and anyone else holding a benefice in the county, swear to Warin and he confirms their benefices. A short scene, not a crisis. Renown and the 834 record set how warmly he receives them.
3. **The emperor's penance (833):** written, see 833-02.
4. **Viking news:** deferred to Arc 3, which will be handled as its own pass.

### The Lothair rule

Lothair is not a supported path. His supporters were mostly his own men from Italy, Lotharingia and Neustria, and a vassal from Autun, tied to Bernard, Pippin or Warin, would never be trusted among them.

- Any acceptance of Lothair's offers (the 833 bribe, an approach during his 834 war, his envoys in 840) gives a short-term gain and sets `lothair_tainted`.
- `lothair_tainted` blocks promotion through Lothair, raises renown thresholds with the emperor and Charles, and makes Lothair's own officers treat the player as a man to use and discard.
- NPCs respond to the player's Lothair offers with suspicion, from both sides.

# Arc 2: War of the Brothers (840–844)

## Arc 2 allegiance rules

After June 840 there are two overlapping fights: Charles against Lothair for the empire, and Charles against Pippin II for Aquitaine. In 841 Pippin II joins Lothair, and the two fights merge at Fontenoy. What the player is expected to do depends on who promoted him.

| Player's standing | Expected to follow | Options |
| --- | --- | --- |
| Not promoted (villa lord under Warin) | Warin, and through him Charles | Fight for Charles, or sit it out by paying the army fine |
| Promoted by the emperor (`royal_vassal`, emperor's viscount) | Charles, the emperor's chosen heir in the west, through Warin | Fight for Charles. Sitting out is very costly: a royal vassal who hangs back is marked as a hedger, like Bernard. |
| Promoted by Pippin I (`pippin_833` with a Pippin reward, or `pippin2_839`) | Pippin II's people expect his father's men to follow the son | With both Pippin I and the emperor dead, the player's personal bonds have lapsed. He can make peace with Warin and Charles without perjury (a clean switch), or follow Pippin II, which puts him on Lothair's side of the field at Fontenoy and in open rebellion against Warin. |
| Count elsewhere (higher ranks) | The king directly | Must choose Charles or stand with someone else openly; sitting out is not credible at this rank |

Lothair is never a supported path (see the Lothair rule). Pippin II's men at Fontenoy fight alongside Lothair, but as Pippin II's men, not Lothair's.

### Sitting it out

- **The army fine:** Carolingian law fined a free man who ignored the call-up 60 solidi (the *heribannum*): 720 denarii, about 1.4 years of the villa's unimproved income. A villa lord can pay it and stay home. Warin is mildly annoyed; no renown.
- **At higher ranks** the fine is not a real way out: viscounts lose Warin's trust, and royal vassals or counts are remembered by Charles as fence-sitters.
- **Staying home is not staying safe:** both armies cross the region in 841, and Fontenoy is only about 120 km away. The stay-home player faces foragers before the battle and deserters and looters after it.

### The two culminations

- **Fontenoy (25 June 841):** the decade's great battle, for players who fight (to be written as 841 entries).
- **Home defense (summer 841):** for players who sit it out, fending off deserters and looters on their own lands after the battle.

## Event 840-03: Lothair demands oaths

- **Fires:** start of autumn 840
- **Channel and form:** Aldric's report, then a visit from one of Lothair's envoys, then a messenger from Warin.
- **Source and slant:** three voices. Lothair's envoy is smooth and menacing; Warin's messenger is firm; Aldric is worried.

### What happened

Lothair lingered in Italy after his father's death, by one account to see which way things would go before crossing the Alps. Then he came north claiming the whole empire, ignoring the Worms division. His messengers promised that those who swore to him would keep their lands and offices, and threatened death to those who resisted. In August he pushed Louis the German back from the Rhine; in October he crossed the Seine into Neustria; in November he met Charles near Orléans. They agreed a truce: Charles would hold Aquitaine, Septimania, Provence and ten counties between the Loire and the Seine until they met again at Attigny on 8 May 841.

### Script

> (Aldric) My lord, Lothair has come over the Alps and claims everything, the whole empire, as if his father's division at Worms had never been made. His men are riding from county to county demanding oaths. And there's one waiting in the hall now, asking for you.
>
> (Lothair's envoy) The emperor Lothair greets the lord of Fontenay. He is the eldest son and the anointed emperor, and he asks only what is his due: your oath. Swear, and you keep your villa and everything you hold, confirmed by his hand. Refuse, and you will have chosen to stand against your emperor. He will remember that when the boy Charles has gone back to his mother.
>
> (Warin's messenger, arriving the same week) Count Warin stands with King Charles, as the late emperor commanded. He asks his men to swear nothing to Lothair's envoys, and to be ready to ride in the spring.
>
> (Aldric, after they've gone) Lothair's armies are moving west toward Charles, my lord. Whatever happens between them, we'll hear of it by winter.

### Knows (can expand when asked)

- Lothair holds the crown and sword their father sent him; he claims that makes him emperor over all.
- Charles holds the west under the Worms division of 839; Warin and Judith support him.
- Louis the German has been pushed back to Bavaria by Lothair.
- The truce terms and the May meeting at Attigny.
- Pippin II is still fighting Charles in Aquitaine, and Lothair has asked Charles to go easy on him: a sign they are drawing together.

### Doesn't know

- That the truce will collapse, and that the brothers' armies will meet at Fontenoy in June.

### The choice

| Response | Result | Flags |
| --- | --- | --- |
| Refuse the envoy; stand with Warin and Charles | Expected of Warin's men and royal vassals. Lothair's men note the name. | `oath_charles_840` |
| Answer vaguely and send him away | A hedge. Warin hears about it. | `hedge_840` |
| Swear to Lothair | Short-term safety; sets `lothair_tainted` (see the Lothair rule). Warin treats it as betrayal. | `lothair_tainted`, `enemy_warin` |
| Pippin I's former men: approached by Pippin II's people instead | Choose Pippin II (rebel against Warin) or make peace with Warin (clean switch) | `pippin2_840` or `oath_charles_840` |

- **Links:** Arc 2, keystone K2, momentum 80.

## Event 840-04: The truce of Orléans

- **Fires:** start of winter 840–841 (reports the November truce).
- **Channel and form:** Aldric, spoken report.
- **Source and slant:** Warin's household. Wary.

### Script

> My lord, Lothair and King Charles met near Orléans in November, with their armies close enough to see each other's fires. They didn't fight. They made a truce instead: Charles keeps Aquitaine, Septimania, Provence and ten counties between the Loire and the Seine, and they're to meet again at Attigny on the eighth of May to settle the rest. The truce says nothing plain about Burgundy, mind you, and that's the kind of thing men go to war over. Count Warin says to keep our horses fed through the winter.

### Knows

- The truce terms and the May meeting at Attigny.
- Lothair is courting Pippin II; Louis the German is gathering strength in the east.

### Doesn't know

- That the truce will break down and the meeting at Attigny will not settle anything.

### Hooks

- A good season to prepare: train men, stock supplies, or set aside the army fine if planning to sit out.
- **Links:** Arc 2, momentum 80.

## Event 841-01: Warin's summons

- **Fires:** start of spring 841.
- **Channel and form:** a messenger from Warin, with Aldric present.
- **Source and slant:** official. Warin needs every man.

### Script

> (Messenger) Count Warin to his men, greeting. The truce with Lothair is a dead letter; he has sent his men into King Charles's lands and courts the king's enemies in Aquitaine. King Charles calls his faithful men to him, and so do I. Muster at Autun before the end of April, armed and provisioned for three months, to march with the count.
>
> (Aldric, after) This is the one, my lord. Lothair, Charles, and Louis of Bavaria too, they say, all moving at once. If it comes to a battle, it'll be the biggest any of us has seen.

### The choice

| Response | Requires | Result | Flags |
| --- | --- | --- | --- |
| Answer the summons | — | March with Warin; leads to the Fontenoy live scene (start of summer 841) | `fontenoy_charles` |
| Pay the army fine and stay home | Villa lord (at higher ranks, see the allegiance rules) | 720 denarii; Warin is annoyed; no renown; leads to the home-defense scene (start of summer 841) | `sat_out_841` |
| Join Pippin II | `pippin2_840` or `pippin2_839` | March with Pippin II's men to join Lothair's side; open rebellion against Warin | `fontenoy_pippin2` |

### Next

- **Start of summer 841:** \[Supply check\] Fontenoy live scene (fighters) or the home-defense scene: foragers before the battle, deserters and looters after it (stay-at-home players).
- **Start of autumn 841:** Aldric's report on Fontenoy and its aftermath, for everyone.
- **Links:** Arc 2, keystone K3, momentum 70.

## Event 841-02: The battle of Fontenoy (live scene)

- **Fires:** start of summer 841; the battle is on 25 June.
- **Channel and form:** live battle scene, or the home-defense scene for players who sat out.
- **Source and slant:** the player's own eyes.

### What happened

The armies met near Fontenoy-en-Puisaye, south of Auxerre: Lothair and Pippin II against Charles and Louis the German. After a last offer of peace was refused, the fighting began in the morning in three separate parts of the field. Lothair's side had the upper hand until Warin arrived with his army from the south and turned the battle. Lothair's men broke and fled; Lothair retreated toward Aachen. Bernard waited with his own troops a few miles away and never joined either side. The losses were remembered as appalling: the victors stayed on the field, buried the dead of both sides, and the bishops ordered a three-day fast. A poet who fought for Lothair later wrote a lament for the slaughter.

### Where the player stands

| Player's path | Position | Notes |
| --- | --- | --- |
| Warin's man (`fontenoy_charles`) | In Warin's relief army, arriving late | The player's column is the force that turns the battle: the biggest renown moment available. |
| Royal vassal or count (`fontenoy_charles`) | With Charles's main army | Holds a part of the line while Lothair presses hard. |
| Pippin II's man (`fontenoy_pippin2`) | With Pippin II's contingent beside Lothair | On the losing side; the escape matters as much as the fight. |
| Still Bernard's man | In Bernard's camp a few miles off, watching | No battle. The player can urge Bernard to commit (to Charles) or stay out. If the player persuades him, `bernard_fontenoy` and Charles's gratitude to both. |
| Sat out (`sat_out_841`) | At home | See "Home defense" below. |

### Battle participation

- **Rank and file:** always open.
- **Subcommand:** open to players who bring full units.
- **Full command:** command of the entire battle. The player has proven himself so formidable in battle and so able a leader of troops that the kings would be committing folly not to let him lead the field. Incredibly difficult and unlikely to earn by 841.
- **Situation card themes:** the dawn ultimatum; crossing the stream under arrows; men on both sides in the same dress, speaking the same language (whose men are those?); a brother or neighbor in the enemy ranks; the late arrival of Warin's column; holding a broken line; routing enemies to pursue or spare; plundering Lothair's camp; the wounded after the battle; burying the dead on Sunday.

### Home defense (players who sat out) \[Supply check\]

- **Before the battle:** foraging parties ranging out from the armies near Auxerre.
- **After the battle:** deserters and broken men scattering south and east; at least one band tests Fontenay.
- A trained militia turns both into fights; renown is small but real. Refugees may arrive.

### Fixed point in time

Fontenoy is a fixed point: Charles and Louis win, Lothair flees, and nothing the player does changes that, whatever his rank, side or command. The player's performance decides only his own fate: renown, his own units' losses, whether he survives, and (on the losing side) how well he gets his men away. A player in full command of Lothair's or Pippin II's side still loses the field, though a strong damage ratio still earns renown.

## Event 841-03: After Fontenoy

- **Fires:** start of autumn 841.
- **Channel and form:** Aldric's report for everyone; Ermenald adds the bishops' fast.
- **Source and slant:** Warin's men coming home. Victory, and grief.

### Script

> (Aldric) My lord, it's done, and God help us, what a day it was. King Charles and King Louis beat Lothair near Fontenoy, south of Auxerre. Lothair had them hard pressed until Count Warin came up with the southern army and broke his line. Lothair has fled north. But the dead, my lord. They say no one living has seen so many killed in one day, Franks killing Franks. Duke Bernard sat it out a few miles off, waiting to see who'd win, and he's sent his son William to King Charles to make his peace.
>
> (Ermenald) The bishops have ordered three days of fasting, for the dead of both sides. Brother against brother, my lord. I pray we never see the like again.

### Knows

- The victory, Warin's decisive arrival, Lothair's flight.
- The scale of the losses; the bishops' fast.
- Bernard's absence from the battle, and his son William sent to Charles's court as a pledge.

### Doesn't know

- That Charles and Louis will swear a formal alliance at Strasbourg in February.

### Hooks

- If the player fought: renown is awarded; Warin's men who arrived with the relief army are spoken of with pride.
- Neighbors who did not come home: widows, orphaned heirs, empty manses. Openings for marriage, land and patronage.
- **Links:** Arc 2, keystone K3, momentum 55.

## Event 842-01: The comet and the oaths of Strasbourg

- **Fires:** start of spring 842.
- **Channel and form:** Ermenald on the comet seen over the winter; Aldric on Strasbourg.

> (Ermenald) My lord, you'll have seen the comet this winter, night after night. The king's own men watched it closely, they say. After Fontenoy, I don't know whether to read it as a warning or a judgment.
>
> (Aldric) King Charles and King Louis met at Strasbourg in February and swore an alliance before both their armies: each king in the other's tongue, so every man could understand, and then the soldiers swore too. They mean to finish Lothair together.

- **Hooks:** the sky-event framings (see 840-01) apply to the comet. A learned player may recognize the oath text as one of the oldest written examples of a French-like language.
- **Links:** Arc 2, momentum 90.

## Event 842-02: Lothair abandons Aachen; peace talks near Mâcon

- **Fires:** start of summer 842.
- **Channel and form:** Aldric.

> My lord, Lothair is finished in the north. Charles and Louis marched on Aachen in March; Lothair's men were meant to hold the Moselle crossings, and they scattered when the armies came up. He's fled south toward the Rhône without a fight, and the bishops at Aachen have declared him unfit to rule. Now he's asking for peace, and here's the strange part: the three brothers are to meet this very season on an island in the Saône, near Mâcon. Barely a day's ride from here.

- **Hooks:** the talks are a local opportunity: sell grain and horses to the camps, offer hospitality to envoys, or simply be seen by great men. In a famine year, supplying the camps is very profitable, and very visible. Charles also takes Toulouse from Bernard this year (leads to 843-01).
- **Links:** Arc 2, momentum 80.

## Event 842-03: A truce, a poor harvest, and a royal wedding

- **Fires:** start of winter 842–843.
- **Channel and form:** Aldric.

> My lord, the kings' men have been meeting all autumn to divide the empire, and they still can't agree, so the truce is extended. Truth is, nobody can afford a war this year: the harvest has been poor everywhere, and all three kings know it. And King Charles is to be married this month, to the lady Ermentrude, a niece of Count Adalard the seneschal. Not our late count, my lord, a different Adalard.

- **Hooks:** ties to the famine (N-841): the kings keep the peace partly because of hunger.
- **Links:** Arc 2, momentum 80.

## Event 843-01: The war for Toulouse

- **Fires:** in three stages. Start of spring 843: the call south (Warin's messenger, or Bernard's rider). Start of spring 844: the siege of Toulouse. Start of summer 844: Bernard's fate and Aldric's report.
- **Channel and form:** summons and messengers, then live battle scenes.
- **Source and slant:** Warin's household calls Bernard a traitor; Bernard's people call Charles ungrateful.

### What happened

In 842 Charles took Toulouse from Bernard and gave it to another count. Bernard refused to accept it, allied himself with Pippin II, and drove the new count out of Toulouse in 843. Charles sent Warin south against him in 842–843, and in spring 844 came himself to besiege Toulouse. Bernard ended up in Charles's hands (one account says Warin captured him at Uzès in 843; others that he was brought before Charles in 844) and was executed in May 844. The siege itself failed: Pippin II's garrison held Toulouse, and on 14 June 844 Pippin II destroyed Charles's relief army in the Angoumois.

### Branches

| Path | Spring 843 | Spring 844 | Flags |
| --- | --- | --- | --- |
| Warin's man | Summoned south to campaign against Bernard in Gothia: castle sieges and skirmishes | Summoned to Charles's siege of Toulouse, which fails | `toulouse_warin` |
| Bernard's man (`oath_kept_lord`, or high `favor_septimania`) | Bernard's rider asks the player to join him; fight Warin's forces in Gothia | Help hold Toulouse with Pippin II's garrison (historically, the defenders win) | `toulouse_bernard`; `enemy_warin` |
| Sit out (villa lord only) | Pay the army fine (Warin's man) or decline politely (Bernard's man) | — | `sat_out_843` |

### Battle participation

- **Rank and file:** always open.
- **Subcommand:** open to players who bring full units.
- **Full command:** on Warin's side, only for count-rank players with high renown (Warin and Charles command). On Bernard's side, more available: Bernard is short of reliable captains.
- **Situation card themes:** scaling ladders and sorties at Toulouse; crossing the Garonne under fire; ambushes in the hills of Gothia; Gascon skirmishers; sickness in the siege camp; summer heat and thirst; burning siege engines; parleys under truce.

### Bernard's fate (momentum 60)

Bernard is not a keystone, so the player can save him. Ways in:

| Path | How | Risk |
| --- | --- | --- |
| Bernard's man | Warn him not to trust a safe-conduct and not to put himself in Charles's hands; escort him to safety in Septimania; defeat the force sent to seize him | High |
| Warin's man, present at his capture | Let him slip away (`enemy_warin` if discovered) | High |
| Warin's man or royal vassal, with high renown | Intercede with Charles for mercy | Moderate; costs royal favor |

- **If saved (`bernard_saved`):** Bernard loses Toulouse and lives on, sidelined, in Septimania under Pippin II (who is recognized as king of most of Aquitaine in 845). He is about 49; he dies by around 850. His sons' stories run as before: his son Bernard ("Plantapilosa") still becomes count of Autun in 864. The player is marked as Bernard's and Pippin II's partisan in Charles's eyes (`charles_enemy` on Bernard's path, `charles_disfavor` if he interceded).
- **If not saved:** Bernard is executed in May 844.

## Event 844-01: Bernard is dead

- **Fires:** start of summer 844 (reports the May execution). Skipped if `bernard_saved`.
- **Channel and form:** Aldric, spoken report. For players close to Bernard, followed by a short cutscene.
- **Source and slant:** Warin's household is satisfied; Bernard's old followers are grieving and afraid.

### Script

> My lord, Bernard is dead. Duke Bernard, who gave you Fontenay. He was brought before King Charles in the spring, and the king had him put to death as a traitor. Whatever you think of him, my lord, and he was never short of enemies, he was the man who took a chance on you. His sons are alive: the elder, William, is at the king's court, and the little one is still with his mother. They say the king means to keep Toulouse out of that family for good.

### Cutscene trigger

Play the short cutscene if any of these are set: `oath_kept_lord`, `favor_septimania` 2 or higher, `saved_gaucelm`, `saved_gerberga`, `toulouse_bernard`.

### Hooks

- Bernard's widow Dhuoda and his young sons may need protection or a friend; a long-term tie to the family that returns to rule Autun in 864.
- **Links:** Arc 2, Arc 5, momentum 60.

## Event 843-02: The Treaty of Verdun

- **Fires:** start of autumn 843 (reports the August treaty).
- **Channel and form:** Aldric.

> My lord, it's settled, at Verdun. The empire is cut in three. Louis takes the east, Charles the west, and Lothair keeps the title of emperor and a long middle kingdom from Frisia down through Lyon and Provence to Italy. We're King Charles's, for good. But mark this: the far bank of the Saône, and Lyon with it, belongs to Lothair now. We live on a border, my lord.

- **Hooks:** Fontenay is now border country. Trade across the Saône becomes trade with another kingdom; Lothair's men are a river away. Good grounds for building defenses and for border diplomacy.
- **Links:** Arc 2, keystone K4, momentum 85.

## Event 843-03: The pact of Coulaines

- **Fires:** start of winter 843–844 (reports the November assembly).
- **Channel and form:** Aldric, with some satisfaction.

> My lord, King Charles held an assembly at Coulaines, near Le Mans, and made a pact with his bishops and great men. He promised to rule with their counsel, and not to take a man's lands or offices from him without just cause and a fair judgment. That's worth more to us than you might think, my lord: a benefice is safer under a king who has sworn that.

- **Hooks:** a formal guarantee for the player's benefice. Strengthens any land claim and makes arbitrary seizure harder.
- **Links:** Arc 2, momentum 80.

## Event 844-02: Ambush in the Angoumois

- **Fires:** start of autumn 844 (reports the battle of 14 June).
- **Channel and form:** Aldric.

> My lord, terrible news from Aquitaine. While King Charles sat before Toulouse, he sent for reinforcements from the north. Pippin's men caught them on the march in the Angoumois and cut them to pieces. Abbot Hugh, the king's own uncle, is dead, and others with him; great lords taken for ransom. The king has given up the siege. Pippin is stronger than ever.

- **Hooks:** players with Pippin II (`fontenoy_pippin2`, `toulouse_bernard`) see their side winning: Pippin II will be recognized as king of most of Aquitaine in 845 (Arc 5). Players on Charles's side may have neighbors among the dead or ransomed.
- **Links:** Arc 2 and Arc 5, momentum 55.

# Arc 3: Vikings on the rivers (841–911)

For most of this arc the Vikings are distant news: Rouen is about 370 km away, Nantes about 470, Paris about 270. They come to Burgundy only from 886. Early entries are short notes bundled into seasons that already carry other news.

## Event 841-V1: Rouen burned

- **Fires:** start of summer 841 (reports the May raid), in the same delivery as the Fontenoy news.
- **Channel and form:** Aldric, one short note among the war news.

> And one more thing, my lord, though it's far from here: Northmen came up the Seine in their ships in May and burned Rouen, and the monasteries along the river. With every lord in the kingdom marching to fight his brothers, there was no one to stop them.

- **Hooks:** a player who points out that the civil war leaves the rivers undefended earns a nod from Aldric; sets `viking_aware`.
- **Links:** Arc 3, momentum 85.

## Event 843-V1: Bishop Gunhard killed at Nantes

- **Fires:** start of autumn 843 (reports the raid of 24 June), in the same delivery as the Treaty of Verdun.
- **Channel and form:** Ermenald raises it himself, shaken.

> My lord, the clergy are speaking of nothing else. On the feast of Saint John, Northmen sailed up the Loire to Nantes. The town was full of people for the feast; they broke into the cathedral while the bishop was saying Mass, and killed him at the altar, with the clergy and the people who had taken refuge there. Then they carried off the rest as captives. At the altar, my lord. Is nowhere holy to these men?

- **Hooks:** churches and monasteries begin to think about where to send their relics and treasures for safety; a learned or devout player can offer Fontenay's help (`relic_refuge_offer`), which pays off when the monks of the Loire and the west come inland in later years.
- **Links:** Arc 3, momentum 85.

## Event 845-V1: Paris taken

- **Fires:** start of summer 845 (reports the Easter raid).
- **Channel and form:** Aldric, seasonal news. No muster.
- **Design note:** several contemporary sources suggest the 7,000 pounds was raised from the king and the people of the land through some kind of tax, but nothing is known about its form or who paid. A bishop's angry protest hints that the church paid a large share, and part of the sum was paid in gold. For the game, a small one-off levy is defensible: suggest about 6 denarii per manse (about 60 for Fontenay), modeled on the better-recorded 866 tax. Leaving it out is also defensible.

> My lord, the Northmen have taken Paris. A fleet came up the Seine in March, beat the men the king sent against them, and hanged their prisoners where the king's army could see. They were in the city at Easter. King Charles paid them seven thousand pounds of silver to go away, and they went, laden. Seven thousand pounds, my lord. That's a lesson the Northmen won't forget: Frankish kings pay.

- **Hooks:** churches and abbeys near Paris give up treasure toward the payment; Ermenald may mention it. A player who argues that paying invites more raids sets `viking_aware`.
- **Note for NPCs:** contemporaries call him "King Charles"; "the Bald" is a later nickname.
- **Links:** Arc 3, momentum 80.

## Note for later: the Viking tribute taxes

Charles levied direct taxes per manse to pay off Viking armies in 866 and 877, and possibly 860. The 866 levy is well recorded and covered Burgundy: 6 denarii per free manse and 3 per servile manse, then 1 more denarius from every manse; a tenth of the value of traders' goods; priests according to their means; each great lord collecting from his own lands. For Fontenay's 10 manses this comes to roughly 70 denarii. Because it is assessed per recorded manse, an improved villa pays no more.

The 877 levy (raised in Francia and Burgundy only) shifted more of the burden onto lords: 1 solidus from each demesne farm; 8 denarii from each free manse (4 from the tenant, 4 out of the lord's rent); 4 denarii from each servile manse (shared the same way); priests from 4 denarii to 5 solidi according to means; church treasuries also tapped. Both levies to be written as their own entries in sequence.

The 860–861 payment (3,000 pounds, rising to 5,000 when the Vikings returned with a larger fleet) was raised from church treasuries, every manse, and all merchants, down to the poorest, with their goods and even their homes valued for tax. Contemporary churchmen resented these levies and blamed lay lords for failing to defend the kingdom by arms: good material for Ermenald.

## Viking forces and winter attacks

### Rough sizes

| Force | Ships | Men (modern estimates) |
| --- | --- | --- |
| Raiding band | 5–20 | 100–600 |
| Large fleet (Paris 845: about 120 ships) | 50–120 | about 1,000–3,000 |
| Combined great army (Paris 885–886) | a few hundred | several thousand (the chronicler's 30,000–40,000 is wildly inflated) |

A ship carried roughly 30–60 men. A count of Autun might field a few hundred mounted men with their followers, so a mid-sized fleet outmatches any single count.

### Winter camps

From the 840s Viking armies stopped sailing home for the winter and camped on river islands inside the kingdom (Noirmoutier from 843, Jeufosse 852–853, Oissel 856–858), raiding year-round while Frankish levies were at home.

### Attacking a winter camp

| Factor | Effect |
| --- | --- |
| Ships beached | The Vikings lose their mobility; surprise is possible |
| Winter supply | Keeping men in the field costs about double the usual supplies |
| Cold and sickness | Morale penalty for the attacker |
| Island camps | A frontal assault is very hard without boats, a blockade or bridges |
| Blockade | Historically the best tool: in 862 Charles trapped a Viking army on the Marne with bridges and forced terms |

Historical results: sieges of island camps mostly failed (Jeufosse 852–853 ended in a payment; Oissel 858 was abandoned when Louis the German invaded). Surprise attacks on camps on land could work: Richard of Autun's victory at Argenteuil-sur-Armançon in December 898 was exactly that.

### Who can attack

| Rank | Can attack a Viking camp? |
| --- | --- |
| Below count | Only as part of someone else's force |
| Count | By joining a royal campaign (Jeufosse 852–853, Oissel 858), or on his own initiative in a year with no royal summons; if the king calls while he is away, his standing suffers |
| Duke | Can hold a standing command against the Vikings, as Robert the Strong did in the west |
| Any rank, from 886 | Local defense is always allowed once Vikings winter in Burgundy |

Before 886 the camps are 300–400 km away on the Seine and Loire, and a Burgundian count's men are in demand for Aquitaine (Pippin II), Brittany and, in 858, the defense against Louis the German.

## Event 853-V1: Tours sacked; the relics of Saint Martin

- **Fires:** start of winter 853–854 (reports the November raid).
- **Channel and form:** Aldric on the raid; Ermenald with a request.

> (Aldric) My lord, the Northmen from the Loire have burned Tours, and the great church of Saint Martin with it. The canons got out in time, they say, and carried the saint's body away with them, inland, to Auxerre.
>
> (Ermenald) My lord, Saint Martin himself, at Auxerre! A day's hard ride from here. And it isn't only Tours: churches all along the rivers are sending their treasures and relics inland, looking for safe hands. I've been asked whether you would take some into your keeping. I said I would ask.

### The request, by rank

| Player's standing | What's offered |
| --- | --- |
| Minor noble | A small reliquary of a lesser saint, with some books and altar plate from a small community |
| Viscount or count | A larger church treasury, with a few monks who come with it |
| Duke, or a strong walled site | A major shrine. Saint Martin himself historically went to Auxerre and stays there; the player can compete for a different great relic only at high rank |

A player who set `relic_refuge_offer` in 843 gets a larger offer, one step up the table.

### Accept or refuse

| Choice | Benefits | Costs and risks |
| --- | --- | --- |
| Accept | Church favor; prestige; pilgrims and their gifts (income); `relics_held` | Feeding the monks (ongoing cost); higher visibility (see Land and value system); thieves and greedy neighbors; from 886, a higher Viking raid chance at Fontenay |
| Refuse | No costs | Ermenald is disappointed; small loss of church favor |

- **If the treasure is lost or stolen:** severe church enmity (`church_enemy`).
- **When the danger passes** (Saint Martin's relics went back to Tours in the 880s): the owners ask for their treasure back. Returning it promptly earns lasting goodwill; refusing makes a powerful enemy.
- **Links:** Arc 3, momentum 75.

## Event 862-V1: The bridge levy

- **Fires:** start of autumn 862 (reports the summer assembly at Pîtres).
- **Channel and form:** Aldric, with Count Robert's officer.
- **Background:** Charles ordered fortified bridges on the rivers the Viking fleets used (Pont-de-l'Arche on the Seine, near Pîtres; Les Ponts-de-Cé on the Loire). Bridge-building and repair was an old public duty. In 862 the king demanded one young laborer from every 100 manses and one cart with two oxen from every 1,000 manses, sent to the works at Pîtres. From 864, free men too poor to serve in the army were put to work on bridges and fortifications instead. No fortified bridge is built at Fontenay: the local streams are far too small for Viking ships.

> My lord, Count Robert's man has been. The king is building great fortified bridges on the Seine and the Loire to stop the Northmen's ships, and every county must send workers and carts. Our share is small, being only ten manses: some days of labor and a cart, or the value of them in timber, stone or coin. The count gathers it all and sends his men north.

### Fontenay's share (game conversion)

| Form | Amount for 10 manses |
| --- | --- |
| Labor | About 10 labor days (a tenth of one laborer's season) |
| Cartage | About 2 cart days with oxen |
| Or in kind or coin | About 15 denarii, or timber and stone of that value |

- **Hooks:** a player who sends skilled men or engineering advice (better foundations, pilings, defensive design) earns Count Robert's notice and small renown. A player who drags his feet earns his displeasure.
- **Links:** Arc 3 and the Economy section, momentum 70.

## Event 864-V1: Pippin II rides with the Northmen

- **Fires:** start of spring 864.
- **Channel and form:** Aldric; Ermenald adds the rumor of apostasy. For Pippin II's men still with him, a live scene (see below).

> (Aldric) My lord, the Northmen have come further inland than ever: a band rode all the way to Clermont in the Auvergne, barely a week's ride from here. And another came up the Garonne and laid siege to Toulouse, and who do you think was riding with them? Pippin, the old king's son. He's hired them, or joined them; either way, he's leading Northmen against Christian towns.
>
> (Ermenald) They say he has given up the faith altogether, my lord, that he lives as they live and worships their gods. A grandson of the emperor Louis.

### For Pippin II's former men (`pippin2_840` or later, not yet submitted)

The player stays at Fontenay; he does not ride with Pippin and the Northmen. In spring, a message arrives from Aquitanian lords: they mean to take Pippin by a trick and hand him to Charles, and they ask for the player's help, or at least his silence.

**Pippin's capture is a fixed point.** Whatever the player does, Pippin is taken in May.

| Choice | Result | Flags |
| --- | --- | --- |
| Help them | The player's information helps; he is pardoned by Charles and keeps his lands. Pippin's other followers call it betrayal. | `betrayed_pippin2`, `pardoned_864` |
| Send a warning | The player sends a messenger to Pippin. The message never arrives, and the messenger is never heard from again: an accident on the road, or something worse; no one ever learns which. Pippin is taken as in history. | `warned_pippin2` (secret; the player loses the messenger) |
| Do nothing | The capture happens without him. | — |

All three lead to the submit-or-flee choice in 864-V2 (the pardon in "Help them" counts as submitting).

- **Links:** Arc 5, fixed point.

## Event 864-V2: Pippin taken; the assembly at Pîtres

- **Fires:** start of summer 864 (reports the May capture); the Pîtres news follows at the start of autumn 864.
- **Channel and form:** Aldric.

> (Summer) My lord, Pippin has been taken. His own Aquitanian lords seized him by a trick and handed him over to King Charles. The king is holding a great assembly at Pîtres this summer; they'll judge him there.
>
> (Autumn) It's done, my lord. At Pîtres the great men condemned Pippin as a traitor and an apostate. He's been shut away in a monastery at Senlis, and I doubt he'll ever come out. And the king has made new laws there: a new coin, struck only at a handful of mints, Chalon among them; fortified bridges on the rivers; and death for any man who sells horses or arms to the Northmen.

### The submit-or-flee choice (Pippin II's former men)

| Choice | Result | Flags |
| --- | --- | --- |
| Submit to Charles | Pardoned, but trusted little; the stain of having served a king who rode with Vikings. Fighting the Vikings clears it. | `pippin2_submitted` |
| Flee | Outlaw; the benefice is forfeit. The way back is a pardon (church patron, marriage tie, or service against the Vikings) or the three land outs from 830-02. | `pippin2_fled` |

- **Later:** Pippin dies in captivity at Senlis, date unknown. Aldric can mention it in passing some years later.
- **Links:** Arc 5 and the Economy section (the Edict of Pîtres), momentum 60 for the capture, 70 for the edict.

## Event 866-V1: Brissarthe

- **Fires:** start of summer 866; the battle is on 2 July.
- **Channel and form:** for Count Robert's vassals, an optional summons and a live battle scene; for everyone else, Aldric's report at the start of autumn 866.
- **Background:** a Viking band under Hastein, with Bretons, sacked Le Mans. Robert the Strong, with Ranulf of Poitou and the counts of Maine, caught them at Brissarthe in Anjou. The Vikings shut themselves in a stone church. During the siege, in the summer heat, Robert took off his helmet and mail; the Vikings burst out, Robert was killed, and Ranulf was mortally wounded by an arrow. The Vikings escaped.

### Who can be there

- **Robert's vassals (Autun, 861–866):** an optional summons to his western campaign, about 400 km away. The player is about 57–59, so command levels only (see Age and participation).
- **Royal vassals or counts:** can join Robert's command as allies.
- **Everyone else:** Aldric's report.

### Saving Robert (momentum 55)

Robert can be saved in two ways:

| Way | How |
| --- | --- |
| Fight well enough | A strong damage ratio by the player's units keeps the Vikings so tightly bottled up in the church that their sortie fails or never comes. The armor moment no longer matters. |
| The armor card | A situation card may (or may not) be drawn in which the player can urge Robert to keep his helmet and mail on during the siege. |

- **If saved (`robert_saved`):** Robert lives and remains count of Autun and commander in the west for some years (he is about 45–50; let him die naturally in the 870s). Hugh the Abbot does not take over the western command in 866. Robert's sons Odo and Robert still rise later; Odo's path to the throne in 888 may even be smoother. Bernard "Hairy-foot" returns to Autun only after Robert's death. Robert becomes a strong patron for the player.
- **If not saved:** Robert dies as in history; Autun is vacant again, and Bernard "Hairy-foot" returns (see Counts of Autun).

### Aldric's report (start of autumn 866, if Robert died)

> My lord, Count Robert is dead. He caught the Northmen and the Bretons at Brissarthe, in Anjou, after they'd burned Le Mans, and penned them up in a stone church. It was blazing hot; he took off his helmet and his mail to rest, and they came bursting out. He was cut down before he could arm himself. Count Ranulf of Poitou took an arrow there too and died of it. The best fighter in the kingdom, my lord, killed for want of a helmet. Autun has no count again.

- **Links:** Arc 3, momentum 55.

## Event 875-V1: The monks of Saint-Philibert come to Tournus

- **Fires:** start of spring 875.
- **Channel and form:** Aldric with the news; Ermenald with a request.
- **Background:** the monks of Saint-Philibert fled their island monastery of Noirmoutier, at the mouth of the Loire, in 836, and spent forty years moving inland ahead of the Vikings (Cunault, Messais, Saint-Pourçain in the Auvergne). In 875 Charles the Bald gave them the old abbey at Tournus on the Saône, about 60–70 km from Fontenay, with its lands and the relics of Saint Valerian. Mostly monks, servants, relics, treasures and books arrive, not crowds of peasants; a few displaced families drift east with them.

> (Aldric) My lord, the king has given the abbey at Tournus to the monks of Saint-Philibert, the ones who fled the Northmen on the Loire all those years ago. They've been wandering for forty years, they say. Now they'll be our neighbors on the Saône, with the king's protection and whatever lands came with the abbey. A great house, so close; that will change things hereabouts.
>
> (Ermenald) My lord, they will pass near us on the last stage from the Auvergne, carrying the body of Saint Philibert himself. Their abbot has asked the lords along the road for help. It would be a great honor to receive a saint, and the monks would never forget it.

### How the player can help

| Help | Cost | Result | Flags |
| --- | --- | --- | --- |
| Hospitality | Food and lodging for the community for a few days at Fontenay | Church favor; the monks remember the house that sheltered their saint | `tournus_host` |
| Carts and guides | Carts, oxen and men for a few weeks; help at river crossings | Church favor; the abbey's goodwill | `tournus_carts` |
| Armed escort | A few mounted men for the journey (bandits are the only real danger) | Prestige: a saint traveling with the player's riders around him is a public statement | `tournus_escort` |
| All three | All of the above | Lasting friendship with the abbey: a powerful patron, a source of precaria and land deals, and a voice for the player with the king | `tournus_friend` |
| Refuse | None | Ermenald is disappointed; the abbey does not remember the player kindly | — |

### Hooks

- **Relic refuge payoff:** a player who set `relic_refuge_offer` (843) or `relics_held` (853) is greeted warmly from the start.
- **A new neighbor:** the abbey becomes a large landholder: competition for land, labor and pilgrims, and an ally for a player who earned its friendship.
- **Refugees:** a few displaced families can be settled on vacant manses.
- **High rank (count or duke, strong walls, `relics_held`):** the player can try to persuade the monks to settle on his own lands instead. Historically the king gave them Tournus, so this is a long shot.
- **Scholarship:** one of the monks, Ermentarius, wrote the history of their wanderings and complained bitterly that lords paid tribute instead of fighting the Northmen. A natural conversation partner for a learned player.
- **Links:** Arc 3, momentum 70.

## Event 881-V1: Victory at Saucourt

- **Fires:** start of autumn 881 (reports the battle of 3 August).
- **Channel and form:** Aldric.

> My lord, good news for once. Young King Louis, the old emperor Charles's grandson, caught a great band of Northmen at Saucourt, up in the Vimeu near the sea, and slaughtered them. Thousands dead, they say, though you know how they say. The Franks across the Rhine are already singing a song about it. It's proof the Northmen can be beaten in the open field, my lord, when a king will stand and fight.

- **Note:** the victory was celebrated in a German poem, the Ludwigslied; but the Vikings were not driven off for long. Louis III died the next year.
- **Hooks:** a morale boost; players with `viking_aware` take it as proof that standing and fighting works.
- **Links:** Arc 3, momentum 70.

## Event 885-V1: Paris besieged

- **Fires:** start of winter 885–886 (the siege begins 25 November).
- **Channel and form:** Aldric; Ermenald adds the prayers being said.
- **Note:** no one in Burgundy can reach Paris in time to defend it. The player is never among the defenders.

> My lord, the Northmen have come back to the Seine in strength, hundreds of ships, and they are at Paris. Count Odo holds the city, and Bishop Gozlin with him, on their island between the two bridges. They say the Northmen offered to pass by if the bridges were opened, and Odo refused them. Now they are building engines. Paris cannot hold out forever, and no one is coming: the emperor is in Italy.

- **Hooks:** the winter and spring pass with news of the siege. A player with `viking_aware` can argue that the kingdom will have to answer this or lose the Seine.
- **Links:** Arc 3, momentum 75.

## Event 886-V1: The emperor's march

- **Fires:** start of summer 886.
- **Channel and form:** a summons, if the player's rank or lord brings him in; otherwise Aldric's news.
- **Background:** the emperor Charles the Fat gathered an army in Italy and marched through Burgundy to relieve Paris, arriving in October. Burgundian lords joining the army as it passed is plausible.

> My lord, the emperor is coming over the Alps at last, with an army out of Italy, and his road to Paris runs through Burgundy. Those who mean to go will join him as he passes.

The player is about 76–79 (see Age and participation): command from behind the lines, or send men under a captain.

- **Participation:** subcommand or full command only. Situation card themes: the long march north; a city starving behind its walls; the Northmen's camp at Saint-Germain; skirmishes with foraging parties; the river chain and the broken bridge.
- **Links:** Arc 3, momentum 75.

## Event 886-V2: The emperor pays (and where the Northmen go)

- **Fires:** start of autumn 886 for the arrival; the payment and its consequence are reported at the start of winter 886–887.
- **Channel and form:** live scene for those with the army; Aldric for everyone else.
- **What happens:** the emperor reaches Paris in October, surrounds the Northmen on Montmartre, and then does not fight. He agrees to pay 700 pounds of silver and gives them leave to go up the Yonne and winter in Burgundy, which is partly in revolt against him. Paris is disgusted; Odo is said to have defied the arrangement. The emperor is deposed in November 887 and dies weeks later; Odo is elected king in February 888.

**The payment happens whatever the player does.** What his rank changes is where the Northmen are sent and what backing comes with them.

| Player's standing | What the emperor does | Result |
| --- | --- | --- |
| Minor noble or viscount | Burgundy is punished as a region; the player is simply in the way | The Northmen come: high raid chance in 886–887, supply checks, refugees. Local defense only |
| Count, loyal to Charles the Fat | "You are trapped in Burgundy with me." The emperor still sends them, but backs the player | Men, coin, royal authority to raise the region's levies, and a commission to contain them: a large renown opportunity and a large risk |
| Duke, loyal, high favor | The emperor will not punish Burgundy at the cost of his best man there; the player chooses | Spend favor to have them sent elsewhere (Burgundy spared; drop the raid table to Low and scale down 888 and 898), or volunteer to take them on with imperial backing (the biggest renown opportunity of the late game) |

- **Whatever the player's rank:** he can argue against the payment. Renown for arguing well in front of the army; the emperor pays regardless.
- **Hooks:** the disgrace of the payment feeds directly into the emperor's fall (887) and Odo's election (888). A player who was present and objected is remembered well by Odo's party.
- **Links:** Arc 3, keystone K7, momentum 40.

## Event 887-V1: The Northmen in Burgundy

- **Fires:** start of winter 886–887, unless the Duke-rank player had them sent elsewhere.
- **Channel and form:** Aldric; then play out the season with raids, supply checks and irregular tactics.

> My lord, they are coming up the Yonne. The emperor's own safe-conduct in their hands, and they are coming to winter on us. They have sat down before Sens and mean to take it. Everything outside the walls between here and the Yonne is theirs for the taking until spring.

- **What happens:** the Northmen besiege Sens for months without taking it, ravage the open country, and go back to Paris in spring 887 to collect their silver.
- **Player options:** walls and refuges; deny the countryside; hit and run on foragers; night raids; ambushes. See Irregular tactics. A field battle against the whole army is suicide at most ranks.
- **\[Supply check\]** every season while they are in the region.
- **Links:** Arc 3, momentum 40.

## Viking danger in Burgundy (886–911)

The danger is episodic, not constant. Raid chance stacks with the supply checks in the appendix.

| Years | What is happening | Raid chance per season |
| --- | --- | --- |
| 886–887 (winter, spring) | The army sent from Paris winters in Burgundy, besieges Sens, ravages the Yonne valley; returns to Paris in spring 887 | High (60–70%) |
| 888 | A band sacks Bèze abbey near Dijon; beaten near Saint-Florentin | Moderate (30%) |
| 889–897 | Quiet in Burgundy; raiding continues elsewhere | Low (5–10%) |
| 898 | Vikings winter between Tonnerre and Montbard; beaten at Argenteuil-sur-Armançon and Saint-Florentin | Moderate to high (40%) |
| 899–911 | Quiet locally; the last campaign is at Chartres in 911 | Low (5%) |

If a Duke-rank player had the Vikings sent elsewhere in 886 (see the Paris entries), drop every figure above to Low and scale down or skip the 888 and 898 battles.

### The army's strength

The band sent into Burgundy was the core of the force that besieged Paris: roughly 1,000–3,000 veteran, well-armed men practised at siege work. Walls held them off (they besieged Sens for months and never took it); open country did not. A field battle against the whole army is suicide at most ranks.

## Irregular tactics

Available to any rank, and the main way a smaller force can hurt a Viking army.

| Tactic | Effect | Risk |
| --- | --- | --- |
| Hit and run on foraging parties | Kills the army's supply gathering; the historical sweet spot for local defense | Low to moderate; small renown per success |
| Deny the countryside (empty villages, hide stores in pits, drive livestock into the woods, break bridges, block fords) | A camped army that cannot forage must move on; also halves supply-check losses | Low; costs labor and a season of disruption |
| Night raid on the camp (cut horse lines, fire tents, kill sentries) | Attrition and panic; Richard's winter victory at Argenteuil in 898 began as a surprise attack | High; a failed raid can cost the player's best men |
| Ambush at river crossings and defiles | The classic Frankish answer; good odds against a detachment | Moderate; renown as a real engagement |
| Burn or hole the beached ships | Devastating: strands the army | Very high; the ships are the most closely guarded thing in the camp |
| Blockade (bridges, chains, fortified crossings) | Pins a fleet in place and forces terms, as Charles the Bald's bridges were meant to do | Low risk, high cost and time; needs rank and resources |

### Poisoning the camp's stores

Sneaking someone into the camp to foul the army's food and drink, rather than poisoning wells (which would poison the player's own people and livestock too).

| Aspect | Effect |
| --- | --- |
| Effect if it works | Moderate attrition and sickness in the camp over weeks; weakens them before a battle or pushes them to move on. Resolved abstractly; no recipes |
| Infiltration | Needs a volunteer: a servant, a captive, a merchant. Roll for success; failure means a dead agent and a camp on alert |
| If it becomes known | The church condemns it outright: `church_favor` penalty, suspicion from neighbors, and a renown penalty, since renown comes from open battle |
| If it stays secret | Keep the attrition, no social cost; secrecy is itself a roll each season |

**Disease as a weapon.** A modern-knowledge player may propose plague-fouled cloth or blankets as "loot" for the Vikings to take. Let him try: the attempt does nothing to the enemy (airborne diseases do not travel this way), and there is a real chance his own household sickens from handling it. The idea is a character moment, not a mechanic; deliberately engineering an outbreak is beyond anyone in this period.

## Event 888-V1: Bèze sacked; Richard's summons

- **Fires:** start of the season in which the band appears (designer's choice: spring or summer 888).
- **Channel and form:** Aldric with the news, then a summons from Count Richard.
- **Who is Richard:** Richard the Justiciar, count of Autun since 880 and the player's own lord for eight years. Born at Vienne in the Rhône valley in 858, so about 30 here; his family (the Bosonids) came from Lotharingia, which is why Burgundians sometimes call them outsiders. He holds Autun until 921, past the end of the game.

> (Aldric) My lord, Northmen in Burgundy again. A band came inland and sacked the abbey at Bèze, up by Dijon; burned it and carried off everything. Count Richard is calling up his men, and Bishop Géran of Auxerre is bringing his.

### The battle at Saint-Florentin

Richard and Bishop Géran caught the band in the plain near Saint-Florentin and destroyed it.

- **The player is about 79:** command from behind the lines, or send men under a captain (see Age and participation).
- **Participation:** subcommand or full command only.
- **Situation card themes:** scouting the band's line of march; the abbey's survivors and what they saw; a bishop's men fighting beside a count's; plunder-laden Northmen who cannot run; cutting off the retreat to the river.
- **If the player holds Autun (duke-rank, from 879–880):** the player commands in Richard's place, with Bishop Géran as his ally.
- **Links:** Arc 3, momentum 35.

## The middle years, 889–897

No Vikings near Burgundy, but Richard is busy, and his vassals with him. Short Aldric notes, with optional summonses.

| Year | Event | The player's part |
| --- | --- | --- |
| 888–890 | Richard supports Rudolph as king of Upper Burgundy and marries his sister Adelaide; in 890 he supports his nephew Louis as king of Provence | News; a wedding to attend; politics rather than war |
| 892 | Richard joins the plot to draw King Odo away to Aquitaine so the young Charles the Simple can be crowned at Reims | News, and a chance to carry messages |
| 894 | Richard shelters Charles the Simple on his own lands against East Frankish troops | A summons to guard the fugitive king: small renown, real risk |
| 894–895 | Richard takes the county of Sens by force | A real campaign: summons, sieges and skirmishes; moderate renown |
| 898 | Odo dies; Richard accepts Charles the Simple, who lets him merge his counties into one marquisate | News: the player's count is now marquis of Burgundy |

## Event 898-V1: The Northmen winter between Tonnerre and Montbard

- **Fires:** start of winter 898–899.
- **Channel and form:** Aldric, then Richard's summons; live battle scene.

> My lord, Northmen have come up the rivers and made a winter camp between Tonnerre and Montbard. Not fifty miles from here, sitting on our country for the winter and stripping it bare. Count Richard, marquis now, means to go at them before they're settled. He's calling every man who can ride.

### The battle

Richard surprised them at Argenteuil-sur-Armançon, beat them again at Saint-Florentin, and drove them back to the Seine valley. A winter attack on a camp on land: see Viking forces and winter attacks.

- **The player is about 89:** command from behind the lines, or send men under a captain.
- **Participation:** subcommand or full command only.
- **Advantages:** their ships are far off; the camp is on land, not an island; surprise is possible in winter.
- **Costs:** winter supply (about double); cold and sickness morale penalty.
- **Situation card themes:** a night march in frost; scouts who know the Armançon crossings; firing the camp before dawn; Northmen fighting dismounted among their baggage; pursuit through the Tonnerrois; prisoners and plunder recovered from the abbeys.
- **If the player holds Autun (duke-rank):** the player plans and commands both actions; Bishop Géran and the levies of the merged counties are his to direct.
- **Reward:** the largest renown of the late game; the man who cleared Burgundy of Northmen.
- **Links:** Arc 3, momentum 30.

# Arc 4: Brittany breaks away (831–890)

Brittany is about 500 km from Fontenay, so most of this arc is Aldric's news. Two royal campaigns bring summonses and battles, and both end in defeat. That is the point of the arc: answering the king's call can mean marching 500 km to lose. (Brissarthe in 866, Arc 3, is also a Breton victory; the 830 mutiny began at a muster for a Breton campaign.)

## Event 845-B1: Ballon

- **Fires:** summons at the start of autumn 845; the battle is on 22 November; Aldric reports the outcome at the start of winter 845–846.
- **Channel and form:** royal summons through the count; live battle scene.
- **Background:** Charles invaded Brittany with about 3,000 men. Nominoe, who had far fewer and mostly light horse, drew him into marshland at the meeting of the Oust and the Aff near Redon, where the Bretons knew the ground. Charles was beaten. A truce followed, and Nominoe's autonomy grew.
- **Note:** 845 is a crowded year. The Vikings took Paris in the spring and the famine is running; a player may already be short of men and food.

> (Summons) The king goes against the Bretons, who have broken faith again. Every man owing service to muster and march west before Martinmas.
>
> (Aldric, after) Beaten, my lord, in a marsh. The king took three thousand men into Brittany and let himself be drawn into bogs where the horses foundered and the Bretons knew every path. Those who came back are still pulling the mud off. All that way, and for nothing.

- **Participation:** all levels (the player is about 36–38).
- **Situation card themes:** the long march west in autumn rain; horses foundering in marsh; Breton light horse appearing and vanishing; holding formation on soft ground; a rearguard covering the retreat; the road home in winter.
- **Renown:** earned by how the player's own men fare, not by the outcome; bringing a unit home intact from a rout is worth as much as a win elsewhere.
- **Can the outcome change?** Momentum 70. The king's defeat stands, but a strong performance can turn a rout into an orderly withdrawal and save lives.
- **Links:** Arc 4, momentum 70.

## Event 851-B1: Jengland

- **Fires:** summons at the start of summer 851; the battle is on 22 August; Aldric reports the treaty at the start of autumn 851.
- **Channel and form:** royal summons; live battle scene. The arc's main engagement.
- **Background:** Nominoe died in March 851. Charles invaded again, with Saxon troops from his brother, and met Erispoe near the Vilaine. The Bretons were heavily outnumbered, perhaps four to one, but refused to close: they harassed the armoured Franks with javelins from horseback, wheeling away whenever the Franks advanced. After two days of this, Frankish losses in men and horses were catastrophic and the Bretons had lost almost nothing. Charles withdrew and made terms at Angers in September, recognising Erispoe as king with Rennes and Nantes.

> (Summons) The old Breton is dead and his son sits in his place without the king's leave. The king calls every man to the host; we go into Brittany before the summer ends.
>
> (Aldric, after) A second time, my lord, and worse than Ballon. They would not stand and fight. Two days of them riding up, throwing their javelins and wheeling off before our men could close, and all the while our horses dying under us. The king gave it up and went to Angers to make terms. Erispoe is to be called king and keep Rennes and Nantes. We marched five hundred miles to make a Breton a king.

- **Participation:** all levels (the player is about 42–44).
- **Situation card themes:** heavy horse that cannot catch light horse; javelins at a distance, hour after hour; Saxon allies breaking back through the Frankish line; dying horses and men on foot; water and heat in August; the decision to hold or to charge; the withdrawal in good order.
- **Renown:** again from the player's own units' performance. A commander who adapts (dismounting, screening with his own light horse, refusing to be drawn) can come out of it with a reputation while the king's army falls apart.
- **Can the outcome change?** Momentum 65. Charles still fails and still makes terms; the player's performance changes his own losses, his standing, and how many neighbours come home.
- **Links:** Arc 4, momentum 65.

## Arc 4 news (Aldric)

### 831: A Breton to rule the Bretons

- **Fires:** start of autumn 831. (Arc 1 years; delivered alongside the Thionville news.)

> The emperor has given Brittany to a Breton, my lord: a man named Nominoe, a count of Vannes, to hold the country in his name. Better a native who knows them than another Frankish count they'll only murder, I suppose. We'll see whether he stays the emperor's man.

### 849–850: The war begins again

- **Fires:** start of summer 849.

> The Bretons are at it again, my lord. The king took Nantes back, and now Nominoe and his son have come out of their country burning. They've gone as far as Angers and Le Mans. He's calling himself prince of the Bretons now, and he's thrown out the bishops the king appointed and put his own men in their sees. That's not a rebel any more; that's a man building a kingdom.

### 851: Nominoe dies

- **Fires:** start of spring 851. (Leads into the Jengland summons.)

> Nominoe is dead, my lord, in March, on campaign in Frankish country. His son Erispoe has taken his place without so much as asking the king's leave. The king won't swallow that.

### 857: Erispoe murdered

- **Fires:** start of winter 857–858.

> Murder in Brittany, my lord. King Erispoe, the one who beat us at Jengland, is dead, killed by his own cousin Salomon, in a church, they say. Salomon has the country now. They're no better at keeping a peace among themselves than we are.

### 863–867: The king buys peace

- **Fires:** start of autumn 863, and again at the start of autumn 867.

> (863) The king has bought the Bretons off, my lord: more land to Salomon to keep him quiet, and an oath of friendship. Land for peace.
>
> (867) More land, my lord. Salomon has the Cotentin now, the whole peninsula, and the king calls him friend. We fought two wars over less than that. Every lord in the kingdom is doing the same arithmetic: hold out long enough and the king pays you in counties.

- **Hook:** a player thinking about his own standing with the king may draw the same conclusion. Feeds the great men's rebellions of 877–878 (Arc 6).

### 874: Salomon murdered

- **Fires:** start of winter 874–875.

> Salomon of Brittany is dead, my lord, killed by his own nobles, and blinded first, they say. Thirty years ago we marched five hundred miles to fight that country. Now they do our work for us.

### c. 890: Alan the Great

- **Fires:** start of autumn 890.

> Good news from the far west, my lord, if you can call it ours. A Breton lord named Alan has smashed a great Northman army at Questembert, in his own country. They say it broke them for a generation. Whatever else the Bretons are, they know how to fight Northmen.

## Event 845-A1: Pippin II recognised as king

- **Fires:** start of summer 845 (reports the June settlement), in the same delivery as the Paris news.
- **Channel and form:** Aldric; for Pippin's men, an invitation to his court.

> My lord, King Charles has come to terms with his nephew at last. Young Pippin is to be king of Aquitaine, most of it, holding it of Charles as his man. After five years of war, the boy has what his father had. Those who stood by him all this while will be remembered at his court this summer.

### Promotion window (Pippin's men only)

Requires `fontenoy_pippin2`, `toulouse_bernard` or an earlier Pippin flag. Pippin is now a king with lands and offices to give, and this is the high-water mark of his fortunes.

| Condition | Result |
| --- | --- |
| Renown at or above the next rank's threshold | Promotion at Pippin's court, and a benefice in Aquitaine or confirmation of the villa |
| Renown below threshold | Gifts and thanks: a horse, arms, a cloak |
| **Cap** | Pippin cannot raise a man above his own standing. No promotion to Duke or above from Pippin; a king cannot make another king, and a king of part of Aquitaine holding of Charles will not create a rival. |

- **Catch:** a benefice in Aquitaine ties the player to a kingdom that will not last (see 848 and 852). Lands held from Pippin are forfeit when he falls; the villa at Fontenay is not.
- **Links:** Arc 5, momentum 70.

## Event 848-A1: Aquitaine turns

- **Fires:** start of summer 848 (reports the spring defections and the Orléans crowning).
- **Channel and form:** Aldric.

> My lord, the Aquitanians have thrown Pippin over. His own lords have gone to King Charles and asked him to rule them, and Charles has been crowned and anointed at Orléans as their king. Three years he's been king down there and they've tired of him already. Pippin's still loose with a few men, but he's a king of nothing now.

- **For Pippin's men:** anything held from Pippin is at risk. Submit to Charles (pardoned, distrusted for a while) or hold out with a dwindling cause. Sets `pippin2_submitted` or keeps the Pippin flags.
- **Links:** Arc 5, momentum 65.

## Event 852-A1: Pippin shut away (and out again)

- **Fires:** start of autumn 852; the escape is reported at the start of summer 854.
- **Channel and form:** Aldric.

> (852) Pippin is finished, my lord. The Gascons he'd fled to handed him over to his uncle, bound. They've shaved his head and put him in the monastery of Saint-Médard at Soissons, the same house where they kept the old emperor after they deposed him. A tonsured monk can't be a king.
>
> (854) My lord, you'll laugh: Pippin has got out of Soissons. Walked out, slipped out, bribed his way out, nobody will say. He's back in Aquitaine and there are men flocking to him again. That family does not stay buried.

- **Hook:** the escape reopens the Aquitaine question and leads to Pippin's last years with the Vikings and his capture in 864 (864-V1, 864-V2).
- **Links:** Arc 5, momentum 60.

## Event 855-A1: A rotating door of kings

- **Fires:** start of spring 855 (the Aquitanian embassy), with a second note at the start of autumn 855 (Charles's answer).
- **Channel and form:** Aldric.

> (Spring) My lord, Aquitaine has outdone itself. They threw Pippin over for Charles, then tired of Charles, and now they've sent to Louis of Bavaria asking for one of his sons to come and be their king instead. Pippin's still at large down there with men of his own. Three claimants and no king, and the Northmen on the Loire sitting watching it all.
>
> (Autumn) The king's answer, my lord: he's made his own boy king of Aquitaine, another Charles, a child. So now they have a child king, a prisoner who got loose, and a Bavarian waiting in the wings. I'd not want to be a lord in Aquitaine. I'd not want to be a peasant there either.

### Hooks

- Former Pippin men (`pippin2_submitted`) are sounded out again, quietly: Pippin is still free and still has friends. No real prospect now; a player who stays out keeps his pardon intact, and one who dabbles risks it all over again.
- A player with land in Aquitaine from the 845 promotion window (845-A1) sees it become worthless or contested.
- Aquitaine's disorder is part of why the Loire Vikings raid so freely in these years (Arc 3).
- **Links:** Arc 5, momentum 65.

# Arc 6: Charles the Bald's reign (855–877)

After 864 there is no rival king for a Burgundian lord to follow: it is Charles or nothing. The arc's choices are about loyalty under pressure, a neighbour's rise and fall across the Saône, and the slow drift of benefices toward inheritance.

## Event 855-C1: The middle kingdom splits

- **Fires:** start of autumn 855 (reports Lothair's death on 29 September).
- **Channel and form:** Aldric; Ermenald adds the monastic end.

> (Aldric) My lord, the emperor Lothair is dead. He gave up his crown, took the habit at Prüm and died a monk six days later. His middle kingdom is cut three ways between his sons: Louis has Italy and the imperial title, Lothair the north, and the youngest, Charles, gets Provence, with Lyon and Vienne. So we have a new neighbour across the Saône, and he's a boy, and a sickly one by all accounts.

- **Hooks:** the far bank of the Saône now belongs to a weak child king. Trade, disputes and fugitives across the river all become live. Feeds 863-C1 and 870-C1.
- **Links:** Arc 6, momentum 85.

## Event 858-C1: Girart builds at Vézelay

- **Fires:** start of summer 858 (and again around 863 for Pothères).
- **Channel and form:** Ermenald, with enthusiasm; Aldric, with calculation.

> (Ermenald) My lord, Count Girart of Vienne is founding a monastery at Vézelay, up the Cure valley, and another at Pothères. Great houses, richly endowed, with relics brought from Rome.
>
> (Aldric) And he rules the Lyonnais for the boy king of Provence, my lord. A man who builds abbeys in our country is putting down roots in it. Good for the masons and the carters. Less good for anyone whose land he wants next.

- **Hooks:** work and trade for the villa; a new patron to court, or a rival for land; the abbeys become powerful neighbours in their own right. Girart's fall in 870 (870-C1) puts everything he built in play.
- **Links:** Arc 6, momentum 60.

## Event 858-C2: Louis the German invades

- **Fires:** start of autumn 858 (the invasion), with the resolution at the start of spring 859.
- **Channel and form:** Aldric, then a choice; no battle (Charles avoided one).
- **Background:** western nobles, discontented with Charles, invited his brother Louis the German to take the kingdom. Louis invaded in autumn 858 and stayed into January 859. Charles fell back, could not trust his own army, and was saved by his bishops, who refused to crown Louis, and by his kinsmen. Louis withdrew; Charles rebuilt his support and later punished the disloyal.

> (Autumn) My lord, the king's own men have invited his brother in. Louis of Bavaria is across the border with an army and half the great lords of the west have gone over to him. King Charles is falling back and daren't give battle; he can't tell which of his own men will stand. The bishops are refusing to crown Louis, and that may be all that's holding the kingdom together.

### The choice

| Choice | Short term | By 859–860 |
| --- | --- | --- |
| Stand with Charles | Isolated and exposed; Louis's men are in the ascendant all winter | Rewarded when Charles recovers: `loyalist_858`, royal favour, a strong claim at the next promotion window |
| Go over to Louis | Safe and well-rewarded through the winter | Louis withdraws in January; the grants evaporate. `perjury_858`: Charles remembers, and the king's officers are slow to help in later disputes |
| Wait and see | No gain, no loss | Neutral; the count notes who did nothing |

- **Note:** this is the same shape as 830 and 840, but with no battle and no rival king afterwards; it is purely a test of nerve.
- **Links:** Arc 6, momentum 60.

## Event 863-C1: The boy king of Provence dies

- **Fires:** start of winter 863–864.
- **Channel and form:** Aldric.

> Charles of Provence is dead, my lord, the sickly one; he never did rule for himself. His brothers have carved up what he had. Lyon and Vienne go to the emperor Louis in Italy, and Count Girart governs there for him as he did for the boy. Borders drawn and redrawn, and nobody asks the people who live on them.

- **Links:** Arc 6, momentum 85.

## Event 869-C1: Lothair II dies; the race for his kingdom

- **Fires:** start of autumn 869 (death in August), with the Metz coronation at the start of winter 869–870 and Meerssen at the start of autumn 870.
- **Channel and form:** Aldric.

> (Autumn 869) My lord, Lothair the younger is dead in Italy, with no lawful son to follow him. His uncle Charles has not waited: he's gone straight into Lotharingia and the bishops have crowned him at Metz. His other uncle, Louis of Bavaria, is coming the other way with an army, and the emperor in Italy claims it all as well. Three men, one kingdom, and the corpse barely cold.
>
> (Autumn 870) They've agreed to divide it at Meerssen, my lord: Charles takes the western half, Louis the eastern. No battle, for once. Our king has doubled what he holds.

- **Links:** Arc 6, momentum 70.

## Event 870-C2: The siege of Vienne

- **Fires:** summons at the start of summer 870; the city falls in December; Aldric reports at the start of winter 870–871.
- **Channel and form:** royal summons through the count; live battle scene.
- **Background:** Count Girart of Vienne held the city against Charles for the emperor Louis. Charles besieged it; the city held out for months and fell in December, by most accounts negotiated rather than stormed, with Girart's wife Bertha arranging terms. Girart lost Vienne and withdrew to his lands in Burgundy, where he died in 877.
- **Why the player is called:** Vienne is about 150 km down the Rhône; Burgundian levies are the natural troops for this siege, and by 870 there is no alternative lord to follow. Refusing means the army fine and the king's displeasure.

> (Summons) The king goes down the Rhône against Count Girart, who holds Vienne against him for the emperor in Italy. Every man owing service to muster with the count.

- **Participation:** all levels (the player is about 61–63: see Age and participation — rank and file is possible but dangerous).
- **Situation card themes:** siege lines in the Rhône heat; river supply and boats; a city that will not starve quickly; sorties against the lines; mining and engines; the long autumn; negotiations under truce and the countess's envoys; keeping order when the gates open.
- **Can the outcome change?** Momentum 70. Vienne falls either way; a strong performance shortens the siege, spares the city a sack, or earns the player a share in the terms.
- **Hooks:** a player who treated Girart well in 858–863 can intercede for him; Girart keeps his Burgundian lands either way, and Vézelay and Pothères remain his foundations.
- **Links:** Arc 6, momentum 70.

## Event 875-C1: The road to Rome

- **Fires:** start of autumn 875 (the offer and departure); messengers each season; the player returns in spring 876.
- **Channel and form:** an invitation, not a summons; then a journey with seasonal messages home.
- **Background:** the emperor Louis II of Italy died in August 875 without a son. Charles crossed the Alps at once, outpacing his rivals, and was crowned emperor by the pope in Rome on Christmas Day 875. Boso and Richard, the brothers who will matter so much later in Burgundy, were in his escort.

> My lord, the emperor in Italy is dead without a son, and King Charles has gone over the Alps to take the crown before his nephews can. He's taken a chosen company, not a levy: the great men of the south and Burgundy, the brothers Boso and Richard among them. Word is that men of standing hereabouts may ride with them if they wish.

### Going or not

| Player's standing | Expectation |
| --- | --- |
| Below count | Not invited; Aldric's news only |
| Count | Invited, not summoned. May go, send men, or decline politely |
| Duke | Invited in person and expected to send men whether or not he goes himself |

- **The journey:** autumn 875 to spring 876, over the Alps and back. The player is about 66–68: no fighting, and the travel itself is hard at that age (bad weather in the passes, sickness, a long absence).
- **Messengers:** while away, the player hears from Aldric and Ermenald once a season and can send instructions back, with a season's delay. Decisions at home are made by his advisors in the meantime.
- **Rewards:** prestige and the emperor's personal notice; contacts among the great men of the south, Boso and Richard above all, which matters enormously from 879; the chance to acquire relics in Rome (an offer, with a cost).
- **Risks:** a season of absence (supply and management penalties at home); illness on the road; anything that goes wrong at Fontenay is handled without him.
- **Links:** Arc 6, momentum 65.

## Event 876-C1: Andernach

- **Fires:** summons at the start of summer 876; Aldric reports at the start of autumn 876.
- **Channel and form:** general summons; optional live battle scene.
- **Background:** Louis the German died in August 876. Charles immediately invaded the east to seize his brother's lands. Louis's son met him at Andernach on the Rhine on 8 October, feigning negotiation, and attacked by night in the rain. The Frankish army panicked and was destroyed; Charles escaped with a handful of men. It broke his attempt on the east, and he died within a year.

> (Aldric, after) A disaster, my lord, and a shameful one. The king went east the moment his brother was buried, to take the whole of it. His nephew sent envoys to talk terms, and while they talked he came on the camp at night, in the rain. Our men never formed. They were cut down running or drowned in the river. The king got away with a few riders and lost everything else: the baggage, the treasure, the army. He's been a changed man since, they say.

### Playing it

- **Participation:** optional. The player is about 67–69: command from behind the lines, or send men under a captain.
- **The objective is survival,** as at Ballon: there is no winning the field in a night rout. Renown comes from getting units out intact.
- **Situation card themes:** envoys arriving at dusk; a camp standing down in the rain; horns in the dark; men running without arms; the river at the camp's back; holding a knot of men together in the chaos; the road home without baggage.

### If the player turns it around (momentum 60)

A strong performance can save the army: the camp stands to, the night attack breaks on a formed line, and the field is held. The campaign still fails, and the three-kingdom shape of Europe survives, through a cost to Charles himself:

- Charles takes a wound in the night fighting that turns bad, or falls sick in the camp. Either way he cannot campaign again and withdraws west, the invasion of the east collapses, and Louis's sons keep their father's kingdom.
- He lingers through 877 as in history, and dies that autumn crossing the Alps.
- The player who saved the army is marked out: large renown, the king's gratitude, and a reputation among the great men who were there (Boso and Richard among them).
- **Links:** Arc 6, momentum 60.

## Event 877-C1: Quierzy, and the king's death

- **Fires:** the capitulary at the start of summer 877; the king's death at the start of winter 877–878.
- **Channel and form:** Aldric, with more interest than usual; Ermenald for the death.

> (Summer) My lord, this one matters to us. The king is going to Italy again and has made arrangements at Quierzy for his absence. Among them: if a count dies while the king is away, his son is to hold his father's office and lands until the king returns and decides. And the same for lesser men, my lord. For men like us. It isn't law that a son inherits, not yet. But it's the first time the king has written down that a son should hold what his father held. Men will remember that sentence long after the king is dead.
>
> (Winter) The king is dead, my lord. He took sick crossing back over the Alps and died in a hut in the mountains, the sixth of October. They tried to carry him home to Saint-Denis and couldn't; they buried him at Nantua and will move him later. Thirty-seven years he reigned over us, since Fontenoy. There'll be another Louis now, and he's not his father.

- **Hooks:** Quierzy is the formal step that makes the player's benefice closer to heritable property; it strengthens every later land claim, and his heir's. The king's death opens Arc 7: within two years, Boso crowns himself and Richard takes Autun.
- **Links:** Arc 6, keystone K5, momentum 80–85.

# Arc 7: Boso, Richard, and the making of Burgundy (877–901)

The player's home arc. Two brothers of the same family divide the region: Boso makes himself a king, Richard stays with the Carolingians, takes Autun and spends forty years building it into a duchy.

**The axis is the king, not the brothers.** Carloman is the player's king from 879, and Richard acts in Carloman's name, so royal loyalty covers everything Richard does. Boso's approach is a conversation, never a binding offer: a small lord is never asked to choose between ruin and exile.

**If the player holds Autun at Duke rank** (see Where the player becomes count), he takes Richard's role throughout this arc: he breaks the Bosonid hold on Burgundy, leads the campaign, and builds the principality.

**Boso's family** (his wife Ermengard and their children, held after Vienne falls) are kept elsewhere by other men; the player has no contact with them.

## Event 878-K1: The great men rebel

- **Fires:** start of autumn 878 (reports the summer council of Troyes).
- **Channel and form:** Aldric.

> My lord, the new king can't hold his own great men. Bernard of Gothia, who held Autun these last two years, has rebelled, and the pope himself came up to Troyes and excommunicated him for it. His offices are being parcelled out. Autun goes to Boso, Count Richard's elder brother, the one who was old King Charles's brother-in-law. Another new count, my lord. I've lost count of the counts.

- **Note:** this is the shuffle that briefly puts Boso at Autun. He is a southern lord, rarely here; his officers govern.
- **Links:** Arc 7, momentum 70.

## Event 879-K1: The king dies, and the boys divide the kingdom

- **Fires:** start of summer 879 (Louis the Stammerer died in April).
- **Channel and form:** Aldric.

> My lord, the king is dead, eighteen months after his father. He was never well. His two sons are to rule between them: Louis in the north, and Carloman, who has Burgundy and Aquitaine. Carloman is our king now, my lord. He is thirteen years old.

- **Hook:** two boy kings and no strong hand. Everything in this arc follows from that.
- **Links:** Arc 7, momentum 85.

## Event 879-K2: A king elected at Mantaille

- **Fires:** start of winter 879–880 (reports the October election).
- **Channel and form:** Aldric; then an approach from Boso's people, if the player holds his benefice from Autun.

> (Aldric) My lord, the strangest news in sixty years. The bishops and great men of the Rhône country met at Mantaille and elected Count Boso king. Elected him, my lord. Not a Carolingian, not a son of anybody, just a man they chose. He has Vienne, he has Provence, and his wife is the old emperor of Italy's daughter. The Carolingians will not swallow this. Not one of them will.

### Boso's approach (below count rank, holding from Autun)

Boso's officers at Autun ask the lords of the county to recognise their count as king. This is a conversation, not an oath: no one is bound, and no land is at stake yet.

| Response | Effect |
| --- | --- |
| Warm (recognise him) | `boso_sympathy`: remembered by the Bosonid family, which returns to favour in the 890s; a small mark against the player with the royal party |
| Non-committal | Nothing |
| Hostile (refuse and say so) | `boso_refused`: the royal party notes it approvingly; Boso's officers at Autun are cold for the few months they last |

- **Count rank or above:** no approach. The player is the king's officer and holds from Carloman, not from Autun.
- **Links:** Arc 7, momentum 55.

## Event 880-K1: Richard takes Autun

- **Fires:** start of spring 880.
- **Channel and form:** live scene at Fontenay (below count rank); Aldric's news for a count or above.
- **What happens:** Richard broke with his brother and took Autun; Carloman confirmed it to him. How he took it is not recorded; Boso was in the south facing royal armies and the county was held by his officers. Play it as gates opened by men who preferred Richard, or a short sharp fight at the walls.

> (Richard's envoy, at Fontenay) Count Richard holds Autun for King Carloman. His brother has set himself up as a king against the king, and the county will not follow him into it. The count asks for your oath, and confirms you in what you hold.

### The oath (below count rank)

| Response | Effect |
| --- | --- |
| Swear readily | Confirmed in the benefice; `richard_vassal`. The simple, safe answer |
| Swear, but ask terms first (confirmation in writing, your men unharmed, no service outside Burgundy for a year) | Confirmed, with terms, if the player has standing; Richard respects a man who negotiates. `richard_vassal`, `richard_respect` |
| Swear reluctantly, saying you keep faith with the lord you had until he releases you | Richard takes it well: a man who keeps oaths is what he wants. `richard_vassal`, `richard_respect`; also remembered by the Bosonids |
| Stall | Richard waits a season, then declares the benefice forfeit and gives it to a man who will swear. The player must use the land outs (830-02) or lose it |
| Resist in arms | A siege of the villa. Almost certainly fatal, and it is the player's own choice, not an execution |

- **Note:** Richard does not kill vassals for keeping faith with his brother. He needs these men to accept him, and a lord who murdered loyal men would find no one willing to swear.
- **Count rank or above:** no oath. The player and Richard are both royal officers, holding their counties from the king. This stays true for twenty years (see 898-K1).
- **Links:** Arc 7, keystone K6, momentum 45.

## Event 880-K2: The campaign on the Saône

- **Fires:** summons at the start of summer 880.
- **Channel and form:** summons through Richard (vassals) or from King Carloman (counts); skirmishes and two small sieges.
- **What happens:** Richard and Boso's forces clashed on the Saône. Richard took Mâcon and garrisoned it for the kings under Bernard "Hairy-foot," then took Lyon, and moved on Vienne.
- **Participation:** all levels (the player is about 71–73: see Age and participation).
- **Situation card themes:** a river crossing contested; a town that opens its gates; a town that does not; men of the same county on both sides; Bosonid officers who will not surrender to a man they served beside last year.
- **Links:** Arc 7, momentum 50.

## Event 880-K3: The siege of Vienne

- **Fires:** opens at the start of autumn 880; runs until the city falls in 882.
- **Channel and form:** live siege, or run by letter (see below).
- **What happens:** Richard besieged his brother's capital, joined by the kings Louis III and Carloman and by Charles the Fat. The siege lasted roughly two years and ended in a negotiated surrender, not a storm. Boso slipped away into Provence. Ermengard, his wife and the emperor of Italy's daughter, led the defence in his absence and arranged the terms.
- **Who is outside the walls:** everyone. Richard's vassals, counts summoned by Carloman as allies, and a Duke-rank player commanding the whole campaign.

### Running it at seventy-three

The player is about 71–75 across the two years. He can go in person (command levels only), or send a captain and run the siege by letter, with the seasonal messenger rhythm used for the Rome journey (875-C1). Designing engines can be done from Fontenay.

### Shortening the siege

| Approach | Effect |
| --- | --- |
| Ordinary investment: lines, blockade, starvation | The historical two years |
| Better engineering: proper circumvallation, cutting the water supply, river blockade | Months off; fewer losses |
| **The counterweight trebuchet** | The big one. Frankish armies have traction engines, hauled by teams, that throw light stones; the counterweight machine does not appear for another three centuries. Everything it needs exists already: timber, rope, iron fittings, a box of earth and stone. Local carpenters can build one in weeks from a player who understands the principle. Against Vienne's walls it turns a two-year starvation into a breach in a season |
| Cannon | Not available. The limit is not casting but saltpetre: no one in ninth-century Europe knows what it is, and making it means nitre beds of manure and ash maturing for a year or more per batch, then working out proportions, then casting a barrel that will not burst. If gunpowder is to exist in this game it is a multi-year project of its own, with its own events, not something brought to this siege |

**Consequence of the trebuchet:** everyone who sees it will copy it. Expect counterweight engines in Frankish and, within a decade, Viking hands: a lasting change to every later siege in the game, including the defence of the player's own walls.

### Inside the walls (rare)

A player who recognised Boso warmly in 879 and never submitted may be inside Vienne. There is no winning: the ending is capture, flight into Provence with Boso, or death. This is the price of following Boso past 880.

- **Participation:** command levels only. Situation card themes: a two-year line in heat and cold; sickness in the siege camp; sorties at the gates; the river and the supply boats; engines rising; a city negotiating its surrender; kings and an emperor sharing one camp.
- **Renown:** large, and larger still for a player who shortens the siege.
- **Links:** Arc 7, momentum 55.

## Event 882-K1: Vienne falls

- **Fires:** start of autumn 882.
- **Channel and form:** live scene for those present; Aldric otherwise.

> My lord, Vienne has fallen at last. Not stormed: they came to terms. Boso was not even in it; he slipped away south months ago and left his wife to hold the place and make the bargain, and by all accounts she did it better than he would have. His family are taken. They will be held somewhere safe and out of the way. Count Richard has beaten his own brother and made himself the first man in Burgundy doing it.

- **Note:** Boso's wife and children are held by others; the player has no contact with them.
- **Links:** Arc 7, momentum 55.

## Event 887-K1: Boso dies

- **Fires:** start of spring 887.
- **Channel and form:** Aldric, briefly.

> Boso is dead, my lord, down in Provence, still calling himself king over the scraps they left him. Eight years a king, and most of them spent losing. His son is a child. Count Richard says nothing about it that anyone can repeat.

- **Hook:** in 890 Richard supports that same child, his nephew Louis, as king of Provence: the family closes ranks again. Players with `boso_sympathy` are remembered kindly as the Bosonids return to favour.
- **Links:** Arc 7, momentum 85.

## Richard's rise, 888–898

Covered in the Arc 3 middle years (889–897): the Burgundy and Provence successions, Richard's marriage to Adelaide, the 892 plot against King Odo, sheltering Charles the Simple in 894, and the Sens campaign of 894–895.

## Event 898-K1: Marquis of Burgundy, and the slow squeeze

- **Fires:** start of autumn 898; the Courtenot assembly at the start of summer 901.
- **Channel and form:** Aldric; then a decision for count-rank players.

> (898) King Odo is dead and Richard has made his peace with Charles the Simple, and the king has let him join all his counties into one great march. Marquis of Burgundy, they're calling him. Autun, Auxerre, Nevers, Avallon, Sens, and his hand on Troyes, Chalon and Beaune besides.
>
> (901) He held an assembly at Courtenot, my lord, and judged a quarrel between the monks of Montiéramey and the count of Bar-sur-Seine. Judged it himself, as a king would. Nobody objected. That tells you where we are.

### For a count-rank player

For twenty years the player and Richard were equals, both royal officers holding from the king. That quietly stops being true. There is no battle and no oath demanded; there is a slow squeeze.

| Choice | Effect |
| --- | --- |
| Commend yourself to Richard | Security, his backing in disputes, a place at his councils; an independence of twenty years given up |
| Stay the king's man alone | Independence kept; isolation. Richard's goodwill is needed for everything, and he gives it slowly |
| Play the king against him | Appeal over Richard's head to Charles the Simple. Possible, since the king owes Richard nothing he can collect; risky, since the king is far away and Richard is not |

- **If the player is the Duke at Autun:** he is the one doing the squeezing, and these are the counts coming to him.
- **Links:** Arc 7, momentum 70.

## The Duke track: the player in Richard's place (879–911)

If the player took Autun at Duke rank before 879, he holds the county Boso would otherwise have had, and the whole Burgundian sequence becomes his. **Richard does not disappear.** Almost nothing he did depended on Autun: he is Boso's brother, born at Vienne, with family lands and standing in the Rhône valley, and his marriage, his nephew's throne and his kingmaking are all family and national politics. In this timeline he is the player's **standing rival**: a Bosonid magnate operating from the south and east while the player holds the north and west, competing for the same counties, abbeys and kings.

### Compulsory: what the job demands

These happen to whoever holds Autun. Refusing them is not an option a lord survives.

| Year | Beat |
| --- | --- |
| 879–880 | Boso's rising forces a choice, then a seizure: hold the county for the king against a rebel who is the region's own great man |
| 880–882 | The royal campaign against Boso: the Saône, Mâcon, Lyon, the siege of Vienne |
| 888 | Vikings sack Bèze and must be met (Saint-Florentin) |
| 898 | Vikings winter between Tonnerre and Montbard and must be driven out (Argenteuil-sur-Armançon) |
| 911 | Rollo's army attacks Auxerre; join the coalition at Chartres |

Every compulsory beat is defence. Nothing in the list builds a duchy.

### The opportunity menu: what builds a principality

Each was a choice Richard made, and each bought him a piece of what became the duchy. The player may take, skip or lose each one. **Anything the player does not take, Richard takes**, and Richard's standing grows accordingly.

| Year | Opportunity | What it buys | If Richard takes it instead |
| --- | --- | --- | --- |
| 888 | Back Rudolph as king of Upper Burgundy | A friendly kingdom on the eastern flank | Rudolph is Richard's ally, and the Jura frontier is not the player's to call on |
| 888 | Marry into that house (Adelaide, Rudolph's sister) | The alliance made permanent; an heir with royal kin | Richard marries her; his house gains the blood and the claim |
| 890 | Support Boso's son Louis as king of Provence | Provence as a client; the Bosonid feud closed | Richard's nephew owes Richard everything; the whole Rhône becomes his sphere |
| 892 | Join the plot to draw King Odo away so Charles the Simple can be crowned | A king who owes you his crown | The king owes Richard instead, and will rule in his favour for thirty years |
| 894 | Shelter Charles the Simple against East Frankish troops | Protector of the king: the strongest card in the west | Richard is the king's protector |
| 894–895 | Take Sens by force | A great city, the road north, and its abbey | Richard holds Sens and the northern approaches |
| 890s | Take the lay abbacies (Sainte-Colombe at Sens, Saint-Germain at Auxerre) | Church wealth and influence without taking orders | Richard's revenues and ecclesiastical weight grow |
| 898 | Have the king merge your counties into one march | The title: marquis, and a principality in law | Richard becomes marquis; the player remains a count among counts |
| 901 | Hold your own assembly and judge between other lords | Sovereignty in practice: the moment the duchy is born | Richard judges, and the region looks to him |

### Scoring the track

- **Most of the menu taken:** the player ends the game as the first duke of Burgundy, with Richard a defeated or subordinate rival.
- **About half:** a great count with a strong house, in a region split between two powers. The likeliest outcome, and the most interesting.
- **Few or none:** the player holds Autun and nothing more; Richard builds the duchy around him, and history arrives at its real destination by another road.

### Competing with Richard

Contested items are won by getting there first and by what the player can offer: troops, money, a daughter, a reputation. Richard's advantages are his brother's Rhône connections, his nephew the king of Provence, and forty years of patience. The player's are proximity to the north, whatever renown he has built since 825, and modern knowledge. Direct war between them is possible but rare; this is a contest of marriages, patronage, and arriving first.

# Arc 8: The kings run out (882–898)

Two boy kings die in two years, the west is left with a five-year-old Carolingian, the nobles invite an emperor in, and when he fails they elect a man who is not a Carolingian at all. The Viking half of these years is in Arc 3 (885-V1, 886-V1, 886-V2, 887-V1).

## Event 882-K2: Louis III dies

- **Fires:** start of autumn 882 (reports the August death), in the same delivery as the fall of Vienne.
- **Channel and form:** Aldric.

> And the other king is dead, my lord. Louis, the elder of the two brothers. Not in battle, not of a fever: he was riding at Saint-Denis, chasing after some girl for sport, laughing, and rode at a low doorway without ducking. Struck his head on the lintel. Nineteen years old. So our Carloman has the whole of it now, north and south, and he is eighteen.

- **Links:** Arc 8, momentum 80.

## Event 884-K1: Carloman dies

- **Fires:** start of winter 884–885 (reports the December death).
- **Channel and form:** Aldric; Ermenald for the funeral.

> (Aldric) My lord, our king is dead. Carloman, out hunting boar in the forest near Les Andelys, and the beast had him. Eighteen years old, my lord. Two brothers, two kings, dead in two years, neither of them in a war. There's talk it was no boar at all but a servant's blow that went wrong and the hunt was the story they agreed on. Whichever it was, the boy is dead.
>
> (Aldric, after) And now we count what's left of the old emperor's line in this kingdom. There's a child at Laon, Louis the Stammerer's youngest, born after his father died. Five years old. That is all. Five years old, with Northmen on every river.

- **Hooks:** the child is the future Charles the Simple (Arcs 3 and 7). A player who has been collecting royal favour has nobody left to collect it from; the great men now decide.
- **Links:** Arc 8, momentum 80.

## Event 885-K1: An emperor sent for

- **Fires:** start of summer 885 (reports the winter invitation).
- **Channel and form:** Aldric.

> My lord, the great men have sent for Charles the Fat to come and be king over us. The emperor, Louis of Bavaria's son, the one who holds Italy and the east. They would not have a child of five, so they have taken a grown man from another kingdom instead. Do you see what has happened? Charlemagne's whole empire is in one pair of hands again, for the first time in forty years, and nobody fought a battle for it. They simply ran out of kings and sent for one.

- **Hook:** leads directly to the Siege of Paris (885-V1) and the payment that destroys him (886-V2).
- **Links:** Arc 8, momentum 75.

## The open throne, 887–888

**The one moment in the game when the crown is decided by reputation alone.** Normally the throne comes only through the king quest chain (see Rank and renown). These two years are the exception: the Carolingian line in the west is reduced to a child, the emperor has disgraced himself, and in February 888 the great men elect a man who is not a Carolingian at all. Odo was chosen on the fame he won defending Paris, and nothing else.

**A player with high enough renown can be elected instead of Odo, with no quest triggered.** What the electors weigh:

| Factor | Why it counts |
| --- | --- |
| Renown at or near the King threshold | The whole basis of Odo's election was reputation in war |
| Fought at Paris (885–886), or objected to the payment | Odo's own claim; the player needs a comparable deed |
| Rank of Count or above | The electors are the great men; one of their own |
| Church backing (`favor_church`, `bishop_trust`, relics sheltered, abbeys endowed) | Bishops crown kings; Boso was elected by bishops in 879 |
| Support of a kingmaker (Richard, or Richard's allies if the player took the Duke track) | No one is elected without the regional magnates |
| Not tainted (`lothair_tainted`, `perjury_833`, `bribed_833`) | A man who sold his oath once is not trusted with a crown |

### If the player is elected

- Odo is not king. He remains count of Paris and marquis of Neustria: a formidable subject and a likely rival, with his brother Robert behind him.
- The civil war of 893–898 changes shape. The party that crowned Charles the Simple against Odo now moves against the player instead, and Richard's choice (backing the boy, or backing the player) becomes the decisive question of the late game.
- The player is about 79–81. A king at that age rules through captains, sons and advisors, and the succession question starts immediately.
- The game still ends with the player's death, around 910–911.

### If the player is not elected

Odo becomes king as in history (888-K2), and the throne is available only through the quest chain thereafter.

## Event 887-K2: The emperor deposed

- **Fires:** start of winter 887–888 (reports the November deposition).
- **Channel and form:** Aldric.

> My lord, the emperor is finished. His own nephew Arnulf came against him out of the east, and when it came to it not a man would fight for him. He gave it up without a battle and asked only to be allowed to live somewhere quietly. They say he is sick and failing. A year and a half ago he had everything Charlemagne had, and he bought off the Northmen with our country as the price, and now nobody will draw a sword for him.
>
> (Weeks later) He is dead. Six weeks, my lord, from emperor of the whole world to a corpse in a borrowed hall.

- **Hook:** the disgrace of the 886 payment (886-V2) is why no one fights for him. A player who objected then is remembered as having been right.
- **Links:** Arc 8, momentum 70.

## Event 888-K2: A king who is not a Carolingian

- **Fires:** start of spring 888 (reports the February election).
- **Channel and form:** Aldric; a live scene if the player is a candidate (see The open throne).
- **Note:** if the player was elected, use the player-king variant below instead.

> My lord, they have made Odo king. Count Odo of Paris, who held the city against the Northmen while the emperor dithered on the hill. Not a Carolingian. Not a drop of Charlemagne in him. The great men met and chose the man who had actually fought, and the bishops crowned him.
>
> And it is not only here. There is a king in the east, a king in Italy, a king in Upper Burgundy, a king in Provence, and every one of them put up by the men of his own country. The empire is gone, my lord. Not divided this time. Gone. What's left is kingdoms, and kingdoms go to whoever the great men will follow.

### Player-king variant

> They have made you king, my lord. The great men met and chose you, and the bishops have crowned you. Odo of Paris is not king; he has gone back to Paris with his brother and his grievance, and he is not a man who forgets. I would not sleep easy, my lord. But I would not trade places with anyone in Francia tonight either.

- **Hooks:** `king_888` or `odo_king`. Richard, the player's own count, is one of the great men whose support decides it; a player on the Duke track may be deciding it himself.
- **Links:** Arc 8, keystone K8, momentum 80.

## Event 893-K1: A second king crowned

- **Fires:** start of spring 893 (reports the January coronation).
- **Channel and form:** Aldric; a summons follows.

> My lord, there are two kings in this kingdom now. A party of the great men have taken Louis the Stammerer's boy, Charles, the one who was five when Carloman died, and had him crowned at Reims. He is fourteen. They say Odo is a usurper and the blood of Charlemagne should rule. Count Richard is in it up to his neck; he was part of the business last year that drew Odo away south so they could do it. So we may be asked to choose between a king who earned his crown and a boy who was born to one.

### For the player

| Standing | What happens |
| --- | --- |
| Richard's vassal | Follows Richard: for Charles the Simple. Campaigning and escort duty rather than great battles |
| Count or above | Courted by both sides. Backing Charles follows the region; backing Odo is defensible and isolating |
| Player-king (`king_888`) | The faction that historically crowned Charles against Odo now moves against the player instead. Richard's choice decides the late game: backing the player, or backing the boy. This is the central question of the player-king path |

- **Links:** Arc 8, momentum 60.

## Event 897-K1: The kings come to terms

- **Fires:** start of winter 897–898 for the reconciliation; Odo's death at the start of spring 898.
- **Channel and form:** Aldric.

> (Winter) They have made peace, my lord. Odo has acknowledged the boy as his heir and given him land in the north to hold meanwhile. Five years of two kings and it ends in an agreement between tired men.
>
> (Spring) And now Odo is dead, the first of January, and young Charles has the whole of it without another blow struck. He is nineteen. Count Richard has made his peace with him, and the king has let him put all his counties into one march. We shall see what sort of king the boy makes.

### Player-king variant

> (Winter) Terms, my lord. The boy's party will have him named your heir, or they will not stop. (Spring) The boy is the only Carolingian left standing, and you are not young. Whatever is settled now is what outlives you.

- **Hooks:** leads to 898-K1 (Richard as marquis and the slow squeeze) and Arc 3's 898 Viking battle. A player-king faces the succession question directly.
- **Links:** Arc 8, momentum 70.

# Arc 9: Saracens, Magyars, and far horizons

Almost all news. One item, Fraxinetum, is a standing hazard that touches the player's own trade and travel. Deliver these in seasons that are otherwise quiet.

## Saracen news

| Fires | Channel | Report |
| --- | --- | --- |
| c. 838–842 | Aldric | Raiders out of the sea have burned around Marseille and Arles again. The Rhône trade suffers; southern goods are dearer this year |
| Start of autumn 846 | **Ermenald** | "My lord, they have sacked Rome. Not the city within the walls, but the churches outside it, and Saint Peter's among them. They stripped the altar over the apostle's own grave. I have no words for it. The emperor Lothair is building a wall around it now, they say, which is a fine thing to do afterwards." |
| Start of winter 869–870 | Aldric | The archbishop of Arles was taken by raiders in the Camargue and died waiting for his ransom to be gathered. A great man of the church, and nobody could reach him in time |

## Event 887-S1: Fraxinetum (standing hazard)

- **Fires:** start of summer 887 or thereabouts; the hazard then persists for the rest of the game.
- **Channel and form:** Aldric, then an ongoing condition.

> My lord, a band of Saracens has fortified itself at a place called Fraxinetum, on the coast in Provence, in the hills above the sea. Not a raid this time: a fortress, held and garrisoned. They are already taking travellers on the roads and in the passes. Anyone of ours going south to Lyon, or over the Alps to Rome, had best go in company and armed.

### Ongoing effect

| Affects | Effect |
| --- | --- |
| Travel to Italy or Rome (pilgrimage, the 875-style journey) | Risk of capture and ransom; escorts cost more |
| Trade down the Saône–Rhône corridor | Southern goods dearer; some seasons nothing comes through |
| Pilgrims and churchmen | Ransom demands reach Ermenald; the player may be asked to contribute |
| A player with men to spare | Escorting merchants or pilgrims through the passes: small renown, real risk |

- **Note:** Fraxinetum was not cleared until the 970s, long after the game ends.
- **Links:** Arc 9, momentum 65.

## Magyar news

These foreshadow the threat that storms Chalon-sur-Saône in 937, a generation after the game ends.

| Fires | Report |
| --- | --- |
| Start of autumn 862 | A strange new name in travellers' tales: horsemen out of the east, called Hungarians, raiding the eastern Frankish lands. Nobody here knows anything about them |
| Start of winter 899–900 | They have come into Italy in force and beaten the Italians badly. They fight all from horseback, with bows, and will not close |
| Start of autumn 907 | A Bavarian army destroyed at Pressburg: the duke dead, bishops dead, the whole host gone |
| Start of autumn 910 | And now the east Franks beaten too, near Augsburg. They are not going to stop at the Rhine, my lord. Not in your lifetime, perhaps. But not never |

## Far horizons

Rumour and traders' talk, for flavour and for a learned player to chew on.

| Fires | Channel | Report |
| --- | --- | --- |
| Start of summer 863 | **Ermenald** | Two Greek brothers have gone to preach to the Slavs in their own tongue, and have made letters for a language that never had any. The Germans are furious about it |
| 858–867 | **Ermenald** | The pope and the patriarch at Constantinople have excommunicated one another. Two halves of the Church calling each other heretics |
| 865–878 | Aldric | A great heathen army has conquered most of England. One king left, in the marshes, and then word that he has beaten them at a place called Edington and the Danish king has been baptised |
| 875–884 | Aldric | Silk is dear and scarce this year. The merchants say there is a great rebellion at the far end of the world, where silk comes from, and the roads are shut |

- **Hook:** a learned player may know more about any of these than the men telling him. Saying so is a chance for prestige, or for suspicion (see the sky-event framings in 840-01).
- **Links:** Arc 9, momentum 80–95.

# Church, councils and scholars

Ermenald's own arc. He is a parish chaplain with a good education and nobody to talk to about it, and the player is a man from the future who can actually follow him. These entries are where he lights up. Deliver them in quiet seasons; most carry no decision, only the chance to engage him, which is how `chaplain_trust` is built.

**How to play him:** enthusiastic, slightly starved of conversation, and always a little nervous that his enthusiasm is unbecoming in a priest. He hedges a bold thought with "though I am no great theologian, my lord": he is a working parish priest, not a cathedral scholar, and unusually well-read for his post, which is why he has nobody to discuss any of it with. When the player knows more than he does, he is delighted rather than threatened, unless the player is dismissive of the faith itself.

## Agobard of Lyon (816–840)

- **Fires:** any quiet season in the 830s; best before his fall in 835 (835-01).

> My lord, I have been reading the archbishop of Lyon. He has written against the people who believe men can call down hail and sell storms, and against ordeals, trial by water and hot iron, as a way of finding the truth of a case. He says God is not to be summoned as a witness at our convenience, and that a thing is not proved because a man's hand blisters. I confess I find him persuasive and I am not certain I should.

- **Hook:** the natural ally for a player who argues from evidence. A player who agrees warmly sets `chaplain_curious`; one who presses too hard on miracles generally sets `chaplain_suspicious`. Agobard is deposed in 835 for backing Lothair, which complicates any friendship (see 835-01).

## Einhard's Life of Charlemagne (c. 830)

- **Fires:** any quiet season around 830–836.

> There is a book going round, my lord, written by a man who actually knew the great emperor. His height, his swimming, his bad Latin handwriting, the way he could not bear his daughters to marry. It reads as though you were in the room. Nobody has written about a living man like that since the ancients.

- **Hook:** the measuring-stick for every ruler in the game. A player who wants to be remembered may take an interest in who writes about him.

## Lupus of Ferrières (840–862)

- **Fires:** any quiet season in the 840s–850s.

> The abbot of Ferrières is hunting books again, my lord. He writes to everyone, bishops, abbots, the king, asking to borrow old texts so he can have them copied before the last copy rots. Cicero, Livy, Caesar's wars. He says a library is the only wall that keeps the past from being lost. He is not far from here, as these things go.

- **Hook:** a correspondent, and the best route for anything the player wants written down and spread. Lending, borrowing or endowing copies builds `favor_church` and a scholarly reputation. A player with modern knowledge has an obvious use for a man whose life's work is copying and circulating texts.

## Dhuoda's handbook (841–843)

- **Fires:** start of any season in 843–844; strongest for players tied to Bernard of Septimania.

> My lord, the lady Dhuoda, Duke Bernard's wife, has written a book for her son William, the boy who was sent to the king's court as a pledge. A mother's instruction, since she cannot speak to him. How to serve his lord, how to pray, how to be a man worth something. She writes that she is writing it because she may never see him again.

- **Hook:** for players with `oath_kept_lord` or `favor_septimania`, this lands hard, especially alongside Bernard's execution in 844 (844-01).

## Nithard's history (c. 843)

- **Fires:** any quiet season in 843–845.

> There is an account going round of the war between the brothers, my lord, written by a man who fought in it, Count Nithard, Charlemagne's own grandson by his daughter. He does not spare anyone, not even the king he served. He writes that the men of his generation have made a ruin of what their fathers built.

- **Hook:** a player who was at Fontenoy may appear in it, or may want to. Nithard is a natural recipient for a player's own account of events.

## The predestination quarrel (848–860)

- **Fires:** any season in the 850s.

> My lord, there is a monk called Gottschalk who teaches that God has settled from before the world began who will be saved and who damned, and that nothing a man does will change it. They have condemned him, flogged him and shut him up in a monastery, and still the bishops are writing books at each other about it. Archbishop Hincmar against the church of Lyon, Lyon against Hincmar. I will say this quietly, my lord: the question is not a stupid one.

- **Hook:** dangerous ground. A player who engages thoughtfully builds `chaplain_trust`; one who talks loosely about fate or free will in front of the wrong people risks `church_suspicion`. Note Lyon is the player's own archbishopric.

## John Scottus Eriugena (c. 845–877)

- **Fires:** any quiet season in the 850s–870s.

> There is an Irishman at the king's court, my lord, who reads Greek. Actual Greek, not a word or two for show. He is translating the Greek fathers and writing philosophy of his own, and half the bishops think it is heresy and cannot follow it well enough to prove it. They say the king keeps him for the pleasure of the argument.

- **Hook:** the most original mind in the kingdom and the best possible audience for genuinely new ideas. Reaching him requires court access (a royal vassal, the Rome journey, or a patron). A player who impresses him gains a formidable intellectual ally and a reputation that cuts both ways.

## The king who wanted a divorce (857–869)

- **Fires:** any season in the 860s.

> Twelve years, my lord, and it is still not settled. King Lothair wants rid of his queen so he can marry the woman who has borne him sons, and he has had bishops declare it lawful and the pope declare it unlawful, and councils, and accusations against the poor woman that I will not repeat. Rome has made itself the judge of a king's marriage bed. That is new, and I am not sure where it ends.

- **Hook:** directly relevant to any player contemplating marriage, annulment or an heir by someone other than his wife. The church's reach into private arrangements is growing.

## The school at Auxerre (c. 860–908)

- **Fires:** any quiet season from the 860s.

> The school at Saint-Germain in Auxerre is becoming something remarkable, my lord. Heiric now, and his pupils after him. They are teaching the old authors properly, grammar and reckoning and the stars. Ninety miles from your gate. If there were a boy in this household worth educating, that is where he should go.

- **Hook:** schooling for a son, a ward, or a promising servant; a place to send ideas so they survive the player; a source of literate men for the household.

## Event 910-E1: Cluny

- **Fires:** start of autumn 910 (the foundation charter is September 910).
- **Channel and form:** Ermenald, at the very end of the player's life.

> My lord, Duke William of Aquitaine has founded an abbey at Cluny, in the Mâconnais. Seventy-five miles, no more. And he has done something I have never heard of: he has given it away entirely. Not to a bishop, not to his own heirs, not to the king. The charter says the monks shall elect their own abbot for ever and answer to no one but Rome, and that his own family may never take it back. He is the grandson of Duke Bernard, my lord. The same family whose man you were, all those years ago.
>
> I do not know what will come of it. But a house that no lord can touch, choosing its own abbots, answering only to the apostle's seat… if that takes root, it will change everything about how the Church sits in the world.

- **Hooks:** the last church event of the game, and the one with the longest shadow. A player with `favor_church`, `tournus_friend` or Septimanian ties may be invited as a witness or benefactor: a final chance to put his name on something that will outlast him by centuries.
- **Links:** Church, momentum 70.

# Coinage and economy

## The Viking tributes: what the player owes

Two kingdom-wide levies fall on Burgundy: 866 (4,000 pounds of silver) and 877 (5,000 pounds, raised from Francia and Burgundy alone). Both are collected through whoever holds jurisdiction: count, bishop, abbot or royal vassal.

### The player's personal share, by rank

In 866 the lord's own contribution is the *heribannum*, the army fine, graded by what he is worth; in 877 it is a flat charge on his demesne farm plus the rent he loses from his tenants' holdings. Suggested figures:

| Rank | 866: personal share | 877: personal share |
| --- | --- | --- |
| Villa lord (10 manses) | 10 solidi (120 d) | 1 solidus (12 d) from the demesne farm, plus rent lost below |
| Viscount | 20 solidi (240 d) | 2 solidi, plus rent lost |
| Count | 40 solidi (480 d) | 1 solidus per demesne farm across his lands |
| Duke | 3 pounds (720 d), the maximum | As a count, across more lands |

### The per-manse rates

| Holding | 866 | 877 |
| --- | --- | --- |
| Free manse (*mansus ingenuilis*) | 6 d, then 1 d more in the second round = **7 d** | **8 d**: 4 from the tenant, 4 taken from the lord's rent |
| Servile manse (*mansus servilis*) | 3 d, then 1 d more = **4 d** | **4 d**: 2 from the tenant, 2 from the lord's rent |
| Smaller holdings (*accolae*, *hospitia*) | 1 d and ½ d | Exempt |
| Merchants | A tenth of their goods | A levy on traders |
| Priests | According to means | 4 d to 5 solidi |

**For Fontenay's 10 manses** (say 6 free, 4 servile): 866 gives 42 + 16 = **58 d** collected from below, plus the player's own 120 d. In 877 the tenants pay 24 + 8 = 32 d and the player loses 24 + 8 = **32 d of rent**, plus 12 d from his demesne: the burden has shifted upward onto men like him.

### Event E-866: The ransom of the kingdom

- **Fires:** start of autumn 866.
- **Channel and form:** Aldric, laying out the problem and the options.

> My lord, the king has agreed to pay the Northmen four thousand pounds of silver to leave the kingdom, and the whole realm is to find it. Here is how it falls on us.
>
> You yourself are assessed at the army fine, by what you are worth: \[amount\]. That is the heavy part, and it must be in coin.
>
> Then every holding on your land pays: sixpence from each free manse, threepence from the servile, and word is there will be a second round of a penny more from every one of them before they have enough. That is \[amount\] from our people altogether.
>
> And that is my worry, my lord. Fourpence is a piglet, or a pair of geese; most families can find it in an ordinary year. But they find it by carrying something to market, and this autumn every household between here and Chalon will be carrying the same eggs and cheeses and piglets to the same market in the same fortnight. Prices will be on the floor. Some will sell the breeding sow. Some will sell the seed corn, and we will both regret that in the spring.

### The player's options

| Choice | Cost | Effect |
| --- | --- | --- |
| Collect strictly in coin, on time | None to the player | The silver is raised; loyalty falls; in a bad year families may be ruined and manses fall vacant |
| Accept payment in kind at a fair valuation, convert it yourself | The player carries the market risk and waits for a better price | Loyalty rises; he probably comes out even or ahead |
| Pay the tenants' share yourself and collect it back in kind later | The cash outlay now | Loyalty rises sharply; remembered for years |
| Advance it as a loan | The cash outlay, returned with increase | Leverage over tenants and neighbours; the church disapproves of interest |
| Buy up what desperate neighbours are selling | Cash | Land and livestock cheap; resentment |

- **If the player is a count or royal vassal:** he is the collector for his whole jurisdiction. He can collect honestly, collect harshly and keep the difference (profitable; risks the king's inspectors and a reputation), or make up the shortfall himself to spare his people (expensive; buys lasting loyalty across the county).
- **Where the silver comes from:** the levy is assessed per **recorded** manse, so an improved villa pays no more than a poor one but can actually produce coin on short notice. A player with stored silver pays easily while neighbours sell land. Churches melt plate; lending to a desperate abbey or neighbour buys leverage.
- **The argument:** churchmen call the tributes a disgrace and blame the lords for failing to defend the kingdom by arms. Ermenald is bitter about it. A player with `viking_aware` has been saying for twenty years that paying invites more; this is his evidence. Taking a public position earns standing with one faction or the other.
- **Links:** Economy, Arc 3, momentum 80.

### Event E-877: The second ransom

- **Fires:** start of winter 877–878 (the levy follows Charles the Bald's death; the arrangements were made at Compiègne).
- **Channel and form:** Aldric, shorter: the player has been through this before.

> Again, my lord. Five thousand pounds this time, and only Francia and Burgundy are to find it; the Neustrians are paying off their own Northmen on the Loire and Lothair's old country is let off entirely. They have learned something since last time, though. The small people pay less: fourpence from a free holding, twopence from a servile. The rest comes from the rent, which is to say from us. A shilling from your own farm besides, and the priests are assessed as well.
>
> Less grief in the villages this time, my lord. More out of your purse.

- **Note:** the 877 structure deliberately shifted the burden from tenants to lords. A player who complains about this is complaining about a fairer tax.
- **Options:** as 866, but the tenant-relief choices matter less and the player's own outlay matters more.
- **Links:** Economy, Arc 3, momentum 80.

## Minting drifts local (888 onward)

The coin never changes: it is still the silver denarius, still reckoned in solidi and pounds. What changes is whose name is on it. Keep this light. For most players it is Aldric's flavour; for a count or duke it is a business to acquire, like a mill.

### Aldric's notes

| Fires | Report |
| --- | --- |
| Any season, 870s | The king has let a dozen new mints open since the recoinage, my lord. They needed the silver turned into pennies faster than ten towns could do it, what with the Northmen to pay |
| Any season, 890s | There's a moneychanger set up at the Autun market now, my lord, weighing coin and taking his cut. Pennies from across the Saône go light here, and ours go light there. Same silver, different names on it |
| Any season, 900s | Half the pennies in the district have a bishop's name on them now, or a count's. Nobody minds much. A penny is a penny if the weight is right, and a near lord stands behind it better than a far king |

### For a count or duke: the mint

- **How it earns:** the mint keeps a cut of every pound of silver turned into coin. Treat it as an improvement like a mill: a fixed cost to establish, then steady income, scaled to how much silver passes through the district.
- **What it signals:** more than the money. A coin with your name on it is a public statement about who actually rules here.

| Route | How | Risk |
| --- | --- | --- |
| Granted by the king | Ask, with service or silver behind the request. Easiest under a weak or indebted king (Odo, Charles the Simple), or for a player whose support the king needs | None, once granted. Takes time and favour |
| Taken without permission | Simply strike coin. Many did after 888; with several kings at once and none with much reach, nobody is watching closely | Low in practice, but it is a usurpation of a royal right. A strong king, or a stronger neighbour, can use it against the player later. If Richard holds the region and the player does not, expect him to object |
| Through a bishop or abbey | Back a church house's petition for the right, and share the profit | Safe, slower, and the church keeps the prestige |

> (Aldric, to a count-rank player, 890s) My lord, I'll say what others are thinking. Half the counts between here and the sea are striking their own pennies now, some by the king's leave and some by nobody's. We have the silver passing through, we have the market, and Chalon has had a mint since the old king's edict. It would pay well. And there is no one left in this kingdom with the strength to tell you no.

- **Links:** Economy, momentum 80.

# The end of the game

## Event 911-F1: Chartres

- **Fires:** start of autumn 911 (the battle is in July).
- **Channel and form:** Aldric. News, not a finale: the player is about 102 and sends men at most.

> My lord, the Northmen are beaten at Chartres. Rollo had the city under siege and our lords came down on him, the marquis and the bishop of Auxerre and the men of Neustria and Poitou together, and broke him. And now the king has made terms: Rollo is to have the land about Rouen and be baptised, and hold it of the king like any other lord. After seventy years of it, my lord. They are to be given a country and made Christians, and that is how it ends.

- **Links:** Arc 3, momentum 60.

## Death of old age

The player dies around 910–911, aged about 102. The game ends; there is no playable heir.

### The closing pop-up

A single screen: the death, then a summary of the life. Written fresh each time by the LLM from the player's actual record, not from a template. Target length: one short paragraph of death, then three or four of summary.

**The death itself.** Old age, in bed, at Fontenay, in whatever season play ends. A man of 102 in this period is a wonder in his own right: he was born before Charlemagne's empire broke apart and has outlived every king, count and chaplain in his story. Whoever is left of the household, Ermenald's successor, a grandson, an old captain, remarks that the lord of Fontenay remembered the emperor Louis, and nobody else living does.

**The summary draws on the record.** The LLM should assemble from whatever the player actually accumulated:

| Thread | What to draw on |
| --- | --- |
| Station | Starting rank and final rank; whether he ever held Autun, a county, a march, or a crown |
| Land | Manses at the end versus 10 at the start; owned outright versus held in benefice; mills, vines, granaries, any second villa |
| War | Which battles he fought and at what level; Fontenoy, Chalon, Ballon, Jengland, Vienne, the Viking fights of 888 and 898; whom he saved (Robert the Strong, Gaucelm and Gerberga, Adalard, Bernard) |
| Loyalty | The great choices: 830, 833, 840, 864, 880. Oaths kept and broken, and what each cost |
| The land itself | Famines survived and how; manses resettled; refugees taken in; whether his people ate in 873 and 895 |
| Knowledge | What he introduced and what became of it: crop rotation, drainage, the trebuchet, clean water, anything else, and whether it spread beyond his lands or died with him |
| The Church | Relics sheltered, abbeys endowed, Cluny, his standing with Ermenald and the bishops |
| People | Marriage, children, heirs, the household; who is standing at the bedside |
| What outlived him | The state of Burgundy, who rules it, whether a duchy exists and whose, what the player's name is attached to |

**Tone:** a chronicle entry rather than a scoreboard. No numbers on screen. The voice is whoever is left to say it, looking back at a life that covered the whole collapse of Charlemagne's empire from one villa in the Morvan.

**If the player died earlier** (in battle, of illness, of a wound), the same screen, adjusted: the death as it happened, and the summary of however much life there was.

# Royal vassal duties (quiet years)

Applies to a player with `royal_vassal` (from 834-02 or 835-02), in seasons with no campaign or major event. Roll once a season; most results cost a little time and hospitality, a few cost real money or men. The point is that the honour has a price, and that the king's service reaches into ordinary years.

| Roll | Duty | Cost |
| --- | --- | --- |
| 1 | **Nothing this season.** Aldric mentions a rumour that the king is coming south, and he isn't | None |
| 2 | **The king's inspectors.** The *missi dominici* tour the county, hearing complaints and checking that the king's orders are kept. They lodge with you | Hospitality for a week; a visibility check (see Land and value system) |
| 3 | **Assembly.** Attend the king's assembly, several weeks' ride away | A season's travel; the player is away from the villa. News and contacts in return |
| 4 | **Escort.** Guide and guard a royal party, a bishop, an envoy, a bride, across the county | A few men for a few weeks; small renown |
| 5 | **Messages.** Carry the king's word to another county, or house his messengers | Days, and horses |
| 6 | **Judgment.** Sit with the count to hear a case: a boundary, a theft, a disputed inheritance | Time, and whichever party loses remembers it |
| 7 | **The court comes to you.** The king's household is moving through the region and must be fed and lodged | Grain, livestock, cartage: a real bite, worse in a bad year. **Moderate renown** (25–50), scaled by how well he hosts; see below |
| 8 | **Horses.** The king's men are buying remounts and you are expected to sell well below the market | Two or three good horses, at a loss |
| 9 | **A guest.** A royal ward, hostage or disgraced nobleman is to be lodged with you for a season or more | Upkeep, and responsibility for him. He may be worth knowing |
| 10 | **Oath renewal.** The king requires his vassals to swear again, in person | A season's travel; refusing is unthinkable |

**If the player is away** on any of these, the villa is run by Aldric and Ermenald, as in the Rome journey (875-C1).

**Flavour, for seasons with no roll:** Aldric speculating about where the court is this year, who has the king's ear, which counts have fallen out, and whether the summons that didn't come this spring will come next.

### Hosting the court (result 7)

One of the main ways a lord got himself noticed. The king and his great men eat at your table, see your estate and learn your name; men spent fortunes on this deliberately.

| How he hosts | Cost | Renown |
| --- | --- | --- |
| Meanly, while visibly prosperous | Low | **Loss** (5–15); he is marked as grasping |
| Adequately | The standard bite | 25 |
| Lavishly: good wine, fresh meat, proper lodging, entertainment | Double or more | 50, and a chance to put a request directly to the king (a charter, a mint, a vacant county) |

A player sitting just below a rank threshold can be pushed over it here, and that is exactly the man who gets tapped when the next county falls vacant: the king can picture his face.

**Compensation:** the status is not all cost. A royal vassal is heard at court, can petition the king directly, and is remembered at promotion windows. Each duty discharged well adds a little to royal favour; each one shirked subtracts more.

# The king's escalation ladder

When the player grows dangerous, the king works down this list. A warning comes first, then three moves, each tried only if the ones above it are blocked, and what blocks them is the player's own strength. The ladder is the opening of the king quest: by the time the king reaches the bottom rung, both men know where it is going.

## The warning: how they talk about you now

**Not a move by the king: a warning sign the player picks up.** Aldric reports how the player is being spoken of at court. Not accusations, nothing actionable, just that his name comes up often now and the tone has changed. Men who have never met him know how many manses he holds. Someone asked, apparently in passing, how many men he could put in the field.

> My lord, I had it from a clerk who was at court this winter, and I did not much like the way he put it. Your name comes up. Not with anything against it, mind, only… often. And he said a man asked him, quite idly, how many men you could raise if you were minded to. Nobody asks that idly, my lord.

- **This is the quest trigger**, fired when renown and holdings pass a threshold. What follows are the king's actual moves.
- **The player's counter:** send gifts, go and be seen, be conspicuously useful, or let it ride and accept what comes.

## 1. Strip the offices

- **Triggered when:** the player's own people are less than solidly behind him (below about half on tenant loyalty). A lord whose district would rise for him is not safe to strip; one whose district shrugs is.
- **How:** a summons to court to answer charges, and judgment at an assembly. Counties are royal appointments and can be taken back.
- **The summons is the real decision:** going means he can be arrested or made to submit publicly; refusing makes the player a rebel by his own choice, and uncommitted allies drift away.
- **Effect: a demotion, not a ruin.** The king takes *some* of the player's honours, to humble him without creating a desperate enemy. He drops a rank or two (Duke to Viscount, say), and renown falls **because** of the loss: a man without a county commands less. He keeps his own land and his household, and climbs back by the game's ordinary loop. A second application takes another rank. The king does not strip a man to nothing; that makes an enemy with nothing to lose. Disgrace was normally followed by reconciliation: Bernard of Septimania lost everything twice and held three counties again by 835.
- **Blocked if:** his people would make it ugly. Then the king goes to step 3.

## 2. Excommunication

- **Note:** the king cannot excommunicate anyone. Only bishops can, and the pope above them. What he does is find bishops willing to do it.
- **What it actually does: it takes his people, not his land.** The player keeps everything and none of it works. Vassals are released from their oaths and drift; levies do not answer; the bishop will not hear his cases; neighbours encroach freely; his peasants are told their lord stands outside the Church. And he cannot be crowned, which blocks the ending outright.

**Getting absolved.** Expensive and slow, never impossible, and there is no time limit: the player is a pariah for as long as it takes.

| Route | Cost |
| --- | --- |
| Donation in coin | A large sum, scaled to what he holds |
| Sell or mortgage land | The usual recourse; he returns absolved and smaller |
| Give land to the church outright | The commonest transaction of the period. He may take it back as a *precaria*, holding for life what he no longer owns (see 830-02) |
| Pilgrimage | Expensive, slow, and it counts |
| Public penance | Cheapest in money, dearest in pride. Barefoot before the bishop if he is feeling theatrical; Louis the Pious did it in 833. Reduces the monetary price |

**Floor:** a player with nothing left ends as a minor noble with a villa and a grudge, which is where the game began and is still entirely playable. No game over.

| Player's church standing | What the king must do | Speed and traces |
| --- | --- | --- |
| Very low | Local bishops are willing | Fast and clean |
| Middling | He must buy them | Slow; leaves traces; a bought sentence is contestable, and simony is a charge that cuts both ways |
| High (the player is his bishop's patron) | He must go over their heads to a hostile archbishop or to Rome, against the player's own bishops arguing his case | Too slow to be useful. **Blocked** |

- **The player's counter:** decades of church patronage, which is what makes this rung unusable.

## 3. The road

**What is left when the lawful tools are blocked.** The player's people are loyal and his bishops are his own, so nothing lawful will serve. So the king reaches for a man inside the player's own household.

- **How:** one of the player's vassals is approached, with money, land, or his own grievance worked on. An ambush on a journey, by men who can be disowned, dressed as bandits or another lord's retainers. Travel is dangerous anyway, which is the point.
- **Alternatives of the same kind:** treachery at a meeting under safe-conduct; arrest at a parley.
- **Outcome:** the attempt fails (this is the quest's inciting incident, not its end). The player survives, and the evidence points at the king without proving anything: a captured attacker who names a dead man, coin too new and too northern, a vassal who cannot be found. Aldric says it plainly so nobody misses it: "This wouldn't stand up before any court in the kingdom, my lord. It was the emperor. We both know it."
- **"Not enough to prosecute, but enough to know."** Everyone suspects. Nobody can prove it. The player now knows the king wants him dead, and the king knows he knows.
- **The player's counter afterwards:** hunt the traitor among his own men; say nothing and prepare; or make it public and force the quarrel into the open.

## After the road

# The king quest

Triggered by the escalation ladder above. The player may leave it at two points by submitting; otherwise it runs to a battle and an election.

## Submission: the way out

The commonest end to a quarrel with a king, and no shame in it. Bernard of Septimania came to Thionville and spoke to the emperor in person; Warin surrendered at Chalon and swore to Lothair to save his life.

| When | What it looks like | Cost |
| --- | --- | --- |
| After the warning | Go to court, be conspicuously loyal, give gifts. The matter dies and the king stops escalating | Small renown loss: he has shown he can be managed |
| After the attempt on his life | He goes to the court of a man who tried to kill him and submits anyway, while the whole court watches and knows | Larger renown loss. Buys years; a publicly reconciled king cannot easily try again |

Submission is not permanent (see Trying again).

## Gathering support

Nine nobles, one per motive. The king begins with **three** sworn to him and gains everyone the player fails to win, so **six of nine is parity**. One of the six betrays the player at the battle, so a careful man wants seven.

| Motive | What he wants |
| --- | --- |
| Grievance | Nothing. The king wronged him and he cannot be bought back. The most reliable ally in the game |
| Money | Silver. Can be outbid by the king, which is a mid-quest crisis |
| Land | A promise of estates when the player is crowned |
| Office | Chancellor, marshal, a bishopric: cheaper than land, paid after winning |
| Marriage | A match into the player's house. Needs an unmarried player or a child |
| Debt owed | Nothing: he is repaying. Famine relief, a ransom paid, a lawsuit backed, a son placed at Auxerre. The audit of sixty years of small kindnesses |
| Fear of the alternative | Reassurance. He does not love the player; he thinks the king is worse, or fears a disputed succession more |
| Protection | A man who will actually fight. Strong pitch from a player who made his name against Northmen |
| Divine favour | Nothing but the appearance of blessing. Church standing, relics, abbeys, surviving what killed others |

**Dual motives:** where a man has two (grievance *and* money), he already wants the king gone and needs paying to act. Where it is marriage or protection, default to marriage.

### How it plays

Aldric briefs, but he is a steward, not a spymaster. He speaks with confidence about four or five; for the rest he does not know, and someone must go and ask.

| Envoy | Sent to |
| --- | --- |
| Ermenald | Bishops and abbots. His element |
| Aldric | Other stewards: how most real business was done |
| The player in person | Anyone whose price is marriage or respect. Sending an envoy to discuss a marriage is an insult |
| A craftsman | Where the price is a mill, an engine, or a gun |

Each approach costs a season. Each named ally brings his own followers, so nine conversations become forty or fifty men at the assembly; the rest of the kingdom is narrated, not scened.

**Expect:** six won, one refusing outright as the king's man, one hedging until after the battle, one accepting warmly and betraying the player at the field.

## The battle

- **Everything the player ever taught or demonstrated is in the field on both sides.** See the Technology Diffusion Rules: anything given to an ally or used publicly has spread. A player who spent eighty years improving Francia fights men armed with his own ideas. This is the intended shape of the ending.
- **The betrayer turns here**, taking his contingent with him: parity becomes a deficit at the worst moment.
- **Winning does not make him king.** It makes him impossible to remove, which is what forces the assembly.
- **Do not kill the king.** Carolingian blood was sacred enough that even Boso's enemies spared him and Charles the Fat was deposed rather than executed. A player who kills an anointed king carries it for the rest of the game. Capture, forced abdication or flight are cleaner.

## The election and the crown

The battle proves he cannot be beaten; the **election** makes him legitimate, and the **bishops** make him king. The supporters he won are the electors.

- **Not a formality**, even with the field his and the old king's men fleeing. Rivals need not beat him to deny him: they can stall, propose a Carolingian child, or simply not attend. An assembly without a quorum elects nobody.
- **The magnates' counter-offer:** everything but the crown. A regency, or a duchy over enlarged territory, in exchange for putting a Carolingian child on the throne. A genuinely interesting failure, and what usually happened.

### Getting crowned

| Route | Requires | Cost |
| --- | --- | --- |
| Earned | Decades of church patronage | None. They crown him willingly |
| Bought | Gifts and privileges | Works, and sets a taint: simony is a charge his enemies use for the rest of his reign, and the pope can make trouble |
| Coerced | Troops at the door | Works now; the Church is an enemy for the rest of a reign that, at eighty-plus, is short anyway |

**The claim.** Boso had an imperial marriage; Odo had the defence of Paris. The player must be able to point at something: the man who saved Burgundy from the Northmen, who fed the kingdom in the famine, who married into Carolingian blood. The renown threshold is the mechanical version; the quest should make him say it aloud.

## Trying again

A player who submitted may try again years later, under a different king. The court has turned over; the archetypes persist but the men do not, and some are the sons of the first set. Allies he won and then abandoned by submitting now have grievances of their own.

**It is much harder, and it should be.** The second run is not a rising star being noticed; it is a known problem. There is no rumour phase and no ambush: the king will not reach for a tool that failed against a man who is expecting it, and the lawful routes are closed because the player is stronger now. Instead the king **encircles** him, granting land and offices to his neighbours and backing his local rivals. The player initiates this time.

| Motive | Second attempt |
| --- | --- |
| Marriage | **Closed.** Nobody weds a daughter to a failed contender |
| Fear of the alternative | **Closed.** He *is* the alternative people fear |
| Divine favour | **Closed or inverted.** God evidently did not favour him the first time |
| Debt owed | Thin: some was spent last time |
| Grievance, money, land, office, protection | Open, and now the bulk of his support |

That leaves a coalition of mercenaries and malcontents against a king who has had years to prepare: precisely what Bernard of Septimania had in 843. He was executed in May 844. A player who wins anyway has earned it.

From here the quest proper begins: gathering supporters (money, marriage, land, favours, and the bishops), the battle that proves the player cannot be beaten, and the assembly that elects and crowns him. The ladder is what makes the war legitimate in the eyes of the great men: the king tried to have him murdered, and failed.

## Entry template

Copy this for each new event.

```markdown
## Event YYYY-NN: Title

- **Fires:** season and year, and what must already have happened
- **Channel and form:** Aldric or Ermenald; spoken, note, or letter
- **Source and slant:** who told the NPC; whose side that favors; any rival version

### Script
> In-character opening delivery.

### Knows (can expand when asked)
- Facts

### Doesn't know
- Future events, private motives, distant details

### Hooks and flags
- Player action: result, flag set
- **Links:** arc, momentum
```

## Sources

- [Bernard of Septimania (Wikipedia)](https://en.wikipedia.org/wiki/Bernard_of_Septimania)
- [Aizo (Wikipedia)](https://en.wikipedia.org/wiki/Aizo)
- [Matfrid (Wikipedia)](https://en.wikipedia.org/wiki/Matfrid)
- [Pepin I of Aquitaine (Wikipedia)](https://en.wikipedia.org/wiki/Pepin_I_of_Aquitaine)
- [Carolingian Catalonia (Chandler, The Heroic Age)](https://www.heroicage.org/issues/17/chandler.php)
- [The rulership of Pippin I of Aquitaine (Meehan, Early Medieval Europe)](https://onlinelibrary.wiley.com/doi/10.1111/emed.12784)
- [Frankish synods of 829 (Wikipedia)](https://en.wikipedia.org/wiki/Frankish_synods_of_829)
- [Paris council of 829 (Manual of Councils)](https://www.ecatholic2000.com/councils2/untitled-19.shtml)
- [Jonas of Orléans (Catholic Encyclopedia)](https://www.newadvent.org/cathen/08499a.htm)
- [Moduin, bishop of Autun (Wikipedia)](https://en.wikipedia.org/wiki/Moduin)
