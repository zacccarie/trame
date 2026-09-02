// Adaptateurs : un magasin = available/probe/query. Aucun ne connaît les autres.
import { $ } from "bun";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { type Store, type Probe, type Answer, toTokens } from "./core";

const HOME = homedir();
const CBM = join(HOME, ".local/bin/codebase-memory-mcp");
const MEMDIR = join(HOME, ".claude/projects/-Users-zac/memory");

const sh = async (cmd: string[], timeoutMs = 45000): Promise<string> => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const t = setTimeout(() => p.kill(), timeoutMs);
    const out = await new Response(p.stdout).text();
    clearTimeout(t);
    return out;
  } catch { return ""; }
};

/** Retire le bruit de log des CLI (level=..., hints, bannières). */
const clean = (s: string) =>
  s.split("\n").filter(l =>
    !/^level=|^hint:|^warning:|^Preparing |^Running |^Completed |^\s*$/.test(l)
  ).join("\n").trim();

// --------------------------------------------------------------- signaux
const CODE_HINT = /\b(fonction|function|classe|class|méthode|method|import|appel|appelle|calls?|caller|usage|utilis\w+|dépend\w+|depend\w+|refactor|type|interface|endpoint|route|composant|component|hook|api)\b/i;
const IDENT = /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*|\w+_\w+)\b/;
const PERSONAL = /\b(je|mon|ma|mes|zac|préfèr\w+|goût|esthé\w+|philosoph\w+|souvenir|pourquoi|décision|choix|projet|client)\b/i;

/** Extrait les termes utiles pour une recherche (>3 car, hors mots vides). */
const STOP = new Set("le la les de des du un une et ou où que qui quoi comment pour dans sur avec sans est sont ce cette ces mon ma mes je tu il elle nous vous ils the of and to in is are what which how why for with".split(" "));
export const terms = (q: string): string[] =>
  q.toLowerCase().replace(/[^\p{L}\p{N}_ ]/gu, " ").split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w));

