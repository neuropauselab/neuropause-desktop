# SESSION 122 — WHOLE-PLATFORM CONVERGENCE CERTIFICATION
## Activate next high-value capability: Operational Reliability Intelligence
### Date: 2026-09-05 · Branch: cert/data-import-cst-integration · Non-frozen session (no FG token consumed)

---

## 0 · OBJECTIVE
Activate ONE more real, high-value capability from the unwired platform packages into the canonical
live NeuroPause platform, with a real production consumer, tests, and full regression. Complete the Mac
keychain/Electron proof or record OPERATOR-PENDING honestly. Constraints honored: no duplicate infra,
no invented business policy, no ERP/DB mutation, no autonomous authority, no release/notarization, no
frozen change without a token, no package deletion/retirement, not audit-only.

## 1 · BASELINE / FINAL HEAD
- Baseline HEAD: **68af984** (S121).
- Final HEAD: **this commit** (S122).
- Frozen surfaces: **UNTOUCHED** (gate-detector PROCEED ×9 on all changed files; no FG token used).

## 2 · SELECTED CAPABILITY — Operational Reliability Intelligence
**Why selected (highest production-value / risk-adjusted):** the canonical governed operational-read
branch already exposes tenant-scoped `DurableCommandJournal` records (outbox status / attempts /
lastError) but derived NO reliability intelligence from them. Operators could list history and delivery
failures, but had no *posture*: success/failure ratios, retry pressure, per-command-type health, or the
recurring error signatures that tell them what is actually breaking. That is preferred target #1/#5
(enterprise operational intelligence / reliability-observability), it is deterministic, tenant-safe,
read-only, and it needs zero new infrastructure. It also **gives the previously-harvested-but-unwired
`errorBudget.ts` (`computeErrorBudget`, from `packages/reliability/src/slo.ts`) its first real caller.**

- **Source package (concept harvested, NOT imported):** `packages/reliability` (SLO / reliability
  engineering). Per S106/S107 Rule 3 the architecture is not imported (it rides the parallel
  `@neuropause/*` infra spine); only the definitional concept is re-implemented with zero deps.
- **Harvested implementation:** `apps/desktop/src/main/operationsPlatform/operationalReliability.ts`
  — pure `summarizeReliability(records, { objective? })`: per-status + per-command-type counts, the
  definitional success / delivery-failure ratios, retry pressure, top-N recurring error signatures, and
  an OPTIONAL request-based error budget delegated to the harvested `computeErrorBudget`.

## 3 · CANONICAL SUBSYSTEM USED + EXACT PRODUCTION CONSUMER
- **Canonical live subsystem:** the ONE governed operational-read branch on `platform:command.dispatch`
  (`OPERATIONAL_READ_OPERATIONS`), over the ONE `DurableCommandJournal`. New sibling operation
  `QueryReliabilitySummary` → `buildReliabilitySummary(journal, principal.tenantId, params)` in
  `operationalRead.ts`. No new channel / command / bus / store / engine.
- **Production consumer (real, user-visible):** `OperationalReliabilityPanel.tsx`, mounted in
  `EopsPlatformTab` (after Delivery Operations, before Connector Lineage). It fetches via
  `ipc.platform.reliabilitySummary()` and renders posture badges, the per-command-type rollup, and
  recurring delivery errors.

## 4 · UI / IPC PATH
UI (`OperationalReliabilityPanel`) → `ipc.platform.reliabilitySummary()` → preload `rawInvoke` →
`platform:command.dispatch` (`QueryReliabilitySummary`) → secure bridge (`requireAuth`) → governed READ
branch (server-resolved principal, RBAC `operations:read`, tenant validated vs principal) →
`buildReliabilitySummary` → `summarizeReliability` over `journal.records(tenantId)` → sanitized posture
→ UI. No command bus, no `journal.run`, no durable write, no mutation.

