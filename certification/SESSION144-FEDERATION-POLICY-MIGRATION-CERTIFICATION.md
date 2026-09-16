# SESSION 144 — WHOLE-REPOSITORY CAPABILITY CONVERGENCE CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from b652b78 · NON-FROZEN, no FG token
### Selected + built: **Federation legacy-policy migration/quarantine goes live** (4 dark governed channels) — GREEN

---

## 1 · Fresh census
Governed command spine LIVE (25 domain commands, all renderer-exposed after S142). Governed operational READ
branch LIVE. Enterprise module registry LIVE (~110 modules, registry-auto-surfaced). Trial balance LIVE (S143).
Data-plane governed export LIVE + renderer-wired (`ExportConfig.tsx` — NOT dark). Backup/audit/approvals/holds
all renderer-consumed. **Remaining CORRECT-BUT-DARK governed channels (registered + governed + tested in main,
no renderer path):** the federation legacy-policy migration cluster (4), `KpiCapture` (1), `EcosystemKeysRotate`
(1), Sandbox authoring CRUD (9), Ecosystem OAuth token endpoints (dark by design, machine-facing).

## 2 · Direct vs transitive package consumption
Direct desktop deps: `@neuropause/shared`, `companion-protocol`, vendored `cst`, `solution-packs`. ~44 other
`packages/*` are unconsumed workspace packages (parallel runtimes on the no-activate list). The federation
governance engine used here is the LIVE in-app `main/federation/**` + `federationPlatform/federationAuthz.ts`,
not a package.

## 3 · ≥8 candidates
1. **Federation legacy-policy migration/quarantine** (FedPolicyMigrationStatus/QuarantinedPolicies/ClaimPolicy/
   DiscardPolicy) — DARK, governed (`federation:read`/`federation:manage`), audited, tenant/org server-resolved,
   tested (`tenancy/e2e/federationLegacyMigration.test.ts`), self-contained admin surface. **No frozen change.**
2. `KpiCapture` — DARK governed action (`intelligence:read`), no renderer helper. Small value.
3. `EcosystemKeysRotate` — DARK governed+audited action beside wired create/revoke. Developer-niche.
4. Sandbox authoring CRUD (9 channels) — DARK, larger surface.
5. Governed operational-evidence export — reuse-only; export framework already exists (dp:export is wired).
6. Trial Balance report *module* — needs FG (frozen `enterprise/index.ts` registration).
7. Cross-module enterprise search — MISSING + NEEDS POLICY (ranking/authz).
8. Ecosystem OAuth token/revoke — DARK by design (machine-facing) — not a UI gap.
9. Inbound correlation (S138) / ABAC enforcement / persistence migration — NEEDS POLICY / excluded.

