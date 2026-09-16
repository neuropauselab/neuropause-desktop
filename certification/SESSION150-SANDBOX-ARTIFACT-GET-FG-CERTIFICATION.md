# SESSION 150 — SANDBOX ARTIFACT-GET GOES LIVE (FG-S149-SANDBOX-ARTIFACT-GET) CERTIFICATION
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · from e8feee6 · FROZEN (1 authorized additive line) + NON-FROZEN
### Selected + built: **Governed single-artifact fetch goes live** (`sandbox:artifact.get`) — GREEN

---

## 1 · Exact frozen line changed (FG-S149-SANDBOX-ARTIFACT-GET)
Token honored verbatim: `AUTHORIZED: FG-S149-SANDBOX-ARTIFACT-GET`. One additive entry in the sole authorized
frozen file `packages/shared/src/ipc/responses.ts` (git diff: **1 file changed, 2 insertions(+)** — the entry
+ its comment; nothing removed or altered), placed beside the existing `'sandbox:artifact.list': Artifact[];`:

```ts
  // FG-S149-SANDBOX-ARTIFACT-GET — fetch one artifact (metadata + inline content) by id.
  'sandbox:artifact.get': Artifact | null;
```

`Artifact` is already a shared type imported by `responses.ts`, so this is a single clean named-type entry.
No other frozen surface touched. gate-detector: `responses.ts` = FROZEN (authorized); the three non-frozen
files = PROCEED ×3.

## 2 · Exact non-frozen files changed
- `apps/desktop/src/renderer/src/lib/ipc.ts` — one typed helper `ipc.sandbox.artifact(id)` =
  `invoke(IpcChannel.SandboxArtifactGet, { id })` (typed via the FG entry; **no rawInvoke**).
- `apps/desktop/src/renderer/src/sandbox/panels/ArtifactsPanel.tsx` — artifact rows become expander buttons;
  opening one calls `ipc.sandbox.artifact(id)` and renders an inline detail (kind · mimeType · size + the
  `inline` content in a scrollable `<pre>`, or a "stored externally" note for binary artifacts). Loading,
  null (missing/denied), and thrown (unauthorized) states each render truthfully.
- **new** `apps/desktop/ui-tests/session150SandboxArtifactGet.test.tsx` (4).

## 3 · Complete runtime path
`ArtifactsPanel artifact row (button) → ipc.sandbox.artifact(id) → typed invoke → IPC sandbox:artifact.get →
sandbox handler (sandbox/index.ts:237, requireAuth: true, permission: read = sandbox:read) → artifacts.get(id)
(artifactStore.ts:116) → Artifact | null → inline artifact-detail render (content / external note / empty
state)`. Reuses the existing SandboxProvider, artifactStore, handler, and ArtifactsPanel — no new
store/provider/channel.

## 4 · Authorization proof (RBAC)
`sandbox:artifact.get` keeps its existing governance: `requireAuth: true, permission: read` (sandbox:read),
enforced main-side — identical to the already-wired sibling `sandbox:artifact.list`. A thrown IPC error
(unauthorized) renders "that artifact could not be opened — you may not have access…", never fabricated
content (focused test 4). Read-only: no create/update/delete/archive/version mutation was added or touched.

## 5 · Tenant-boundary proof
`artifactStore.get(id)` resolves within the sandbox workspace/execution boundary server-side (the same store
and boundary as the wired `artifact.list`); the `Artifact.tenantId` is fail-closed (absent ⇒ visible to none).
The renderer supplies NO tenant/org/workspace — only the artifact id.

## 6 · Renderer payload proof
Focused test asserts the dispatched payload is exactly `{ id: 'art-1' }` — `sawPayload` `toEqual({ id })`, with
`'tenantId' in payload === false`, `'orgId' in payload === false`, `'workspaceId' in payload === false`. The
workspace/execution/tenant boundary is resolved entirely server-side.

