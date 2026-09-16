# NEUROPAUSE ERP — AUTONOMOUS ENGINEERING PROGRAM · MASTER PLAN (Phase 0)

**Date:** 2026-09-01 · **Base HEAD:** `f0ac6c1` (seam #1 landed) · **Branch:** `cert/data-import-cst-integration`
**Nature:** dependency-ordered seam backlog for the Level-1 → Level-2 → Level-3 ERP build. Additive; reuses the
existing enterprise-module framework; no frozen surface; no parallel domain model.

This plan governs the autonomous program. Each session is ONE vertical seam, closed end to end
(UI/IPC → service → store/DB → transaction/audit/event → readback) with tests + negative controls + evidence,
then committed. Stops only at the safety boundary (external secret · destructive prod op · irreversible migration ·
paid service · unavailable hardware · materially-consequential architecture decision).

---

## 1 · WHAT IS ALREADY REAL (the baseline — do not rebuild)

NeuroPause ships a genuinely deep ERP: **106 enterprise modules** on one declarative framework
(`defineEnterpriseModule` → descriptor + `EnterpriseRecordStore` + hooks), each inheriting RBAC, tenant scope,
audit, timeline, renderer broadcast, generic CRUD/action IPC, offline-first persistence. Two spines are real
domain engines, not mockups:

- **Physical spine** — an append-only stock-movement ledger (`postStockMovement`, balance = Σ movements),
  reservations, reorder→PR, ledgered production orders, BOM explosion.
- **Financial spine** — a real double-entry GL (`journalEntryModule` governed `post`, `applyGlDerivedEntries`,
  AR/AP auto-posting, FX, periods).
- **Seam #1 (CLOSED, `f0ac6c1`)** — the inventory ledger posts to the GL (`inventoryGlBridge`): a valued movement
  → one balanced, idempotent journal entry.
- **Seam #1-spine / Session 1 (CLOSED, this commit)** — the correlation/causation transaction-graph spine
  (below).

Mapping to the operator's **3-layer target**: System of Record = the 106-module canonical store; System of
Control = per-module RBAC/ABAC + the CST governance kernel + approval gates; System of Intelligence = Live Brain
(propose-only) + the enterprise intelligence subsystem. The seams below thicken the System of Record and wire it
to Control/Intelligence.

---

## 2 · GAP MAP (RED = missing · YELLOW = partial · GREEN = real)

| ERP capability | State | Note |
|---|---|---|
| Canonical entities + CRUD + RBAC + tenant + audit | 🟢 GREEN | 106 modules on the framework |
| Inventory ledger (physical truth) | 🟢 GREEN | append-only, reconciled |
| Double-entry GL (financial truth) | 🟢 GREEN | governed post, balanced, periods, FX |
| Inventory → GL posting | 🟢 GREEN | seam #1 (`f0ac6c1`) |
| **Transaction graph (correlation/causation)** | 🟢 GREEN | **Session 1 (this commit) — spine + 2 funnels + sales chain** |
| Domain-action ↔ document-adapter posting parity | 🟡 YELLOW | seam #2 — some actions emit `updated` not `status_changed` |
| MRP → persisted requirements / PR / production orders | 🟡 YELLOW | seam #3 — engine real, terminates in counts |
| QA disposition → inventory quarantine/reject | 🔴 RED | seam #4 |
| Production actual-cost + variance posting | 🟡 YELLOW | seam #5 — order consumption/output movements exist |
| Posted-movement void / reversal (governed) | 🔴 RED | seam #6 |
| Multi-line receipts / dispatches | 🟡 YELLOW | seam #7 — ledger unit is per-movement today |
| Remaining conversion seams carrying correlation | 🟡 YELLOW | Session 1b — ~18 hand-written conversions (mechanical) |

---

## 3 · DEPENDENCY-ORDERED SESSION BACKLOG

1. **Session 1 — correlation/causation transaction-graph spine** ✅ CLOSED (this commit). Everything downstream
   (trace, variance attribution, "why is this delayed?", AI explanations) depends on a shared transaction id.
2. **Session 1b — correlation across the remaining conversions** (procurement PR→PO→GR, manufacturing
   order→schedule→execution→movements, warehouse pick→pack→ship, maintenance PM/CM→WO, CRM lead→contact/customer,
   projects billing-run→invoice). Mechanical: each hand-written conversion adds `childCorrelationMeta(source,…)` to
   its create + `rootMetaIfUnset` to its source update, reusing the Session 1 helper. Independent per domain.
3. **Session 2 — domain-action ↔ document-adapter posting parity** (seam #2): every consequential domain action
   that changes financial/stock state posts through the governed funnels; reconcile the status-vs-updated event key.
4. **Session 3 — MRP → persisted planned orders** (seam #3): the net-requirement engine drafts real PRs /
   production orders (reuse the auto-reorder drafting seam), carrying correlation to the demand that caused them.
5. **Session 4 — QA disposition → inventory** (seam #4): pass/quarantine/reject post movements (quarantine
   warehouse) and gate receipt/output.
6. **Session 5 — production actual-cost + variance** (seam #5): derive actual cost from an order's own
   consumption/output movements; post the variance to the GL (5900/5910), attributed by correlation.
7. **Session 6 — governed void/reversal of a posted movement** (seam #6): a reversal entry, never a history rewrite.
8. **Session 7 — multi-line receipts/dispatches** (seam #7).
9. **Then** the remaining Level-1/2/3 gaps in dependency order, each its own session.

---

## 4 · STANDING ENGINEERING RULES (every session)

Reproduce/verify before editing · fix root causes · never weaken security/tenancy/consent/authorization/
provenance/Vault/fail-closed · additive, no parallel domain model · UI→IPC→service→store→transaction/audit→readback
or it is not done · tests + negative controls (mutate→fail→restore byte-identically) + blast-radius suite +
tsc(node+web) + lint + build · honest evidence label (SOURCE/TEST/LIVE) · one commit per session · the user pushes
from their Mac · never fake green. AI proposes only; never bypasses authorization or writes the DB directly;
correlation ids are system-derived, never taken from model output.
