# SESSION 141 — OPERATIONAL EXCEPTIONS NAVIGATION COMPLETION CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · Renderer-only, NON-FROZEN, no FG token
### Status: **GREEN** — nav "Needs attention" badge + held-reconciliation → Hold Center deep-link. FINAL completion of the S139/S140 operational-exception navigation.

---

## 1 · Scope
Completes the operator navigation around the S139 Unified Operational Exceptions queue using ONLY existing
governed capabilities:
(1) an honest "Needs attention" count badge on the PRIMARY Operations navigation (the Operations Center
header + the Platform tab that hosts the queue), reusing `QueryOperationalExceptions`; and
(2) a read-only deep-link from `held_reconciliation` exception rows to the EXISTING governed Hold Center.
No new store, event/command bus, workflow, severity, SLA, priority, threshold, polling, or policy.

## 2 · Architecture path
- **Nav count:** `AppShell (case 'opscenter') → OpsCenterView(onNavigate) → OpsCenterRoot → OpsCenterInner`.
  `OpsCenterInner` loads `ipc.platform.operationalExceptions({limit:1})` → `platform:command.dispatch
  (QueryOperationalExceptions)` → server principal + RBAC `operations:read` + tenant validation → `counts.total`.
  Rendered as a header "Needs attention" pill (`number` → red/green; `'unavailable'` → gray; `null` → hidden)
  and as the Platform tab's numeric `count` (only when >0). Clicking the pill opens the Platform tab.
- **Hold Center deep-link:** `OpsCenterInner(onNavigate) → EopsPlatformTab(onNavigate) →
  OperationalExceptionsPanel(onNavigate)`. A `held_reconciliation` row renders "Open in Hold Center" →
  `onNavigate('holds')` → `AppShell.goToSection('holds')` → the EXISTING `HoldsView`. `onNavigate` is
  `(id) => goToSection(id as SectionId)`, the same pattern the other hosts use.

## 3 · Files changed (all non-frozen)
- `apps/desktop/src/shell/AppShell.tsx` — pass `onNavigate={(id) => goToSection(id as SectionId)}` to `<OpsCenterView>` (case 'opscenter').
- `apps/desktop/src/renderer/src/views/OpsCenterView.tsx` — forward optional `onNavigate` to `OpsCenterRoot`.
- `apps/desktop/src/renderer/src/operationsCenter/OpsCenterView.tsx` — load the exceptions count (reused read), render the honest header "Needs attention" pill (count / 0 / unavailable), badge the Platform tab count (>0 only), thread `onNavigate` to `EopsPlatformTab`.
- `apps/desktop/src/renderer/src/operationsPlatform/EopsPlatformTab.tsx` — accept + forward `onNavigate`.
- `apps/desktop/src/renderer/src/operationsPlatform/OperationalExceptionsPanel.tsx` — accept `onNavigate`; render "Open in Hold Center" for `held_reconciliation` rows only.
- **new** `apps/desktop/ui-tests/opsCenterExceptionsBadge.test.tsx` (3).
- `apps/desktop/ui-tests/operationalExceptionsPanel.test.tsx` — +2 S141 tests.

## 4 · Frozen / FG status
**No frozen surface touched. No FG token requested or guessed.** gate-detector = PROCEED on all changed files
(7/7). Reuses S139 `QueryOperationalExceptions`; the `count` field on `SegmentedTabItem` and `goToSection`
already exist. No shared contract/primitive change.

## 5 · Security proof (S139/S140 model preserved)
Both the count read and the queue reads run on the SAME governed branch: server-resolved tenant, RBAC
`operations:read`, fail-closed authn/authz (`UNAUTHENTICATED`/`UNAUTHORIZED`/`TENANT_SCOPE_VIOLATION`
unchanged), read-only. The renderer supplies NO tenant. The count is rendered from `counts.total` only; on a
failed read the badge shows "unavailable" — NEVER a fabricated 0. The Hold Center deep-link is pure UI
navigation (`goToSection('holds')`): no new hold resolver, no mutation/execute/approve/retry authority added;
the destination remains the existing governed Hold Center. `correlationId` is never manufactured; held rows
carry none and are deliberately NOT routed through Evidence Trace. No secret/token/credential/raw payload is
rendered (asserted).

