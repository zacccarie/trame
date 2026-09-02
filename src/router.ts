// Routeur à coût : choisit les magasins, respecte un budget, mesure le contrefactuel.
import { allStores, type Store } from "./stores";
import { detectIntent, weigh, type Intent } from "./intent";
import { logQuery, toTokens, type Answer, type Probe, type StoreName } from "./core";

export interface AskOptions {
  scope?: string;
  /** Budget en tokens pour la réponse assemblée. */
  budget?: number;
  /** Force un ou plusieurs magasins et court-circuite le routage. */
  only?: StoreName[];
}

export interface AskResult {
  answer: string;
  tokens: number;
  baseline?: number;
  saved?: number;
  used: StoreName[];
  considered: { store: StoreName; cost: number; confidence: number; chosen: boolean }[];
  ms: number;
  verdict: string;
  intent: Intent;
}

const DEFAULT_BUDGET = 2200;

export async function ask(question: string, opt: AskOptions = {}): Promise<AskResult> {
  const t0 = Date.now();
  const budget = opt.budget ?? DEFAULT_BUDGET;
  const intent = detectIntent(question);

  // 1. Sonde tous les magasins disponibles (opération bon marché).
  const probes: Probe[] = [];
  const byName = new Map<StoreName, Store>();
  for (const s of allStores) {
    if (opt.only && !opt.only.includes(s.name)) continue;
    if (!(await s.available())) continue;
    byName.set(s.name, s);
    const p = await s.probe(question, opt.scope).catch(() => null);
    if (!p) continue;
    // L'intention repondère la confiance avant tout classement.
    p.confidence = Math.max(0.02, Math.min(0.97, p.confidence * weigh(intent, p.store)));
    probes.push(p);
  }

  // 2. Classe par rendement attendu : confiance par token dépensé.
  probes.sort((a, b) => b.confidence / b.cost - a.confidence / a.cost);

  // 3. Exécute tant que le budget tient et que la confiance cumulée est faible.
  const answers: Answer[] = [];
  const considered: AskResult["considered"] = [];
  let spent = 0, conf = 0;

  const toRun: Probe[] = [];
  for (const p of probes) {
    const affordable = spent + p.cost <= budget;
    const needed = conf < 0.85;
    const chosen = affordable && needed && p.confidence >= 0.25;
    considered.push({ store: p.store, cost: p.cost, confidence: +p.confidence.toFixed(2), chosen });
    if (!chosen) continue;
    toRun.push(p);
    spent += p.cost;                                  // réserve le budget estimé
    conf = 1 - (1 - conf) * (1 - p.confidence);
  }
  // Les magasins retenus sont interrogés en parallèle : la latence est celle du plus lent.
  const settled = await Promise.all(toRun.map(p =>
    byName.get(p.store)!.query(question, p, opt.scope).catch(() => null)));
  for (const a of settled) if (a && a.text.trim()) answers.push(a);

  // 4. Contrefactuel : coût de l'alternative naïve, quand un magasin sait le mesurer.
  const baseline = answers.reduce<number | undefined>(
    (acc, a) => (a.baseline != null ? (acc ?? 0) + a.baseline : acc), undefined);

  const body = answers.map(a =>
    `## [${a.store}] ${a.provenance.slice(0, 4).join(", ")}\n${a.text}`).join("\n\n");
  const tokens = toTokens(body);
  const saved = baseline != null ? baseline - tokens : undefined;

  // 5. Règle de l'article, rendue exécutable : si la récupération coûte plus
  //    cher que la lecture directe, on le dit au lieu de faire semblant.
  let verdict: string;
  if (!answers.length) verdict = "AUCUN MAGASIN — lis les fichiers directement.";
  else if (saved != null && saved <= 0)
    verdict = `PERTE (${-saved} tokens) — sur cette question la lecture directe est moins chère.`;
  else if (saved != null)
    verdict = `GAIN ${saved} tokens (${Math.round((saved / baseline!) * 100)} % vs lecture directe).`;
  else verdict = "Pas de contrefactuel mesurable pour ce type de question.";

  const ms = Date.now() - t0;
  logQuery({ question, scope: opt.scope, store: answers[0]?.store,
             tokens, baseline, ms, hit: answers.length > 0 });

  return { answer: body || "(aucun résultat)", tokens, baseline, saved,
           used: answers.map(a => a.store), considered, ms, verdict, intent };
}
