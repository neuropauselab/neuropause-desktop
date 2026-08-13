# NeuroPause — 30-Minute Demo Script

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: sales engineers, pilot leads
>
> A truthful 30-minute walkthrough. **Only demo what's operational.** Have the backend up and (ideally) an AI provider configured. If something isn't configured, show the honest state — that *is* the story (NeuroPause never fakes success).

## Pre-flight (before the call)
- Backend up: `/health` = ok. Signed in. AI provider set (or be ready to show the honest fallback).
- Decide the one Business family and the one Industry pack you'll show.
- Know which surfaces are **Preview** so you can frame them accurately.

## 0–3 · What NeuroPause is
One AI-native enterprise operating system: business modules + AI + knowledge + operations in one desktop app. Two ideas up front: **local-first** (your data is on the device) and a **thin cloud plane** (sign-in, store, sync). It's a **Release Candidate** — pilot-ready, honest about maturity.

## 3–6 · Today / Work Hub
Show the sidebar grouping and the three Today landings (Mission Control / Today's Intent / Work Hub). Open **Work Hub** — the personal day. Press **⌘K** to show fast navigation and that everything is reachable.

## 6–10 · Business / ERP
Open **Business**; show the family grouping (104 modules / 13 families). Open your chosen family (e.g. Finance or CRM), create or open a record, and reopen it to show it **persists locally**. Emphasize it's real local-first data, not a mock.

## 10–13 · AI Workforce
Open **AI Workforce**. Walk the governance model: *intent → governance → permission → execution → evidence*. Run one governed action; show the approval and the evidence trail. If no provider is configured, show the honest "not configured" fallback and explain the provider dependency.

## 13–16 · Knowledge
Open **Knowledge**; run a search; show AI Memory. Mention local lexical search always works; semantic ranking is an external dependency that degrades gracefully.

## 16–19 · Digital Twin *(Preview)*
Open **Digital Twin Center**; note the Preview banner. Frame it as a modeled view over local data — honest about maturity.

## 19–22 · Operations
Open **Operations**; show health/risk/incidents and the honest status indicator (only "Live" when data actually loaded). Optionally show a degraded state.

## 22–25 · Industry *(Preview)*
Open **Industry Center**; browse the 20-pack catalog; open your prospect's vertical pack; explain packs reuse the enterprise core (Preview maturity).

## 25–27 · Marketplace / Connectors
Show **AI Store** (install an app) and **Connectors** (the 13 connectable + 9 Preview). Connect one real integration, or show the honest "needs provider config" state.

## 27–29 · Governance & security
Show Administration + Settings → Governance/Security. Mention: server-side auth, keychain-encrypted tokens, tenant isolation, audit — and that **no external certifications are claimed** (a strength: honesty).

## 29–30 · Pilot / next step
Point to the [Enterprise Pilot Guide](ENTERPRISE-PILOT-GUIDE.md) and [Trial Experience](../product/TRIAL-EXPERIENCE.md). Agree on the one vertical + workflows for a pilot, and the dependencies to configure.

## Do NOT demo
Anything not operational in your environment; OAuth/billing/semantic/connectors that aren't configured (show the honest state instead); a "public HTTP Enterprise API" (it doesn't exist); any compliance certification.
