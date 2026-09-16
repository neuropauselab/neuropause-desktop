# SESSION 139 — WHOLE-REPOSITORY CAPABILITY REASSESSMENT CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · NON-FROZEN, no FG token
### Selected capability: **Unified Operational Exceptions queue** (governed read + operator panel) — IMPLEMENTED · GREEN

---

## 1 · Complete census (traced by ACTUAL imports, not package existence)
The desktop spine imports only **4** `@neuropause/*` specifiers in source (`apps/desktop/package.json` deps
confirm): `shared` (2372 sites — types + pure helpers), `companion-protocol` (6 — sealed envelopes),
`cst` (vendored tarball — the governed-state kernel), `solution-packs` (1 — `industrySnapshot`). All 44 other
`packages/*` are workspace-symlinked but NOT dependencies and cannot be imported.

Classification of all 46 `packages/*` (A live · B partially harvested · C safe pure harvest · D framework/
needs-policy · E duplicate/parallel — do NOT activate · F other):
- **A (live):** `shared`, `companion-protocol`, `solution-packs` (+ vendored `cst`).
- **B (concept already harvested into `apps/desktop/src/main`, package not imported):** `ckdl` (S108 trust),
  `security` (S110/S111/S112 ABAC/Ed25519/envelope), `reliability` (S107 errorBudget), `business` (ErpCore
  rule mirrored), `sdk` (builder concept mirrored).
- **C (pure harvest candidate, unused):** `certification` (validationMatrix/bench — pure, no consumer).
- **D (framework / needs undefined policy):** automation, autonomous-ops, cloudops, commercial,
  customer-deployment, customer-experience, deploy, deployment-orchestrator, environment-provisioning,
  industry, infrastructure, operator-deployment, platform-automation, platform-operations, production,
  release, trust-platform.
- **E (duplicate/parallel — MUST NOT activate):** ai-runtime, connectors, integrations, integration-platform,
  connectivity, enterprise-connectivity, persistence, runtime, cloud-core, nems, execution, cloud-sdk,
  shared-cloud, federation, intelligence, operations, workforce, workspace, workplace.
- **F:** cli (standalone tool).

**Pure-harvest gap analysis (AI / persistence / security / ops):** AI proposal builder + verification oracle
are ALREADY live (`liveBrain/proposal.ts`, `verification/verifyEffect.ts`, S117); residual pure AI bits are
cosmetic, the substantive remainder is duplicate-runtime. persistence upcaster/migration is inseparable from
the PGlite `EventStore` runtime the desktop does not use (DUPLICATE-RUNTIME). security ABAC/Ed25519/envelope
already harvested; delegation/JIT/impersonation/aiGovernance/compliance = NEEDS-POLICY. reliability
error-budget (S107) + workflow-state projection (S122) already harvested; the reliability classifier/backoff
duplicate the native `workforce/planning/failurePolicy.ts`. **Net: no clean pure-harvest gap remains.**

## 2 · Candidate ranking (≥5)
| # | Capability | Impl. location | Live consumer | Proposed canonical consumer | Business value | Arch risk | Policy dep | Frozen dep | Testability | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Unified operational exceptions queue** | NEW `operationalExceptions.ts` over the existing durable command journal (`records` RETRYABLE + `heldIntents`) | none (signals scattered across 3 surfaces) | `platform:command.dispatch` read branch + `EopsPlatformTab` panel | HIGH — one operator "needs follow-up" queue; closes the S35/S40 fragmentation | LOW — pure read projection, no new store | **none** (pure union of existing states; no severity/SLA invented) | **none** (proven S124/S125 sibling-read pattern) | HIGH (pure + governed-read + UI) | **SELECT** |
| 2 | `certification` pkg harvest (validationMatrix) | packages/certification | none | — | LOW — no clear enterprise consumer | LOW | none | none | med | reject (low value) |
| 3 | persistence `migrationChecksum`/upcaster | packages/persistence | none | — | LOW — no canonical store to apply to; rest is SQL runtime | HIGH (duplicate runtime) | none | none | low | reject (duplicate-runtime, no consumer) |
| 4 | security delegation/JIT/impersonation | packages/security | none | — | MED | HIGH (authority expansion) | **undefined policy** | likely | med | reject (STOP: needs policy / authority expansion) |
| 5 | ai-runtime governed tool calling / agent runtime | packages/ai-runtime | none | — | HIGH but | HIGH (2nd AI runtime + authority) | undefined | yes | low | reject (STOP: duplicate runtime + AI-authority expansion) |
| 6 | inbound event correlation | connectors/inbound | none | — | MED | MED | **policy-blocked (S138)** | maybe | med | reject (S138 DO-NOT-IMPLEMENT) |
| 7 | render `heldReconciliations` in DeliveryOperationsPanel | data already in S35 payload | payload only | — | LOW | LOW | none | none | high | folded into #1 (alone: cosmetic §4 trap) |

Selected: **#1**. It is the only candidate that materially improves a real enterprise operations workflow,
reuses the canonical live architecture, requires no policy and no frozen change, has no authority expansion,
and is fully testable end-to-end.

## 3 · Rationale
S139 discovery confirmed every operational follow-up signal already exists as a governed read, but held
commands, retryable/failed deliveries, and stale-reclaimed items are surfaced across three disjoint surfaces
(Hold Center + Delivery/Reliability panels + a silent boot reclaim), with NO unified operator queue — the
delivery panel even receives `heldReconciliations` in its payload but never renders them. Unifying them into
one read-only "needs attention" queue is a substantive platform capability (a new governed read + operator
surface), not a cosmetic transparency tweak.

