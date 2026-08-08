# NeuroPause — Release Notes (Release Candidate `1.0.0-rc.15`)

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilots, evaluators, IT
>
> These notes describe the **current Release Candidate** and its recent hardening focus. They intentionally do **not** reconstruct a per-version history we cannot verify; they describe the state of `1.0.0-rc.15` as it actually stands. **RC ≠ GA.**

## Release summary

`1.0.0-rc.15` is a **Release Candidate**: pilot-ready quality, general availability pending. The recent work has centered on *credibility* — making sure the product tells the truth about itself, that real data paths are proven, and that the experience feels like one coherent product. The release gate (typecheck + lint + tests across shared, protocol, cloud-core, backend, and desktop) is green at **5,703 tests across 631 files** on this baseline.

## Highlights of recent hardening

- **Pilot-credibility hardening.** Automation execution never reports success for a no-op; business views handle errors honestly; Operations shows "Live" only when data actually loaded; in-view Preview banners mark preview surfaces.
- **Information architecture & Apple-grade UX.** Surfaces were regrouped and relabelled into one coherent product with a progressive-disclosure model (everyday surfaces up front; advanced centers on demand) — without rebuilding business logic or changing route identity.
- **Desktop end-to-end certification.** Auth, tenancy, authorization, AI Store, health, and failure/recovery were certified against a **real** PostgreSQL 16 + Redis 7 + Express backend — no mocks. This also established the decisive architectural truth that business data is **local-first**.
- **Documentation & product enablement.** A complete user/admin/developer/enterprise/product/support documentation set with honest maturity labelling throughout (this release).

## What's in this RC

- **Business (ERP):** 104 modules across 13 families, persisting locally. *(Local-first — Verified)*
- **AI Workforce:** governed AI (intent → governance → permission → execution → evidence). *(Works with a provider; provider is an External dependency)*
- **Knowledge & AI Memory:** natural-language search; lexical always on. *(Local-first; semantic optional)*
- **Operations:** honest health/risk/incident views. *(Local-first — Verified)*
- **AI Store & Connectors:** discoverable catalog; 22 connectors (13 production-ready + 9 Preview). *(Cloud + External dependency)*
- **Administration & Settings:** organizations, roles, 14 settings domains. *(Cloud + Local-first)*

## Preview surfaces in this RC

Digital Twin Center, Industry Center (20 packs, catalog `0.0.0-preview.1`), Enterprise Marketplace, Cloud, Federation, and other advanced centers run on **seeded/in-memory data** and are labelled **Preview** in-app. They are for exploration and feedback, not production reliance.

## Dependencies to configure

None of the following are fabricated when absent — each shows an honest state until you configure it: an **AI provider** (Anthropic key or local Ollama) for live AI; **Qdrant + embeddings** for semantic ranking; **OAuth apps** for social sign-in and for each connector; **Razorpay** keys for billing.

## Known limitations

- **Cold-launch auth needs the backend.** If the backend is unreachable at launch, users are stranded on the login screen despite local data being present.
- **Desktop visual QA on macOS is a human task** and is treated as pending sign-off, not auto-claimed.
- **No public HTTP Enterprise API.** The enterprise surface is in-process typed IPC/SDK, not a public HTTP API.
- **No signed/notarized packaged artifact is published yet** — pilots run from source or an unsigned build.
- **Windows and Linux are planned**, not certified in this build.

## Not claimed

No SOC 2 / ISO 27001 / GDPR / HIPAA certification; no DPA or data-residency guarantees beyond what Settings exposes; no pricing, SLAs, or trial durations (operator/commercial decisions).

## Upgrade / pilot guidance

Follow the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) for the verified setup path (`npm install → infra:up → db:migrate → dev`) and the security checklist (including rotating any secrets ever placed in dotfiles). Verify `GET /health` returns `{"status":"ok"}` with database and redis `up` before onboarding users.

## Related
[Product Brochure](NEUROPAUSE-PRODUCT-BROCHURE.md) · [One-Page Product Sheet](ONE-PAGE-PRODUCT-SHEET.md) · [Trial Checklist](TRIAL-CHECKLIST.md) · [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md)
