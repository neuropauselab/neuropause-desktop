# SESSION 140 — OPERATIONAL FOLLOW-UP COMPLETION CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · Renderer-only, NON-FROZEN, no FG token
### Status: **GREEN** — exceptions count badge + Evidence Trace cross-link, both reusing existing governed reads

---

## 1 · Scope
Completes the S139 operator "needs attention" workflow using ONLY existing governed capabilities:
(1) an honest exceptions count on the Operations overview, reusing `QueryOperationalExceptions`; and
(2) a per-exception Evidence Trace cross-link, reusing `QueryEvidenceTrace`, shown ONLY when the exception
genuinely carries a `correlationId`. No new store, event/command bus, workflow, severity, SLA, priority,
threshold, or policy. Inbound correlation (S138) untouched.

## 2 · Architecture path
- **Count:** `OperationalOverviewPanel → ipc.platform.operationalExceptions({limit:1}) → platform:command.dispatch
  (QueryOperationalExceptions) → server principal + RBAC operations:read + tenant validation →
  buildOperationalExceptions → counts.total`. Rendered as a "Needs attention" tile; `null` ⇒ "unavailable"
  (never a fabricated 0).
- **Trace:** `OperationalExceptionsPanel row (correlationId present) → ExceptionTrace → ipc.platform.evidenceTrace
  ({correlationId}) → platform:command.dispatch (QueryEvidenceTrace) → composeEvidenceTrace (exact-match)`.
  Only `delivery_retrying` items carry a `correlationId` (from the committed event); `held_reconciliation`
  items carry none, so they show NO trace action (honest absence — no fuzzy/temporal inference, never manufactured).

## 3 · Files changed (all non-frozen)
- `apps/desktop/src/renderer/src/operationsPlatform/OperationalOverviewPanel.tsx` — "Needs attention" tile fed
  by a reused `QueryOperationalExceptions` read (added to the existing `Promise.allSettled`).
- `apps/desktop/src/renderer/src/operationsPlatform/OperationalExceptionsPanel.tsx` — `ExceptionTrace` lazy
  cross-link (reuses `ipc.platform.evidenceTrace`) rendered only when `traceableCorrelationId(row)` is non-empty.
- `apps/desktop/ui-tests/operationalExceptionsPanel.test.tsx` — +3 S140 tests.
- `apps/desktop/ui-tests/operationalOverviewPanel.test.tsx` — +2 S140 tests.
No main/shared/IPC/contract file changed. No new renderer accessor needed (`operationalExceptions` from S139,
`evidenceTrace` from S126 already exist).

## 4 · Frozen / FG status
**No frozen surface touched. No FG token requested or guessed.** gate-detector = PROCEED on every changed file
(overview panel, exceptions panel, both test files). Reuses the S139/S126 governed reads verbatim; the renderer
uses the generic `data` response — no contract change.

## 5 · Security proof (S139 guarantees preserved)
Both reads run on the SAME governed branch: server-resolved tenant, RBAC `operations:read`, fail-closed
auth/authz (`UNAUTHENTICATED`/`UNAUTHORIZED`/`TENANT_SCOPE_VIOLATION` unchanged), bounded, credential-free.
Read-only only — no write/mutate/execute/resolve/retry. `correlationId` is used solely as the trace lookup key
for a read the operator is already authorized for; it is NEVER a tenant selector and is NEVER manufactured.
No secret/token/credential/raw payload rendered (asserted in both panels' tests).

## 6 · Tenant proof
The renderer supplies NO tenant to either read; both resolve tenant server-side. The exceptions count and the
trace are the calling operator's tenant by construction (S139/S126 tenant isolation, already proven).

## 7 · AI-authority impact
**None.** No AI path touched; no execute/approve/send/mutate/dispatch. Read-only operator surfaces only.

## 8 · Operator journey tested
exception exists → overview shows "N exceptions" → open exceptions queue → inspect item → **valid Evidence
Trace when a correlationId is present** (fetches QueryEvidenceTrace with the item's real correlationId, renders
its entries) → **honest absence** when the trace reports `found:false` ("No correlation records") and when the
item carries no correlationId at all (no trace action offered — the held reconciliation case).

## 9 · Tests
- UI `operationalExceptionsPanel.test.tsx` (**6** = 3 S139 + 3 S140): trace action appears ONLY for an item
  with a genuine correlationId (held item offers none); opening it calls `QueryEvidenceTrace` with the item's
  real correlationId and renders entries; `found:false` → "No correlation records".
- UI `operationalOverviewPanel.test.tsx` (**6** = 4 + 2 S140): honest count tile ("2 exceptions"); count is
  "unavailable" (never a fabricated 0) when the exceptions read fails.

## 10 · Full regression
| Check | Result |
|---|---|
| gate-detector (4 files) | **PROCEED ×4** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint (`eslint apps/desktop --max-warnings 0`) | **0** |
| Full main (8 shards) | **10,843 passed / 7 skipped** (1038 files) — identical to S139 (renderer-only, decision-neutral) |
| Full UI | **509 passed** (90 files) — S139 504 → **+5** (2 overview + 3 exceptions S140 tests) |
| S104 security + S114–S139 suites | included in full main + UI (green) |

## 11 · Electron status
OPERATOR-PENDING (Linux sandbox). Proven at the real UI→bridge layer (driven-component tests). No
macOS/keychain/real-Electron click-through claimed.

## 12 · Package activation matrix
Unchanged. 13 live `@neuropause/*` in desktop main; no package activated/imported/retired/deleted; no duplicate
infrastructure (reuses S139 `QueryOperationalExceptions` + S126 `QueryEvidenceTrace` + existing OpsPanel
primitives).

## 13 · Remaining blockers
- POLICY-BLOCKED (unchanged): inbound correlation (S138); persistence-migration; security-authority (ABAC
  enforcement, delegation/JIT/impersonation); SLO verdict.
- OPERATOR-PENDING (Linux): live-Electron click-through; macOS keychain (S113/S115).
- S132 supply-chain debt (truthfully tracked, NOT touched): qs remediation (DECISION-MEMO-S132), softprops
  SHA-pin, signed provenance, dev-toolchain advisories, vuln-gate policy.

## 14 · Recommended S141
1. **Add the same "needs attention" count to the primary app navigation entry for Operations** (a small badge
   on the nav item), reusing `QueryOperationalExceptions` — completes the affordance at the top-level nav, no
   new infra. (This session placed it on the Operations overview panel; the nav badge is the natural next step.)
2. **Held-reconciliation → Hold Center deep-link:** since held items carry no correlationId (so no Evidence
   Trace), offer a read-only link to the existing Hold Center where they are already governed-resolvable — no
   new mutation, reuses the existing surface.
3. Execute DECISION-MEMO-S132 Option A (qs remediation) in a network/multi-platform environment.

**No FG token. No duplicate infrastructure. No AI authority. No invented severity/SLA/threshold/policy. No
secrets/raw payload exposed. Zero frozen surfaces touched. correlationId never manufactured, never a tenant
selector. Inbound correlation NOT implemented (S138). macOS/keychain NOT claimed.**