## 5 · SECURITY PROPERTIES
- **Read-only / no mutation / no autonomy:** pure function over existing rows; dispatches no command,
  mutates no store, executes nothing. AI has no path to it as authority.
- **Tenant isolation:** the read resolves the principal server-side and validates any `claimedTenantId`
  (`TENANT_SCOPE_VIOLATION` on mismatch); the projection reads only `journal.records(tenantId)`. Proven:
  tenant B posture excludes tenant A rows (handler test), unauthenticated/unauthorized fail closed.
- **Credential-free:** only ids / types / statuses / counts / trimmed error signatures are surfaced —
  never a command payload/result, never a secret. Asserted in both the pure test and the UI test
  (no secret/token/password/authorization/payload).
- **No invented policy:** the error-budget verdict is computed ONLY when a caller supplies an explicit
  SLO `objective ∈ [0,1]`; the live UI supplies none, so no verdict is shown (DECISION-MEMO-S122).

## 6 · TESTS
- `operationalReliability.test.ts` — **9** pure tests: status/type counts + ratios, error-signature
  grouping + no-leak, MAX_ERROR_SIGNATURES bounding, no-verdict-without-objective, objective→budget
  (breached + healthy), empty input, malformed NaN attempts, AT_RISK_BURN single-constant reuse.
- `session122ReliabilityRead.test.ts` — **8** governed-read tests through the REAL `runSecureHandler`
  over a REAL journal: real posture from real committed rows, tenant isolation, renderer-claimed-tenant
  rejected, unauthenticated + unauthorized fail closed, no-objective→no-budget, objective→budget,
  credential-free.
- `operationalReliabilityPanel.test.tsx` — **3** UI tests through the real UI→bridge path: asserts the
  `QueryReliabilitySummary` operation, renders posture/rollup/errors, empty state, no secret/payload.

## 7 · ELECTRON RESULT — OPERATOR-PENDING (not simulated)
A real click-driven Electron acceptance is deferred to the Mac: this session's shell is a Linux aarch64
sandbox with no runnable macOS Electron (`electron/dist` empty), consistent with every prior session.
The full path is instead proven at the available layers (real secure-bridge governed read + server
tenant + RBAC + scope-violation via the handler suite, and the real UI→bridge wiring asserting the
operation via the UI suite). No Electron result was fabricated.

## 8 · MAC KEYCHAIN RESULT — OPERATOR-PENDING (not simulated)
The pending S115/S113 durable-Ed25519-key → safeStorage → sign → restart → recover → verify → tamper
proof cannot be exercised in Linux (no macOS safeStorage/keychain). It is recorded OPERATOR-PENDING; the
S116 runbook stands. Not faked.

## 9 · FULL REGRESSION (nothing hidden)
| Check | Result |
|---|---|
| gate-detector (9 changed/new files) | **PROCEED ×9** (no frozen/sensitive surface) |
| typecheck node / web | **0 / 0** |
| eslint (changed files) | **0** |
| Focused: reliability pure + governed read | **17 passed** |
| Focused: reliability UI panel | **3 passed** |
| Full main suite (8 shards, `ulimit -n 65536`, forks/singleFork) | **10,681 passed / 7 skipped** (1023 files; skips pre-existing) |
| Full UI suite | **472 passed** (+3 new) |

ERP/HR/CRM/Expenses/Payroll/Procurement/P2P/Warehouse/Inventory/Manufacturing/Maintenance/Projects/
O2C/AR/AP/GL/AI/Connectors/Operations/Security/Audit/Backup all remained green within the full main +
UI suites. No legacy action door, direct store mutation, cross-tenant access, replay, duplicate
accounting, authorization bypass, or AI-authority bypass was introduced — the capability is a pure
read-only projection with no write path.

