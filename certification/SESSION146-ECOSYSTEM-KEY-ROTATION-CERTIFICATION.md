# SESSION 146 — WHOLE-REPOSITORY SUBSTANTIVE CAPABILITY CONVERGENCE CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from 87b0c08 · NON-FROZEN, no FG token
### Selected + built: **API key ROTATION goes live** (`ecosystem:keys.rotate`, 1 dark governed action) — GREEN

---

## 1 · Fresh repository census
Governed command spine LIVE (25 domain commands, renderer-exposed since S142). Governed operational READ
branch LIVE. Enterprise module registry LIVE (~110 modules). Trial balance LIVE (S143). Federation
legacy-policy migration LIVE (S144). KPI capture LIVE (S145). Developer Portal LIVE (dashboard, keys
create/revoke/list, OAuth apps, usage, marketplace, gateway, billing — all renderer-consumed). **Remaining
CORRECT-BUT-DARK governed channels (registered + governed + tested in main, no renderer path):**
`EcosystemKeysRotate` (1), Sandbox authoring CRUD (~9), Ecosystem OAuth token/revoke (machine-facing, dark
by design).

Sandbox CRUD inspection: the sandbox authoring channels are a **developer-only** authoring surface (create/
update/delete workspaces, scenarios, datasets). Per the mandate's own caution — "do not expose developer-only
or unsafe operations merely to eliminate a dark-channel count" — the nine were not selected; several are
destructive delete operations whose production-operator appropriateness is unsettled (a policy question), and
the count is not itself a reason.

## 2 · ≥8 ranked candidates
| # | Candidate | Impl | Tests | RBAC | Tenant | Reachable | Dark link | Frozen? | Policy | Value |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **EcosystemKeysRotate** | complete (`developerStore.rotateKey`) | main (`developerSurfaceTenancy`) | `developer:manage` | server (`mineOrNull`) | no renderer helper/UI | helper+button | non-frozen (rawInvoke) | none | **HIGH** — leaked-key cutover w/o downtime |
| 2 | Sandbox workspace/scenario/dataset CRUD (~9) | complete | main | manage | server | no renderer path | large surface | non-frozen | **delete-appropriateness open** | med, dev-only |
| 3 | Ecosystem OAuth token/revoke-token | complete | main | manage | server | machine-facing | not a UI gap | non-frozen | none | low (by design) |
| 4 | Trial Balance/P&L/BS report *module* | builder exists | main | — | server | needs registration | FG (frozen `enterprise/index.ts`) | none | med |
| 5 | Cross-module enterprise search | partial | — | — | — | missing | needs ranking/authz | non-frozen | **needs policy** | med |
| 6 | Inbound event correlation (S138) | — | — | — | — | — | — | — | **PERMANENT BLOCK** | — |
| 7 | ABAC/delegation/JIT enforcement | pure only | main | — | — | — | needs authority policy | — | **PERMANENT BLOCK** | — |
| 8 | Persistence-migration into parallel runtime | dormant pkg | — | — | — | — | — | — | **PERMANENT BLOCK** | — |

## 3 · Selection rationale
**#1 EcosystemKeysRotate wins.** It is the highest-value fully-buildable-now "correct but dark" capability:
a complete, governed, audited, tenant-safe mutation (`developer:manage`, `audit:true`, `rotateKey` resolves
ownership via `mineOrNull` before mutating, mints a fresh secret and revokes the old id atomically) that sits
directly beside the already-wired **create** and **revoke** on the same `ApiKeysPanel`, yet had no renderer
path — so an operator whose key leaked could only revoke-then-recreate (two steps, a downtime window, a new
id) rather than rotate cleanly. It requires no undefined policy (rotation semantics are fully defined and
tested), no frozen change (rawInvoke — the channel is intentionally absent from the frozen IpcResponseMap),
and no new infrastructure. Sandbox CRUD was explicitly declined on the developer-only / delete-appropriateness
caution; everything else is FG-gated, policy-blocked, or a permanent block.

## 4 · Exact architecture path
`ApiKeysPanel "Rotate" (developer:manage admin) → useDeveloper().rotateKey(id) → ipc.ecosystem.rotateKey(id)
→ rawInvoke(window.neuropause.invoke) → IPC ecosystem:keys.rotate → ecosystemAuthz RBAC developer:manage →
ecosystem/index.ts handler (audit:true) → developerStore.rotateKey(id) [mineOrNull ownership resolve →
createKey (new secret) → revokeKey (old id), atomic] → ApiKeyWithSecret | { error } → DeveloperProvider
refreshLive() → the new secret revealed once via the existing one-time modal`. Reuses the existing channel,
handler, RBAC map, store, DeveloperProvider and ApiKeysPanel — no new store/channel/command/bus/authz.

## 5 · Files changed (all non-frozen)
- `apps/desktop/src/renderer/src/lib/ipc.ts` — one `ipc.ecosystem.rotateKey` helper (via untyped `rawInvoke`,
  since `ecosystem:keys.rotate` is intentionally absent from the frozen `IpcResponseMap` — the S144 precedent).
