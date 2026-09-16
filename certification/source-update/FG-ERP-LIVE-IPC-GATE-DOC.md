# FG GATE DOC — LIVE PLATFORM-COMMAND IPC CHANNEL (ERP Session 21-Live)

**Status:** PREPARED — ⛔ AWAITING OPERATOR TOKEN. No frozen surface has been touched. No code applied.
**Precedent:** FG-1 (`capability:m365.propose` contract in `packages/shared`) + FG-2 (`runtimeCore` `defs.push`). This gate replays that exact two-part pattern for the ERP platform command bus.
**Why a gate at all:** the S17–S21 platform (command bus → application boundary → workflow → client adapter) has **zero production callers** (verified: the only importers of `dispatchCommand`/`handleApplicationRequest`/`decideApproval`/the adapters are the platform modules themselves + the S17–S21 test files). Putting it on the live Electron IPC path is the whole point of this session, but the only registration points are **frozen**.

---

## A · WHY THE CHANGE IS REQUIRED

The renderer today reaches ERP only through the `enterprise:module.*` channels → `buildModuleHandlers` → `module.runAction`/`store` (the direct module framework). That path is live and governed (RBAC + tenant scope), but it does **not** traverse the S17–S21 governed platform: no command envelope, no principal-derived tenancy at the command layer, no durable idempotency journal, no domain-event/outbox, no workflow/approval gate. The command bus exists and is fully test-verified, but nothing production invokes it. To make "USER → IPC → application boundary → command bus → durable transaction → event → outbox → audit → UI" real, a live IPC channel must dispatch into `handleApplicationRequest`. There is no non-frozen way to add a new invokable channel: the channel name, its contract, and its invokable-allowlist membership all live in frozen `packages/shared`, and the handler registration lives in frozen `runtimeCore.ts`. (The non-frozen handler module cannot even compile until the frozen `IpcChannel` enum entry exists — so there is no "non-frozen half" that can land first on its own.)

## B · EXACT SURFACES

1. **`packages/shared/src/ipc/channels.ts`** (FROZEN — whole `packages/shared/` is frozen):
   - the `IpcChannel` map (add one entry),
   - the runtime-invokable classification list (~line 1320, add the new channel),
   - `ALL_INVOKABLE_CHANNELS` (~line 2024, add the new channel).
2. **`packages/shared/src/ipc/contracts.ts`** (FROZEN): add the request Zod schema + response type (mirrors `CapabilityProposeM365ActionRequest`, line 510).
3. **`apps/desktop/src/main/runtimeCore.ts`** (FROZEN): one import + one `defs.push(...platformCommand.handlers)` beside the existing `defs.push(...capabilityHandlers)` (line 2191).

Non-frozen accompaniment (lands with, gated by, this doc — cannot precede B.1):
4. **NEW `apps/desktop/src/main/platform/adapter/platformCommandIpc.ts`**: builds the `SecureHandlerDef` group, self-carrying `requireAuth: true` + the per-operation permission, resolving the principal SERVER-SIDE (from the authenticated session / active tenant scope — never renderer-supplied), and calling `handleApplicationRequest` with the production `ApplicationDeps` (the live enterprise registry + a durable `DurableCommandJournal` singleton + the framework audit sink).
5. **Renderer** call site (non-frozen) that invokes the channel via the existing `window.neuropause.invoke` bridge (the bridge itself is generic and needs no edit — it validates against the frozen `ALL_INVOKABLE_CHANNELS`).

## C · EXISTING INVARIANTS THAT MUST HOLD

- Deny-by-default channel classification (`assertAllChannelsClassified`) — a new non-public channel MUST be classified or the boot assertion fails. Satisfied by the handler self-carrying `requireAuth` + `permission`.
- Preload exposes ONLY channels in the frozen `ALL_INVOKABLE_CHANNELS`; no `ipcRenderer`/Node leak.
- The command layer derives tenant from the PRINCIPAL, never the envelope (already enforced in `commandBus`/`applicationService`); the IPC handler must pass a server-resolved principal, never a renderer-claimed identity.
- One authorization engine (`ctx.authorize`), one durable transaction/event/outbox (the Session-18 journal), one audit sink — no second engine.
- Existing channels, their contracts, and their authz are byte-unchanged (this is purely additive).

