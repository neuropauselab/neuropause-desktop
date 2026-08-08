# NeuroPause — Phase 6 Finalization Closeout

**Date:** 2026-08-08 · **Build:** `1.0.0-rc.15` · **Branch:** `phase6-stage13-enterprise-digital-twin-platform` · **Baseline:** `1cd95e7`

## Executive summary

This pass closed the **P0 gap** the previous closeout named: the Universal Enterprise Data Plane is now wired end-to-end through the secure IPC architecture — permissions, channels, typed contracts, response map, runtime authorization, subsystem, `runtimeCore`, and an explicit renderer namespace. It also delivered **tenant-isolated mapping memory**, **import lifecycle notification**, and **real segregation of duties** on high-risk approval.

It did **not** deliver P1 (line-item documents), P2 (accounting integration), the Data Command Center UI, the medical-device pack, or the Relife pilot foundation. Those are classified, explained and sequenced in `claude/PHASE-6-FINAL-WIRING-PLAN.md` rather than partially faked.

**One mandatory step was not performed and could not be:** macOS Electron boot verification. See "Not verified" below — it is the single most important caveat in this report.

**Gate:** typecheck PASS · lint PASS · **5,790 tests / 634 files green** (from 5,766 / 633 — **+24, zero regressions**). No test was deleted or weakened.

## COMPLETE / VERIFIED this pass

| Item | Evidence |
|---|---|
| Data Plane engine preserved, not rewritten | Only behavioural change: an explicit decline now reports `skipped`, not `awaiting_approval` |
| Three separable permissions (`data:read` / `data:import` / `data:approve`) | Added to the union + `ALL_ENTERPRISE_PERMISSIONS`; asserted by test |
| 11 `dp:*` channels registered, contracted, response-mapped | `channels.ts`, `contracts.ts` (bounded `.strict()` Zod), `responses.ts`, `types/dataPlane.ts` |
| Runtime authorization on every channel | `RUNTIME_CHANNEL_PERMISSIONS`; read and write scopes separated |
| Subsystem + `runtimeCore` wiring | Reuses the enterprise module registry, authz gate and governance audit sink — no parallel infrastructure |
| Explicit renderer namespace (`ipc.data.*`) | No arbitrary `invoke`; **content crosses IPC as base64, never a filesystem path** |
| **Boot-invariant replicated in tests** | `wiring.test.ts` runs the real `assertAllChannelsClassified` over the real registries and handler defs |
| Segregation of duties on approval | Approving a high-risk table demands `data:approve`; `data:import` alone is refused — asserted, including that nothing is written |
| Mapping memory, tenant-isolated | Versioned, auditable, `useCount`; a tenant-B lookup **cannot** return a tenant-A mapping (asserted) |
| Import lifecycle notification | One event per destination module with a correlation id; nothing emitted when nothing imported |
| Audit on mutating channels | `dataplane.import`, `dataplane.import.approved`, `dataplane.mapping.saved/forgotten` |

## PARTIAL

- **Import lifecycle events** — subscribers are notified; imports do not yet re-enter each module's `hooks.onChange`. Loop-guarding via the correlation id is designed, not implemented.
- **Transactional import** — compensating rollback for high-risk tables. Not ACID; JSON stores cannot be.
- **Import Center** — the full backend API exists (`dp:history`, `dp:run`, `dp:provenance`); there is no UI.

## NOT IMPLEMENTED

Line-item documents · inventory→GL / COGS · GRNI · three-way match · WIP/variance · ERP multi-level approval and SoD · Data Command Center UI · provenance UI · cross-domain relationship reconstruction · medical-device industry pack · batch/lot traceability views · quality/document-control foundation · Relife tenant, dataset, dashboard and pilot documents · connectors · PDF extraction.

**Three of the accounting items are blocked on line items.** Implementing GRNI or a three-way match against single-line documents would yield numbers that look correct and are not — the worst outcome for an accounting system, so it was not done.

## EXTERNAL DEPENDENCY

Image OCR (no engine bundled) · external ERP connectors (no credentials, no tested endpoint — status stays **NOT CONFIGURED**, never CONNECTED) · PDF, pending a packaging validation that requires actually building the app.

## NOT VERIFIED — the mandatory step that was not done

The charter requires launching the real Electron app on macOS before claiming the wiring complete. **This was not done.** This session runs in a Linux container; the bridge to the developer's Mac executes in an isolated Linux VM and cannot launch the packaged app.

To remove the specific danger that caused the previous pass to decline wiring altogether — `runtimeCore` throws at boot for an unclassified channel, and that check does not run in tests — `wiring.test.ts` now replicates that invariant against the real registries. The "app will not boot" failure mode is therefore caught by `test:release`.

Still unverified, and only verifiable by running the app: preload exposure, window lifecycle, the renderer round-trip, and the runtime behaviour of the session/workspace accessors the subsystem is bound to (`authService.getStatus()`, `workspaceStore.activeWorkspaceId()`). **Until an operator launches the app, Phase 6 wiring is COMPLETE-BUT-UNVERIFIED, not VERIFIED.**

## Security

Untrusted input handling is unchanged and still holds: bounds-checked ZIP offsets, entry/per-entry/whole-archive inflation budgets, refusal of ZIP64, encrypted archives and unknown compression methods, no DTD or external-entity resolution, row ceilings, no execution of uploaded content, formulas read as values. Added this pass: a 64 MiB base64 request ceiling enforced by Zod before any parsing is scheduled; no filesystem path accepted from the renderer; tenant-scoped mapping memory with cross-tenant reads asserted impossible; and a distinct approval scope so bulk-loading rights do not confer approval rights over payroll or money.

