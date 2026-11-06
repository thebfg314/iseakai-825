import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { lintHistory, lintHistoryStructure } from "./lint";
import { historyContent, setHistoryContentForTests } from "./load";
import { PILGRIM_GIFT_DENARII } from "./relics";
import { seasonRevenue, tradeMultiplier } from "./revenue";
import { tradeHealth } from "./trade";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import { fillSlots, slotValue } from "./slots";
import { dangerAt, tickVikings } from "./vikings";

/** Step D: Arcs 3–6 (841-V1 … 877-C1), relics, the bridge levy, Viking danger, the tributes, Pippin II's men. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
type Season = (typeof ORDER)[number];

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    if (state.battle_call?.kind === "history") state.battle_call = null; // The clock stands in for the hall: a history call left open is answered before the season turns.
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1, { coverUpkeep: true });
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  const to = (year: number, season: Season): HistoryPassResult[] => {
    const all: HistoryPassResult[] = [];
    while (state.meta.year < year || (state.meta.year === year && ORDER.indexOf(state.meta.season) < ORDER.indexOf(season))) all.push(next());
    return all;
  };
  return { next, to };
}

const choose = (state: WorldState, eventId: string, optionId: string) => applyProposal(state, { type: "history_choice", summary: "", eventId, optionId }, "steward");
const hook = (state: WorldState, eventId: string, hookId: string, actor = "steward") =>
  applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, actor);

/** Keep the manses through the 830 crisis so later land effects are visible. */
function settled(state: WorldState, clock: ReturnType<typeof clockFor>) {
  clock.to(830, "autumn");
  hook(state, "830-L1", "church_fixed", "chaplain");
}

const STEP_D_FLAGS = [
  "viking_aware", "relic_refuge_offer", "relics_held", "relics_monks", "relics_returned", "levy_paid", "levy_refused", "bridge_engineer",
  "brissarthe_866", "tournus_host", "tournus_carts", "tournus_escort", "tournus_friend", "warned_neighbours_viking", "march_886", "objected_886",
  "vikings_sent_elsewhere", "imperial_commission_886", "irregular_tactics", "poisoned_camp", "disease_blankets", "saint_florentin_888",
  "rudolph_wedding", "carried_messages_892", "guarded_charles_894", "sens_895", "argenteuil_898", "ballon_845", "jengland_851", "vienne_870",
  "andernach_876", "holdout_848", "pippin2_dabbled", "pippin2_submitted", "pippin2_fled", "betrayed_pippin2", "warned_pippin2", "pardoned_864",
  "favor_girart", "rome_875", "boso_contact", "quierzy_heir", "bought_land_tribute", "tribute_866", "tribute_877", "loyalist_858", "perjury_858",
  "sheltered_refugees", "reputation_shrewd", "charles_favor",
];

