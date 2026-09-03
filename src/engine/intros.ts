import type { WorldState } from "./schema";

/** Engine-authored first-meeting lines. Not LLM. Shown once per save (merchants: once per visitor name). */
export const HOUSEHOLD_INTROS: Record<string, string> = {
  steward:
    "My lord. I am Aldric, steward of Fontenay. I have kept these books while the hall waited on a master; grain, labour, and the chest are my care. When you want a craftsman found, ask me — not the forge, and not the cell.",
  smith:
    "Bernard. I keep the forge. Iron's short. Charcoal too. Tell me what you need made, and I'll say if the hearth can do it.",
  chaplain:
    "I am Ermenald, prior of Saint-Martin's cell and your chaplain. Four brothers and a timber oratory. The bishop of Autun hears what is done on Sundays. For grain, see Aldric; for iron, Bernard. For the soul of a matter, I am here.",
  quarry_master:
    "Colman, my lord — quarry master, out of Ireland. Soft ground here, but stone's stone. Show me the face you want cut and I'll say if it'll hold, or if it'll bury a man.",
  carpenter:
    'Haimo. Carpenter. Oak before people, if I\'m honest — but I\'ll still be kind about it. Tell me the roof, the door, or the cart. "Good enough" is how halls fall.',
  mason:
    "Gerold. Mason. A wall is a promise. Don't pull me off a course halfway and expect me to smile. Point at the work, and I'll start when the lime is ready.",
  potter:
    "Hugo. Potter. Clay here is only fair — I'll still make you a decent bowl. Show me what cracked last season and we'll not rush the kiln.",
  village_reeve:
    "Otto. They made me reeve for my back, not my tongue. I speak for the hides and who is shirking. Treat the village fair and I'll stand with you to hell and back.",
  vinedresser:
    "Ambrosius, at your service — the vines, not the wheat. Smell that? Last year's barrel still clings to the wood. Give me sun and patience, and I'll give you something worth a cup.",
  head_seamstress:
    "Hildegard. Seamstress. Your cuff is fraying, my lord — I'll mend it if you wish. Cloth is how a house is seen. I'll run the workshop proper, not wild.",
  copper_smith:
    "Lorenzo, from Lombardy — copper, not Bernard's iron, thank you. Always behind, always busy, but for you I make time. What does my lord need from the soft metal?",
  captain:
    "Eberhard. I've seen enough of war to prefer a quiet watch — and enough to keep my edge if trouble comes. Point me at the gate. Parade dress can wait.",
  negotiator:
    "My name Gerulf, my lord. If the merchants on the road do not carry it, I will. Name the thing you want, and I will say what it costs and how long I need — then I go looking. Do not send me for barley; that is Aldric's world.",
};

export const MERCHANT_INTROS: Record<string, string> = {
  Gero: "Salt, news, and a loud Frank who did you a favor coming inland. Don't mind the grey — the roads still know me.",
  Odo: "Every toll named, every price slow. Rush me and the deal gets worse.",
  Liutward: "Alemannic cloth. Feel that weave. Quality first; sit if you must.",
  Theudo: "I know good goods and better bargains. Pay fair and I'll treat you as a friend of the road.",
  Boso: "Burgundy on my breath. Wine on the carts. Let's make a game of the price.",
  Isaac: "Long road, quiet calendar. Far goods, fair when we trust each other — nu, let's see the stock.",
  Salamon: "A joke first, then the carts. Cheat me and the smile goes.",
  Wichard: "Hides, bloom iron. Talk straight or I move on, partner.",
};

function merchantVisitorName(state: WorldState): string | undefined {
  return state.merchant.name ?? state.npcs.find((n) => n.id === "merchant")?.name;
}

export function introSpeechFor(npcId: string, state: WorldState): string | undefined {
  if (npcId === "merchant") {
    const name = merchantVisitorName(state);
    return name ? MERCHANT_INTROS[name] : undefined;
  }
  return HOUSEHOLD_INTROS[npcId];
}

export function introAlreadySpoken(state: WorldState, npcId: string): boolean {
  if (npcId === "merchant") {
    const name = merchantVisitorName(state);
    if (name && state.merchant_intro_spoken?.[name]) return true;
  }
  return state.npcs.find((n) => n.id === npcId)?.introSpoken === true;
}

export function markIntroSpoken(state: WorldState, npcId: string): void {
  if (npcId === "merchant") {
    const name = merchantVisitorName(state);
    if (name) {
      state.merchant_intro_spoken ??= {};
      state.merchant_intro_spoken[name] = true;
    }
  }
  const npc = state.npcs.find((n) => n.id === npcId);
  if (npc) npc.introSpoken = true;
}
