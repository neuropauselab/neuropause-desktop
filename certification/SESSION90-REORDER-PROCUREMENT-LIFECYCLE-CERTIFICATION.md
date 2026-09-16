# SESSION 90 — REORDER → PROCUREMENT LIFECYCLE — CERTIFICATION

**Class:** governed lifecycle continuation + certification. **Outcome: the S89 reorder-created draft PR continues through the EXISTING governed procurement lifecycle (Submit → Approve → Convert → PO) with ZERO production changes.** No new approval engine, no second workflow, no bypass, no automation added. No frozen change; no FG-S90 token. Baseline S89 GREEN. Release track PAUSED.

## 1. Discovery / source-wins

The full PR→approve→PO governed lifecycle already exists (ERP S17/S20/S49) and is wired to the UI. The S89 reorder PR is a normal PR record that flows through it. Key sources: `commandBus.ts` (Submit/Approve/Reject/Convert commands), `purchaseRequestModule.ts` (status machine + edit-door authority fence), `conversion.ts` (approval-gated, idempotent PR→PO with lineage), `workflowRuntime.ts` (the DEFINED policy statement), `EnterpriseModuleScreen.tsx` (GOVERNED table routing the PR buttons to the commands).

## 2. Canonical PR lifecycle found

`draft → (SubmitPurchaseRequest) pending → (ApprovePurchaseRequest) approved → (ConvertPurchaseRequestToPO) ordered`, producing ONE draft PO. Conversion refuses unless `status==='approved'` and is idempotent (`convertedOrder` guard). Full trace + guards in DECISION-MEMO-S90 §1.

## 3. Exact governed commands reused

`SubmitPurchaseRequest`, `ApprovePurchaseRequest`, `ConvertPurchaseRequestToPO` — all existing, all through the durable command journal (idempotency + `PurchaseRequestSubmitted`/`Approved`/`ConvertedToPO` events + outbox + audit), all `procurement:manage`-authorized (conversion also asserts the orders write scope). Reused verbatim; none modified.

## 4. Approval policy actually applied

The DEFINED, live-enforced policy is exactly **"a PR requires human approval before it becomes a PO"** (deny-by-default; conversion gated on `approved`; `approved` reachable only via the governed Approve command; edit-door refuses to hand-set approved/ordered). **No threshold / hierarchy / SoD / self-approval rule** — those are undefined and deliberately absent (§22); `DEFAULT_SPEND_POLICY`/`applicableSteps` is an unwired illustrative engine and was NOT wired (that would invent policy). DECISION-MEMO-S90 §2.

## 5. PO conversion / send path

Conversion is the S90 terminus: a **draft** PO with reorder lineage (`poNumber = PO-PR-REORDER-<report>-<sku>`, `sourceRequest = PR id`, Session-1 correlation). PO approve/send exist as governed PO module actions (RBAC-gated) but are **beyond the S90 target** and never performed automatically. DECISION-MEMO-S90 §3.

## 6. Status-machine proof

Verified (focused + journey): submit only from draft; approve only from draft/pending; convert only from approved; already-ordered cannot be re-approved; the approved/ordered boundary cannot be hand-set through the edit door (bypass refused); re-conversion refused (`convertedOrder` guard). `reorderProcurementLifecycle.test.ts` "status machine" block.

## 7. Idempotency / replay proof

Duplicate Submit/Approve/Convert under the same idempotency key replay (no second effect); a distinct-key re-conversion is refused by the already-converted guard; **replay across a durable-journal RESTART creates no duplicate PO**; exactly one PO per approved PR. No duplicate accounting/inventory effects.

## 8. Tenant / security proof