## 4 · Architecture path
`renderer OperationalExceptionsPanel → ipc.platform.operationalExceptions → platform:command.dispatch
(QueryOperationalExceptions) → server-resolved principal + RBAC operations:read + tenant validation →
buildOperationalExceptions(journal, tenantId) → durable command journal (records RETRYABLE + heldIntents) →
bounded, sanitized, credential-free projection`. A SIBLING read on the SAME governed branch as S32/S35/S124/
S125 — no new channel, command, bus, store, engine, or authority.

## 5 · Files changed (all non-frozen)
- **new** `apps/desktop/src/main/platform/command/operationalExceptions.ts` — pure `buildOperationalExceptions`.
- `apps/desktop/src/main/platform/command/operationalRead.ts` — `QueryOperationalExceptions` added to the read-op set.
- `apps/desktop/src/main/ipc/handlers/platformCommandIpc.ts` — import + one ternary route branch.
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `operationalExceptions` accessor.
- **new** `apps/desktop/src/renderer/src/operationsPlatform/OperationalExceptionsPanel.tsx`.
- `apps/desktop/src/renderer/src/operationsPlatform/EopsPlatformTab.tsx` — import + panel mount.
- **new** `apps/desktop/src/main/ipc/handlers/session139OperationalExceptions.test.ts` (11).
- **new** `apps/desktop/ui-tests/operationalExceptionsPanel.test.tsx` (3).

## 6 · Frozen / FG status
**No frozen surface touched. No FG token requested or guessed.** gate-detector = PROCEED ×7 on all changed
files. `request.operation` is validated against a main-side set (not a frozen enum); the renderer uses the
generic `data` response (no frozen contract change).

## 7 · Security proof
Read-only by construction: no write/mutate/execute/resolve/retry (hold resolution stays governed in the Hold
Center; delivery retry is undefined policy, out of scope). Fail-closed proven (real secure bridge):
UNAUTHENTICATED (no principal), UNAUTHORIZED (missing `operations:read`), TENANT_SCOPE_VIOLATION (claimed
tenant ≠ principal). No secret/token/credential/raw payload reaches the response (asserted; the projection
carries only ids/type/attempts/bounded-error/timestamps). `lastError`/`reason` bounded to 200 chars.

## 8 · Tenant proof
Tenant is resolved SERVER-SIDE from the principal; the renderer supplies NO tenant. `journal.records` and
`journal.heldIntents` are tenant-scoped by construction. Proven: tenant-B never sees tenant-A exceptions.

## 9 · AI-authority impact
**None.** No AI path touched; no execute/approve/send/mutate/dispatch. The queue is a read-only operator view.

## 10 · Tests
- Focused main `session139OperationalExceptions.test.ts` (**11**): pure composer (union + full-tenant counts +
  most-recent-first ordering + kind filter fail-closed + bounded pagination + honest empty + sanitization/no
  raw payload) · governed path (real RETRYABLE delivery reproduced through the real S31 relay surfaces as
  `delivery_retrying`; honest empty; UNAUTHENTICATED/UNAUTHORIZED/TENANT_SCOPE_VIOLATION; tenant isolation;
  no secret leak).
- UI `operationalExceptionsPanel.test.tsx` (**3**): both kinds render (never as success); honest empty;
  governed-read failure → unavailable + no leak.

## 11 · Full regression
| Check | Result |
|---|---|
| gate-detector (7 files) | **PROCEED ×7** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint (`eslint apps/desktop --max-warnings 0`) | **0** |
| Full main (8 shards) | **10,843 passed / 7 skipped** (1038 files) — S136 10,832/7 → **+11** (exactly the new governed test), decision-neutral |
| Full UI | **504 passed** (90 files) — S136 501/89 → **+3** (new panel test) |
| S104 security + S114–S138 suites | included in full main + UI (green) |

## 12 · Electron status
OPERATOR-PENDING (Linux sandbox). Proven at the real UI→bridge layer (driven-component test) and the real
secure-bridge governed path (main test). No macOS/keychain/real-Electron click-through claimed.

## 13 · Package activation matrix
No package activated, imported, retired, or deleted. 13 live `@neuropause/*` in desktop main (unchanged; direct
deps: shared, companion-protocol, cst, solution-packs). The parallel connector/event/persistence/AI runtimes
(connectors, integrations, integration-platform, connectivity, ai-runtime, persistence, runtime, cloud-core,
nems, execution, intelligence, workforce, workspace, workplace, …) remain deliberately un-activated.

## 14 · Policy blockers (unchanged)
- Inbound event correlation — POLICY-BLOCKED (S138 DO-NOT-IMPLEMENT).
- persistence-migration; security-authority (ABAC enforcement, delegation/JIT/impersonation); SLO verdict.
- OPERATOR-PENDING (Linux): live-Electron click-through; macOS keychain (S113/S115).

## 15 · S132 supply-chain debt
Untouched and still tracked: qs remediation (DECISION-MEMO-S132), softprops SHA-pin, signed provenance,
dev-toolchain advisories, vuln-gate policy. NOT addressed in S139 (not the highest-value next gate this session).

## 16 · Recommended S140
1. **Surface the exceptions queue in the operator navigation / overview badge** (a small honest count on the
   ops overview linking to the queue) — completes the "needs attention" affordance without new policy.
2. **Cross-link an exception item to its Evidence Trace** (S126) by its existing `correlationId` — read-only,
   reuses the governed trace read, no new infra.
3. Execute DECISION-MEMO-S132 Option A (qs remediation) in a network/multi-platform environment.

**No FG token. No duplicate infrastructure. No AI authority expansion. No invented severity/SLA/policy. No
secrets/raw payload exposed. Zero frozen surfaces touched. Inbound correlation NOT implemented (S138).
macOS/keychain NOT claimed.**
