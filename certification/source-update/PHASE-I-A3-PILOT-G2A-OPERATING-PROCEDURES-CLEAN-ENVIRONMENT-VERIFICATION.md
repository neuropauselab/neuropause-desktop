# Phase I-A.3 — Pilot Readiness G2-A — Operating Procedures + Clean-Environment Verification (READ-ONLY)

**READ-ONLY / evidence-first. No production/test/frozen/runtime/UI/package change; no commit/push.**
Baseline HEAD `ffa2863` (parent `d2c9827`), branch `cert/data-import-cst-integration`. Source basis: G1-A / G1-B /
G2 / Worker-Ingress investigation (all unchanged) + direct source + read-only artifact inspection.
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]` / `[REQUIRED]`.
No `[DESIGN]`/`[INFERRED]` is upgraded to `[PROVEN]`. Procedures below are **DESIGN deliverables, not implemented and
not executed.**

## 1. Baseline `[PROVEN]`
HEAD `ffa2863c29e6c5fac7f4267abb032566c6b12548`, branch `cert/data-import-cst-integration`, working tree clean, no
change this gate. Distinctions preserved: **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL;
UNKNOWN ≠ FAILURE ≠ SUCCESS; CERTIFIED CODE ≠ PILOT-VALIDATED SYSTEM.**

## 2. G1-B constraints (inputs) `[PROVEN prior]`
Approved-workflow allow-list · one decision = one execution · no blind retry · manual reconciliation · bounded
single-process · bounded tenant/account/operator · operator-visible failure/hold · evidence preservation.

## 3. G2 findings carried in (unchanged, two OPEN engineering items — NOT fixed here) `[PROVEN]`
1. Worker `NetworkError` collapses into generic FAILED (no UNKNOWN class on worker ingress). **OPEN — CODE CHANGE
   REQUIRED — SEPARATE AUTHORIZATION.**
2. `ExecutionStore.loadAllSync` fails OPEN on corruption (empty history) → worker single-use ledger can be lost.
   **OPEN — CODE CHANGE REQUIRED — SEPARATE AUTHORIZATION.**
Also: packaged build path exists; clean-machine launch NOT yet executed; IPC exposes richer UNKNOWN/HOLD semantics;
worker exposes a simpler FAILED; UNKNOWN must never be treated as success; external outcome must not be inferred from
the executor return alone.

## 4. Operating procedures (DESIGN — not implemented) `[DESIGN]`/`[REQUIRED]`
| State | Operator observation | Operator action | PROHIBITED | Required evidence | Exit condition |
|---|---|---|---|---|---|
| A. Normal execution | ok:true "accepted … not independently verified" | record ACK (not verified) | claiming verified delivery | outcome=ACKNOWLEDGED, session | logged + evidence stored |
| B. DENIED | message "Not authorized …" | check actor/tenant/account/scope | retrying without fixing authz | outcome=DENIED | corrected or abandoned |
| C. HOLD | "needs confirmation" / "Held for reconciliation" | supply confirmation OR reconcile prior | forcing past a hold | outcome=HOLD, requiresConfirmation | confirmed or reconciled |
| D. EXECUTION_FAILED | "provider rejected" | investigate provider cause | assuming effect happened | outcome=EXECUTION_FAILED | resolved or escalated |
| E. UNKNOWN (IPC) | "Outcome UNKNOWN … NOT retried. Reconcile before any retry" | HOLD → inspect external state → record | blind retry / resend | outcome=UNKNOWN + external obs | external state determined |
| F. Worker FAILED (possible net uncertainty) | generic FAILED | **treat as possibly-UNKNOWN**; check external state; reconcile | asserting "no effect"; blind retry | session FAILED + external obs | external state determined (§5) |
| G. Duplicate request | "already admitted (single-use)" / suppressed | none (single-use held) | forcing re-run | single-use denial record | closed |
| H. Concurrent duplicate | one effect only | none | manual second submit | one result | closed |
| I. Process restart | "interrupted" sessions | verify store integrity (§6) before resuming | resuming before integrity check | recovered session list | integrity confirmed |
| J. Corrupt/untrusted state | history empty/unexpected | HOLD; escalate; preserve state | resuming consequential worker exec | store bytes + logs | integrity established (§6) |
| K. Connector unavailable | AuthError/HTTP failure | retry later; no resend if uncertain | assuming effect | outcome/message | connector restored |
| L. Auth failure | "reconnect this account" | re-auth out-of-band | entering creds into unexpected UI | outcome=DENIED | re-authenticated |
| M. Wrong account | "Not authorized" | correct account | proceeding | DENIED record | corrected |
| N. Wrong tenant | DENY / MISSING_TENANT (worker) | correct tenant scope | proceeding | DENY record | corrected |
| O. Missing scope/authz | "Missing Graph permission(s)" | grant scope + reconnect | proceeding | DENIED record | scope granted |
| P. Manual reconciliation | ambiguous outcome | §5 sequence | new action before reconcile | external obs + decision | reconciled |
| Q. Customer dispute | "did it happen?" | reconstruct evidence + external obs | asserting without evidence | full evidence package (§11) | disposition recorded |

## 5. Worker FAILED / UNKNOWN procedure (mandatory) `[REQUIRED]`
The worker ingress collapses `NetworkError` into generic FAILED (`executor.ts:161-169`). **The procedure MUST NOT
state `FAILED = no effect`** — source does not prove it; a collapsed-NetworkError FAILED may have reached Graph.
Conservative rule:
`WORKER FAILED (after any network uncertainty) → DO NOT BLIND RETRY → CHECK EXTERNAL STATE (out-of-band Graph read /
provider console) → RECONCILE → RECORD OBSERVATION → NEW GOVERNED DECISION IF REQUIRED`.
Evidence an operator needs to reconcile: decisionId (worker) / outcome+identity (IPC), tenant, actor, account,
action, parameters, timestamp, the returned failure message, and an **independent external observation** of whether
the provider state changed. UNKNOWN implementation in the worker is **NOT** performed here (OPEN engineering item).

## 6. ExecutionStore integrity procedure `[REQUIRED operator control]`
G2 established `ExecutionStore.loadAllSync` fails OPEN on corruption. **Integrity verification is an operator
procedure requirement, not currently a runtime-enforced property** — the repository provides no cryptographic or
corruption-evident integrity check on `executions.json` (do not claim one exists). Before resuming consequential
worker execution after a controlled restart: (1) verify the execution-state store file is readable; (2) verify it
parses to the expected array-of-sessions structure with plausible content; (3) verify it was not unexpectedly
replaced/emptied/truncated (e.g. size/record-count sanity vs prior); (4) if integrity **cannot** be established:
**DO NOT resume consequential worker execution — HOLD — escalate for technical review — preserve the file + logs**;
(5) resume only after integrity is established. This mitigates (does not remove) the fail-open re-admission risk; the
runtime-level fix is an OPEN engineering item.

## 7. Approved-workflow boundary `[REQUIRED operational control]` / `[CODE CHANGE REQUIRED — FUTURE GATE]`
From source: governance refuses any action lacking approval/claim/binding, and the committed coverage guard ensures
every mutating M365 action is governed — but **there is no runtime "pilot allow-list" that restricts WHICH workflows/
skills may run.** A pilot constrains scope operationally by enabling only the declared pilot workers/skills and
declared actions. Therefore the approved-workflow boundary is a **REQUIRED OPERATIONAL CONTROL** (documentation +
operator discipline), **not runtime-enforced**. A technical allow-list (deny-by-default workflow registry) would be
**CODE CHANGE REQUIRED — FUTURE GATE**. Documentation is not runtime enforcement `[PROVEN-ABSENT of runtime
allow-list]`.

## 8. Tenant / account / operator boundary `[PROVEN]`/`[REQUIRED]`
| Element | Technically enforced today? | Basis |
|---|---|---|
| Tenant | **PROVEN (enforced)** | tenant isolation on execution/session ownership; Boundary-B MISSING_TENANT; workspace scope |
| Account | **PROVEN (enforced)** | executor `ownsAccount` (`executor.ts:96`) |
| Process | **PROVEN (technical)** | single-instance lock (`index.ts:174`) |
| Machine | operational | not a software boundary |
| Operator | operational | actor is authoritative but operator↔actor mapping is a pilot declaration |
| Approved workflow | operational (§7) | no runtime allow-list |
Do not claim tenant isolation beyond existing evidence; no new identity mechanism introduced.

## 9. Clean-environment verification — **NOT EXECUTED** `[NOT EXECUTED]`
This is the empirical core, and it was **not performed** — deliberately, to avoid fabricated evidence:
- **No provisioned clean/isolated environment is available.** The only host here is the developer working copy (with
  existing userData, keychain session, config) — a launch here is not a clean boot.
- **Existing packaged artifacts do NOT correspond to the certified baseline.** `apps/desktop/dist/mac-arm64/
  NeuroPause.app` and the `.dmg`/`.zip`/`NeuroPause-Setup.exe` are built from **commit `efe8196`, version
  `1.0.0-rc.20`** (`resources/build-info.json`), **not** `ffa2863`. `backendUrl: null` in build-info.
- **The mac artifact is NOT notarized:** `dist/notarization-status.json` → `{state:"skipped", notarized:false,
  reason:"one or more Apple credentials are absent", version:"1.0.0-rc.20"}`.
- Launching that GUI build on the dev machine would also risk outward side effects (auto-update to the
  `electron-builder.yml` generic provider `https://neuropause033.com/updates`; launch-at-login/tray OS integration;
  keychain; backend calls) — beyond a read-only gate — and readiness could not be reliably observed from this
  session.