- `apps/desktop/src/renderer/src/developer/DeveloperProvider.tsx` — `rotateKey` action on the context
  (returns `ApiKeyWithSecret | { error } | null`, refreshes live slices; the large refresh tuples untouched).
- `apps/desktop/src/renderer/src/developer/ApiKeysPanel.tsx` — a "Rotate" IconAction on each active key row
  (beside Revoke); the new secret is revealed once through the SAME one-time modal as creation; a governed
  refusal is shown as a truthful inline message, never fabricated or thrown.
- **new** `apps/desktop/ui-tests/session146EcosystemKeyRotate.test.tsx` (2).

## 6 · Frozen / FG status
**No frozen surface touched. No FG token.** gate-detector = PROCEED ×4. The channel, handler, RBAC entry,
zod contract (`EcosystemKeysRotateRequest`), and store method already existed; only the renderer was added.
Adding `ecosystem:keys.rotate` to the frozen `IpcResponseMap` WOULD be a frozen change — deliberately avoided
by using `rawInvoke` (the established precedent), so no FG was required.

## 7 · Security proof
`ecosystem:keys.rotate` keeps its existing governance: RBAC `developer:manage` (enforced main-side via
`ecosystemAuthz`), `audit:true`. The renderer sends ONLY the key id (proven: `sawPayload` `toEqual({ id })`,
no `tenantId`/`orgId`/`developerId`). Ownership is resolved SERVER-SIDE by `developerStore.rotateKey` →
`mineOrNull` (`this.tenancy.mine(k)`), so one tenant can never rotate another's key (fail-closed → `null`),
and a revoked key cannot be re-rotated (`k.revokedAt` guard → `null`). The rotate is atomic (mint new + revoke
old). **No private-key material crosses into the renderer** — the secret returned is the API-key bearer secret,
the exact same class already surfaced once by `createKey`, shown once and never re-displayed (the store keeps
only a hash). A governed refusal is returned as data, not thrown. AI is not involved — this is an
operator-initiated button.

## 8 · Tenant proof
Owner/tenant identity is server-resolved (`mineOrNull`); the renderer never supplies it. The focused test
asserts the dispatched payload is exactly `{ id }` with no tenant/org/developer key. Main-side cross-tenant
refusal is certified in `tenancy/e2e/developerSurfaceTenancy.test.ts` (`rotateKey(b)` → `toBeNull()`).

## 9 · Policy analysis
**No undefined policy invented.** Rotation semantics were fully defined in P3.0: mint a fresh secret with the
same name/scopes/expiry and revoke the old id atomically. No approval/SoD/threshold/retention/ownership/
ranking decision is required. (Sandbox CRUD was declined precisely because its delete operations raise an
open production-operator-appropriateness question — a policy call, not a wiring call.)

## 10 · Focused test results
`session146EcosystemKeyRotate.test.tsx` (2): rotate dispatches `ecosystem:keys.rotate` with ONLY the id (no
renderer-supplied tenant/org/developer) and returns the new one-time secret; a governed refusal (`{ error }`)
is returned honestly, not thrown. Both green.

## 11 · Full regression
| Check | Result |
|---|---|
| gate-detector (4 files) | **PROCEED ×4** — zero frozen |
| typecheck node / web | **0 / 0** (exit 0 / 0) |
| eslint (4 files) | **0** |
| Full main (8 shards) | **10,844 passed / 7 skipped** (1038 files) — identical to S145 (renderer-only, decision-neutral) |
| Full UI | **530 passed** (95 files) — S145 528 → **+2** |
| developerSurfaceTenancy e2e | included in full main (green) |

## 12 · Package activation status
Unchanged. No package activated/imported/retired/deleted; no duplicate infrastructure. Reuses the live
`main/ecosystem` developer stack + the existing DeveloperProvider + ApiKeysPanel.

## 13 · Remaining blockers (unchanged, not pretended solved)
- S138 inbound correlation policy; persistence-migration policy; ABAC/delegation/JIT authority policy; SLO
  verdict; macOS/keychain/live-Electron OPERATOR-PENDING (Linux CI); S132 qs/supply-chain remediation.
- Sandbox CRUD delete-appropriateness for the production operator surface (policy-open — deliberately not
  wired this session).

## 14 · Commit hash
`<see commit below>` (single non-frozen commit).

## 15 · Recommended S147
Remaining fully-buildable non-frozen candidate: a **read-only Sandbox authoring surface** (list workspaces/
scenarios/datasets) that avoids the delete-appropriateness policy question while surfacing the authoring state,
or the mutating Sandbox CRUD once a production-operator delete policy is ruled (present a DECISION MEMO first).
A dedicated Trial Balance / P&L / Balance Sheet report *module* remains an FG-gated slice (frozen
`enterprise/index.ts` registration) — present the exact FG request. Respect the S138 block, the parallel-runtime
no-activate list, and the S132 debt.

**No FG token. No duplicate infrastructure. No AI authority. No invented policy. No secrets/private keys/raw
payload exposed (the one-time bearer secret is the same class already surfaced by create). Zero frozen surfaces
touched. An operator who could create and revoke API keys but never rotate a leaked one can now rotate cleanly
on the real governed product path. macOS/keychain NOT claimed (Linux CI).**
