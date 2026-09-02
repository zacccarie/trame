# trame

Routeur de connaissance à coût mesuré pour Claude Code.

Pas un index de plus : une couche de **routage** au-dessus de quatre magasins
qui existent déjà et ne se parlent pas (graphe de code, vault, mémoires, brain).

## Thèse

Un graphe de connaissance ne fait économiser des tokens que s'il **remplace**
la lecture de fichiers. S'il s'y ajoute, il coûte. Personne ne livre l'arbitrage :
il est laissé à une consigne en prose dans un CLAUDE.md, que le modèle applique
au jugé. `trame` en fait une règle exécutée, et **mesure le contrefactuel** à
chaque requête — y compris quand il perd.

## Architecture

    question
       │
       ├─ intent.ts    nature de la question (locate/usage/impact/decision/concept/howto)
       │               → repondère la confiance de chaque magasin
       ├─ router.ts    sonde tous les magasins, classe par confiance/coût,
       │               exécute en parallèle sous budget de tokens
       └─ stores.ts    code (codebase-memory) · vault (qmd) · memory · brain (gbrain)

    ledger SQLite  ~/.trame/trame.sqlite  — tokens rendus vs coût de l'alternative

## Deux idées non triviales

**1. L'index est lu dans le processus, pas dans le contexte.**
`MEMORY.md` et les `description:` de frontmatter sont des résumés français
curatés : la meilleure surface de routage disponible, meilleure que les
embeddings d'un modèle 300M sur un corpus bilingue. `trame` les lit pour router,
mais ne rend au modèle que l'extrait retenu. L'index sort de la taxe fixe et
cesse de croître avec le nombre de mémoires.

**2. Le contrefactuel est modélisé sur la stratégie réelle d'un agent.**
`grep -n` puis lecture des 3 fichiers les plus touchés — pas « tous les fichiers
contenant la chaîne », qui gonfle le gain d'un ordre de grandeur. Exclusions
vendorisées (`node_modules`, `.venv`, `site-packages`, `target`…) et plafond de
longueur de ligne, sinon un `torch/_inductor/ir.py` fausse tout.

## Usage

    trame ask "<question>" [--scope /chemin/projet] [--budget N]
    trame stats
    trame link <src> <src_store> <dst> <dst_store> <kind> [note]
    trame mcp

MCP : outils `trame_ask`, `trame_link`, `trame_links`, `trame_stats`.

## Statut

v0.1 — fonctionnel, mesuré. Zéro dépendance (bun + sqlite natif).
Le liage inter-magasins (`trame_link`) est en place mais pas encore peuplé.
