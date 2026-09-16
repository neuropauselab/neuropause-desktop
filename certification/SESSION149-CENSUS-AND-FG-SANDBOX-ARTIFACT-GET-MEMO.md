# SESSION 149 — WHOLE-REPOSITORY CENSUS + DECISION/FG MEMO (no code change)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from b837120 · DOCS-ONLY (zero source, zero frozen)
### Outcome: **STOP at the frozen contract** — the strongest remaining capability (`SandboxArtifactGet`) requires one additive frozen response-map line. Precise FG request prepared below.

---

## 1 · Fresh census (post-S148)
Method: `comm` of main-registered `IpcChannel.*` vs renderer-referenced `IpcChannel.*`, plus targeted source
inspection. `MemoryBackfill` is now wired (S148) and has left the dark set.

**Fully-dark channels (main-registered, zero renderer reference) — exactly 12, in three classes only:**
- **D) Frozen/FG-gated (read):** `SandboxArtifactGet` — response type absent from the frozen IpcResponseMap.
- **C) Policy-open (mutations):** `SandboxWorkspaceCreate/Update/Delete`, `SandboxScenarioCreate/Update/Archive/VersionCreate`, `SandboxDatasetCreate/Delete` — authoring mutations whose delete/ownership semantics are undefined.
- **B) Machine-facing by design:** `EcosystemOAuthToken`, `EcosystemOAuthRevokeToken` — OAuth 2.1 endpoints, not a UI gap.

**Convergence finding:** there is NO fully-dark channel that is simultaneously non-frozen, non-policy, and
non-machine-facing. At the channel level the platform is essentially converged; the remaining dark surface is
FG-gated, policy-open, or machine-facing by design. (A) genuinely-missing-operator-surface with a clean
non-frozen path = **none at the channel level.** Domain areas (ERP/HR/CRM/finance/supply-chain/mfg/maintenance/
projects/intelligence/memory/connectors/governance/operations/developer) were all wired in prior sessions;
their governed commands and reads have renderer consumers. E) duplicate/parallel infrastructure remains on the
no-activate list, untouched.

## 2 · ≥8 candidates + ranking
Ranked by value × completeness × governance × tenant-safety × usefulness × reuse × ship-without-policy ×
ship-without-frozen:

| # | Candidate | Class | Governance | Frozen? | Policy? | Value | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **SandboxArtifactGet** (view one artifact's content) | dark read | `sandbox:read`, requireAuth | **needs 1 FG map line** (`Artifact\|null`) | none | MED — real ArtifactsPanel gap | **winner, FG-gated → STOP** |
| 2 | Sandbox scenario create/update/archive | dark mutation | `sandbox:manage`, audit | non-frozen | **delete/ownership OPEN** | MED (dev) | STOP/memo |
| 3 | Sandbox workspace create/update/delete | dark mutation | `sandbox:manage`, audit | non-frozen | **delete/ownership OPEN** | MED (dev) | STOP/memo |
| 4 | Sandbox dataset create/delete | dark mutation | `sandbox:manage`, audit | non-frozen | **delete/ownership OPEN** | LOW-MED | STOP/memo |
| 5 | EcosystemOAuthToken / RevokeToken | machine-facing | manage | non-frozen | none | n/a (not a UI gap) | do not surface |
| 6 | Dark-at-UI helper methods (typed helpers with no component consumer) | UI-polish | varies | mostly non-frozen | varies | LOW (mostly event/subscribe/provider-internal) | follow-up census axis; no confirmed clean win |
| 7 | Trial Balance / P&L / BS report *module* | missing module | — | **FG** (`enterprise/index.ts` registration) | none | MED | FG-gated, larger than #1 |
| 8 | Cross-module enterprise search | missing | — | non-frozen | **ranking/authz OPEN** | MED | needs policy |
| 9 | Inbound correlation (S138) / ABAC / persistence migration | — | — | — | **PERMANENT BLOCK** | — | excluded |

Do-not-touch set (§4 of the directive) honored: no Sandbox authoring mutation, no OAuth-as-UI, no S138, no
persistence migration, no ABAC/JIT, no parallel runtime, no S132, no undefined economic/approval/ownership
policy.

