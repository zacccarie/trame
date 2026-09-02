#!/usr/bin/env bun
import { ask } from "./router";
import { stats, addLink, linksFor } from "./core";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));

if (cmd === "mcp") { await import("./mcp"); }
else if (cmd === "ask") {
  const r = await ask(positional.join(" "), {
    scope: flag("--scope"), budget: flag("--budget") ? +flag("--budget")! : undefined,
  });
  console.log(`\n\x1b[1m${r.verdict}\x1b[0m`);
  console.log(`intention: \x1b[36m${r.intent}\x1b[0m | magasins: ${r.used.join(", ") || "aucun"} | ${r.tokens} tokens | ${r.ms} ms`);
  console.log(`examinés: ${r.considered.map(c => `${c.store}(coût~${c.cost} conf=${c.confidence}${c.chosen ? " ✓" : " ✗"})`).join("  ")}`);
  console.log("\n" + r.answer.slice(0, +(flag("--show") ?? 1800)));
}
else if (cmd === "stats") {
  const s = stats();
  const pct = s.base ? Math.round(((s.base - s.tok) / s.base) * 100) : 0;
  console.log(`requêtes ${s.n} | rendus ${s.tok ?? 0} tok | naïf ${s.base ?? 0} tok | économie ${s.saved ?? 0} (${pct} %) | liens ${s.links}`);
  for (const b of s.byStore) console.log(`  ${b.store}: ${b.n} req, ${b.tok} tok, ${b.saved ?? 0} économisés`);
}
else if (cmd === "link") { addLink(rest[0], rest[1], rest[2], rest[3], rest[4], rest[5]); console.log("ok"); }
else if (cmd === "links") { console.table(linksFor(rest[0])); }
else console.log(`trame — routeur de connaissance à coût mesuré

  trame ask "<question>" [--scope /chemin/projet] [--budget N] [--show N]
  trame stats
  trame link <src> <src_store> <dst> <dst_store> <kind> [note]
  trame links <node>
  trame mcp                      serveur MCP stdio`);
