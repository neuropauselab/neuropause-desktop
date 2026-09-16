# Gate Status Board — after the 2026-09-12 gate-closure session

Baseline of record: `NP-GLOBAL-PILOT-READINESS-20260907-001` · latest seam `NP-GLOBAL-PILOT-004` (2026-09-09).
Work performed on isolated branch `pilot/gate-closure` at `61b1503`, parent `f0ba0e8f`.

## Technical gates — machine-closable

| Item | Before | After | Evidence |
| --- | --- | --- | --- |
| TR-GPR-01 state snapshot object | `IMPLEMENTED_THIS_SEAM: false` | **EMITTED** | `TR-GPR-01-STATE-SNAPSHOT.json`, 5,617 files, source digest `a9afa5e1…` |
| TR-GPR-02 pilot claim register | `IMPLEMENTED_THIS_SEAM: false` | **EMITTED** | `TR-GPR-02-PILOT-CLAIM-REGISTER.json`, PC-01..04 bound to evidence requirements |
| TR-GPR-03 test↔artifact binding | `IMPLEMENTED_THIS_SEAM: false` | **EMITTED** | `TR-GPR-03-TEST-ARTIFACT-BINDING.json`, 3 execution records bound to tree `36f75c06` |
| Enforcement gates exercised | `5 gates, 0 exercised` | **32/32 pilot tests pass** | `EXEC-02`, incl. `NP-ENF-015-016` prototype-injection refusal and `NP-ENF-015-027` positive control |
| `authority.ts` uncommitted | untracked, `c8f276f0…` | **committed** | `61b1503` on `pilot/gate-closure` |
| ORPHANED_ENFORCEMENT_MAPPING | **CONFIRMED at HEAD** — `human_decision_required` mapped to HTTP 403 with no thrower | **CLOSED** | verified: at `f0ba0e8f` `DECLARED_MINUS_THROWN = ['human_decision_required']`; after commit `= []` |
| Backend typecheck | not recorded | **exit 0** | `EXEC-01` |
| Backend test suite | one label carried two contradictory outcomes | **450/450, 39 files, digest-bound** | `EXEC-03`, bound to source digest `a9afa5e1…` |

## Technical items deliberately NOT actioned

| Item | Why not |
| --- | --- |
| `certification/baseline.json` (292 commits stale) | Regenerating it would **designate a baseline** — that is MG-02 / `BASELINE_AUTHORITY`, `MACHINE_ACTION_ALLOWED: false`. The snapshot object was emitted instead, carrying `DESIGNATED: false`. |
| `packages/intelligence` unwired | Depended on by 10 packages, **0 import sites in any app source**. Wiring it into a shipping app is a product-scope decision with behavioural consequences. Not pilot-critical (16 of 20 operational requirements are not depended upon). |
| PC-02 / PC-03 verification | Require A-custody instruments `verify_npc.py` (14,824 B) and `verify_npms.py` (11,089 B). **Neither is present in B custody.** Cannot be measured on this machine at all. |
| The literal `~/` directory | An unquoted-shell artifact in the source worktree. Not carried onto the branch. Still present in the original worktree. |

## Authority gates — machine cannot close

| Gate | Status | Who |
| --- | --- | --- |
| `GATE-INTENDED-USE` | **NOT_ESTABLISHED** — first blocking gate | operator + qualified regulatory reviewer |
| MG-01 execution authorization (`HD-19-CLASS`) | three execution records now exist; **formal closure is a human determination** | operator |
| MG-02 baseline designation (`BASELINE_AUTHORITY`) | snapshot emitted, **designation withheld** | operator |
| `PILOT_OPERATOR` | not designated | operator |
| `PILOT_CLAIM_SET_ADOPTION` | all four claims `NEITHER_ADOPTED_NOR_EXCLUDED` | operator |
| `VERIFIER_DESIGNATION` (A.157) | `NOT_DESIGNATED` | operator |

## Beyond the pilot — launch dependencies, all untouched

- **Production (8):** authentication · user registration · data storage · privacy/data processing · update path · installation · canonical artifact selection · exercised enforcement gates
- **Publication (5):** publisher identity · domain custody · release identity · distribution record · signing
- **Commercial (5):** payment · support/operations · domain custody · commercial boundary · global-use boundary

## Standing status

```
PUBLIC_LAUNCH_STATUS   = NOT_ESTABLISHED
PRODUCTION_STATUS      = NOT_ESTABLISHED
COMMERCIAL_STATUS      = NOT_ESTABLISHED
AUTHORIZATION_ISSUED   = FALSE
global_pilot_gate      = BLOCKED
first_blocking_gate    = GATE-INTENDED-USE
```

Nothing in this session issued an authorization, adopted a claim, designated a baseline, or made a
regulatory determination. The certified evidence baseline (`f0ba0e8f`, porcelain 16, `27302b87`)
remains reproducible in the original worktree.