## 3 · Selected capability + why
**`SandboxArtifactGet` is the strongest remaining candidate** and the only non-policy, non-machine-facing
fully-dark capability. Real gap proven (source): `sandbox/panels/ArtifactsPanel.tsx:134-142` lists each
artifact (name, kind, size) as display-only — there is no way to open a single artifact's content. The
handler `artifacts.get(id)` (`sandbox/index.ts:236`) returns the full `Artifact` gated `requireAuth: true,
permission: read` (sandbox:read), server-side; `artifactStore.get(id): Artifact | null`
(`sandbox/artifactStore.ts:116`). Its sibling `sandbox:artifact.list` is already wired the same way.

**Pre-edit proof (§5):** implementation real ✓ (artifactStore.get) · handler authoritative ✓ (sandbox/index.ts,
sandbox:read) · governance real ✓ (requireAuth + read permission, matching the wired artifact.list) · tenant
boundary ✓ (execution/workspace-scoped store, same as list) · no duplicate infrastructure required ✓ (reuses
the sandbox subsystem + SandboxProvider + ArtifactsPanel).

**The one hidden frozen contract:** `sandbox:artifact.get` is absent from `packages/shared/src/ipc/responses.ts`
(its siblings `sandbox:artifact.list`, `sandbox:result.get`, `sandbox:report.get` are present). Typed wiring
(`ipc.sandbox.artifact(id)` via `invoke`) requires that one additive line. rawInvoke would evade a genuinely
required frozen contract change — forbidden by the directive. **The named type `Artifact` already exists in
shared and is already imported by responses.ts**, so — unlike S148's inline literal — this is a single clean
named-type entry.

## 4 · Precise FG request
```
AUTHORIZED: FG-S149-SANDBOX-ARTIFACT-GET
Add exactly one additive entry to packages/shared/src/ipc/responses.ts:
  'sandbox:artifact.get': Artifact | null;
(placed beside the existing 'sandbox:artifact.list': Artifact[]; `Artifact` is already imported.)
No other frozen surface.
```
On authorization, the non-frozen wiring (already scoped, not yet applied) is:
`ArtifactsPanel artifact row → ipc.sandbox.artifact(id) [typed invoke] → sandbox:artifact.get → sandbox:read →
artifacts.get(id) → Artifact|null → an artifact-detail drawer/section rendering the artifact's content` +
a focused UI test (renderer reachability: dispatch with `{ id }`, no tenant/org; missing artifact → null →
honest empty state) + focused core coverage. No new store/provider/policy.

## 5 · Why STOP and not build this session
The directive authorized no FG token for S149 (unlike S148, whose prompt carried `AUTHORIZED: FG-S148-…`).
CLAUDE §2 #1: frozen surfaces change only through an FG gate with the literal token; silence is not consent.
The directive §5: "If a frozen change is genuinely required, STOP and prepare the smallest precise FG request
instead of using rawInvoke to evade it." Both point to STOP. No non-frozen/non-policy candidate of equal or
greater value exists to build instead (census §1). Building a low-value non-frozen change purely to avoid
stopping would be audit-count optimization, which the directive explicitly forbids.

## 6 · Package activation status
Unchanged. No package activated/imported/retired/deleted. No source or frozen change this session.

## 7 · Remaining dark capabilities (unchanged)
`SandboxArtifactGet` (FG-gated — this memo); Sandbox authoring mutations (policy-open); OAuth token endpoints
(machine-facing).

## 8 · Remaining blockers (unchanged, not pretended solved)
S138 inbound correlation; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO verdict;
macOS/keychain/live-Electron OPERATOR-PENDING (Linux CI); S132 qs/supply-chain remediation; Sandbox authoring
delete/ownership semantics (policy-open).

## 9 · Recommended S150
Grant `FG-S149-SANDBOX-ARTIFACT-GET` (one clean named-type line) → wire the artifact-view surface end-to-end
per §4. Alternatively, rule the Sandbox authoring delete/ownership policy so the authoring mutations become
buildable, or open the Trial Balance/P&L/BS report-module FG. Respect the permanent-block and no-activate lists.

**No code changed. No frozen surface touched. No rawInvoke. No invented policy. No AI authority. The census
result is itself the finding: channel-level convergence is essentially complete, and the single strongest
remaining capability is FG-gated — its precise, minimal token is prepared above. macOS/keychain NOT claimed.**
