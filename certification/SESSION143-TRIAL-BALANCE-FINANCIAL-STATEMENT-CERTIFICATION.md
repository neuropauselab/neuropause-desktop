# SESSION 143 — WHOLE-REPOSITORY SUBSTANTIVE CAPABILITY CONVERGENCE CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · NON-FROZEN, no FG token
### Selected + built: **Trial Balance on the live Financial snapshot** (the certified `glTrialBalance` builder goes live) — GREEN

---

## A · Fresh repository census
Governed command spine LIVE (25 domain commands, all renderer-exposed after S142). Governed operational READ
branch LIVE (10 Query* ops). Enterprise module registry LIVE (~110 module instances, all registered in the
FROZEN `enterprise/index.ts`, auto-surfaced in the Business Workspace via `readableSummaries`, RBAC-gated).
Data-plane governed export LIVE + renderer-wired (`ExportConfig.tsx`). S81/S83/S84/S85/S86 snapshot modules all
REGISTERED + surfaced (not dark).

## B · Direct vs transitive package consumption
Direct desktop deps: `@neuropause/shared`, `companion-protocol`, vendored `cst`, `solution-packs`. All other
~44 `packages/*` are unconsumed workspace packages (parallel runtimes on the no-activate list). `@neuropause/
business` (its own ErpCore/trialBalance) is NOT imported anywhere in apps/desktop — dormant; the live-app GL
builders live in `@neuropause/shared` (`glTrialBalance`/`glStatement`).

## C · ≥8 candidate capabilities
1. **Trial Balance / Financial Statements** — certified `glTrialBalance()` (`generalLedger.ts:289`) had ZERO
   production consumers; `glStatement()` consumed only for ratios. CORRECT-BUT-DARK. Real accountant consumer.
2. Federation governance-admin cluster (FedPolicyMigrationStatus/QuarantinedPolicies/ClaimPolicy/DiscardPolicy)
   — DARK, complete engine, no renderer surface. Niche admin value.
3. KpiCapture (`kpi:capture`) — DARK governed action, `intelligence:read`, no renderer helper. Small value.
4. EcosystemKeysRotate — DARK governed+audited action next to wired create/revoke. Developer-niche.
5. Sandbox authoring CRUD (workspace/scenario/dataset create/update/delete) — DARK, 9 channels, larger.
6. Governed operational-evidence export (S141 suggestion) — reuse-only; export framework already exists.
7. Cross-module enterprise search — MISSING; NEEDS POLICY (ranking/authz) + new fan-out handler.
8. Ecosystem OAuth token/revoke endpoints — DARK by design (machine-facing, via REST gateway) — not a UI gap.
9. Inbound correlation — NEEDS POLICY (S138). ai-runtime/persistence/etc. — DUPLICATE/PARALLEL.

## D · Candidate ranking
#1 Trial Balance (highest business value, real consumer, no policy, reuses live registered module, no dup) →
#2 Fed governance cluster (fully buildable now but niche) → #3 KpiCapture → #4 export → #5 EcosystemKeysRotate
→ #6 Sandbox CRUD → #7 cross-module search (policy-blocked) → #8 OAuth (by-design dark) → rest blocked.

## E · Selected winner + why
**Trial Balance on the live Financial snapshot.** The trial balance is the single most conventional accounting
control (posted debits vs credits + a balanced check) and the certified builder existed and was tested but had
ZERO production consumers — the repo's own S9 audit flagged this P1. The `financialRatiosModule` (Finance,
registered, surfaced, RBAC `operations:read`/`operations:manage`) already reads the GL and calls `glStatement`;
extending it to also compute and persist the certified `glTrialBalance` brings the dark builder onto the live
product surface with **no frozen change** (contrast: a brand-new module would require registering in the FROZEN
`enterprise/index.ts` → an FG gate + STOP, which would not be reachable this session). No undefined policy (the
accounting is fully defined by the certified builder). Highest value that is fully buildable + reachable now.

## F · Exact architecture path
`Business Workspace → EnterpriseModulesList/Get (governed reads, RBAC operations:read, server-resolved tenant)
→ financialRatiosModule record → its validate hook reads the injected Ledger Accounts + Journal stores →
glTrialBalance(postedEntries) [certified] → persists totalDebits/totalCredits/trialBalanceStatus on the
immutable snapshot → summarize surfaces the trial balance + escalates an UNBALANCED ledger to a high-risk GL
integrity alarm`. Reuses the existing registered module, its injected stores, and the governed read path — no
new module, channel, command, store, or index.ts registration.

