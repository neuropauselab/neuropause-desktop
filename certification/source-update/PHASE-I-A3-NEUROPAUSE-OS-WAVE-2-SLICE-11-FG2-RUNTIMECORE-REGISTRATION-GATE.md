# NeuroPause OS — Wave 2 / Slice 11 — FG-2 GATE: runtimeCore capability registration

**Additive registration of the `capability:m365.propose` data-only handler. The handler logic + tests + the honest
`declareChannelResource` are non-frozen and already prepped (uncommitted, 15/15 green). The ONLY frozen change is in
`runtimeCore.ts`. Awaiting token: `AUTHORIZED: FG-2 — runtimeCore capability registration, one additive line, per gate doc`.**

## Honest scope note (surface before token)
The §5 phrasing says "one additive line." The verbatim diff is **two additive lines** in the frozen `runtimeCore.ts`
— the `defs.push(...)` and its necessary `import`. Both additive; both in `runtimeCore.ts`. The token's "per gate doc"
binds to THIS diff. If you want the token reworded to "two additive lines," say so; otherwise "per gate doc" covers both.

## Frozen diff — verbatim (`apps/desktop/src/main/runtimeCore.ts`)
```diff
+import { capabilityHandlers } from './capabilities/capabilityProposeIpc';
```
```diff
   defs.push(...connectors.handlers);
+  defs.push(...capabilityHandlers);   // FG-2 — capability:m365.propose (data-only proposal producer)
```
No other frozen line changes. `channels.ts`/`contracts.ts` (FG-1) unchanged; CST, executor, admission, M365ActionExecute unchanged.

## Non-frozen module it imports (prepped, uncommitted) — the exact def shape
`apps/desktop/src/main/capabilities/capabilityProposeIpc.ts`:
```
declareChannelResource({ channel: CapabilityProposeM365Action, store: 'connector-accounts', effect: 'read', reason: … });
export const capabilityHandlers = withRuntimeAuthz([
  { channel: IpcChannel.CapabilityProposeM365Action,
    schema: CapabilityProposeM365ActionRequest,
    handler: (req) => runProposeM365Action({ resolveSelection, subjectId, scope }, req) },
]);
```
- `withRuntimeAuthz` stamps `requireAuth:true` + `connectors:manage` from RUNTIME_CHANNEL_PERMISSIONS (throws if unclassified — it is classified).
- Handler pipeline (pure core `capabilityProposeCore.ts`): re-resolve capability (`capabilityDiscoveryService.resolveSelection` — NEVER trusts the AI capabilityId) → `resolvePrincipal(authService.getStatus().user.id, activeTenantScope())` → `buildM365ActionProposal` → `toWritePanelProposal` → data-only `{ok, proposal:{to,subject,body}, provenance:{capabilityId,accountId}} | {ok:false, reason, detail}`.
- Declaration verified from code: the handler reads `connector-accounts` (connected accounts, via the catalog), `effect:'read'`; writes no store; performs no effect. `DECLARED_BASELINE 3→4` accompanies it (non-frozen).

## Threat analysis — both directions
- **Inbound:** request is the UNTRUSTED AI candidate; the handler re-resolves the capability (Phase 5) and resolves the principal server-side; the request has no actor/tenant/principal field; malformed → zod edge reject; hostile params → inert (Slice-8 pins re-asserted in `capabilityProposeCore.test.ts`); `connectors:manage` + `requireAuth` gate the caller.
- **Outbound:** response is data only — `{to,subject,body}` + `{capabilityId,accountId}` or a typed refusal; no token/credential/callable/`confirmed` (pinned). It is a proposal, not authorization; the human confirms downstream through the certified path.
- **Structural:** the core takes no executor/CST/admission dep and has no import path to them; it cannot execute or mint admission.