## 7 · Focused test results
`session150SandboxArtifactGet.test.tsx` (4), rendering the real ArtifactsPanel with a mocked `useSandbox`
(fixed execDetail) so the real `ipc.sandbox.artifact` helper routes through the harness: (1) opening an
artifact dispatches `sandbox:artifact.get` with ONLY `{ id }` (no tenant/org/workspace) and renders the inline
content; (2) a binary artifact (no inline) shows the external-storage note, not fake content; (3) a null
(missing/denied) result renders an honest empty state; (4) a thrown (unauthorized) fetch renders a truthful
message and no fabricated content. All 4 green.

## 8 · Full regression
| Check | Result |
|---|---|
| gate-detector (4 files) | **FROZEN ×1 (responses.ts, FG-authorized) + PROCEED ×3** |
| frozen diff | **1 file changed, 2 insertions(+)** — purely additive, only the authorized entry |
| typecheck node / web | **0 / 0** |
| eslint (3 files) | **0** |
| Full main (8 shards) | **10,845 passed / 7 skipped** — unchanged vs S148 (S150's test is UI-only, decision-neutral) |
| Full UI | **539 passed** (98 files) — S148 535 → **+4** |

## 9 · Package activation status
Unchanged. No package activated/imported/retired/deleted; no duplicate artifact store/provider/channel. Reuses
the live `main/sandbox` subsystem + the existing SandboxProvider + ArtifactsPanel.

## 10 · Remaining dark capabilities (post-S150)
- **Sandbox authoring mutations** (workspace/scenario/dataset create/update/delete/archive/version) —
  **policy-open** (delete/ownership/retention semantics undefined). Do-not-touch.
- **EcosystemOAuthToken / EcosystemOAuthRevokeToken** — machine-facing OAuth 2.1 endpoints, dark by design;
  not a UI gap.
- **No non-policy, non-machine-facing dark channel remains.** Channel-level convergence is complete for the
  safe/buildable class.

## 11 · Post-S150 convergence assessment (per directive)
- **Meaningful non-policy, non-machine-facing dark capability left?** No, at the IPC-channel level. The only
  fully-dark channels are the policy-open Sandbox authoring mutations and the machine-facing OAuth endpoints.
  Further "dark-at-UI" helper-method gaps (a typed helper with no component consumer) are largely event/
  subscribe/provider-internal and are UI-polish, not substantive capability gaps.
- **Production-readiness gates remaining (engineering vs external vs policy):**
  - **Undefined business policy (STOP-class):** Sandbox authoring delete/ownership/retention; ABAC/delegation/
    JIT authority; S138 inbound correlation semantics; posting-ownership (task #96). These need an operator
    ruling before any code.
  - **Operator / external verification (not code):** macOS keychain + live-Electron certification (Linux CI
    cannot claim these); distribution notarization/signing; SLO baselines (measure-then-target).
  - **Actual engineering work:** persistence migration into the durable runtime (explicitly deferred);
    S132 dependency remediation (deferred unless required); FG-gated report modules (Trial Balance / P&L / BS)
    behind an `enterprise/index.ts` registration FG.
- **Recommendation:** do NOT invent a speculative feature to manufacture another session. The substantive
  channel-level convergence work is essentially complete; the remaining items are operator-policy rulings,
  external/operator verification, or explicitly-deferred engineering. The highest-leverage next steps are
  operator decisions (Sandbox authoring policy, task #96 posting-ownership) or the macOS/distribution
  verification track — not another dark-capability activation.

## 12 · Commit hash
`<see commit below>` (single commit; the one authorized frozen line + its coupled non-frozen wiring, tests,
and this certification — gate-detected).

**FG-S149-SANDBOX-ARTIFACT-GET honored: exactly one additive entry in `responses.ts`, no other frozen surface,
no rawInvoke. No duplicate infrastructure. No Sandbox authoring/ownership/deletion/retention policy invented,
no authoring mutation activated. No OAuth-as-UI. No secrets or unrelated sandbox data exposed. Read-only,
sandbox:read-governed, tenant boundary server-resolved. An operator who could list sandbox artifacts but never
open one can now view an artifact's content on the real governed product path. macOS/keychain NOT claimed
(Linux CI).**