## Pilot readiness

**NOT PILOT READY for Relife Ortho.** The pilot foundation was deliberately not started. Building a medical-device pack over an ERP whose inventory never reaches the ledger and whose documents have no line items would produce a demo rather than a foundation, and a traceability story resting on that base would be misleading in a regulated industry. No compliance, certification or regulatory claim is made anywhere in this work.

The **Universal Data Plane itself** is pilot-ready as an engine once the app is launched and the Data Command Center exists.

## Recommended next steps

1. **Operator: launch the app on macOS** and verify boot plus one `dp:*` round-trip. Nothing else should proceed until this passes.
2. Build the Data Command Center UI — the backend is fully reachable.
3. **Line-item documents** — the single highest-value ERP change and the unlock for most of the accounting gaps.
4. Inventory→GL, GRNI, three-way match, WIP/variance, in that order.
5. Generalize the data plane's SoD pattern into an ERP approval engine.
6. Only then: medical-device pack → Relife pilot foundation.

## Final status

**PHASE 6 FINALIZATION — P0 WIRING COMPLETE (UNVERIFIED ON DEVICE). P1/P2 NOT IMPLEMENTED AND SEQUENCED.**

Phase 7 has not been started.


---

# ADDENDUM — ERP Foundation Pass (2026-08-08, later same day)

This addendum supersedes the "NOT IMPLEMENTED" lines above for the items it names.

## Executive summary

Following the charter's own dependency order — *complete the ERP foundation first* — this pass built the **structural keystone** the Phase 6 recon identified: line-item documents, and the accounting integrations they unblock. **48 new tests, all green. Gate: 5,838 tests / 635 files, zero regressions.**

## Work completed

**Line-item documents (`erp/documentLines.ts`) — VERIFIED COMPLETE.** Eight trade document types get real parent/child lines. Design: lines are their own records keyed by parent, NOT a widened `EnterpriseFieldValue` — so all 104 modules, the descriptor validator, the sync `rev` model and the certification lock stay untouched. `journalEntry` is deliberately excluded: the GL already has a real, balance-guarded line model, and duplicating it would create a second accounting truth. Because JSON storage has no foreign keys, parent/child integrity is enforced in the service layer: all-or-nothing writes, an explicit cascade, and an orphan sweep.

**Deterministic totals — VERIFIED COMPLETE.** Money is computed in integer minor units with half-up rounding; document totals are the **sum of rounded line totals**, not a re-computation over summed inputs (which is what makes an invoice disagree with its own printed lines by a cent). Tested against rounding edges, discounts, tax, credit lines, zero price and mixed currency.

**Three-way match (`erp/threeWayMatch.ts`) — VERIFIED COMPLETE.** PO ↔ GR ↔ Bill on supplier, currency, product, quantity and price with explicit configurable tolerances, resolving to MATCHED / PARTIAL / MISMATCH / BLOCKED / MANUAL_REVIEW. **A mismatch never posts.** Covers overcharge, over-billing, billing before receipt, unordered items, excessive over-receipt, and wrong-supplier/wrong-currency blocks.

**Stock and production accounting (`erp/postingRules.ts`) — VERIFIED COMPLETE.** Closes the ceiling "inventory, production and procurement never reach the books": goods receipt (Dr Inventory / Cr GRNI), supplier bill (Dr GRNI / Cr AP, clearing only what was matched), COGS on dispatch (Dr COGS / Cr Inventory), inventory adjustment both directions, material issue (Dr WIP / Cr Inventory), and production completion (Dr Finished Goods + variance / Cr WIP). Rules **derive** balanced journal lines; the existing journal module still **posts** them, so there remains exactly one accounting engine with one balance guard. A rule that cannot compute a defensible amount produces **no entry** and says why — an uncosted dispatch refuses rather than posting a partial cost of sale. Valuation: `weighted_average` and `standard` implemented and named; **FIFO is not implemented and not claimed.**

**Approval engine + segregation of duties (`erp/approvalEngine.ts`) — VERIFIED COMPLETE.** Generalizes the Data Plane's proven pattern: configurable multi-step, threshold, role-based and department-scoped approval, with SoD as an independent control (creator-cannot-approve, no repeat approver, no self-approved payment). A user can hold the required role and still be barred. Refused decisions record nothing.

**Procure-to-pay E2E — VERIFIED COMPLETE.** Receipt accrues GRNI → three-way match → matched bill clears it, asserting **GRNI nets to zero**.

## What remains NOT IMPLEMENTED

The engines above are complete and tested but **not yet adopted by the 104 live ERP modules** — replacing flat fields with lines and calling the posting rules from module lifecycle hooks is the next step. Also still absent: the Data Command Center / Import Center / Provenance UIs, cross-domain relationship reconstruction, export, module-level lifecycle re-entry, connectors, PDF/OCR, and the entire medical-device pack and Relife pilot foundation.

**Relife was deliberately not started**, per the charter's own rule. The foundation only became reliable in this pass and no module calls it yet; a regulated-industry traceability story resting on that would be feature theater.

## Final status

**PHASE 6 ENGINEERING — ERP FOUNDATION COMPLETE. DEVICE VERIFICATION PENDING. UI, MEDICAL-DEVICE PACK AND RELIFE PILOT NOT IMPLEMENTED.**

Per-item status: `claude/PHASE-6-COMPLETION-MATRIX.md`. Device steps: `claude/MACOS-PHASE-6-OPERATOR-CERTIFICATION.md`.

Phase 7 has not been started.