## 10 · PACKAGE ACTIVATION MATRIX (delta, S122)
| Capability / package | Status | Notes |
|---|---|---|
| `packages/reliability` — SLO/error-budget concept | **PARTIALLY HARVESTED → now LIVE-CONSUMED** | `computeErrorBudget` (S107 harvest) gained its first real caller via `summarizeReliability`; reliability posture now live in the operator UI. Package architecture NOT imported (concept only). |
| Operational reliability read (`QueryReliabilitySummary`) | **LIVE (this session)** | governed read branch + operator panel. |
| Connector inbound lineage (`QueryInboundLineage`) + per-connector summary | LIVE (S119–S121) | unchanged. |
| Operational history / delivery operations / health reads | LIVE (S32/S34/S35) | unchanged. |
| Signed audit chain + audit-integrity ops UI | LIVE (S111/S113/S115) | unchanged. |
| Inbound webhook verify→platform event | LIVE (S114) | unchanged. |
| AI proposal metadata (advisory) in confirm UI | LIVE (S117/S118/S120) | unchanged. |
| ABAC (H4) / Ed25519 (H5) / envelope (H6) / decision-quality (H8) | LIVE | unchanged. |
| `packages/persistence` — upcaster/snapshot/migration | FRAMEWORK-ONLY (B) | activation candidate; needs a persisted-shape migration slice. |
| `packages/ai-runtime` — WorkflowEngine rollback / tool registry / streaming / durable agent state | FRAMEWORK-ONLY (B/C) | POLICY-BLOCKED for execution (needs governed-execution policy); no second AI runtime. |
| `packages/security` — delegation / JIT / impersonation | FRAMEWORK-ONLY (A, next) | needs its own authority-policy decision. |
| Real macOS keychain (S113/S115) proof | **OPERATOR-BLOCKED** | Linux sandbox; runbook ready. |
| Remaining ~5 connector pkgs + ~30 wave/NCEA pkgs | DUPLICATIVE / RETIREMENT CANDIDATE (D/E) | covered by canonical subsystems; NOT deleted this session. |
| M365 executor residual writes | POLICY-BLOCKED (widen) | unchanged. |

**Unwired-package count unchanged** (39/46 remain unwired); this session activated a capability by
concept-harvest + live consumer, not by importing a package.

## 11 · REMAINING BLOCKERS / POLICY DECISIONS REQUIRED
- **DECISION-MEMO-S122-SLO-OBJECTIVE** — an SLO objective (target, banding, scope, persistence) is a
  policy decision; the error-budget verdict stays dormant in production until ratified (OPERATOR-GATED).
- Mac keychain + real-Electron click-through — OPERATOR-PENDING (Linux sandbox).
- `packages/persistence` upcaster/snapshot (B), `packages/security` delegation/JIT (A),
  `packages/ai-runtime` governed-execution policy (B/C) remain future gates.

## 12 · RECOMMENDED S123 TARGET
Activate the **operational reliability trend / anomaly signal** as the natural next increment — a pure,
deterministic delta over successive reliability snapshots (e.g. rising retry rate / new error signature
since last read), surfaced on the SAME governed read branch and panel. It stays read-only, tenant-safe,
policy-free (no objective needed), and reuses the S122 projection — no new infra. Alternatively, ratify
the SLO-objective policy (DECISION-MEMO-S122) to light up the dormant error-budget verdict.

## 13 · COMMIT SCOPE
Committed (all non-frozen): `operationalReliability.ts` (+test), `operationalRead.ts`,
`platformCommandIpc.ts`, `ipc.ts`, `OperationalReliabilityPanel.tsx`, `EopsPlatformTab.tsx`,
`session122ReliabilityRead.test.ts`, `operationalReliabilityPanel.test.tsx`,
`DECISION-MEMO-S122-SLO-OBJECTIVE.md`, and this certification.

**Deliberately EXCLUDED** (not this session's work, per CLAUDE.md §1 custody note): the pre-existing
custody-protected `certification/baseline.json` re-record, the stray `.claude/` directory, and the
unrelated `NP-FG-001` / `NP-IPC-ENV-001` evidence docs.

**No FG token consumed. No frozen surface touched. No release/notarization performed. No package
deleted or retired. No business policy invented.**