**What DOES exist (read-only, PROVEN):** a reproducible build/package path (`electron-vite build` + `electron-builder`
mac/win + `verify:release` + `notarize.cjs`), `out/main/index.js` built, packaged artifacts present, notarization
recorded (as skipped). **What is MISSING for a valid clean-machine verification `[REQUIRED]`:** a provisioned clean/
isolated machine; a **signed + notarized** package built **from `ffa2863`**; a declared backend endpoint; pilot
tenant/account credentials; an observation method for the renderer readiness state (`starting/ready/failed`) and the
`RuntimeFailureNotice` banner.

## 10. Controlled-restart verification — **NOT EXECUTED** `[NOT EXECUTED]`
Depends on a clean launch (§9), which was not performed. Restart durability remains **source/test-proven only**
(`durableConsumption` + `boundaryBEnforcement` controls 13/15/16; `recoverInterrupted`/`seedHistory`) for
single-process, intact-state — **not** empirically re-verified on a packaged build this gate. Power-loss/filesystem-
corruption remain OPEN and were **not** tested (no destructive testing).

## 11. Pilot evidence package (minimum per consequential action) `[DESIGN]`
| Field | Source class | Available today? |
|---|---|---|
| timestamp | RUNTIME-GENERATED | `[PROVEN]` (session/events) |
| tenant | RUNTIME-GENERATED | `[PROVEN]` (session.tenantId / binding) |
| actor | RUNTIME-GENERATED | `[PROVEN]` (binding/actor) |
| account | RUNTIME-GENERATED | `[PROVEN]` |
| action + parameters/identity | RUNTIME-GENERATED | `[PROVEN]` (binding/idempotency key) |
| approval/confirmation | RUNTIME-GENERATED | `[PROVEN]` (approval; confirmed) |
| governance verdict | RUNTIME-GENERATED | `[PROVEN]` (outcome / Boundary-B verdict) |
| admission/decision id | RUNTIME-GENERATED | `[PROVEN]` (decisionId / idempotency key) |
| execution state | RUNTIME-GENERATED (persisted) | `[PROVEN]` (ExecutionSession — fail-open caveat §6) |
| returned outcome | RUNTIME-GENERATED | `[PROVEN]` (ok/message/data.outcome) |
| external observation | EXTERNALLY-OBSERVED | `[OPEN]` — operator-captured, **not** a runtime field |
| reconciliation result | OPERATOR-CAPTURED | `[OPEN]` — not a runtime field |
| operator decision | OPERATOR-CAPTURED | `[OPEN]` — not a runtime field |
| final disposition | OPERATOR-CAPTURED | `[OPEN]` — not a runtime field |
Do not claim the runtime stores the last four; they are operator/external artifacts the pilot MUST capture.

