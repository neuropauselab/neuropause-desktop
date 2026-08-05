# NEMS Universal Search — User Guide (Phase 6 Stage 3)

One search box, everything in NeuroPause: synced documents, emails and messages, the knowledge graph, AI memory, the activity timeline, decisions, workflows, connectors, workspaces, AI sessions, business records (invoices, orders, customers…), people, apps, and navigation.

## Getting there

- **Sidebar → Search** (third entry, right under Mission Control and Today's Intent).
- **⌘K** — start typing: the top content results appear in a "Search" group, and "Search everywhere for …" opens the full experience.
- **Mission Control** — press **Enter** in the search box (or click "Search everywhere") to hand your query to the full Search section.

## Asking in plain language

The planner understands phrases like:

- *find today's invoices* — routes to your business records with a today filter
- *search gmail for the contract from last week* — Gmail-synced documents, last week only
- *show github issues assigned to Sam* — GitHub tasks mentioning Sam
- *"NeuroPause"* — results must contain the exact phrase
- *find AI sessions discussing Kubernetes* — execution sessions + memory
- *show connectors with recent failures* — connector records, failure-flagged
- *workflows using Slack* — automation rules touching Slack

Whatever it understood is shown under the box ("Understood as: …") — query understanding is never a black box. Words it doesn't recognize simply stay part of the search text.

## The Scope Selector

Chips under the search box route your query across the existing indexes — **Everything, Docs & messages, Knowledge, Activity, Operations, Business, People, Navigate**. Picking a scope runs only that slice (faster, more focused); *Everything* runs them all. Hover a chip for exactly what it covers.

## Reading results

Results stream in as each index answers — the status strip shows every source as loading, ready, or **"Unavailable — reason"** (for example, semantic search says *"Sign in to use semantic search."* when you're signed out; a preview connector without a data adapter is never faked). Zero results and an unavailable source are different things, and the UI always tells you which one you're looking at.

Each result shows its title, kind, source, freshness ("updated 2 h ago"), and — where it's meaningful — a **confidence** badge. Click **Why?** on any result for the full explanation: every ranking factor with its weight (index relevance, title match, recency, pinned), the exact source, freshness, and the final score.

## Filters, sorting, actions

After a search: filter by **type** chips and **date** (24h / 7d / 30d), sort by **relevance** or **newest**. Every result row opens its real destination (Enter or click), and the Why? panel offers quick actions — Open, Pin, Copy title, Open connector, View in timeline, Open AI Memory.

## Saved, pinned, recent

- **Save search** keeps the current query in your saved list (synced with your enterprise personalization, shown when the box is empty).
- **Pin** (in a result's Why? panel) boosts that result in future rankings — and the boost is shown as an explicit "Pinned by you" factor.
- **Recent searches** are stored locally (last 20) and shown when the box is empty.

## Keyboard

↑/↓ move through results, **Enter** opens the highlighted result (or runs the query from the box), **Esc** clears. In ⌘K, the same keys work inside the Search group.

## Honesty notes (what search will and won't do)

Search reads only the systems you've connected — connector content comes from the local synced mirror (each hit names its connector; freshness reflects the last sync). Notion, Linear and other preview connectors have no data adapter yet and therefore never appear as results. *"assigned to me"* is noted but not yet resolved to your account (coming with the AI assistant stage). Nothing is ever mocked: if an index can't answer, its chip says so and why.