## 4 · Ranking + selection rationale
#1 Federation migration cluster wins: it is the highest-value fully-buildable-now "correct but dark"
capability — a complete governance-admin workflow (see the count → view the quarantined rows → claim or
discard), fully governed/audited/tested in main, resolvable only from a renderer path that did not exist. Its
absence is a real operational hazard: governance evaluation **fails closed** while any legacy policy is
unattributed, and before S144 no user could clear them. No undefined policy, no frozen surface, no new
infrastructure. (The 4-channel cluster also satisfies the mandate's Candidate A priority.)

## 5 · Exact architecture path
`GovernancePanel (federation:manage admin) → useFederation() → ipc.federation.{policyMigrationStatus,
quarantinedPolicies,claimPolicy,discardPolicy} → secure preload → IPC (fed:gov.*) → federationAuthz RBAC
(READ for status, MANAGE for the rest) → main/federation/index.ts handlers → globalGovStore (org resolved
server-side via callerOrg(); claim/discard audited; fail-closed with no active org) → IPC response →
FederationProvider state → UI`. Reuses the existing federation IPC cluster, the existing FederationProvider,
and the existing GovernancePanel — no new store/channel/command/bus/authz.

## 6 · Files changed (all non-frozen)
- `apps/desktop/src/renderer/src/lib/ipc.ts` — 4 `ipc.federation.*` helpers (via untyped `rawInvoke`, since
  these channels are not in the frozen `IpcResponseMap` — the platform-dispatch precedent).
- `apps/desktop/src/renderer/src/federation/FederationProvider.tsx` — `migrationRequired`/`quarantinedPolicies`
  state + a dedicated `refreshMigration` reader (the large refreshAll/refreshLive tuples untouched) + `claimPolicy`/
  `discardPolicy` actions + context wiring + event-driven refresh.
- `apps/desktop/src/renderer/src/federation/GovernancePanel.tsx` — a "Legacy policy migration" admin panel
  (count subtitle, quarantined-row list, Claim/Discard, truthful outcome message), shown only when there is
  something to resolve.
- **new** `apps/desktop/ui-tests/session144FederationPolicyMigration.test.tsx` (5).

## 7 · Frozen / FG status
**No frozen surface touched. No FG token.** gate-detector = PROCEED ×4. The channels, handlers, RBAC map,
zod contracts (`FedPolicyMigrationRequest`), and store already existed; only the renderer was added.

## 8 · Security proof
The four channels keep their existing governance: `federation:read` (status count only — a quarantined row may
name another org's action, so its CONTENTS are never disclosed on the status channel) and `federation:manage`
(quarantined listing + claim + discard, all audited). The store resolves the acting org server-side via
`globalGovStore.callerOrg()` and refuses (returns null/false) with no active org — claim/discard can only
constrain the caller's own governance. The renderer sends ONLY the policy id (proven: no `org`/`tenantId`
field), never a tenant/org claim. Claiming/discarding is fail-closed and idempotent (a second attempt on a
resolved row returns false, not a re-mutation). No secret/credential surface. Main-side guarantees are
certified in `tenancy/e2e/federationLegacyMigration.test.ts`.

## 9 · Tenant proof
Org/tenant identity is server-resolved (`callerOrg()`); the renderer never supplies it. Quarantined-row
contents come back only for a `federation:manage` caller with an active org; the count is all anyone else sees.

## 10 · Policy analysis
**No undefined policy invented.** The migration semantics were fully defined in P13C Round 5: claim (take
ownership, safe-by-construction) or discard are the two ruled resolutions; attributing rows to *other* orgs is
the explicitly-rejected option that would need an authority the app lacks — and S144 does not do it. No
approval/SoD/threshold/retention decision is required.

## 11 · Focused test results
`session144FederationPolicyMigration.test.tsx` (5): status → count + empty payload; quarantined → rows;
claim/discard → send ONLY the id (no org/tenant), return the governed outcome; a `claimed:false` refusal is
returned honestly, not thrown. All 5 green.

## 12 · Full regression
| Check | Result |
|---|---|
| gate-detector (4 files) | **PROCEED ×4** — zero frozen |
| typecheck node / web | **0 / 0** |
| eslint | **0** |
| Full main (8 shards) | **10,844 passed / 7 skipped** (1038 files) — unchanged vs S143 (renderer-only, decision-neutral) |
| Full UI | **525 passed** (93 files) — S143 520 → **+5** |
| federationLegacyMigration e2e + S104 security | included in full main (green) |

## 13 · Package activation status
Unchanged. No package activated/imported/retired/deleted; no duplicate infrastructure. Reuses the live
`main/federation` engine + the existing federation renderer cluster.

## 14 · Remaining blockers (unchanged, not pretended solved)
- S138 inbound correlation policy; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO
  verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux); S132 qs/supply-chain remediation.

## 15 · Commit hash
`<see commit below>` (single non-frozen commit).

## 16 · Recommended S145
Next fully-buildable "correct but dark" candidates (no frozen change): **KpiCapture** (one dark governed
`intelligence:read` action beside the already-wired ExecutiveCenterSnapshot — helper + a "Capture KPIs" button)
or **EcosystemKeysRotate** (dark governed+audited action beside wired create/revoke). If a dedicated Trial
Balance / P&L / Balance Sheet report *module* is preferred, that is an FG-gated slice (frozen
`enterprise/index.ts` registration) — present the exact FG request. Respect the S138 block, the parallel-runtime
no-activate list, and the S132 debt.

**No FG token. No duplicate infrastructure. No AI authority. No invented policy. No secrets/raw payload exposed.
Zero frozen surfaces touched. A quarantine that main could count but no user could clear is now resolvable on
the real governed product path. macOS/keychain NOT claimed.**
