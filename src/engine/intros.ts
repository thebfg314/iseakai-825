import type { WorldState } from "./schema";

/** Engine-authored first-meeting lines. Not LLM. Shown once per save (merchants: once per visitor name). */
export const HOUSEHOLD_INTROS: Record<string, string> = {
  steward:
    "My lord. I am Aldric, steward of Fontenay. I have kept these books while the hall waited on a master; grain, labour, and the chest are my care. When you want a craftsman found, ask me — not the forge, and not the cell.",
  smith:
    "Bernard. I keep the forge. Iron's short. Charcoal too. Bought iron is what this hearth knows. If the stores can bear a bloomery, I will say so. Ask me, if you would hear more. Tell me what you need made, and I'll say if the hearth can do it.",
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
    "My name Gerulf, my lord. Give me a brief and a purse and I will walk the roads — iron and ordinary goods at the dear end of the market, a little more on an easy road and more when the road is hard, and the scarce finds the carts will not carry. I am not a stall in the yard. Name the thing, and I will say what it costs and how long I need. Do not send me for barley; that is Aldric's world. If I am already away, leave the brief as it stands.",
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

/** The lord's wife (history/marriage.ts), the first time he comes to her tab after the wedding. */
export const WIFE_INTROS: Record<string, (name: string) => string> = {
  hildegard: (name) =>
    `${name}. You know my father's hall, so you know what I was raised to: who owes whom in this district, which families have not spoken in twenty years and why, and what the market thinks of you by Thursday. Ask me about the neighbours and the sworn men. Ask Aldric about the kingdom; I will only tell you what the district believes, and the district is often wrong.`,
  theoderada: (name) =>
    `${name}. I will be useful to you, and I will be plain about it: when I tell you what a count will do, I am usually right, and when what I advise would also serve my brothers, I will say so before you have to ask. The court is a game of three moves, not one. Bring me the letters. Leave the barns to Aldric; he is better at them than either of us.`,
  gisla: (name) =>
    `${name}. I have run a household before, and buried the man I ran it with, so you will forgive me if I ask about the stores before I ask about your day. Tenants, officers, barns, what a steward is not saying: that I know. Kings and counts I know as a householder knows weather. Ask me what I know, and I will tell you when you have reached the end of it.`,
  linda: (name) =>
    `${name}. I know what they say, and I know I was not raised to any of this. I do not know what a benefice is yet, or why a sworn man must be given a horse he does not need, and I will ask you until I do. But I know when a thing is right and when it is not, and I will tell you so, which I think is why you married me. Nobody else in this hall will.`,
};

function merchantVisitorName(state: WorldState): string | undefined {
  return state.merchant.name ?? state.npcs.find((n) => n.id === "merchant")?.name;
}

export function introSpeechFor(npcId: string, state: WorldState): string | undefined {
  if (npcId === "merchant") {
    const name = merchantVisitorName(state);
    return name ? MERCHANT_INTROS[name] : undefined;
  }
  if (npcId === "wife") {
    const m = state.history?.marriage;
    if (!m?.archetype || !m.name) return undefined;
    return WIFE_INTROS[m.archetype]?.(m.name);
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
