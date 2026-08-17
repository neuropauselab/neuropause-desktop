# Phase I-A.3 — Pilot Readiness G2 — Runtime Readiness Investigation (READ-ONLY)

**READ-ONLY. No production/test/frozen/runtime change; no commit/push.** Baseline HEAD `ffa2863` (parent
`d2c9827`), branch `cert/data-import-cst-integration`. Source basis: the G1 / G1-A / G1-B documents (unchanged) +
direct source. Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]` /
`[REQUIRED]`. No `[INFERRED]`/`[DESIGN]` is upgraded to `[PROVEN]`.

## 1. Repository baseline `[PROVEN]`
HEAD `ffa2863c29e6c5fac7f4267abb032566c6b12548`, branch `cert/data-import-cst-integration`, working tree clean
(0 tracked/staged), diff-check clean. 11 preserved untracked certification docs. This gate changed no code.

## 2. G1-B constraints (inputs, not restated as new claims) `[PROVEN prior]`
Approved-workflow allow-list · one decision = one execution · no blind retry · manual reconciliation for uncertain
outcomes · bounded single-process environment · bounded tenant/account/operator · operator-visible failure/hold
state · evidence preservation. Preserved distinctions: **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠
UNIVERSAL.**

## 3. G2 acceptance matrix (runtime, from source)
| Property | REQUIRED | Runtime state | Classification |
|---|---|---|---|
| A. Installation | yes | electron-builder mac(dmg/zip,arm64,hardened)/win(nsis/zip/portable,x64); notarize+verify:release | **PROVEN present** (no Linux target) |
| B. Startup | yes | single-instance lock → bootstrap → initRuntimeCore (index.ts:174/81/150) | **PROVEN** |
| C. Initialization | yes | sequential awaits, single fail-closed catch (index.ts:150-170) | **PROVEN** |
| D. Runtime health | yes | readiness gate starting/ready/failed (runtimeReadiness.ts); RuntimeState IPC | **PROVEN (readiness, not liveness)** |
| E. Configuration | yes | env→default fail-open (config.ts:11-21) | **PROVEN present** |
| F. Authentication | yes | authService.restoreSession keychain (index.ts:144) | **PROVEN present** |
| G. Account availability | yes | ownsAccount + token gate (executor.ts:96-114) | **PROVEN** |
| H. Connector availability | yes | connector health healthy/degraded/unhealthy/unknown (runtimeCore.ts:3016) | **PROVEN present** |
| I. Governance readiness | yes | governedSend/governedAction + Boundary-B + Step-5 wired | **PROVEN** |
| J. Approval/confirmation | yes | confirmed:true post-approval; awaiting_approval UI | **PROVEN** |
| K. Admission | yes | Step-5 durable reserve (executeEngine.ts:143) / CST claim | **PROVEN** |
| L. Execution | yes | action.run at-most-once | **PROVEN** |
| M. Failure classification | yes | IPC typed (UNKNOWN/FAILED/HOLD/DENIED); worker generic | **PROVEN (asymmetric)** |
| N. UNKNOWN / outcome uncertainty | yes | IPC: message class; worker: collapsed to FAILED | **PARTIALLY AVAILABLE / worker PROVEN-ABSENT** |
| O. HOLD | yes | IPC HOLD message; no dedicated UI state | **PARTIALLY AVAILABLE** |
| P. Reconciliation | yes | manual only; no automated reconcile | **PROVEN-ABSENT (auto); REQUIRED (manual)** |
| Q. Restart | yes | loadAllSync→recoverInterrupted→seedHistory (runtimeCore.ts:2548) | **PROVEN (single-process)** |
| R. Evidence capture | yes | ExecutionStore + audit + platform events | **PROVEN partial; OPEN (ext-obs/reconcile)** |
| S. Operator visibility | yes | execution states + awaiting_approval + failure banner; message strings | **PARTIALLY AVAILABLE** |
| T. Recovery | yes | interrupted (never rerun); idempotency rehydrate | **PROVEN (intact state)** |
| U. Shutdown | yes | log flush + power/quit handlers (index.ts:186-200) | **PROVEN present** |
| V. Re-launch | yes | seedHistory hydration on boot | **PROVEN (single-process, intact file)** |
| W. Malformed configuration | yes | fail-open to default (config.ts) | **PROVEN present** |
| X. Missing configuration | yes | baked build-info / dev default | **PROVEN present** |
| Y. Missing token | yes | DENY/refuse (executor.ts:113; governedAction DENY) | **PROVEN** |
| Z. Expired token | yes | refresh accessor; null→refuse | **PROVEN** |
| AA. Network unavailable | yes | IPC UNKNOWN→reconcile; worker collapsed→FAILED | **PROVEN (asymmetric — §7)** |
| AB. Connector unavailable | yes | AuthError/HTTP → failure/DENY | **PROVEN** |
| AC. Persisted-state problems | yes | idempotency FAIL-CLOSED; ExecutionStore **FAIL-OPEN** | **PROVEN (asymmetric — §6/§9)** |

## 4. Actual runtime lifecycle `[PROVEN]`
`INSTALL (electron-builder) → START (app.whenReady, single-instance lock, index.ts:174) → bootstrap() (index.ts:81)
→ CSP + IPC allowlist + base router (registerIpcHandlers) → window created (index.ts:95) → RuntimeService.start →
authService.restoreSession (index.ts:144) → initRuntimeCore (runtimeCore.ts:409): registry/plugins → initPlatform →
initConnectors (constructs DurableIdempotencyStore, connectors/index.ts:389) → initUnified → initSync → graph →
memory → workforce → enterprise → ExecutionStore + ExecuteEngine (runtimeCore.ts:2377) → executor registration →
registerSecureHandlers (~650 channels, LAST) → markRuntimeReady (index.ts:159)`. Failure at any init await →
single catch → `markRuntimeFailed(safeInitFailureMessage)` (index.ts:160-170), window stays up, operator sees a
banner (§8). Per-transition failure behavior is fail-closed at runtime scope (no partial-ready). `[PROVEN]`

## 5. Real consequential workflow trace `[PROVEN]`
Chosen certified action: **`mail.send`** (governedSend, IPC ingress).
`operator → M365WritePanel.confirmSend (renderer, M365WritePanel.tsx:63) → IPC M365ActionExecute
(connectors/index.ts:528) → actionId=mail.send → governedSend({actor=deps.actor()??'', tenant=deps.workspaceId(),
ownsAccount, grantedScopes, getToken, confirmed, ports=m365SendPorts}) → CST kernel (authorize + atomic claim +
durable idempotency) → action.run (pure Graph send, typed errors preserved) → semanticOutcome →
mapSendOutcome → ConnectorWriteResult{ok,message,data.outcome} → renderer "Sent/Not sent: message"`.
States actually represented: DENIED/HOLD/ACKNOWLEDGED/UNKNOWN/EXECUTION_FAILED/ESCALATE carried in
`data.outcome`+`message` `[PROVEN]`; rendered only as `ok?message:message` text `[PROVEN]` (§8). An `ok:true`
= ACKNOWLEDGED ("accepted … not independently verified"), **never** external effect success `[PROVEN]`.

## 6. Failure-state analysis `[PROVEN]`
| Input | Expected governed state | Actual runtime state | Operator visibility | Evidence | Recovery |
|---|---|---|---|---|---|
| Missing token | DENY | refuse `{ok:false}` (both ingresses) | message text | session/outcome | reconnect |
| Expired token | DENY | refresh→null→refuse | message | " | reconnect |
| Missing scope | DENY | refuse (missing perms) | message | " | grant scope |
| Wrong account | DENY | ownsAccount→"Not authorized" | message | " | — |
| Wrong tenant | DENY | Boundary-B MISSING_TENANT (worker) / tenant scope | message | " | — |
| Unauthorized actor | DENY | empty actor→DENY / MISSING_ACTOR | message | " | — |
| Missing confirmation | HOLD | requiresConfirmation (IPC) / executor refuse | requiresConfirmation flag | " | confirm |
| Network failure | **IPC UNKNOWN / worker FAILED** | IPC: `ok:false` "Outcome UNKNOWN … reconcile"; worker: generic `{ok:false}` | IPC message / worker FAILED | outcome/session | **reconcile (no blind retry)** |
| HTTP failure | EXECUTION_FAILED | `{ok:false}` provider rejected | message | " | investigate |
| Malformed request | DENY (non-canonical) | canonicalize throws→DENY | message | " | fix input |
| Connector unavailable | DENY/HOLD | AuthError/HTTP failure | message | " | retry later |
| Process restart | interrupted, never rerun | recoverInterrupted (runtimeCore.ts:2549) | execution UI "interrupted" | durable session | reconcile |
| Duplicate request | suppressed | IPC idempotency / worker single-use | message/denial | " | none needed |
| Concurrent duplicate | one effect | CST claim / synchronous reserve | one result | " | none |
| Unknown external outcome | UNKNOWN→HOLD | IPC message; worker collapsed | see network row | " | manual reconcile |

## 7. UNKNOWN analysis `[PROVEN]` — the central pilot finding
- **IPC ingress:** `NetworkError→UNKNOWN` is preserved and surfaced: `mapSendOutcome`/`mapActionOutcome`
  (`connectors/index.ts:159-193`) return `ok:false` with message *"Outcome UNKNOWN — the request was transmitted
  but no response was received; it was NOT retried. Reconcile before any retry."* and `data.outcome='UNKNOWN'`.
  **UNKNOWN is never presented as SUCCESS.** `[PROVEN]`
- **Worker ingress:** `M365Executor.execute` collapses `NetworkError` into a generic `{ok:false}` (`executor.ts:
  161-169`); there is no UNKNOWN class. It presents as a **definite FAILED**, never as SUCCESS. `[PROVEN]`
- **Critical safety property holds on BOTH:** no path converts UNKNOWN into SUCCESS, and single-use consumes the
  decision/idempotency intent BEFORE the effect, so an ambiguous outcome is **not blindly retried** under the same
  decision/identity. `[PROVEN]`
- **Never claim `FAILED = effect did not happen`.** Source does not prove that: a worker `{ok:false}` from a
  collapsed NetworkError may have reached Graph. The pilot MUST treat a worker consequential FAILED as *potentially*
  UNKNOWN and reconcile before re-deciding. `[REQUIRED procedure]`

## 8. Operator visibility `[PROVEN]`/`[PARTIALLY AVAILABLE]`
| State | Availability | Source |
|---|---|---|
| REQUESTED | PARTIALLY (log/session start) | executeEngine emit 'execution.started' |
| GOVERNED | PARTIALLY (message/outcome, not a badge) | data.outcome |
| ADMITTED | PARTIALLY (session running) | executeEngine.ts:160 |
| EXECUTING | **PROVEN** (running dot) | ExecutePanel.tsx:37 |
| COMPLETED | **PROVEN** (completed dot) | ExecutePanel.tsx |
| DENIED | PARTIALLY (message text only) | mapOutcome DENIED |
| HOLD | PARTIALLY (message/requiresConfirmation) | mapOutcome HOLD |
| EXECUTION_FAILED | **PROVEN** (failed dot / "Not sent") | ExecutePanel / M365WritePanel |
| OUTCOME_UNCERTAIN | IPC: message text; worker: **NOT AVAILABLE** | mapOutcome UNKNOWN / executor collapse |
| RECONCILIATION_REQUIRED | **NOT AVAILABLE as a state** (message hint only) | — |
| VERIFIED | **PROVEN-ABSENT** (honest; never claimed) | — |
| awaiting_approval (worker) | **PROVEN** (orange badge) | workforce/lib.ts:58 |
| interrupted (restart) | **PROVEN** (dot) | ExecutePanel + executeEngine.ts:27 |
Conclusion: structured lifecycle badges exist for execution states + approval; the **nuanced governance outcomes
(UNKNOWN/HOLD/DENIED/ESCALATE) are operator-READABLE as message strings on the IPC path but are NOT dedicated UI
states, and are absent on the worker path**. A bounded pilot can compensate with a documented manual procedure
(read `data.outcome`/message; treat worker FAILED as possibly-UNKNOWN) `[REQUIRED]`. A dedicated UNKNOWN/reconcile
UI state would be **CODE CHANGE REQUIRED — SEPARATE AUTHORIZATION** (not implemented; not a hard blocker because the
text + procedure + never-success property compensate).

## 9. Evidence model `[PROVEN partial]`/`[OPEN]`
- Runtime-generated + persisted: `ExecutionSession` (durable `executions.json`, tenant-bucketed, cap 500/owner) with
  decisionId/bindingDigest/claimNonce stamped for governed worker actions; audit + platform-event fan-out
  (Timeline/Audit/Diagnostics/Executive Center); connector activity. `[PROVEN]`
- Test evidence: durableConsumption + boundaryBEnforcement + governedAction cohorts + coverage guard. `[PROVEN]`
- **NOT runtime fields** `[OPEN]`: external observation (did Graph actually change?), reconciliation result, and the
  operator's post-reconciliation decision — these are **operator-entered** artifacts the pilot must capture manually.
- **Persisted-evidence integrity caveat** `[PROVEN gap]`: `ExecutionStore.loadAllSync` **fails OPEN** — a corrupt
  `executions.json` silently yields `[]` (`executionStore.ts:102-113`), so the durable record (and the worker
  single-use ledger it seeds) is silently lost. A normal log is not a durable certification record; the durable
  record here can be silently emptied by corruption. Do not treat ExecutionStore as tamper/corruption-evident.

## 10. Restart / recovery analysis `[PROVEN]`/`[PROVEN gap]`
| Scenario | Survives | Reconstructed | Re-execution possible? | Operator intervention | Safe to continue? |
|---|---|---|---|---|---|
| A. Admission then restart | decisionId (session) + idempotency intent | seedHistory + idempotency hydrate | no (single-use/idempotency) | none (intact file) | **yes** `[PROVEN]` |
| B. Restart before effect | reserved decision (persisted pre-effect) | consumedDecisions | no (already consumed) | reconcile (effect may not have run) | conditional `[PROVEN admission; effect OPEN]` |
| C. Network failure then restart | session FAILED/interrupted | history | worker: a NEW decision could re-attempt | **reconcile before re-decide** | conditional `[REQUIRED]` |
| D. Duplicate after restart | consumed ledger (intact file) | seedHistory | no | none | **yes** `[PROVEN]` |
| E. Concurrent duplicate | — | — | no (synchronous reserve) | none | **yes** `[PROVEN]` |
| F. **Corrupt executions.json at boot** | **nothing (fail-open→[])** | **empty ledger** | **worker single-use LOST → re-admission possible** | **REQUIRED integrity check + reconcile** | **NO without procedure** `[PROVEN gap]` |
Scope preserved: single-process restart durability **≠** cross-process **≠** power-loss/fsync (both latter NOT
proven). The IPC idempotency store fails CLOSED (protects the IPC path); the worker single-use backing (ExecutionStore)
fails OPEN (scenario F) — an asymmetry the pilot restart procedure MUST cover.

## 11. Clean-environment / deployment readiness `[PROVEN present]`
- Build/package path EXISTS: `electron-vite build` + `electron-builder` (`package`/`package:mac`/`package:win`/
  `package:mac:universal`) with `generate-notices`/`generate-build-info`/`verify:release`; `electron-builder.yml`
  (appId `com.neuropause.desktop`, asar, extraResources bundle docs, `afterSign: notarize.cjs`, mac dmg/zip arm64
  hardened, win nsis/zip/portable x64, auto-update generic beta). `[PROVEN present]`
- Prerequisites: Node ≥20.11.0, npm@10.5.0, Electron 42.8.1; macOS arm64 or Windows x64 (no Linux target); backend
  URL via `NEUROPAUSE_BACKEND_URL`/baked build-info; keychain auth session; vendored `@neuropause/cst 1.3.0.tgz`.
- NOT verified in this gate `[OPEN]`: an actual clean-machine packaged launch (this is a source inventory, not an
  executed install); the `/run` skill's "launch the app" step was NOT performed here (read-only gate).

## 12. Pilot environment boundary `[DESIGN]` (only G1-B-supported / G2-proven-necessary constraints)
one machine · one process (single-instance lock structurally supports this) · one declared tenant · bounded declared
account(s) · named operator · approved-workflow allow-list · controlled restart **with executions.json integrity
verification** (from §10-F) · manual reconciliation (no blind retry) · external-outcome verification procedure ·
prefer the **IPC ingress** for consequential actions where operator-visible UNKNOWN/reconcile matters (it carries the
UNKNOWN class; the worker ingress collapses it).

## 13. Pilot blockers
**None ABSOLUTE.** No runtime behavior converts UNKNOWN→SUCCESS or FAILURE→SUCCESS (the critical safety property)
`[PROVEN]`. The two candidate concerns are bounded, not blocking:
- Worker UNKNOWN collapse (§7) → **PILOT-READY WITH OPERATING CONSTRAINT** (manual reconciliation; treat worker
  FAILED as possibly-UNKNOWN).
- Corrupt-`executions.json` fail-open re-admission (§10-F) → **PILOT-READY WITH OPERATING CONSTRAINT** (controlled
  restart + integrity check + reconcile), with a hardening option (§16) available under separate authorization.

## 14. Non-blocking gaps
- No dedicated UNKNOWN/HOLD/RECONCILIATION UI state (message text only) — **NON-BLOCKING** (procedure compensates).
- External-observation / reconciliation / operator-decision not runtime evidence fields — **NON-BLOCKING** (operator
  captured).
- No Linux packaging target — **OUT OF CURRENT SCOPE** (pilot on mac arm64 / win x64).
- Cross-process / power-loss durability — **NOT PROVEN** (bounded by single-process constraint).

## 15. Required operational procedures `[REQUIRED]`
1. Declared workflow allow-list + declared tenant/account/operator.
2. Manual reconciliation runbook; treat every ambiguous/worker-FAILED consequential outcome as possibly-UNKNOWN;
   **no blind retry**; determine external Graph state before re-deciding.
3. Controlled single-process restart procedure that verifies `executions.json` integrity before resuming
   consequential worker actions (mitigates §10-F).
4. Operator reads `data.outcome`/message on the IPC path; prefers IPC ingress for high-consequence actions.
5. Manual capture of external observation + reconciliation result + operator decision as pilot evidence.
6. Bounded single-process machine; do not run multi-instance (durability not proven cross-process).

## 16. Required future engineering work — **CODE CHANGE REQUIRED — SEPARATE AUTHORIZATION** (none implemented)
- **[CODE CHANGE REQUIRED]** Dedicated operator-visible `OUTCOME_UNCERTAIN` / `RECONCILIATION_REQUIRED` states on the
  M365/worker surfaces (today: message text only).
- **[CODE CHANGE REQUIRED]** Worker-ingress UNKNOWN preservation (Option D parity — route worker effect through CST /
  call `action.run` one layer down instead of the error-collapsing executor). Touches FROZEN `runtimeCore.ts`/
  executor path.
- **[CODE CHANGE REQUIRED]** Fail-closed (or corruption-evident) `ExecutionStore` hydration to remove the §10-F
  operational burden.
- **[OPEN]** cross-process / power-loss durability; automated reconciliation; provider verification. None authorized.

## 17. Certification-claim audit `[PROVEN]`
Preserved, not strengthened: Worker↔IPC = PARTIALLY EQUIVALENT; CST equivalence = NOT PROVEN; bounded pilot = YES,
CONDITIONAL. This gate adds only runtime-readiness observations. It does **not** claim: universal governance; worker/
IPC equivalence; provider idempotency/effect/verification success; cross-process/power-loss durability; that the
runtime distinguishes worker FAILED from UNKNOWN; that a corrupt-state restart is safe without procedure; that a
clean-machine launch was executed this gate. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL.**

## 18. Final G2 decision — **B. G2 PASS WITH BOUNDED OPERATING CONDITIONS**
The current certified build can operate safely inside the G1-B bounded pilot envelope **provided** the §15 operator
procedures are in force. The decisive safety property holds: **no runtime path converts UNKNOWN or FAILURE into
SUCCESS**, admission is durable+single-use before effect, and interrupted work is never silently rerun. The residual
items — worker UNKNOWN collapse and corrupt-`executions.json` fail-open — are **PILOT-READY-WITH-OPERATING-CONSTRAINT**,
not blockers, and their permanent removal is flagged as **CODE CHANGE REQUIRED — SEPARATE AUTHORIZATION** (§16). No
code was changed in this gate.

## STOP
Read-only investigation. HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; exactly one new document;
prior certification documents preserved; nothing staged, committed, or pushed.
