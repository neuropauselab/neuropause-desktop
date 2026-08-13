# NeuroPause — Product Tour

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: new users, evaluators
>
> A self-guided walk through NeuroPause in the order the product itself reveals things (progressive disclosure). Each stop says what you'll see and its maturity, so you always know whether you're looking at verified behavior or a Preview surface.

## Before you start

Sign in (the backend must be reachable). You'll land in the shell with three groups: **Today**, **Business**, and **Advanced**. Everyday surfaces are up front; advanced centers are revealed on demand. Press **⌘K** anywhere to jump to any surface.

## Stop 1 — Today / Work Hub *(Local-first)*

Your personal day. Open **Work Hub** for the day view; the three Today landings are Mission Control, Today's Intent, and Work Hub. This is home base — start and end your day here.

## Stop 2 — Business / ERP *(Local-first)*

The heart of the product: **104 modules across 13 families**. Open a family you actually use — Finance or CRM are good first stops — create a record, close it, and reopen it. It persists on your device. This is real local-first data, not a demo. Notice that sensitive families (like HR) are permission-gated.

## Stop 3 — Knowledge & AI Memory *(Local-first; semantic optional)*

Save something to **AI Memory**, then find it again from **Knowledge** search. Local lexical search always works. If your operator enabled semantic ranking, results are richer; if not, search degrades gracefully rather than failing.

## Stop 4 — AI Workforce *(Local-first + AI provider)*

Where AI does governed work. Watch the lifecycle: **intent → governance → permission → execution → evidence**. Run one action and inspect the approval and the evidence trail. If no AI provider is configured, you'll see an honest deterministic fallback instead of a fabricated answer — that's the point.

## Stop 5 — Operations *(Local-first)*

Health, risk, and incidents. Look at the status indicator: it reads **"Live" only when data actually loaded**. A degraded or empty state here is the product being honest, not broken.

## Stop 6 — AI Store & Connectors *(Cloud + External dependency)*

Open the **AI Store** to discover and launch apps (served by the backend). Open **Connectors** to see the 22 integrations — 13 production-ready, 9 Preview. Try connecting one: if its OAuth credentials aren't configured, you'll see an honest "not configured" state rather than a fake connection.

## Stop 7 — Advanced & Preview surfaces *(Preview)*

Reveal the Advanced group to find centers like **Digital Twin**, **Industry** (20 vertical packs), **Enterprise Marketplace**, **Cloud**, and **Federation**. These run on **seeded/in-memory data** and are labelled **Preview** in-app — explore them, but don't rely on them for production yet.

## Stop 8 — Administration & Settings *(Cloud + Local-first)*

Manage your organization, roles, and the **14 settings domains**. This is where an administrator sets up providers, reviews RBAC and HR privacy gating, and configures the environment. Tenant isolation is DB-enforced.

## After the tour

You've seen the everyday product and recognized the Preview edges. Deepen from here: the [User Guide](../user/NEUROPAUSE-USER-GUIDE.md) for full coverage, the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) to run a real evaluation, and the [Product Brochure](NEUROPAUSE-PRODUCT-BROCHURE.md) for the capability-by-capability overview.

## Related
[First 30 Minutes](../user/FIRST-30-MINUTES.md) · [Where Do I Go?](../user/WHERE-DO-I-GO.md) · [Product Brochure](NEUROPAUSE-PRODUCT-BROCHURE.md) · [Demo Script](../enterprise/DEMO-SCRIPT.md)