## G · Files changed (all non-frozen)
- `apps/desktop/src/main/enterprise/modules/finance/financialRatiosModule.ts` — import `glTrialBalance`; add
  `totalDebits`/`totalCredits`/`trialBalanceStatus` descriptor fields; compute them in `validate` from the
  same posted journal; surface the trial balance in `summarize` and flag an UNBALANCED ledger as high risk;
  descriptor description updated.
- `apps/desktop/src/main/enterprise/modules/finance/financialRatios.test.ts` — +trial-balance assertions on
  the balanced-book test; +1 new test proving an UNBALANCED trial balance is a high-risk GL integrity alarm.

## H · Frozen / FG status
**No frozen surface touched. No FG token.** gate-detector = PROCEED ×2. `enterprise/index.ts` is FROZEN and was
NOT edited (the winner was chosen precisely to avoid a new-module registration). `glTrialBalance` is already
exported from `@neuropause/shared` and imported the same way as the module's existing `glStatement`.

## I · Security proof
Read-through-generate on an existing governed module: RBAC `operations:read`/`operations:manage` (Finance
family scopes), tenant resolved server-side, no renderer tenant authority. The trial balance is computed from
the tenant's own posted journal (never typed in); an immutable snapshot; no secret/credential/token surface.
Bounded (a single snapshot record). No new egress.

## J · Tenant proof
The module's stores are tenant-scoped by construction (the same injected Ledger Accounts + Journal stores the
ratios already read). The snapshot is created under the caller's tenant via the generic governed
`enterprise:module.create` path (unchanged). No cross-tenant surface added.

## K · Policy analysis
**No undefined policy invented.** The trial balance is a certified, deterministic accounting computation
(`glTrialBalance`); "balanced" is `round((debits−credits)*100)===0`. Flagging an unbalanced ledger as elevated
risk is a factual integrity signal, not a business threshold. No approval/SoD/monetary-threshold/retention/
accounting-treatment decision is required — the accounting is already defined.

## L · Focused tests
`financialRatios.test.ts`: balanced book → `totalDebits=1600`, `totalCredits=1600`, `trialBalanceStatus=
'Balanced'`, summary names the trial balance, risk not high; NEW — an UNBALANCED persisted register → summarize
`risk='high'` with "does not balance" reason and the alarm in the headline/summary. Plus `moduleCertification`
(all descriptors valid) still green with the new fields.

## M · Full regression
| Check | Result |
|---|---|
| gate-detector (2 files) | **PROCEED ×2** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint | **0** |
| Full main (8 shards) | **10,844 passed / 7 skipped** (1038 files) — S142 10,843 → **+1** (new module test), decision-neutral |
| Full UI | **520 passed** (92 files) — unchanged (no renderer change) |
| moduleCertification + S30 GL control-plane + S104 security | included (green) |

## N · Package activation status
Unchanged. No package activated/imported/retired/deleted. `@neuropause/business` (parallel ErpCore) NOT
activated — the live GL builders in `@neuropause/shared` were used.

## O · Remaining blockers (unchanged, not pretended solved)
- S138 inbound correlation policy; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO
  verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux); S132 qs/supply-chain remediation.
- A **standalone dedicated Trial Balance / P&L / Balance Sheet report MODULE** (vs surfacing on the ratios
  snapshot) remains available as a future slice — it needs an FG gate for `enterprise/index.ts` registration
  (recorded, not taken this session).

## P · Recommended S144
Discovery-first again. Strongest remaining "correct but dark" candidates that are FULLY buildable without a
frozen change: (1) the **Federation governance-admin cluster** (four dark governed channels already registered
in non-frozen `federation/index.ts` — helpers + one admin panel; no policy), or (2) **KpiCapture** (one dark
governed action beside the already-wired ExecutiveCenterSnapshot). If a dedicated Trial Balance report module
is preferred over the ratios-snapshot surfacing, that is an FG-gated slice (new `enterprise/index.ts`
registration) — present the exact FG request. Respect the S138 block, the parallel-runtime no-activate list,
and the S132 debt.

**No FG token. No duplicate infrastructure. No AI authority. No invented policy. No secrets/raw payload exposed.
Zero frozen surfaces touched. The certified trial-balance builder is now on the live product surface, and an
unbalanced ledger is surfaced as an integrity alarm rather than hidden. macOS/keychain NOT claimed.**
