# NeuroPause — Pilot Test Pack

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilot evaluators
>
> A hands-on evaluation an evaluator can run on their own data. This is a **suggested pilot evaluation sequence**, not a fixed-length trial — the operator sets the actual duration. Each stage maps to the [Pilot Acceptance Criteria](PILOT-ACCEPTANCE-CRITERIA.md); record results against those IDs.

## How to use this pack

Work the stages in order — they follow the product's progressive-disclosure model (don't open all ~40 surfaces at once). For each step, note PASS / FAIL / BLOCKED / EXTERNAL-DEP and capture evidence (a note, a screenshot, or a support bundle). Log issues with the [Pilot Feedback Form](PILOT-FEEDBACK-FORM.md).

Before you start, confirm the environment from the [Enterprise Pilot Guide](ENTERPRISE-PILOT-GUIDE.md): backend up (`GET /health` = ok), an organization created, evaluators invited, and (optionally) an AI provider configured.

## Stage 1 — Install, authenticate, orient *(criteria INS-*, AUTH-*, NAV-*)*

1. Install and launch the app; complete first-run.
2. Sign in with email/password; confirm you reach the shell.
3. Try an invalid login once — confirm it's rejected honestly.
4. Restart the app — confirm your session persists.
5. Identify the three groups (Today / Business / Advanced); open **Work Hub**; press **⌘K** and jump to three different surfaces.
6. Open the in-app help and confirm the documentation links resolve.

*Goal:* a new user understands where to start, what the product is, where their work/AI/business/admin live.

## Stage 2 — Business workflows on real data *(criteria ERP-*)*

1. Open **Business**; pick 1–2 families you actually use (e.g. Finance, CRM, HR).
2. Create a record, edit it, close it, and reopen it — confirm it **persists locally**.
3. Restart the app and reopen the record — confirm **no data loss**.
4. Exercise a representative chain for your area (e.g. Procurement request→approval→PO; Inventory item→movement→quantity).
5. Confirm permission gating (e.g. HR read/manage restricted to Manager/Admin).

*Goal:* representative local-first business workflows persist and behave.

## Stage 3 — AI & Knowledge *(criteria AI-*, AUTO-*, KN-*)*

1. Save something to **AI Memory**; retrieve it from **Knowledge** search (lexical always works).
2. If a provider is configured: run one **AI Workforce** action end-to-end; inspect the approval + evidence trail. If not: confirm the honest deterministic fallback (no fake result).
3. Run one **automation** (e.g. create reminder / save memory); confirm it produces a real effect — or fails honestly.
4. If Qdrant + embeddings are configured: confirm semantic ranking; otherwise confirm graceful lexical fallback.

*Goal:* AI is governed and honest; knowledge persists and is retrievable.

## Stage 4 — Operations & Industry *(criteria OPS-*, IND-*)*

1. Open **Operations**; confirm the status indicator reads "Live" only when data actually loaded (a degraded/empty state is truthful).
2. Open **Industry Center**; select your vertical's pack; review its scope (**Preview** — seeded/in-memory).
3. Note which advanced surfaces are Preview via their in-app banners.

*Goal:* operational status is honest; Preview surfaces are recognizable as such.

## Stage 5 — Marketplace & integrations *(criteria MKT-*, AUTH-5)*

1. Open **AI Store**; browse the catalog; install/launch an app where supported (install path is worker-oriented today).
2. Open **Connectors**; connect one real integration if its OAuth app is configured — otherwise confirm the honest "not configured" state.
3. Review **Enterprise Marketplace** (Preview) governance.

*Goal:* catalog and connection flows behave; unconfigured providers show honest states.

## Stage 6 — Security, recovery, admin *(criteria SEC-*, REC-*)*

1. Log out; confirm credentials are cleared; sign back in.
2. Force-quit the app during use; relaunch — confirm local data is intact (corrupt stores are quarantined, not reset).
3. Admin: review Administration, Settings (14 domains), roles/RBAC, and the security checklist in the [Data & Security Guide](DATA-AND-SECURITY-GUIDE.md).

*Goal:* recovery is safe; security posture is understood.

## Final — Review against acceptance

Walk the [Pilot Acceptance Criteria](PILOT-ACCEPTANCE-CRITERIA.md), record PASS/FAIL/accepted-dependency per ID, and make a **go / no-go** decision with a documented list of what to configure for production (providers, signing, secret management, backend/feed hosting).

## Related
[Pilot Acceptance Criteria](PILOT-ACCEPTANCE-CRITERIA.md) · [Pilot Feedback Form](PILOT-FEEDBACK-FORM.md) · [Enterprise Pilot Guide](ENTERPRISE-PILOT-GUIDE.md) · [Trial Checklist](../product/TRIAL-CHECKLIST.md)