## 6 · Tenant proof
Tenant is resolved SERVER-SIDE for the exceptions count (same as S139). The nav badge and deep-link add no
tenant surface. Cross-tenant isolation is enforced by the reused governed read (proven S139).

## 7 · AI-authority impact
**None.** No AI path touched; no execute/approve/send/mutate/dispatch. Read-only nav + navigation only.

## 8 · Operator journey tested
Operations nav → honest "Needs attention" badge (count / 0 / unavailable) → open Platform tab → exceptions
queue → delivery exception → Evidence Trace when a correlationId exists (S140); held reconciliation → "Open
in Hold Center" deep-link with NO Evidence Trace → the existing governed Hold Center.

## 9 · Tests
- UI `opsCenterExceptionsBadge.test.tsx` (**3**): real count when the read succeeds; honest `0` when there
  are genuinely none; "unavailable" (never a fabricated 0) when the read fails.
- UI `operationalExceptionsPanel.test.tsx` (**8** = 3 S139 + 3 S140 + 2 S141): held row offers exactly one
  "Open in Hold Center" (delivery row does not; delivery row gets Evidence Trace instead); clicking routes to
  `holds`; with no `onNavigate` no Hold Center link is shown.
- Negative/failure cases covered: exceptions read unavailable (badge + panel), zero exceptions (honest 0),
  held item has no correlationId (no trace action), unauthorized/tenant-mismatch (S139 governed-read tests),
  no secret/raw-payload leakage (S139/S140 tests).

## 10 · Full regression
| Check | Result |
|---|---|
| gate-detector (7 files) | **PROCEED ×7** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint (`eslint apps/desktop --max-warnings 0`) | **0** |
| Full main (8 shards) | **10,843 passed / 7 skipped** (1038 files) — identical to S139/S140 (renderer-only, decision-neutral) |
| Full UI | **514 passed** (91 files) — S140 509 → **+5** (3 nav-badge + 2 held-link tests) |
| S104 security + S114–S140 suites | included in full main + UI (green) |

## 11 · Electron status
OPERATOR-PENDING (Linux sandbox). Proven at the real UI→bridge layer (driven-component tests). No
macOS/keychain/real-Electron click-through claimed.

## 12 · Package activation matrix
Unchanged. 13 live `@neuropause/*` in desktop main; no package activated/imported/retired/deleted; no duplicate
infrastructure. Reuses S139 `QueryOperationalExceptions`, existing `goToSection`, existing `HoldsView`,
existing `SegmentedTabItem.count`, and the existing `StatusBadge` primitive.

## 13 · Remaining blockers
- POLICY-BLOCKED (unchanged): inbound correlation (S138); persistence-migration; security-authority (ABAC
  enforcement, delegation/JIT/impersonation); SLO verdict.
- OPERATOR-PENDING (Linux): live-Electron click-through; macOS keychain (S113/S115).
- S132 supply-chain debt (truthfully tracked, NOT touched): qs remediation (DECISION-MEMO-S132), softprops
  SHA-pin, signed provenance, dev-toolchain advisories, vuln-gate policy.

## 14 · Recommended NEXT substantive capability (S142)
The S139–S141 operational-exception navigation arc is COMPLETE. Per the directive, return to whole-repository
capability convergence with discovery-first reasoning. Candidate direction to evaluate (not yet selected):
a **governed operational EXPORT** of the exceptions/evidence trace (read-only, tenant-scoped, credential-free
— an operator "export what needs attention" as a downloadable artifact for offline review/audit), which is a
substantive new capability over existing governed reads rather than another Operations UI enhancement. S142
must begin with a fresh discovery-first census and select the strongest SAFE, non-duplicative, no-policy
capability (respecting the S138 inbound-correlation block, the parallel-runtime no-activate list, and the
S132 debt).

**No FG token. No duplicate infrastructure. No AI authority. No invented severity/SLA/threshold/policy/polling.
No secrets/raw payload exposed. Zero frozen surfaces touched. correlationId never manufactured; held items not
routed through Evidence Trace. Hold Center remains the existing governed destination (no new resolver/mutation).
macOS/keychain NOT claimed.**
