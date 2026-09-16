# SESSION 142 — WHOLE-REPOSITORY CAPABILITY CONVERGENCE CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · Renderer-only, NON-FROZEN, no FG token
### Selected + implemented: **Governed Payment-Reversal UI exposure** (the last two DARK finance commands go live) — GREEN

---

## A · Fresh whole-repository census (by actual imports/consumers)
Desktop spine imports 4 `@neuropause/*` packages (shared, companion-protocol, vendored cst, solution-packs);
~44 other `packages/*` are unimported. Meaningful capability classes:
- **LIVE:** the governed command spine (25 domain commands), the governed operational READ branch
  (10 Query* ops), enterprise module registry (~106 stores), data-plane governed export (csv/xlsx/json),
  S139–S141 operational-exception nav.
- **PARTIAL / "correct but dark":** **2 of 25 governed domain commands had NO renderer path** —
  `ReverseCustomerPayment` / `ReverseVendorPayment` (built live in S61). Every other command is renderer-exposed.
- **SAFE HARVEST:** none clean remaining (S139 census: already-harvested / duplicate-runtime / needs-policy).
- **NEEDS POLICY:** inbound correlation (S138), ABAC/delegation/JIT enforcement, cross-module search ranking/authz,
  persistence migration.
- **DUPLICATE/PARALLEL — DO NOT ACTIVATE:** ai-runtime, connectors/integrations/integration-platform/
  connectivity, persistence, runtime/cloud-core, intelligence/operations/workforce/workspace/workplace, etc.
- **MISSING:** governed operational-evidence export; cross-module enterprise search.

## B · Candidate ranking (≥7)
| # | Candidate | Impl. location | Consumer | Value | Fit | Policy dep | Frozen dep | Security/tenant | Testability | Size/risk | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Expose ReverseCustomerPayment/ReverseVendorPayment (dark finance commands)** | commandBus S61 + paymentReversalModule (live) | finance operator | HIGH (real reversal workflow; currently impossible from UI) | reuses command spine end-to-end | **none** (module guards fully defined; bank-reconciled subset already fail-closed refused) | none | server tenant, `operations:manage`, target-not-authority, kind from command type | high (S43 UI pattern + S61 handler tests) | small | **SELECT** |
| 2 | Governed operational-evidence export | operationalRead builders + dataPlane exporters | operator/auditor | MED-HIGH | reuse-only read | none (already-sanitized) | none | reuse read branch | high | medium | strong 2nd (S141 suggestion) |
| 3 | Cross-module enterprise search | new fan-out over 106 stores | operator | MED-HIGH | needs new handler | **ranking/authz policy** | none | new surface | medium | large | defer (needs policy + design) |
| 4 | AI proposal/tooling expansion | liveBrain | — | — | — | AI-authority expansion | — | — | — | — | reject (authority) |
| 5 | Connector/integration capability | parallel runtimes | — | — | — | — | — | — | — | — | reject (no-activate list) |
| 6 | Inbound correlation | connectors/inbound | — | — | — | **S138 policy-blocked** | — | — | — | — | reject (blocked) |
| 7 | persistence migration/upcaster | packages/persistence | — | — | — | needs policy + SQL runtime | — | — | — | — | reject (dup runtime) |
| 8 | ABAC/delegation enforcement | packages/security | — | — | — | **undefined authority policy** | — | — | — | — | reject (needs policy) |
| 9 | master-data dark reads | enterprise module reads | — | — | — | — | — | — | — | — | none dark (all exposed) |

## C · Selected capability and why it won
**Payment-reversal UI exposure.** It is the ONLY remaining dark governed domain command pair — the exact
"correct but dark" gap S43 was cited as the model for. It is substantive (a real finance control-plane
workflow: reverse a cleared payment, book the compensating GL, re-open the settled document), has a real
business operator consumer, reuses the canonical governed command spine end-to-end, requires NO undefined
policy (the reversal module's guards are fully defined; the one policy-blocked subset — bank-reconciled
originals — is already fail-closed refused), no duplicate runtime, and is provable end-to-end. It also closes
a governance gap: reversals were only creatable via the non-governed CRUD door (bypassing journal/idempotency/
outbox/audit and letting the client forge `originalKind`).

## D · Exact architecture path
`EnterpriseModuleScreen (create, module 'finance-payment-reversals') → ipc.platform.reverse{Customer,Vendor}Payment
→ platform:command.dispatch → Application Boundary → command bus (Reverse{Customer,Vendor}Payment,
`operations:manage` RBAC) → EnterpriseModuleCreate('finance-payment-reversals') with originalKind set from the
COMMAND TYPE + reason from payload + originalPaymentId from target → module guards (cleared-only, not
bank-reconciled, tenant-scoped, at-most-one, immutable) → compensating GL + document re-open (onChange) →
durable intent/journal → domain event → outbox → governance audit`. Command selected by the form's
`originalKind`; the server sets the authoritative kind from the command type.

