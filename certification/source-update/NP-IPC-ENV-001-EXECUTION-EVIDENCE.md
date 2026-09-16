# NP-IPC-ENV-001 — EXECUTION EVIDENCE · A.324 / GATE-IPC.05
### Status: IMPLEMENTATION_APPLIED_PENDING_REVIEW · NOT committed · NOT independently reviewed · NOT certified

## A. AUTHORITY
- Instrument: NP-IPC-ENV-001 · Issuer: Saurabh Patel (human Grantor/Issuer) · Holder: Dishant Dobariya
- Registry Event #9 · bound registry SHA-256 `cae54c453242bc32420dadfcd73e9d701fbcf873df1e6aecc3fd5961f7c16a9b`
- A.320 adoption act SHA-256 `51fe6aadc61245e3c9007e20870a406913575604caffb3662152695ea882c1ce` (first-person adoption verified A.323)
- Effective 3 September 2026 10:46 PM as declared by the issuer · A.323 = PRE_IMPLEMENTATION_ADMITTED
- NP-FG-001 LIVE/SEPARATE/UNAMENDED · FG-16 FREE/NOT CONSUMED/NOT RESERVED · A.294 LIVE/UNAMENDED

## B. PRE-EXECUTION BASELINE (measured 2026-09-03T18:56:46Z UTC, local clock)
- Repo `/Users/saurabhpatel/Desktop/neuropause-desktop` · branch `cert/data-import-cst-integration` · HEAD `542f3f629838d9df07a2ea9a126a022cde1c1ce1`
- Worktree: only `M certification/baseline.json` (known custody-protected 3±/3∓ pointer change; untouched by this seam)
- gate-detector (live): target PROCEED / EXIT=0 · control `packages/shared/src/ipc/contracts.ts` FROZEN / EXIT=2 (not edited)

## C/D. TARGET, PRE-EDIT
- `apps/desktop/src/renderer/src/lib/ipc.ts` · 117,200 B · 2,500 lines · SHA-256 `443501e5512ae988e5617702692cf83e2a83e92355154a33670b32e0d51a9324` · m365Execute() at 791–809 (byte-identical to the A.323 admitted state)

## E. TARGET, POST-EDIT
- 117,291 B (+91) · 2,502 lines (+2) · SHA-256 `0ae508c1a1a34578ee3cefdc6aadb634066460e1ebfb33c8ad5525b90cb5d1db` · m365Execute() now 791–811

## F/G/H. EXACT DIFF (2 insertions, 0 deletions, one path)
Diff SHA-256 `acbddd3e8e207d9313e90785be29d8029c400b41a45638fc8fad2dd4e0ea0525` (965 bytes; saved copy byte-verified against live `git diff`):

```diff
diff --git a/apps/desktop/src/renderer/src/lib/ipc.ts b/apps/desktop/src/renderer/src/lib/ipc.ts
index b8e1924..ec67559 100644
--- a/apps/desktop/src/renderer/src/lib/ipc.ts
+++ b/apps/desktop/src/renderer/src/lib/ipc.ts
@@ -796,6 +796,7 @@ export const ipc = {
       confirmed: boolean,
       /** FG-14 — causal episode identity, evidence only. Omitted when unavailable; never substituted. */
       correlationId?: string,
+      confirmedAt?: string,
     ) =>
       invoke(IpcChannel.M365ActionExecute, {
         connectorId,
@@ -806,6 +807,7 @@ export const ipc = {
         // FG-14 — omitted entirely when unavailable, so "absent" reaches the contract as absent
         // rather than as an empty string that a downstream reader could mistake for an identity.
         ...(correlationId === undefined ? {} : { correlationId }),
+        ...(confirmedAt === undefined ? {} : { confirmedAt }),
       }),
     m365Draft: (
       connectorId: string,
```

Changed paths: exactly `apps/desktop/src/renderer/src/lib/ipc.ts`. No comments added (the two authorized executable insertions only).

## I. SEMANTIC CHECKS (adversarially verified, 2 independent verifiers, 0 issues)
- confirmedAt optional trailing; `undefined` ⇒ key omitted; defined value forwarded verbatim; no generation (no `new Date`/`Date.now` in the diff or function), no default/transform/trim/validation/substitution/derivation; no authorization/credential/tenant/identity semantic change; existing correlationId semantics untouched.
- Wrapper regression: edited function still returns the typed `invoke(IpcChannel.M365ActionExecute, …)` — telemetry (:264–266), boot-window runtime-readiness + No-handler single retry (:275–284), denial decoding (:288), channel attribution (:289), first-failure logging (:290–293), typed response (`IpcResponseOf`), preload bridge, error propagation all reachable and byte-unchanged (the invoke helper region contains no diff hunk). No raw `window.neuropause.invoke` introduced (grep of full diff: zero matches). Sole caller `M365WritePanel.tsx:106` (6 args) unmodified and compatible.

## J/K. VALIDATION (offline only)
- `npm run typecheck -w @neuropause/desktop` (tsc node + web): EXIT=0
- `npx eslint apps/desktop/src/renderer/src/lib/ipc.ts --max-warnings 0`: EXIT=0
- Tests: NOT RUN this seam — actionRecord.test.ts / T1–T10 are outside NP-IPC-ENV-001 (test-file modification not authorized); no test claimed passed that was not run. No build.

## L–P. AUDIT
Network 0 · credentials 0 · authentication 0 · Graph 0 · external effect 0 · registry mutation 0 · governance mutation 0 · commit 0 · push 0 · tag 0 · build 0 · package 0 · release 0. Post-edit worktree: `M apps/desktop/src/renderer/src/lib/ipc.ts` + known `M certification/baseline.json` + this evidence file (created per the instrument's evidence provision, after the worktree scope check).

Independent review: NOT claimed. Certification: NOT claimed. Release readiness: NOT claimed.
