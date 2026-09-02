// Classification d'intention : ce qu'on CHERCHE détermine où chercher.
// Sans cette couche, le routeur ne fait que du recouvrement lexical et se
// trompe de magasin dès que les mots d'une question de code figurent aussi
// dans une note de projet.
import type { StoreName } from "./core";

export type Intent = "locate" | "usage" | "impact" | "decision" | "concept" | "howto" | "unknown";

const RULES: [Intent, RegExp][] = [
  ["usage",    /\b(qui appelle|appel(é|ants?|le)|utilis(é|ent|ations?)|référenc|call(ers?|ed|s)\b|where is .* used|usages?)\b/i],
  ["impact",   /\b(impact|casser?|casse|si je (change|renomme|supprime)|blast|dépend(ances?|ent)|breaking)\b/i],
  ["locate",   /\b(où (est|sont|se trouve)|localis|défini(s|e|tion)?|déclar|implémenté|where (is|are)|find the|quel fichier)\b/i],
  ["decision", /\b(pourquoi\b|décision|décidé|choix|choisi|préfér|convention|règle|feedback|tranché|arbitr|plutôt qu)\b/i],
  ["howto",    /\b(comment (faire|configurer|lancer|installer)|procédure|étapes?|setup|how (do|to))\b/i],
  ["concept",  /\b(qu'?est-ce|explique|signifie|principe|théorie|philosoph|c'?est quoi|what is)\b/i],
];

export function detectIntent(q: string): Intent {
  for (const [i, re] of RULES) if (re.test(q)) return i;
  return "unknown";
}

/** Multiplicateurs de confiance par (intention × magasin). 1 = neutre. */
const W: Record<Intent, Partial<Record<StoreName, number>>> = {
  locate:   { code: 1.9, memory: 0.35, vault: 0.25, brain: 0.3 },
  usage:    { code: 2.2, memory: 0.25, vault: 0.2,  brain: 0.2 },
  impact:   { code: 2.0, memory: 0.6,  vault: 0.2,  brain: 0.2 },
  decision: { memory: 1.8, brain: 1.1, vault: 0.9,  code: 0.35 },
  concept:  { vault: 1.6, brain: 1.4,  memory: 0.8, code: 0.3 },
  howto:    { memory: 1.4, brain: 1.0, vault: 0.8,  code: 0.7 },
  unknown:  {},
};

export const weigh = (intent: Intent, store: StoreName): number => W[intent][store] ?? 1;