## D · PROPOSED CHANGE (verbatim shape — NOT YET APPLIED)

`channels.ts` (additive):
```ts
// in the IpcChannel map, beside CapabilityProposeM365Action:
PlatformCommandDispatch: 'platform:command.dispatch',
// in the runtime-invokable classification list:
IpcChannel.PlatformCommandDispatch,
// in ALL_INVOKABLE_CHANNELS:
IpcChannel.PlatformCommandDispatch,
```

`contracts.ts` (additive):
```ts
export const PlatformCommandDispatchRequest = z.object({
  operation: z.string(),                 // untrusted — validated by the command bus (deny-by-default)
  target: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(1),
  correlationId: z.string().optional(),
  claimedTenantId: z.string().optional(),// validated vs the resolved principal; never authoritative
});
export type PlatformCommandDispatchRequest = z.infer<typeof PlatformCommandDispatchRequest>;
export type PlatformCommandDispatchResponse = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string }; requestId: string; correlationId: string; operation: string; replayed?: boolean };
```

`runtimeCore.ts` (additive — two lines, FG-2 pattern):
```ts
import { buildPlatformCommandHandlers } from './platform/adapter/platformCommandIpc';
// …after the enterprise registry + a DurableCommandJournal singleton are in scope:
defs.push(...buildPlatformCommandHandlers({ registry: enterpriseRegistry, journal: platformJournal, audit: auditSink, resolvePrincipal }));
```

`platformCommandIpc.ts` (NEW, non-frozen): a thin `SecureHandlerDef` that maps the request → a `ClientRequest` → the existing `TestClientAdapter`/`AIAdapter`-equivalent production adapter → `handleApplicationRequest`. Reuses the S21 adapter design verbatim; the only new code is the production `Authenticator` (reads the authenticated session/active tenant) and the `ApplicationDeps` composition.

## E · COMPATIBILITY STRATEGY

Purely additive. No existing channel, contract, handler, or authz entry changes. The new channel is deny-by-default until classified, and self-classifies with a real permission. The direct `enterprise:module.*` path is untouched, so the 106 modules and every existing workflow behave identically. The command bus already exists and is test-verified; this only gives it a live entry point.

## F · REGRESSION STRATEGY

- Full main suite (sharded) + UI suite green before and after (S21 baseline: 9856 main / 405 UI).
- `assertAllChannelsClassified` / `routerClassification` / `ipcContract` tests must stay green (they lock the channel surface).
- A new integration test drives the REAL secure bridge: `registerSecureHandlers([...platformCommand handlers])` → `runSecureHandler('platform:command.dispatch', …)` → asserts the full chain (authorization → command bus → durable journal record + event + outbox + audit) and the deny-by-default negatives (unauthenticated, unauthorized, cross-tenant, unknown op).
- Change-control choreography (§2.2): clean checkpoint → freeze-baseline re-record → `verify-freeze.sh` INTACT #1 → apply the authorized diff + accompaniment → suites green → one isolated commit → re-record → INTACT #2 → evidence doc.

## G · ROLLBACK STRATEGY

Revert exactly the additive hunks in `channels.ts`, `contracts.ts`, `runtimeCore.ts` and delete `platformCommandIpc.ts` + the renderer call site. Because the change is additive and the direct module path is untouched, rollback restores the prior byte-state with no data migration. The command bus reverts to test-only (its current state).

---

## TOKEN REQUIRED

Nothing is applied until the operator, having read this doc, replies with the literal token:

```
AUTHORIZED: FG-ERP-LIVE-IPC — platform:command.dispatch channel + contract + runtimeCore push, per gate doc
```

Silence is not consent; enthusiasm is not consent; only the token is consent (§2.1). A diff that changes after the token requires a new token.