## 12. Incident procedures `[DESIGN]`
| Incident | DETECT → HOLD/STOP → PRESERVE → RECONCILE → DECIDE → RECOVER → CLOSE |
|---|---|
| 1 Network uncertainty | uncertain/FAILED → HOLD → preserve session+message → external Graph read → decide → new governed decision if needed → close (no blind retry) |
| 2 Auth failure | DENIED/"reconnect" → STOP → preserve → re-auth out-of-band → decide → resume → close |
| 3 Connector failure | HTTP/Auth error → HOLD → preserve → confirm no partial effect → decide → retry only if certain-not-done → close |
| 4 Duplicate request | single-use denial → no action → preserve denial record → n/a → n/a → n/a → close |
| 5 Restart | interrupted sessions → HOLD consequential → §6 integrity → reconcile in-flight → resume → close |
| 6 ExecutionStore integrity | empty/odd history → STOP consequential worker exec → preserve file+logs → technical review → decide → resume only after integrity → close |
| 7 Wrong account/tenant | DENY → STOP → preserve → correct scope → decide → re-issue governed → close |
| 8 Customer dispute | claim → gather full evidence (§11) + external obs → determine external state → record disposition → close |
No automatic retry where the outcome is uncertain.

## 13. Pilot operator acceptance checklist (NONE marked COMPLETE — no execution evidence) `[REQUIRED]`
`[ ]` Approved workflow defined · `[ ]` Pilot tenant defined · `[ ]` Pilot account defined · `[ ]` Pilot operator
defined · `[ ]` Pilot machine defined · `[ ]` Single-process constraint understood · `[ ]` Restart procedure tested
(**NOT EXECUTED** §10) · `[ ]` ExecutionStore integrity procedure understood · `[ ]` Manual reconciliation understood
· `[ ]` No-blind-retry rule understood · `[ ]` Worker-FAILED-uncertainty rule understood · `[ ]` Evidence procedure
understood · `[ ]` Customer-dispute procedure understood · `[ ]` Escalation owner defined · `[ ]` Technical owner
defined · `[ ]` Pilot evidence location defined. Every box is unchecked: these require operational declaration and, for
the restart item, executed verification — none of which this read-only gate can mark COMPLETE.