describe("Arcs 3–6 content", () => {
  afterEach(() => setHistoryContentForTests(null));

  it("lints, and every Step D flag has a setter", () => {
    expect(lintHistoryStructure(historyContent())).toEqual([]);
    const unset = lintHistory(historyContent()).filter((p) => p.includes("nothing sets it"));
    for (const id of STEP_D_FLAGS) expect(unset.find((p) => p.includes(`'${id}'`)), id).toBeUndefined();
    const ids = ["841-V1", "843-V1", "845-V1", "853-V1", "862-V1", "864-V1", "864-V2", "866-V1", "875-V1", "881-V1", "885-V1", "886-V1", "886-V2", "887-V1", "888-V1", "898-V1", "845-B1", "851-B1", "845-A1", "848-A1", "852-A1", "855-A1", "855-C1", "858-C1", "858-C2", "863-C1", "869-C1", "870-C2", "875-C1", "876-C1", "877-C1", "E-866", "E-877"];
    for (const id of ids) expect(historyContent().byId.has(id), id).toBe(true);
  });

  it("the tribute slots follow rank and the manse roll, and fill the scripts", () => {
    const state = fresh();
    expect(slotValue(state, "tribute_866_personal")).toBe(120);
    expect(slotValue(state, "tribute_866_tenants")).toBe(58);
    expect(slotValue(state, "tribute_877_demesne")).toBe(12);
    expect(slotValue(state, "tribute_877_rent")).toBe(32);
    expect(slotValue(state, "tribute_877_tenants")).toBe(32);
    expect(slotValue(state, "levy_845")).toBe(60);
    expect(fillSlots(state, "worth: {tribute_866_personal}; people: {tribute_866_tenants}; {nope}")).toBe("worth: 120 denarii (10 solidi); people: 58 denarii; {nope}");
    state.player.rankLevel = 3;
    expect(slotValue(state, "tribute_866_personal")).toBe(480);
    expect(slotValue(state, "tribute_877_demesne")).toBe(12 * state.holdings.length);
  });

  it("the 845 Paris levy is paid by default and refusing it marks the lord viking-aware", () => {
    const a = fresh();
    const ca = clockFor(a);
    settled(a, ca);
    ca.to(845, "spring");
    a.resources.denarii = 100;
    expect(a.player.rankLevel).toBe(2); // Crémieu raised him in 835 on the Field of Lies renown
    const office = seasonRevenue(a).net;
    const summer = ca.next();
    expect(summer.fired).toEqual(["845-V1", "845-A1"]);
    expect(summer.beats.some((b) => b.text.includes("For us that is 60 denarii (5 solidi)."))).toBe(true);
    ca.next();
    expect(a.resources.denarii).toBe(100 - 60 + 2 * office);
    expect(a.history.flags.levy_paid).toBe(1);

    const b = fresh();
    const cb = clockFor(b);
    cb.to(845, "summer");
    expect(choose(b, "845-V1", "refuse").ok).toBe(true);
    expect(b.history.flags.viking_aware).toBe(true);
    expect(b.history.flags.levy_refused).toBe(1);
  });

  it("relics: the Nantes offer enlarges the 853 treasury, pilgrims pay, and the treasure goes home in 885", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(843, "autumn");
    expect(hook(state, "843-V1", "relic_refuge_offer", "chaplain").ok).toBe(true);
    clock.to(853, "autumn");
    const winter = clock.next();
    expect(winter.fired).toContain("853-V1");
    expect(winter.beats.some((b) => b.text.includes("They remembered what you said after Nantes"))).toBe(true);
    expect(winter.beats.some((b) => b.text.includes("What is offered is modest"))).toBe(false);
    const vis = state.history.land.visibility;
    expect(choose(state, "853-V1", "accept").ok).toBe(true);
    expect(state.history.flags.relics_held).toBe(true);
    expect(state.history.flags.relics_monks).toBe(true);
    expect(state.history.land.visibility).toBe(vis + 15);
    const coin = state.resources.denarii;
    state.resources.rye = 20;
    const office = seasonRevenue(state).net; // a viscount since Crémieu: the deputy's share and the court fines come in each season
    const spring = clock.next();
    expect(state.resources.denarii).toBe(coin + PILGRIM_GIFT_DENARII + office);
    expect(state.resources.rye).toBe(18);
    expect(spring.effects.some((l) => l.includes("Pilgrims"))).toBe(true);
    clock.to(884, "winter");
    const s885 = clock.next();
    expect(s885.fired).toContain("885-V2");
    clock.next();
    expect(state.history.flags.relics_held).toBe(false);
    expect(state.history.flags.relics_returned).toBe(true);
    expect(state.history.flags.church_enemy).toBeUndefined();
  });

  it("the bridge levy can be paid in coin, labour or materials", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(862, "summer");
    const autumn = clock.next();
    expect(autumn.fired).toContain("862-V1");
    state.resources.denarii = 50;
    expect(choose(state, "862-V1", "coin").ok).toBe(true);
    expect(state.resources.denarii).toBe(35);
    expect(hook(state, "862-V1", "send_engineers").ok).toBe(true);
    expect(state.history.flags.bridge_engineer).toBe(true);
  });

  it("Viking danger: bands by season, a seeded raid call, and the camp's poison does not stay secret forever", () => {
    expect(dangerAt({ year: 880, season: "summer" }).danger).toBe("none");
    expect(dangerAt({ year: 886, season: "winter" })).toMatchObject({ danger: "high", camp: true });
    expect(dangerAt({ year: 887, season: "summer" }).danger).toBe("none");
    expect(dangerAt({ year: 888, season: "summer" }).danger).toBe("moderate");
    expect(dangerAt({ year: 893, season: "spring" }).danger).toBe("low");
    expect(dangerAt({ year: 898, season: "winter" })).toMatchObject({ danger: "moderate", camp: true });
    expect(dangerAt({ year: 898, season: "winter" }, true)).toMatchObject({ danger: "low", camp: false });
    expect(dangerAt({ year: 905, season: "spring" }).danger).toBe("low");

    const state = fresh();
    let raided = false;
    for (let turn = 1; turn < 60 && !raided; turn++) {
      const r = tickVikings(state, { year: 886, season: "winter" }, turn);
      raided = r.raid;
    }
    expect(raided).toBe(true);
    expect(state.battle_call?.kind).toBe("raid");
    expect(state.battle_call?.eventId).toBe("viking:886:winter");
    expect(state.history.vikings.campNear).toBe(true);
    // No second call while one is open.
    expect(tickVikings(state, { year: 886, season: "winter" }, 99).raid).toBe(false);

    const poison = fresh();
    poison.history.flags.poisoned_camp = true;
    poison.history.flags.favor_church = 3;
    let known = false;
    for (let turn = 1; turn < 40 && !known; turn++) {
      poison.battle_call = null;
      poison.meta.year = 800 + turn; // vary the seed
      tickVikings(poison, { year: poison.meta.year, season: "winter" }, turn);
      known = poison.history.flags.poison_known === true;
      poison.history.vikings.campNear = true;
    }
    // Discovery depends on the camp being near; with the band table that is 886–887 and 898–899 only.
    const near = fresh();
    near.history.flags.poisoned_camp = true;
    near.history.flags.favor_church = 3;
    for (let t = 0; t < 30 && near.history.flags.poison_known !== true; t++) {
      near.meta.region = `r${t}`;
      tickVikings(near, { year: 886, season: "winter" }, 250 + t);
      near.battle_call = null;
    }
    expect(near.history.flags.poison_known).toBe(true);
    expect(near.history.flags.favor_church).toBe(1);
  });

  it("the Northmen winter in Burgundy: supply checks both seasons, the irregular hooks, and the summer close", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(886, "autumn");
    const winter = clock.next();
    expect(winter.fired).toContain("887-V1");
    expect(state.history.supply.lastRoll?.situation).toBe("enemy_main");
    expect(hook(state, "887-V1", "deny_countryside").ok).toBe(true);
    expect(state.history.flags.hidden_stores).toBe(true);
    const spring = clock.next();
    expect(spring.fired).toContain("887-V2");
    expect(hook(state, "887-V2", "deny_countryside_spring").ok).toBe(true);
    expect(state.history.flags.irregular_tactics).toBe(2);
    const renown = state.player.renown ?? 1;
    const summer = clock.next();
    expect(summer.fired).toContain("887-V3");
    expect(summer.beats.some((b) => b.text.includes("never got fat on was ours"))).toBe(true);
    expect(state.player.renown).toBeGreaterThan(renown);
  });

  it("optional summonses at old age: stay by default; the battle and the report follow when men are sent", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(887, "winter");
    const spring = clock.next();
    expect(spring.fired).toContain("888-V1");
    state.military.units = [{ ...(state.military.units[0] ?? {}), id: "u1", sheetId: "pedites_fyrd", name: "The militia", veteran: false, strength: 20 } as never];
    expect(choose(state, "888-V1", "send_men").ok).toBe(true);
    const summer = clock.next();
    expect(summer.fired).toEqual(["888-B1", "888-V2"]);
    // The battle pass: men sent under a captain are still fought on the grid, by letter (mode "captain").
    expect(state.battle_call).toMatchObject({ kind: "history", eventId: "888-B1", historyId: "saint_florentin_888", mode: "captain" });
    expect(summer.beats[0].text).toContain("The muster waits on you");
    expect(state.history.away).toBeNull(); // men went; the lord stayed
    expect(summer.beats.some((b) => b.text.includes("The count noticed who was not there"))).toBe(false);

    const home = fresh();
    const c2 = clockFor(home);
    c2.to(898, "autumn");
    c2.next(); // winter 898: the summons, stay by default
    expect(home.history.fired["898-V1"]).toBeDefined();
    const s899 = c2.next();
    expect(home.history.flags.argenteuil_898).toBe("stayed");
    expect(s899.fired).toEqual(["899-V1"]);
    expect(s899.beats.some((b) => b.text.includes("a long memory for who rode and who did not"))).toBe(true);
  });

  it("Brittany: the summons is answered by default, the lord is away for the battle, and the report lands the same season", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(845, "summer");
    const autumn = clock.next();
    expect(autumn.fired).toContain("845-B1");
    const winter = clock.next();
    expect(state.history.flags.ballon_845).toBe("answered");
    expect(winter.fired).toEqual(["845-B2", "845-B3"]);
    expect(state.history.away?.reason).toContain("Brittany");
    expect(winter.beats.map((b) => b.text).join(" ")).toContain("Beaten, my lord, in a marsh.");
    clock.to(851, "summer");
    state.resources.denarii = 800;
    expect(choose(state, "851-B1", "pay_fine").ok).toBe(true);
    expect(state.resources.denarii).toBe(80);
    const a851 = clock.next();
    expect(a851.fired).toEqual(["851-B3"]);
    expect(a851.beats[0].text).toContain("before the king's men could close");
  });

  it("Pippin II's men: Aquitaine turns, the dabbler is asked again, the warning never arrives", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    state.history.flags.pippin2_840 = true;
    clock.to(845, "spring");
    const horses = state.resources.horses;
    clock.next();
    // The promotion window fires; a viscount since Crémieu with renown far below 500 gets the horse, the arms and the cloak.
    expect(state.history.fired["845-P1"]).toBeDefined();
    expect(state.history.rank.windows["845-P1"]).toBe("thanks");
    expect(state.player.rankLevel).toBe(2);
    expect(state.resources.horses).toBe(horses + 1);
    clock.to(848, "spring");
    const s848 = clock.next();
    expect(s848.fired).toEqual(["848-A1", "848-A1P"]);
    clock.next();
    expect(state.history.flags.pippin2_submitted).toBe(true);
    clock.to(854, "winter");
    const s855 = clock.next();
    expect(s855.beats.some((b) => b.text.includes("somebody has been asking after you"))).toBe(true);
    expect(hook(state, "855-A1", "dabble").ok).toBe(true);
    clock.to(863, "winter");
    const s864 = clock.next();
    expect(s864.fired).toEqual(["864-V1", "864-V1P"]);
    const horsesBefore = state.resources.horses;
    expect(choose(state, "864-V1P", "warn").ok).toBe(true);
    expect(state.history.flags.warned_pippin2).toBe(true);
    expect(state.resources.horses).toBe(horsesBefore - 1);
    const summer = clock.next();
    expect(summer.fired).toEqual(["864-V2"]); // already submitted: no submit-or-flee
    expect(summer.beats.some((b) => b.text.includes("Your man never reached him"))).toBe(true);
    const autumn = clock.next();
    expect(autumn.beats.some((b) => b.text.includes("At Pîtres the great men condemned Pippin"))).toBe(true);
    clock.next(); // the last stage closes with the season
    expect(state.history.scenes["864-V2"]).toBeUndefined();
    expect(state.history.record.some((r) => r.text.includes("condemned at Pîtres"))).toBe(true);
  });

  it("Pippin's court raises a man whose renown bears it, and Aquitaine's turn takes his benefices back", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    state.history.flags.pippin2_840 = true;
    clock.to(845, "spring");
    expect(state.player.rankLevel).toBe(2);
    state.player.renown = 600; // crosses the Count threshold just before the window
    const villasBefore = state.holdings.length;
    const summer = clock.next();
    expect(state.history.rank.windows["845-P1"]).toBe("promoted");
    expect(state.player.rankLevel).toBe(3);
    expect(state.history.flags.promoted_845).toBe(true);
    expect(state.history.rank.patron).toBe("Pippin II, king of Aquitaine");
    expect(state.holdings.length).toBe(12);
    expect(state.holdings.filter((h) => h.grantedBy === "Pippin II, king of Aquitaine").length).toBe(12 - villasBefore);
    expect(state.history.rank.counties.map((c) => c.name)).toEqual(["Beaune"]);
    expect(state.history.vassals.filter((v) => !v.group).length).toBe(10);
    expect(summer.beats.some((b) => b.text.includes("Count of this land, by the hand of Pippin II"))).toBe(true);
    // The office pays its quarter from the next season.
    const coin = state.resources.denarii;
    const autumn = clock.next();
    // 625 a quarter on ordinary roads; the roads are poorer after Fontenoy's year, Verdun and the dearth.
    expect(tradeHealth(state)).toBeLessThan(55);
    expect(state.history.rank.lastRevenue?.tolls).toBe(Math.round(625 * tradeMultiplier(state)));
    expect(state.resources.denarii).toBeGreaterThan(coin);
    expect(autumn.effects.some((l) => l.startsWith("The office paid"))).toBe(true);
    // 848: Aquitaine throws Pippin over; what he gave in land goes, the rank and the county stay.
    clock.to(848, "spring");
    const s848 = clock.next();
    expect(s848.fired).toContain("848-A1");
    expect(s848.beats.some((b) => b.text.includes("I have struck them from the books"))).toBe(true);
    expect(state.holdings.length).toBe(villasBefore);
    expect(state.holdings.some((h) => h.grantedBy === "Pippin II, king of Aquitaine")).toBe(false);
    expect(state.player.rankLevel).toBe(3);
    expect(state.history.rank.counties.length).toBe(1);
  });

  it("Pippin II's men: holding out leads to submit-or-flee; fleeing forfeits the villa unless an out is taken", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    state.history.flags.pippin2_840 = true;
    clock.to(848, "summer");
    expect(choose(state, "848-A1P", "hold_out").ok).toBe(true);
    clock.to(864, "spring");
    const summer = clock.next();
    expect(summer.fired).toEqual(["864-V2", "864-V2P"]);
    expect(choose(state, "864-V2P", "flee").ok).toBe(true);
    expect(state.history.land.tenure).toBe("forfeit_claimed");
    const autumn = clock.next();
    expect(autumn.fired).toContain("864-L1");
    const free = state.holdings[0].manses.free;
    clock.to(866, "spring");
    expect(state.history.land.tenure).toBe("benefice");
    expect(state.holdings[0].manses.free).toBe(free - 2);
    expect(state.history.record.some((r) => r.text.includes("seized part of the villa"))).toBe(true);
  });

  it("858: standing with Charles pays off in the spring; going over to Louis is remembered", () => {
    const a = fresh();
    const ca = clockFor(a);
    ca.to(858, "autumn");
    expect(choose(a, "858-C2", "charles").ok).toBe(true);
    ca.next();
    const spring = ca.next();
    expect(spring.fired).toContain("859-C1");
    expect(a.history.flags.charles_favor).toBe(52);
    expect(spring.beats.some((b) => b.text.includes("right side of that list"))).toBe(true);

    const b = fresh();
    const cb = clockFor(b);
    cb.to(858, "autumn");
    expect(choose(b, "858-C2", "louis").ok).toBe(true);
    cb.next();
    cb.next();
    expect(b.history.flags.charles_disfavor).toBe(48);
    expect(b.history.flags.count_opinion).toBe(48);
  });

  it("866: Robert's campaign is optional, his death changes the count, and the tribute fills its amounts and lends", () => {
    // A villa lord's tribute: the promotion pass is off so Crémieu does not raise him and the heribannum stays at 10 solidi.
    setHistoryContentForTests({ features: { promotions: false } });
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "autumn");
    hook(state, "830-L1", "marry_local"); // keeps the manses and stays sworn to the count, so Robert's optional summons reaches him; the match brings two free manses (marriage.ts)
    clock.to(866, "spring");
    const summer = clock.next();
    expect(summer.fired).toContain("866-V1");
    expect(state.history.realm.countOfAutun).toBe("Robert the Strong");
    state.resources.denarii = 400;
    const autumn = clock.next();
    expect(state.history.flags.brissarthe_866).toBe("stayed");
    expect(autumn.fired).toEqual(["866-V2", "E-866"]);
    expect(state.history.realm.countOfAutun).toBe("Bernard Plantapilosa");
    expect(autumn.beats.some((b) => b.text.includes("Count Robert the Strong holds the county no longer"))).toBe(true);
    const text = autumn.beats.map((b) => b.text).join("\n");
    expect(text).toContain("by what you are worth: 120 denarii (10 solidi).");
    expect(text).toContain("That is 72 denarii (6 solidi) from our people altogether.");
    expect(choose(state, "E-866", "loan").ok).toBe(true);
    expect(state.resources.denarii).toBe(400 - 192);
    expect(state.history.flags.tribute_866).toBe("paid");
    clock.next();
    clock.next();
    clock.next();
    const coinBefore = state.resources.denarii;
    const back = clock.next();
    expect(state.resources.denarii).toBe(coinBefore + 90);
    expect(back.beats.some((b) => b.text.includes("with the increase: 90 denarii"))).toBe(true);
  });

  it("877: Quierzy, the king's death announced by the event, and the second ransom in the same winter", () => {
    setHistoryContentForTests({ features: { promotions: false } }); // a villa lord's share of the 877 tribute
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(877, "spring");
    const summer = clock.next();
    expect(summer.fired).toContain("877-C1");
    expect(hook(state, "877-C1", "quierzy_claim").ok).toBe(true);
    expect(state.history.land.charter).toBe("count");
    clock.next();
    expect(state.history.realm.king).toBe("Charles the Bald");
    const winter = clock.next();
    expect(winter.fired).toEqual(["877-C2", "E-877"]);
    expect(state.history.realm.king).toBe("Louis the Stammerer");
    expect(state.history.realm.emperor).toBeNull();
    expect(winter.beats.some((b) => b.eventId.startsWith("realm:king"))).toBe(false);
    expect(winter.beats.some((b) => b.text.includes("12 denarii (1 solidus) from the demesne, 32 denarii lost out of the rents"))).toBe(true);
    state.resources.denarii = 100;
    expect(choose(state, "E-877", "pay_for_tenants").ok).toBe(true);
    expect(state.resources.denarii).toBe(100 - 76);
  });

  it("the Tournus monks: three kinds of help make a friend; refugees settle", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(874, "winter");
    const spring = clock.next();
    expect(spring.fired).toContain("875-V1");
    state.resources.denarii = 100;
    state.resources.rye = 20;
    state.resources.horses = 3;
    expect(hook(state, "875-V1", "hospitality").ok).toBe(true);
    expect(hook(state, "875-V1", "carts").ok).toBe(true);
    expect(state.history.flags.tournus_friend).toBeUndefined();
    expect(hook(state, "875-V1", "escort").ok).toBe(true);
    expect(state.history.flags.tournus_friend).toBe(true);
    const vacant = state.holdings[0].manses.vacant;
    expect(hook(state, "875-V1", "settle_refugees").ok).toBe(true);
    expect(state.holdings[0].manses.vacant).toBe(vacant - 1);
  });
});
