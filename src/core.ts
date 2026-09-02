// Noyau : types partagés, estimation de coût, ledger SQLite.
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

export const DATA_DIR = join(homedir(), ".trame");
mkdirSync(DATA_DIR, { recursive: true });

/** Estimation de tokens. 1 token ~ 3.6 caractères sur du code/markdown mixte FR+EN. */
export const CHARS_PER_TOKEN = 3.6;
export const toTokens = (s: string | number): number =>
  Math.ceil((typeof s === "number" ? s : s.length) / CHARS_PER_TOKEN);

export type StoreName = "code" | "vault" | "memory" | "brain";

export interface Probe {
  store: StoreName;
  /** Coût attendu de la réponse, en tokens. */
  cost: number;
  /** Confiance que ce magasin réponde réellement, 0..1. */
  confidence: number;
  /** Données opaques transmises à query() pour éviter de retravailler. */
  hint?: unknown;
}

export interface Answer {
  store: StoreName;
  text: string;
  tokens: number;
  provenance: string[];
  /** Coût de l'alternative naïve (lecture de fichiers), si mesurable. */
  baseline?: number;
}

export interface Store {
  name: StoreName;
  available(): Promise<boolean>;
  probe(q: string, scope?: string): Promise<Probe | null>;
  query(q: string, probe: Probe, scope?: string): Promise<Answer | null>;
}

// ---------------------------------------------------------------- ledger

const db = new Database(join(DATA_DIR, "trame.sqlite"));
db.run(`CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  question TEXT NOT NULL,
  scope TEXT,
  store TEXT,
  tokens INTEGER NOT NULL,
  baseline INTEGER,
  saved INTEGER,
  ms INTEGER,
  hit INTEGER NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  src TEXT NOT NULL, src_store TEXT NOT NULL,
  dst TEXT NOT NULL, dst_store TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  UNIQUE(src, dst, kind)
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_links_src ON links(src)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst)`);

export function logQuery(r: {
  question: string; scope?: string; store?: StoreName;
  tokens: number; baseline?: number; ms: number; hit: boolean;
}) {
  const saved = r.baseline != null ? r.baseline - r.tokens : null;
  db.run(
    `INSERT INTO queries (ts,question,scope,store,tokens,baseline,saved,ms,hit)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [Date.now(), r.question, r.scope ?? null, r.store ?? null,
     r.tokens, r.baseline ?? null, saved, r.ms, r.hit ? 1 : 0]
  );
}

export function addLink(src: string, srcStore: string, dst: string, dstStore: string, kind: string, note?: string) {
  db.run(
    `INSERT OR IGNORE INTO links (ts,src,src_store,dst,dst_store,kind,note) VALUES (?,?,?,?,?,?,?)`,
    [Date.now(), src, srcStore, dst, dstStore, kind, note ?? null]
  );
}

export function linksFor(node: string): any[] {
  return db.query(
    `SELECT src,src_store,dst,dst_store,kind,note FROM links WHERE src=?1 OR dst=?1`
  ).all(node) as any[];
}

export function stats(): any {
  const g = db.query(`SELECT COUNT(*) n, SUM(tokens) tok, SUM(baseline) base,
    SUM(saved) saved, SUM(hit) hits, AVG(ms) ms FROM queries`).get() as any;
  const byStore = db.query(`SELECT store, COUNT(*) n, SUM(tokens) tok, SUM(saved) saved
    FROM queries WHERE store IS NOT NULL GROUP BY store ORDER BY saved DESC`).all();
  const nLinks = (db.query(`SELECT COUNT(*) n FROM links`).get() as any).n;
  return { ...g, byStore, links: nLinks };
}

export const rawDb = db;