// ----------------------------------------------------------------- CODE
export const codeStore: Store = {
  name: "code",
  async available() { return existsSync(CBM); },

  async probe(q, scope) {
    if (!scope || !existsSync(scope)) return null;
    let conf = 0.15;
    if (CODE_HINT.test(q)) conf += 0.35;
    if (IDENT.test(q)) conf += 0.35;
    if (/\.(ts|tsx|js|py|rs|go|swift|sql)\b/.test(q)) conf += 0.15;
    if (conf < 0.3) return null;
    // Le graphe rend des lignes compactes : ~35 tokens par symbole.
    return { store: "code", cost: 35 * 30, confidence: Math.min(conf, 0.95), hint: { scope } };
  },

  async query(q, _p, scope) {
    const project = scope!.replace(/^\//, "").replace(/\//g, "-");
    const pats = terms(q).slice(0, 4);
    const baselineP = grepBaseline(scope!, pats);   // en parallèle du graphe
    const results = await Promise.all(pats.map(async pat => {
      const raw = await sh([CBM, "cli", "--json", "search_graph",
        JSON.stringify({ project, name_pattern: pat, limit: 12 })]);
      const c = clean(raw);
      if (!c || /^unknown tool/i.test(c)) return null;
      try {
        const txt = JSON.parse(c)?.content?.[0]?.text ?? "";
        return txt && !/^total: 0/.test(txt) ? { pat, txt } : null;
      } catch { return null; }
    }));
    const chunks: string[] = [], prov: string[] = [];
    for (const r of results) if (r) { chunks.push(`### ${r.pat}\n${r.txt}`); prov.push(`graph:${r.pat}`); }
    if (!chunks.length) return null;
    const text = chunks.join("\n\n");
    return { store: "code", text, tokens: toTokens(text), provenance: prov,
             baseline: await baselineP };
  },
};

/**
 * Contrefactuel HONNÊTE : on modélise la stratégie qu'un agent compétent
 * suivrait vraiment, pas le pire cas qui flatterait le chiffre.
 *   grep -n (lignes correspondantes) + lecture des 3 fichiers les plus touchés.
 * Compter « tous les fichiers contenant la chaîne » gonfle le gain d'un ordre
 * de grandeur et rend la mesure inutilisable.
 */
const OPEN_CAP = 3;        // fichiers réellement ouverts après le grep
const GREP_LINE_CAP = 120; // au-delà, on raffinerait la requête

const GREP_FLAGS = [
  "--include=*.ts", "--include=*.tsx", "--include=*.js", "--include=*.py",
  "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.next",
  "--exclude-dir=dist", "--exclude-dir=build", "--exclude-dir=.vercel",
  "--exclude-dir=coverage", "--exclude-dir=.vexp",
  // Dépendances vendorisées : l'équivalent Python/Go de node_modules.
  "--exclude-dir=.venv", "--exclude-dir=venv", "--exclude-dir=site-packages",
  "--exclude-dir=__pycache__", "--exclude-dir=vendor", "--exclude-dir=.cache",
  "--exclude-dir=target", "--exclude-dir=.turbo", "--exclude-dir=out",
  "--exclude=*.min.js", "--exclude=*.bundle.js", "--exclude=*.d.ts",
];

async function grepBaseline(scope: string, pats: string[]): Promise<number | undefined> {
  if (!pats.length) return undefined;
  const counts = new Map<string, number>();
  let grepChars = 0;

  const outs = await Promise.all(pats.map(p =>
    sh(["grep", "-rn", ...GREP_FLAGS, p, scope], 20000)));

  for (const out of outs) {
    const lines = out.split("\n").filter(Boolean);
    // Une ligne de grep utile fait ~200 car ; les blobs minifiés ne se lisent pas.
    for (const l of lines.slice(0, GREP_LINE_CAP)) grepChars += Math.min(l.length, 200);
    for (const l of lines) {
      const f = l.split(":")[0];
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  if (!counts.size) return undefined;

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, OPEN_CAP);
  let bytes = 0;
  for (const [f] of ranked) { try { bytes += statSync(f).size; } catch {} }
  return toTokens(grepChars) + toTokens(bytes);
}

// ---------------------------------------------------------------- VAULT
export const vaultStore: Store = {
  name: "vault",
  async available() { return !!(await sh(["which", "qmd"])).trim(); },
  async probe(q) {
    let conf = 0.3;
    if (PERSONAL.test(q)) conf += 0.3;
    if (IDENT.test(q)) conf -= 0.15;
    return { store: "vault", cost: 900, confidence: Math.max(0.1, Math.min(conf, 0.9)) };
  },
  async query(q) {
    // BM25 d'abord : ~200 ms, aucun appel LLM. Repli sémantique si trop maigre.
    let out = clean(await sh(["qmd", "search", q, "--collection", "vault", "--limit", "6"], 25000));
    if (out.length < 200) out = clean(await sh(["qmd", "query", q, "--collection", "vault", "--limit", "4"], 60000));
    if (!out || out.length < 40) return null;
    const prov = [...out.matchAll(/^\s*(?:#\d+\s+)?([\w\-./]+\.md)/gm)].map(m => m[1]).slice(0, 5);
    return { store: "vault", text: out, tokens: toTokens(out), provenance: prov };
  },
};

// --------------------------------------------------------------- MEMORY
/**
 * Mémoires. Principe central : l'index curaté (MEMORY.md + frontmatter
 * `description:`, tous deux en français) est la meilleure surface de routage —
 * meilleure que les embeddings d'un modèle 300M sur un corpus bilingue.
 * Il est lu DANS le processus, jamais rendu au modèle : le contexte ne reçoit
 * que l'extrait retenu. C'est ce qui retire MEMORY.md de la taxe fixe.
 */
const MEM_CAP = 1400;

export const memoryStore: Store = {
  name: "memory",
  async available() { return existsSync(MEMDIR); },
  async probe(q) {
    const files = routeByIndex(q);
    if (!files.length) return null;
    const picked = pickWithinCap(scoreSections(q, files));
    if (!picked.length) return null;
    const cost = picked.reduce((a, s) => a + toTokens(s.body), 0);
    return { store: "memory", cost,
             confidence: Math.min(0.35 + files[0].score / 6, 0.95), hint: picked };
  },
  async query(_q, p) {
    const picked = p.hint as Section[];
    const text = picked.map(s => `--- ${s.file} § ${s.heading} ---\n${s.body}`).join("\n\n");
    const whole = new Set(picked.map(s => s.path));
    let bytes = 0;
    for (const f of whole) { try { bytes += statSync(f).size; } catch {} }
    // Contrefactuel : l'index complet chargé à chaque session + les fichiers entiers.
    const idx = join(MEMDIR, "MEMORY.md");
    const idxTok = existsSync(idx) ? toTokens(statSync(idx).size) : 0;
    return { store: "memory", text, tokens: toTokens(text),
             provenance: [...new Set(picked.map(s => `${s.file}§${s.heading}`))],
             baseline: idxTok + toTokens(bytes) };
  },
};

interface Section { file: string; path: string; heading: string; body: string; score: number }
interface Routed { file: string; path: string; score: number }

/** Étage 1 — route sur l'index curaté et les descriptions de frontmatter. */
function routeByIndex(q: string): Routed[] {
  const ts = terms(q);
  if (!ts.length) return [];
  const scores = new Map<string, number>();
  const bump = (f: string, n: number) => scores.set(f, (scores.get(f) ?? 0) + n);

  // MEMORY.md : "- [Titre](fichier.md) — résumé en français"
  const idx = join(MEMDIR, "MEMORY.md");
  if (existsSync(idx)) {
    for (const line of readFileSync(idx, "utf8").split("\n")) {
      const m = /\]\(([\w\-.]+\.md)\)/.exec(line);
      if (!m) continue;
      const hay = line.toLowerCase();
      let sc = 0;
      for (const t of ts) if (hay.includes(t)) sc += 2.5;
      if (sc) bump(m[1], sc);
    }
  }
  // Frontmatter description: de chaque mémoire.
  for (const f of readdirSync(MEMDIR)) {
    if (!f.endsWith(".md") || f === "MEMORY.md") continue;
    const head = readFileSync(join(MEMDIR, f), "utf8").slice(0, 700).toLowerCase();
    const d = /description:\s*"?([^"\n]+)/.exec(head);
    let sc = 0;
    for (const t of ts) {
      if (d && d[1].includes(t)) sc += 2;
      if (f.toLowerCase().includes(t)) sc += 1.5;
    }
    if (sc) bump(f, sc);
  }
  return [...scores.entries()]
    .map(([file, score]) => ({ file, path: join(MEMDIR, file), score }))
    .sort((a, b) => b.score - a.score).slice(0, 4);
}

/** Étage 2 — dans les seuls fichiers routés, garde les sections denses. */
function scoreSections(q: string, files: Routed[]): Section[] {
  const ts = terms(q);
  const out: Section[] = [];
  for (const r of files) {
    const raw = readFileSync(r.path, "utf8");
    for (const sec of splitSections(raw)) {
      const hay = (sec.heading + "\n" + sec.body).toLowerCase();
      let score = r.score;
      for (const t of ts) {
        const n = hay.split(t).length - 1;
        if (n) score += 1 + Math.log(n);
      }
      out.push({ file: r.file, path: r.path, heading: sec.heading, body: sec.body,
                 score: score / Math.log(50 + sec.body.length) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function splitSections(raw: string): { heading: string; body: string }[] {
  const secs: { heading: string; body: string[] }[] = [{ heading: "(entête)", body: [] }];
  for (const l of raw.split("\n")) {
    const m = /^(#{1,4})\s+(.*)$/.exec(l);
    if (m) secs.push({ heading: m[2].trim(), body: [] });
    else secs[secs.length - 1].body.push(l);
  }
  return secs.map(s => ({ heading: s.heading, body: s.body.join("\n").trim() }))
             .filter(s => s.body.length > 30);
}

function pickWithinCap(secs: Section[]): Section[] {
  const out: Section[] = []; let acc = 0;
  for (const s of secs) {
    const t = toTokens(s.body);
    if (acc + t > MEM_CAP) continue;
    out.push(s); acc += t;
    if (out.length >= 5) break;
  }
  if (out.length) return out;
  // Aucune section ne tient : tronque la meilleure au plafond.
  const best = secs[0];
  const maxChars = Math.floor(MEM_CAP * 3.6);
  return [{ ...best, body: best.body.slice(0, maxChars) + (best.body.length > maxChars ? "\n[…tronqué]" : "") }];
}

// ---------------------------------------------------------------- BRAIN
export const brainStore: Store = {
  name: "brain",
  async available() { return !!(await sh(["which", "gbrain"])).trim(); },
  async probe(q) {
    if (IDENT.test(q) && !PERSONAL.test(q)) return null;
    return { store: "brain", cost: 1100, confidence: 0.35 };
  },
  async query(q) {
    const out = clean(await sh(["gbrain", "search", q], 45000));
    if (!out || out.length < 40 || /error|failed/i.test(out.slice(0, 120))) return null;
    return { store: "brain", text: out.slice(0, 6000), tokens: toTokens(out.slice(0, 6000)),
             provenance: ["gbrain"] };
  },
};

export const allStores: Store[] = [codeStore, memoryStore, vaultStore, brainStore];
