# OS-track L6 · S4.0 · TENANT AUTHORITY UNIFICATION · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: S4.0 LANDED — TEST-VERIFIED, non-frozen. The audit's #1 blocker is closed.** No proposal code exists yet
(S4.1); this is the wiring precondition the fleet audit ranked first. FREEZE INTACT. **S5 execution stop remains
separate and behind S4.**

## Why S4.0 first (the confused-deputy defense)
The fleet audit (B1, HIGH) found that a dual-authority split (a background principal vs the session-scoped catalog) could
form a proposal whose EVIDENCE is Tenant A and whose TARGET is Tenant B — the L6 join did no tenant cross-check and the
L4/L2/L3/L5 snapshots carried no tenant identity. Per the operator directive, **no proposal code exists before tenant
authority is unified.**

## What landed
- **`tenancy/tenantStamp.ts`** — a PURE `TenantStamp` (`{tenantId, scope, authoritySource, timestamp}`) + `reconcileTenant`
  (deny-by-default: no stamp → not provable; the first disagreement is surfaced, never silently resolved). Single tenant
  authority, imported never redefined (the D-16 pattern applied to tenancy).
- **Every snapshot carries the stamp** — `readonly tenant?: TenantStamp` threaded onto `WorkspaceDomainSnapshot` (L1),
  `CapabilityGraphSnapshot` (L4), `EnvironmentModel` (L2), `DiscoveryRun` (L3), `PurposeEvaluation` (L5) as a TYPE-only
  addition (the pure composers' zero-runtime-import invariants hold; the assembler/wiring sets the stamp from the ONE
  authoritative context).
- **L6 cross-check (conflict-check-0)** — `composeLiveBrainState` reconciles the five snapshot stamps FIRST: a disagreement
  is a first-class **`tenant identity` CONFLICTING** that flags every section; an ActionRecord whose `tenantId` differs
  from the reconciled tenant is a **`tenant identity (evidence)` CONFLICTING**. `LiveBrainState` gains
  `tenantProvable: boolean` — true ONLY when ≥1 stamp is present, all agree, and the evidence matches.
- **`proposalAdmission.ts`** — `proposalAdmissible(state)`, the S4 REFUSAL predicate: not provably single-tenant →
  `{ admissible:false, 'REFUSED — no proposal object is created' }`. Deny-by-default. PURE (type import only, zero authority).

## The BINDING acceptance fixture (`s4TenantUnification.test.ts`, 4) — pinned
| case | STATE | PROPOSAL | ACTION |
|---|---|---|---|
| single tenant A (all substrates + evidence A) | `tenantProvable=true`, no tenant conflict | admissible | (would propose) |
| **cross-tenant (evidence A, capability target B)** | **CONFLICTING** (`tenant identity`; sections CONFLICTING; `tenantProvable=false`) | **REFUSED** | **NONE** |
| cross-tenant evidence (snapshots A, ActionRecord in B) | `tenant identity (evidence)` CONFLICTING; `tenantProvable=false` | REFUSED | NONE |
| unstamped (deny-by-default) | `tenantProvable=false` | REFUSED | NONE |

The two tenants are fully populated via the REAL composers (L1–L5). The binding case is **exactly** the directive's:
*evidence from A, target in B → PROPOSAL = REFUSED, STATE = CONFLICTING, ACTION = NONE.*

## The five acceptance fields
| field | how honored |
|---|---|
| **Observable object** | `LiveBrainState.tenantProvable` + the `tenant identity` conflicts + `AdmissionVerdict` |
| **Collection boundary** | reconciles ONLY the injected snapshot stamps + ActionRecord tenantIds; no new source |
| **Capability contract** | REFUSE-only guard; `proposalAdmissible` proposes nothing, executes nothing; zero-runtime-import (only the two PURE authorities — verificationTerminals + tenantStamp — permitted; pinned) |
| **Verification** | tenant is provable ONLY with a present, agreeing stamp set + matching evidence — deny-by-default |
| **Failure/UNKNOWN** | any disagreement → CONFLICTING (never a silent join); no stamp → not provable → REFUSED |

## Non-frozen — no FG gate
New pure `main` modules (`tenantStamp`, `proposalAdmission`) + an additive optional field on five non-frozen snapshot
types (type-only) + the L6 cross-check. No shared-type change, no IPC channel, no frozen touch. Proofs:
`s4TenantUnification.test.ts` (4) + `tenantStamp` reconciliation exercised + full main (**847 files, 8908 passed /
3 skipped**) + typecheck node + lint clean.

## Next (report-and-continue): S4.1
The proposal engine (the reviewed field set) + the L5 operational bridge (built WITH S4) — consuming `proposalAdmissible`
so no proposal object is ever formed from a non-single-tenant state. Then S4.2 (the 7-attack integrity fleet, under a D-15
quiet window) → S4.3 (certification). **S5 remains its own hard stop.**

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. S4.0 gates whether a proposal MAY be formed; it
forms none, proposes nothing, executes nothing.