## 14. Open engineering issues (recorded, NOT implemented) `[OPEN]` / `[CODE CHANGE REQUIRED — SEPARATE AUTHORIZATION]`
1. Worker-ingress UNKNOWN preservation (Option D — touches frozen `runtimeCore`/executor).
2. Fail-closed / corruption-evident `ExecutionStore` hydration.
3. Dedicated `OUTCOME_UNCERTAIN` / `RECONCILIATION_REQUIRED` UI states.
4. Runtime deny-by-default pilot workflow allow-list (§7).
5. Signed + notarized package **from `ffa2863`** (current artifacts are rc.20/`efe8196`, un-notarized).
6. Cross-process / power-loss / fsync durability. None authorized or implemented here.

## 15. Certification-claim audit `[PROVEN]`
Preserved, not strengthened: Worker↔IPC PARTIALLY EQUIVALENT; CST equivalence NOT PROVEN; G2 = PASS WITH BOUNDED
OPERATING CONDITIONS; bounded pilot = YES, CONDITIONAL. This gate adds **designed** operating procedures and an
**honest negative** clean-environment result. It does NOT claim: deployment verified; procedures tested; clean launch
executed; artifacts correspond to the baseline; notarized package exists; runtime allow-list; worker UNKNOWN; runtime
integrity enforcement; that FAILED means no-effect. Two OPEN engineering items remain explicitly open.

## 16. Final G2-A decision — **E. G2-A INCONCLUSIVE — EXECUTION EVIDENCE MISSING**
The operating procedures, incident playbooks, evidence package, and acceptance checklist are **designed** and
source-grounded `[DESIGN]`, and no code was changed. But the **empirical core of G2-A — a clean-machine launch and
controlled-restart verification — was NOT EXECUTED**, and the only available packaged artifacts are from a
different, un-notarized build (`efe8196`/rc.20), not the certified baseline `ffa2863`. The procedures are documented
but **untested**; the checklist has zero COMPLETE items. Therefore pilot operations cannot be declared ready:
**INCONCLUSIVE — execution evidence missing.** This is not a code blocker (the two engineering items are deferred,
not required to *design* procedures); it is an **execution/operational-evidence** gap. Readiness was not manufactured:
clean-machine launch is reported as NOT EXECUTED, procedures as DESIGN-not-tested, and the artifact/baseline mismatch
and missing notarization are named plainly.

## STOP
Evidence-first, read-only. HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; no app launch performed;
exactly one new document; prior certification documents preserved; nothing staged, committed, or pushed.
