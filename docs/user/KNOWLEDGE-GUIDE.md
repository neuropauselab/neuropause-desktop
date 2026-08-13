# NeuroPause — Knowledge Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: all users
>
> Maturity: **Local-first · RC**. Smarter **semantic** ranking is an **External dependency**; local **lexical** search works without it.

## The knowledge surfaces, and how they relate

NeuroPause has a small, deliberate hierarchy — not four competing "knowledge" screens:

- **Knowledge** (Workspace) — the **umbrella lens**. One read-only place for search, AI memory, the knowledge graph, and a summary of the enterprise fabric, with links out to the full surfaces.
- **Enterprise Knowledge** (Advanced) — the **deep fabric explorer**: relationships, classification, lineage, evidence, governance. *(Preview.)*
- **AI Memory** (Workspace) — your **personal** memory: conversations, notes, saved items.
- **Knowledge Graph** — the map of entities and relationships, surfaced inside the above (not a separate destination).

## What you can do

- **Search** across records, memory, timeline, graph, and federation from **Knowledge** (or ⌘K / the **Search** section).
- **Save & retrieve** notes and conversations in **AI Memory**; find them again via search.
- **Explore relationships** and **trace lineage/evidence** in **Enterprise Knowledge** (Preview) — see how facts connect and where they came from, with confidence and governance context.
- **Deep-link out** from the umbrella to the full Memory / Enterprise Knowledge / Enterprise surfaces.

## Local vs. semantic search (read this)

- **Local lexical search works on your device**, always — it matches on text.
- **Semantic (vector) search** ranks by *meaning* and needs the external stack: a vector database (Qdrant) plus an embedding provider. The backend does the embedding; the desktop never talks to the vector DB directly.
- **If the semantic stack isn't available, NeuroPause falls back to local lexical search and labels the result as degraded** — it does not pass off a lexical result as a semantic one. *(External dependency.)*

## Where your knowledge lives

All knowledge content — memory, graph, fabric projections — is **local-first**, stored on your device. Only the optional semantic *ranking enhancement* uses the cloud/vector stack. Deleting or exporting is governed by your data settings; see [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md).

## Permissions & governance

Enterprise knowledge respects the same tenant and role boundaries as the rest of the platform; governance/redaction context is shown in Enterprise Knowledge. Personal AI Memory is yours.

## Related

[AI Workforce Guide](AI-WORKFORCE-GUIDE.md) · [User Guide → Knowledge](NEUROPAUSE-USER-GUIDE.md#15-knowledge) · [Glossary](GLOSSARY.md)