## Verification plan (choreography per §2.2)
On token: apply the 2 frozen lines → the frozen line + the prepped non-frozen module + `declareChannelResource` +
`DECLARED_BASELINE 3→4` land in ONE isolated choreographed commit (bracketed by INTACT #3/#4) → full suites green →
evidence with the frozen/non-frozen split. Certified path untouched → certification impact NONE.

## Prep status (uncommitted, ready)
- `capabilities/capabilityProposeCore.ts` (pure), `capabilityProposeIpc.ts` (wired def), `capabilityProposeCore.test.ts`
  (8 pins), `channelStoreCoverageGate.test.ts` `DECLARED_BASELINE 3→4`. **Core test + channel-store gate: 15/15.**
  Typecheck clean; lint clean; `verify-freeze` INTACT (uncommitted prep doesn't drift committed source).

## STOP
Awaiting the token. Nothing frozen applied. HEAD `201e774`, FREEZE INTACT.

---

## EXECUTION RECORD (post-token)

**Token received (verbatim):** `AUTHORIZED: FG-2 — runtimeCore capability registration, two additive lines (import + push), per gate doc`.
Also approved: the §5 correction one→two additive lines, and this landing order — **land the prepped NON-frozen work first
as its own green commit; then re-record → INTACT → apply ONLY the two frozen lines → suites green → isolated frozen-only
commit → re-record → INTACT.** With the pre-authorized fallback: *if a guard makes the frozen-only commit non-green, fall
back to a single mixed commit and record why.*

### What landed, in order

1. **Non-frozen prep commit `c73e741`** — `capabilityProposeCore.ts` (pure), `capabilityProposeIpc.ts` (wired def, NOT yet
   imported anywhere), `capabilityProposeCore.test.ts`, `channelStoreCoverageGate.test.ts` `DECLARED_BASELINE 3→4`.
   Full main suite **8656 passed / 3 skipped**. Typechecked in isolation (nothing imported the module yet).

2. **Freeze re-record #3 `2668ab8`** — BASELINE at `c73e741`. INTACT. (Unblocked by applying the authorized living-docs
   spec-exclusion early to the three freeze scripts — see DECISIONS D-5; the untracked root docs had been tripping
   `freeze-baseline.sh`'s dirty check.)

3. **Applied the two frozen `runtimeCore.ts` lines** (import of `capabilityHandlers` + `defs.push(...capabilityHandlers)`).
   → **`npm run typecheck` FAILED: `runtimeCore.ts(2153,13) TS2345`.** The pushed def's handler
   `(req: CapabilityProposeM365ActionRequest) => …` is not assignable to the `SecureHandlerDef` slot
   `(payload: unknown) => unknown` — parameter **contravariance**. Latent in `c73e741` (typechecked in isolation because
   nothing imported the module); exposed only when `runtimeCore` imports and pushes it. The frozen-only commit therefore
   **could not be green** without a one-line non-frozen typing fix in `capabilityProposeIpc.ts`.

4. **FALLBACK invoked (pre-authorized).** Fixed the handler to `(req: unknown): …Response => runProposeM365Action(…, req
   as CapabilityProposeM365ActionRequest)` — the standard connector-handler pattern; the bridge validates `req` against
   `schema` before calling, so the cast is safe. The two frozen `runtimeCore.ts` lines + this non-frozen typing fix landed
   in one mixed commit **`5534c45`** (reason recorded in its message). Typecheck clean; lint clean on both files; full main
   suite **8656 passed / 3 skipped**.

5. **Freeze re-record #4 `aff5d13`** — verify-freeze reported **BROKEN** vs baseline #3 with `5534c45` as the sole
   source-touching commit (the authorized gate break). Re-froze onto `5534c45` → **BASELINE-0df776a6a740** → verify-freeze
   **INTACT** (evidence commit only since freeze).

### Frozen / non-frozen split (as landed)

- **FROZEN** (`packages/shared` was already done in FG-1; here only `runtimeCore.ts`): `+import { capabilityHandlers }`
  and `+defs.push(...capabilityHandlers);`. Two additive lines, exactly the token.
- **NON-FROZEN**: `capabilityProposeIpc.ts` handler-param typing fix (fallback); everything in `c73e741`.

### Certification impact: NONE
The certified M365 execution path (CST → governedSend/governedAction → admission → executor) is untouched. The new
channel is **data-only**: it validates an AI candidate against the capability catalog and returns a reviewable proposal +
provenance or a typed refusal. It has no import path to the executor/CST/admission and never sets `confirmed`. A human
still reviews and confirms downstream through the certified path (the one-confirmation architecture is intact).

### Baselines
- INTACT #3: baseline `c73e741` (re-record `2668ab8`).
- Break: `5534c45` (authorized FG-2 source change).
- INTACT #4: **BASELINE-0df776a6a740** at `5534c45` (re-record `aff5d13`). HEAD now `aff5d13`, FREEZE INTACT.
