# NeuroPause — Trial Experience

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: evaluators & pilot leads
>
> A structured way to *learn the product*, not a marketing fiction. Aligned with NeuroPause's progressive-disclosure model. Maturity tags apply throughout.

## Objective

By the end of the trial, an evaluator can explain what NeuroPause is, run representative business + AI + knowledge + operations workflows on their own data, and articulate the local-first / cloud-plane / external-dependency boundaries.

## Who should evaluate it

A small cross-functional group: one business/operations user, one administrator, and (ideally) one developer. That covers the User, Admin, and Developer guides.

## Recommended setup

Follow the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md): stand up PostgreSQL + Redis + the backend, create an organization, invite the evaluators. Configure an **AI provider** (Anthropic key or Ollama) if you want to evaluate live AI; otherwise you'll see honest deterministic fallbacks.

## Trial duration

**Trial duration and any feature/entitlement limits must be configured by the operator.** This build does not hard-code a trial length; treat the checklist below as a suggested cadence, not a product-enforced clock.

## What evaluators should experience (progressive)

`START → Today` · `DISCOVER → Work Hub` · `OPERATE → Business` · `INTELLIGENCE → Knowledge` · `AI → AI Workforce` · `CONTROL → Operations` · `EXTEND → AI Store / Connectors` · `ADVANCED → Developer / Admin`.

## What requires what

- **Local-first (works on-device):** Business/ERP, Knowledge, AI Memory (lexical), Operations dashboards, Runtime, automations.
- **Cloud (needs backend):** sign-in, AI Store catalog, organizations/devices, sync.
- **External dependency (you configure):** live AI (provider), semantic search (Qdrant+embeddings), OAuth login, connectors (per-provider), billing (Razorpay).
- **Preview (seeded/in-memory):** Enterprise Knowledge, Digital Twin, Autonomous Operations, Industry Center, Enterprise Marketplace, Cloud, Federation, and other Advanced centers.
- **Not available:** a public HTTP Enterprise API; a signed/notarized packaged artifact; any external compliance certification.

## Suggested evaluation workflows

1. Persist and reload real records in one Business family.
2. Save to AI Memory; find it via Knowledge search.
3. Run one governed AI action (with a provider) and inspect the approval + evidence.
4. Connect one real integration in Connectors.
5. Select your vertical's Industry pack (Preview) and review its scope.
6. Trigger a backend outage and confirm honest states + recovery (optional, from the Pilot Guide).

## Success looks like

Evaluators navigate confidently, records persist, AI is governed and honest, dependencies are understood, and Preview surfaces are recognizable as such. Capture findings against the [Trial Checklist](TRIAL-CHECKLIST.md).

## Related
[Trial Checklist](TRIAL-CHECKLIST.md) · [First 30 Minutes](../user/FIRST-30-MINUTES.md) · [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md)
