// Serveur MCP stdio en JSON-RPC brut : zéro dépendance.
import { ask } from "./router";
import { addLink, linksFor, stats } from "./core";

const TOOLS = [
  {
    name: "trame_ask",
    description:
      "Interroge le réseau de connaissance (code, vault, mémoires, brain) en UN appel. " +
      "Le routeur choisit les magasins selon leur coût attendu et rend un contexte compact " +
      "avec provenance. À utiliser AVANT de lire des fichiers ou de lancer une recherche. " +
      "Le champ 'verdict' dit si la récupération a réellement coûté moins cher que la lecture directe.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "La question, en langage naturel." },
        scope: { type: "string", description: "Chemin absolu du projet, pour activer le graphe de code." },
        budget: { type: "number", description: "Budget en tokens de la réponse (défaut 2200)." },
      },
      required: ["question"],
    },
  },
  {
    name: "trame_link",
    description:
      "Crée un lien typé entre deux nœuds de magasins DIFFÉRENTS (ex: une mémoire de décision " +
      "vers un symbole de code, une note du vault vers un projet). C'est ce liage croisé qui " +
      "transforme quatre index séparés en un seul réseau.",
    inputSchema: {
      type: "object",
      properties: {
        src: { type: "string" }, src_store: { type: "string" },
        dst: { type: "string" }, dst_store: { type: "string" },
        kind: { type: "string", description: "decides|implements|documents|contradicts|derives_from" },
        note: { type: "string" },
      },
      required: ["src", "src_store", "dst", "dst_store", "kind"],
    },
  },
  {
    name: "trame_links",
    description: "Liste les liens croisés attachés à un nœud.",
    inputSchema: {
      type: "object",
      properties: { node: { type: "string" } },
      required: ["node"],
    },
  },
  {
    name: "trame_stats",
    description: "Économies mesurées : tokens rendus vs coût de l'alternative naïve, par magasin.",
    inputSchema: { type: "object", properties: {} },
  },
];

const send = (msg: any) => { process.stdout.write(JSON.stringify(msg) + "\n"); };
const ok = (id: any, result: any) => send({ jsonrpc: "2.0", id, result });
const text = (s: string) => ({ content: [{ type: "text", text: s }] });

async function call(name: string, args: any) {
  switch (name) {
    case "trame_ask": {
      const r = await ask(args.question, { scope: args.scope, budget: args.budget });
      const head =
        `verdict: ${r.verdict}\n` +
        `magasins retenus: ${r.used.join(", ") || "aucun"} | ${r.tokens} tokens | ${r.ms} ms\n` +
        `examinés: ${r.considered.map(c => `${c.store}(c=${c.confidence}${c.chosen ? ",✓" : ""})`).join(" ")}\n`;
      return text(head + "\n" + r.answer);
    }
    case "trame_link":
      addLink(args.src, args.src_store, args.dst, args.dst_store, args.kind, args.note);
      return text(`lien créé: ${args.src} --[${args.kind}]--> ${args.dst}`);
    case "trame_links": {
      const l = linksFor(args.node);
      return text(l.length
        ? l.map(x => `${x.src} [${x.src_store}] --${x.kind}--> ${x.dst} [${x.dst_store}]${x.note ? ` // ${x.note}` : ""}`).join("\n")
        : "aucun lien");
    }
    case "trame_stats": {
      const s = stats();
      const pct = s.base ? Math.round(((s.base - s.tok) / s.base) * 100) : 0;
      return text(
        `requêtes: ${s.n} (${s.hits} avec résultat)\n` +
        `tokens rendus: ${s.tok ?? 0}\n` +
        `alternative naïve mesurée: ${s.base ?? 0}\n` +
        `économie nette: ${s.saved ?? 0} (${pct} %)\n` +
        `liens croisés: ${s.links}\n` +
        `latence moyenne: ${Math.round(s.ms ?? 0)} ms\n\n` +
        s.byStore.map((b: any) => `  ${b.store}: ${b.n} req, ${b.tok} tokens, ${b.saved ?? 0} économisés`).join("\n")
      );
    }
    default:
      return text(`outil inconnu: ${name}`);
  }
}

for await (const line of console) {
  let msg: any;
  try { msg = JSON.parse(line); } catch { continue; }
  const { id, method, params } = msg;
  try {
    if (method === "initialize")
      ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} },
               serverInfo: { name: "trame", version: "0.1.0" } });
    else if (method === "tools/list") ok(id, { tools: TOOLS });
    else if (method === "tools/call") ok(id, await call(params.name, params.arguments ?? {}));
    else if (id !== undefined) ok(id, {});
  } catch (e: any) {
    if (id !== undefined)
      send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } });
  }
}