`ApprovePurchaseRequest` requires `procurement:manage` (denied actor → `UNAUTHORIZED`, PR stays pending); `NO_TENANT` → `UNRESOLVED_TENANT`; forged tenant → `CROSS_TENANT_CLAIM`; a foreign-tenant actor cannot see the PR (tenant-scoped store) → refused. Actor server-derived; AI holds no `procurement:manage` path and cannot approve/convert/send (advisory-only, §13). The command-bus path is journaled/audited; the module-action layer is RBAC+tenant+audit governed on both the command and legacy doors (the PR lifecycle is not in the S46 governed-only fence — recorded in DECISION-MEMO-S90 §4, not changed).

## 9. Side-effect proof

PR creation → one draft PR. Approval → status transition + governance records/events only. Conversion → exactly one draft PO. **No inventory mutation, no goods receipt, no supplier invoice, no supplier payment, no GL** from the PR→PO lifecycle (a draft PO is a document, not an economic event). Before/after snapshots in `reorderProcurementLifecycle.test.ts` side-effect block + the journey.

## 10. UI journey / identifiability

No new procurement screen; the existing PR detail already renders Submit/Approve/Create-Purchase-Order (routed to the governed commands, S49) and the reorder identity (`requestNumber` `PR-REORDER-…`, `reason`). After conversion the PO carries `PO-PR-REORDER-…` + `sourceRequest`. **No UI change was required** (minimum-UI-change satisfied by existing lineage data). DECISION-MEMO-S90 §5.

## 11. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`e2e/s90ReorderProcurementLifecycleJourney.e2e.cjs` on the alternate build (`out-seam-s90`), fresh isolated profile, governed bridge only. **Passed every assertion + RESULT on the first run, exit 0**: product → demand → S85 → S86 → S89 confirmation → draft PR (`PR-REORDER-…`, status draft — automation stops here) → an unapproved PR could NOT convert → the edit door refused to hand-set `approved` → Submit → pending → Approve → approved → Convert → **exactly ONE draft PO** carrying the reorder lineage (`PO-PR-REORDER-…`, `sourceRequest` = the PR), PO status draft (not auto-approved/sent), PR ordered + cross-linked; same-key convert replays; distinct-key re-convert refused (still one PO); **NO GL, NO inventory mutation.** Each transition was an explicit governed dispatch — the exact commands the UI buttons send.

## 12. Frozen-file changes

**None.** gate-detector PROCEED on all S90 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `moduleRegistry.ts`, `commandBus.ts`, `EnterpriseModuleScreen.tsx` untouched. No FG-S90 token. `certification/baseline.json` untouched. Zero production code changed.

## 13. Test totals

`reorderProcurementLifecycle.test.ts` **10/10** (happy path + lineage, automation-stops-at-draft, idempotency incl. durable restart, status-machine negatives, security/tenant, side-effects). Typecheck node clean; eslint clean. Procurement + command-spine regression sweep recorded on landing. Full main + UI + build + journey PENDING operator Mac.

## 14. Remaining policy gaps (documented, not implemented)

Multi-step spend-policy chain (unwired engine); segregation of duties / self-approval (undefined, absent); PO approve/send governance promotion + S46 fence for PO consequential actions; PR-lifecycle legacy-door fencing. Each is a future operator-gated decision (DECISION-MEMO-S90 §7), none blocking the S90 target.

## 15. Exact commits

One non-frozen commit (tests + journey + memo + cert), recorded on landing.

## 16. Final S90 status — GREEN

**Reorder → procurement lifecycle CERTIFIED and VERIFIED end-to-end in the real Electron runtime (operator Mac), with ZERO production change.** The S89 draft PR continues through the existing governed Submit → Approve → Convert commands to exactly one draft PO carrying the reorder lineage (`PO-PR-REORDER-…`, `sourceRequest`); approval is the single defined human-approval gate; every transition is an explicit governed action; idempotent (one PO, incl. durable restart); no automation, no invented policy, no bypass, no economic side effects. Proven by 10/10 focused tests + command-spine/procurement/inventory 338/338 + the real-Electron journey (all assertions + RESULT, exit 0). No frozen change; no FG-S90 token; AI advisory-only. `certification/baseline.json` untouched. Release track PAUSED.
