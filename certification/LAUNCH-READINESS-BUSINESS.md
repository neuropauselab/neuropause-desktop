# LAUNCH-READINESS — BUSINESS EDITION (NP-010 §6)
### Per-module truth: what it holds, what is verified, what is draft-only, what is gated. · 2026-08-20

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

Companion to `LAUNCH-READINESS.md` (the app-wide edition). Sources: `BUSINESS-DATA-MODEL.md`,
`CONNECTOR-REALITY.md`, the NP-008 census, and tonight's NP-010 §2/§3/§5 slices (commits `df17ac6`, `bf39fb5`,
`59cca40`). Vocabulary per the standing law: **ingested ≠ verified · drafted ≠ sent · kit-complete ≠ certified.**

## The honest claim for the outside world

> **Your business data, provenanced and queryable — on your device.** NeuroPause holds your parties, invoices,
> orders, payments, inventory and employees in tenant-scoped local records. Data you import is identified,
> reviewed before anything is written, and traceable back to the row it came from — and every ingested record
> carries an honesty label (nothing imported is called *verified* until something independently corroborates it).
> Financial summaries name their evidence ("computed over N invoices from source X"). **Consequential actions are
> certified one at a time**: today exactly one (sending mail through Microsoft 365) has passed that bar; AI may
> *propose* business actions, and nothing sends without your confirmation.

## Per-family readiness

| Family (modules) | Census class | Data it can hold | Verified / proven | Draft-only / proposal-side | Gated / not yet |
|---|---|---|---|---|---|
| **Finance (21)** | LIVE (honest-empty) | invoices, payments, GL (double-entry), ledger accounts, bank statements, budgets, vendor bills, AR/AP aging, FX, treasury, tax reports | GL posting deterministic + tested; **AR aging snapshots now carry evidence lineage (§3)**; invoice lifecycle actions (issue/cancel) post to GL | Invoice "send", payment links, push-to-accounting: proposal/ASK shapes only — each a FUTURE S23 kit rung | GST filing formats (GSTR/e-invoice/HSN) NOT implemented — flat tax rate + GSTIN capture only, stated plainly |
| **Sales (7)** | LIVE (honest-empty) | quotes, **orders (now file-ingestable, §2)**, contracts, pricing, commissions, forecasts | quote→order conversion; order lifecycle actions | Revenue forecasts compute; no outbound action certified | — |
| **CRM (8)** | LIVE (honest-empty) | customers (ingestable), contacts, leads, opportunities, activities | identity matching at import time; relationship chains (order-to-cash) | Outreach = the §5 reminder class, proposal-side only | — |
| **Procurement (7)** | LIVE (honest-empty) | suppliers (ingestable), POs, receipts, RFQs, vendor contracts | 3-way match + budget controls exist in-app | PO issuance to a vendor: future kit rung | — |
| **Inventory / Warehouse (15)** | LIVE (honest-empty) | products (ingestable), movements, lots, serials, reservations, valuations, bins, transfers | movement ledger deterministic; device-grade lot trace (medical pack) | Auto-reorder proposes, never orders | — |
| **HR (15)** | LIVE (honest-empty) | employees (ingestable), payroll runs, payslips, statutory (ECR/ESI/PT/24Q) | payroll math deterministic + tested; Indian statutory table-driven | **Statutory FILING is a manual human act** — files are prepared, never submitted | salary disbursement executes nothing external |
| **Manufacturing (12) / Maintenance (10) / Projects (4) / Helpdesk (1) / Documents (1)** | LIVE (honest-empty) | BOMs→executions, work orders, time entries→billing runs, tickets, doc registry | costing guard, BOM explosion pinned | production scheduling proposes | document registry stores refs, not bytes |
| **Medical Devices (2 + trace)** | LIVE (honest-empty) | product catalogue, lots (9-state), trace edges | forward/backward trace from real records | — | explicit no-regulatory-claim on the surface |

## The ingestion spine (§2 — what changed tonight)

- **12 canonical entities** now importable (was 10): + `payment` → finance-payments, + `sales_order` → sales-orders
  (closing the documented orders-become-junk-customers defect, its old lock rewritten to hold the fix shut).
- **Every ingested object carries the honesty label** `unverified-source` — on the provenance row AND the record
  metadata, at all four ingestion sites (file import create/adopt, connector bridge, identity adoption).
  `verified` is reserved for corroboration; **no code path can assign it** (source-pinned).
- Approve-before-write remains structural; HIGH-risk (finance/HR) imports are all-or-nothing with compensating
  rollback; per-field provenance + import idempotency keys unchanged.
- **Honestly excluded** (multi-line destinations; follow-ups, not hacks): journal-entry and bank-statement file
  import need an aggregation-shaped importer; Tally-XML vouchers and GST return files land with that mechanism.
  QuickBooks/Zoho flat CSVs flow through the existing + new entities today (the payments fixture is Zoho-shaped).

## The financial core (§3) and the Brain (§5)

- **The tile law is live on AR aging**: every generated snapshot names its register — "Computed over N invoice(s) —
  X imported from <file> (unverified-source), Y entered in app" — rendered through the existing module UI.
  Extension of the same one-rule helper to cash position, GST summaries and the Business dashboard tiles is the
  recorded next lineage slice.
- **The Brain now SEES business facts** (`composeBusinessFacts`): overdue invoices as provenanced facts with
  five-valued certainty, derived through the certified aging core — a fact is never more certain than its source,
  and an unreadable register is UNAVAILABLE, never zero. **It PROPOSES** (`draftOverdueReminder`): a deterministic
  mail.send candidate whose recipient can come ONLY from the operator's mandate — auto-filling from record data is
  a REFUSAL, pinned. **It does not reach**: zero-runtime-import purity pinned; the production trigger is an
  explicit gate that opens only after the S5.4 ceremony, riding the one certified capability.

## Write-deep status (§4)

One capability above the certified line (`mail.send`, LIVE-VERIFIED once). The ranked revival ladder is presented
in `CONNECTOR-REVIVAL-LADDER.md` — calendar.create presumed second (kit dry-run done), Razorpay payment-link as
the highest-value future rung and the second-connector abstraction test — **awaiting the operator's order ruling**.
Everything below the line refuses at the boundary today, by test.

## Open follow-ups (recorded, not hidden)

Aggregation-shaped importer (Tally XML / bank CSV / GST files) · lineage on cash position + GST summaries + the
Business dashboard tiles (one shared rule; renderer/shared placement may need an FG gate) · invoice lifecycle
evidence-per-transition model (paid ← payment reference exists; sent requires a certified send) · §5 lane wiring
(post-ceremony gate) · GST compliance formats (a program, not a patch) · the NP-008/master-recon findings that
touch business surfaces (F-MR-5 connector certification dimension in UI).

## Verification this edition stands on

NP-010 commits `45a0970` (§1) · `df17ac6` (§2) · `bf39fb5` (§3) · `1b29368` (§4) · `59cca40` (§5) — each with
suites green at commit time (final: full main **862 files / 9010 passed / 3 skipped**, ui **41/278**, typecheck
clean, honesty scans 0). FREEZE INTACT throughout; **zero frozen touches; zero external effects; ceremony
surfaces untouched.**