## E · Files changed (all non-frozen, renderer only)
- `apps/desktop/src/renderer/src/lib/ipc.ts` — new `reverseCustomerPayment(originalPaymentId, reason, key)` +
  `reverseVendorPayment(...)` helpers (target + payload.reason).
- `apps/desktop/src/renderer/src/enterprise/modules/EnterpriseModuleScreen.tsx` — create-routing branch for
  `finance-payment-reversals` (selects the command by `originalKind`; passes originalPaymentId as target + reason).
- **new** `apps/desktop/ui-tests/session142GovernedPaymentReversalUI.test.tsx` (6).

## F · Frozen / FG status
**No frozen surface touched. No FG token requested or guessed.** gate-detector = PROCEED ×3. The command bus
route, RBAC map, and reversal module are all pre-existing (S61); the module id is used as a literal string
(`PAYMENT_REVERSALS_MODULE_ID` is not exported from frozen `@neuropause/shared`, so it is NOT imported — no
frozen change). Renderer uses the generic dispatch response.

## G · Security + tenant proof
Server-resolved tenant + actor; the renderer sends NO tenant (asserted). RBAC `operations:manage` enforced by
the command route. The original payment id is a **target, never authority** — the reversal module resolves it
tenant-scoped and refuses a non-cleared / bank-reconciled / foreign-tenant / already-reversed / nonexistent
original (S61 handler tests). `originalKind` is set from the COMMAND TYPE server-side, so a client cannot forge
it. The decisive bypass proof: the non-governed `enterprise:module.create` CRUD door is NEVER called for a
reversal create (asserted), and a retry reuses ONE idempotency key (replay-safe → never a duplicate reversal).
No secret/raw-payload surface added.

## H · Policy analysis
**No undefined policy invented.** Every guard is pre-defined in the S61 reversal module. The bank-reconciled
subset is already a fail-closed refusal (DECISION-MEMO-S61), not an open question. A finer reverse-only RBAC
authority remains an S61-recorded optional enhancement (frozen `EnterprisePermission` addition — out of scope);
the command already runs under the same `operations:manage` as the whole finance family.

## I · Tests and regression totals
| Check | Result |
|---|---|
| gate-detector (3 files) | **PROCEED ×3** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint (`eslint apps/desktop --max-warnings 0`) | **0** |
| Focused UI `session142GovernedPaymentReversalUI` | **6 passed** (customer→ReverseCustomerPayment, vendor→ReverseVendorPayment, target+reason, no-tenant, refusal-surfaced/modal-stays-open/CRUD-unused, retry-one-key, CONTROL non-reversal unchanged) |
| Full main (8 shards) | **10,843 passed / 7 skipped** (1038 files) — identical to S139–S141 (renderer-only, decision-neutral) |
| Full UI | **520 passed** (92 files) — S141 514 → **+6** |
| S61 reversal handler suite + S104 security + S114–S141 | included in full main (green) |

## J · Package activation status
Unchanged. 13 live `@neuropause/*` in desktop main; no package activated/imported/retired/deleted; no duplicate
infrastructure. Reuses the S61 command family + the S43/S45/S49 create-routing pattern.

## K · Remaining blockers (unchanged, not pretended solved)
- S138 inbound correlation POLICY-BLOCKED; persistence-migration policy; ABAC/delegation/JIT authority policy;
  SLO verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux); S132 qs/supply-chain remediation
  (DECISION-MEMO-S132) — untouched.
- Finer reverse-only RBAC authority (S61-recorded optional; frozen permission addition).

## L · Recommended S143
With the last dark governed command now live, every governed domain command is renderer-exposed. Next
discovery-first candidate to evaluate (not pre-selected): the **governed operational-evidence export**
(candidate #2 — read-only CSV/JSON of the S139/S140 exceptions + evidence trace the operator already sees,
reusing the existing dataPlane exporters + save seam; no undefined retention/PII policy since operational rows
are already sanitized). Alternatively, a fresh census may surface a stronger substantive capability; S143 must
begin discovery-first and respect the S138 block, the parallel-runtime no-activate list, and the S132 debt.

**No FG token. No duplicate infrastructure. No AI authority. No invented policy. No secrets/raw payload exposed.
Zero frozen surfaces touched. The two dark finance commands now flow through the same journaled/idempotent/
audited spine as every other consequential write. macOS/keychain NOT claimed.**
