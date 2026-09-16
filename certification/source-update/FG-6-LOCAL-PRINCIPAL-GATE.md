# FG-6 — GATE DOC · the honest `local` AuthStatus + device-local principal (S17 local-first)

**Status: PRESENTED — awaiting the literal token. No frozen byte changes until the token arrives.**

## The token this gate waits for (verbatim)
```
AUTHORIZED: FG-6 — local AuthStatus + device-local principal, per gate doc
```
Silence is not consent; enthusiasm is not consent; only the token is consent. If the diff below changes after the token, a new token is required.

---

## 1 · Why (S17) and what the union gains

S17 kills the sign-in wall on an honest, unseeded build: no account → the full product on the local store, cloud features absent gracefully, one affordance ("Working locally — connect an account to sync"). The whole slice reduces to one fact both walls key off — `authService.getStatus().state === 'authenticated'` with a `session.user.email`:
- renderer gate `App.tsx:40` (else → `LoginScreen`), and
- org refusal `tenancy/tenantContext.ts:375` via `sessionEmail()` empty → `refuse('not_signed_in')`.

Option A (your decision) represents a device-local principal **honestly** — a distinct `local` state, **never** labelled `authenticated` (a green "authenticated" pixel with no authentication beneath is exactly the defect the Definition of ALIVE forbids). This gate adds that state and turns the audited consumers into deliberate, deny-by-default branches.

## 2 · The frozen additive contract (packages/shared/src/types/auth.ts)

`LocalPrincipal` is **minimal and honest** (FG-6 condition 2): a stable device-local id, a display name, a createdAt — **no** tokens, **no** `Session`, **no** org claims, **no** email field (the email-shaped tenant identity is *derived*, never stored as if it were a real account).

```
 export interface Session {
   user: User;
   accessTokenExpiresAt: number;
 }

+/**
+ * A device-local principal — the identity of someone using NeuroPause with NO
+ * cloud account (S17 local-first). It is NOT authentication: it carries no
+ * token, no Session, no org claim. Its id is stable across restarts (persisted
+ * in the local profile) so a local principal's governed admissions correlate
+ * over time (FG-6 condition 2 / pin 3). The tenant/membership identity and the
+ * governed-actor identity are DERIVED from `id` (see governedActor.ts /
+ * localIdentity.ts) into two explicitly-synthetic, non-routable namespaces —
+ * never a value that could collide with or imply a real account.
+ */
+export interface LocalPrincipal {
+  /** Stable device-local id (a per-profile UUID; NOT a cloud account id). */
+  id: string;
+  displayName: string;
+  /** ISO-8601. */
+  createdAt: string;
+}
+
 export type AuthStatus =
   | { state: 'unauthenticated' }
   | { state: 'authenticating'; provider: AuthProviderId }
   | { state: 'authenticated'; session: Session }
+  /**
+   * S17 local-first (FG-6). A device-local principal, distinct from and never
+   * conflated with `authenticated`. Cloud clients still fail closed (a local
+   * principal holds no access token); enterprise RBAC + tenancy resolve locally.
+   */
+  | { state: 'local'; principal: LocalPrincipal }
   | { state: 'error'; message: string; cause?: AuthErrorCause };
```

This member is purely additive. Because there is **no exhaustive `switch`/`assertNever` over `AuthStatus` anywhere** (audit §C — TYPECHECK-FORCING = 0), adding it compiles green with zero forced edits — which is the hazard, not the comfort: every consumer below is touched **by hand**, from the audit, not by the compiler.

## 3 · The two synthetic namespaces (both derived from `LocalPrincipal.id`)

| namespace | value for a local principal | where used | why |
|---|---|---|---|
| **actor** (reserved `local:`) | `local:<id>` | CST admission actor (`runtimeCore.ts:482`, `:771`) | self-disclosing; an admission carrying it can never read as cloud-authenticated (condition 3). **Reserved** — an `authenticated` id matching `^local:` is a forgery → DENY (pin 1). **Never stripped** — the prefixed string IS the identity (pin 2). |
| **tenant/membership email** (`.invalid`) | `local-<id>@device.invalid` | `sessionEmail()` ×3 + `bindOwner` claim | RFC-6761 non-routable; consistent at every site so first-claim-wins binds the owner the membership check then matches. |

Both derive from the same stable `id` → same-principal correlation (pin 3). They are distinct fields with distinct consumers; neither is ever parsed back to a "real" identity.

## 4 · Consumer-audit table (FG-6 condition 1 — every narrowing consumer sorted; deny-by-default)

**Counts:** 28 branching consumers (27 ACCEPTS-LOCAL, 1 already-correct deny) + 10 token-gated clients (auto-deny) + 2 CST actor sites + 3 test fixtures. TYPECHECK-FORCING over `AuthStatus` = **0**.

### (A) TOUCHED IN THIS GATE — must accept local to be usable + honest

| site | change | condition |
|---|---|---|
| `packages/shared/.../auth.ts:20` | + `LocalPrincipal` + `local` member | core contract |
| `apps/desktop/.../auth/authService.ts` (restoreSession `!stored`; new `enterLocalMode`) | no account → enter local mode (was → `unauthenticated`/wall) | S17 core |
| `runtimeCore.ts:482` (mail.send CST actor) | → `resolveGovernedActor(status, u=>u.displayName??u.email)` | 3 / pins 1,4 |
| `runtimeCore.ts:771` (workforce/approval CST actor → `boundDecisionClaimMint`) | → `resolveGovernedActor(status, u=>u.id)` | 3 / pins 1,4 |
| `runtimeCore.ts:3284` (`secureBridge.isAuthenticated`, gates ALL permissioned enterprise IPC) | accept `authenticated`\|`local` | usability |
| `enterprise/index.ts:386` (`tenantContext.sessionEmail`) | → `sessionEmailFor(status)` | usability (`not_signed_in`) |
| `enterprise/index.ts:691` (RBAC `sessionEmail`) | → `sessionEmailFor(status)` | usability (RBAC member) |
| `enterprise/index.ts:615` (`bindOwner`) | claim owner for `local` via the same synthetic email | usability (`not_a_member`) |
| `renderer/App.tsx:40` (+ AppShell local handling) | `local` → mount the shell | usability (the wall) |
| renderer affordance (lift `ConnectionIndicator`/banner + "Connect an account" CTA → `loginOAuth`) | show local-mode affordance | S17 exit |

### (B) AUTHENTICATED-ONLY — deny-by-default, **no edit needed** (already fail closed)

- **10 token-gated cloud clients** — `orgClient`, `catalogClient`, `billingClient`, `deviceClient`, `backendSemanticClient`, `backendBackfillClient`, `license/transport`, `cloud/livesync/transport` (+ `authService.getValidAccessToken` itself): a local principal holds no `accessToken` → `getValidAccessToken()` returns null → fail closed. *No `.state` branch; deny is implicit.* **Verification pin V-6** asserts each stays denied for `local`; a follow-up hardening item (V-note) proposes an explicit `state==='local'` short-circuit so deny is *asserted*, not merely emergent — **out of scope for FG-6** (no frozen edit), logged for S29 deny-by-default.
- **`cloud/livesync/liveSyncInstance.ts:109`** — opens the cloud sync identity only on `=== 'authenticated' && activeOrgId`; `local` stays in the `else` → `clear()`. Correct with no edit; pinned.

### (C) DEFERRED — safe fallback, documented, revisit at S34 universal action-trace

- **Subsystem audit/attribution actors** — dataPlane (`:788`/`:806`), documents (`:880`/`:887`), identity (`:1112`/`:1119`), raiseHold (`:1207`/`:1213`), governed-binding (`:1349`/`:1355`), ecosystem (`:185`), directory `sessionEmail` (`:1888`), companion (`:3229`/`:3230`), platform telemetry (`producers.ts:78`). For `local`, each falls to its **existing** fallback (`null` actor / `'owner'`/`'system'` audit / companion off / telemetry `authed=false`). These are **audit labels and optional surfaces, not authority** — none grants a local principal any capability, and none makes a local principal look *cloud-authenticated*. Structured actor-kind for these belongs to **S34** (universal action-trace) and, if pursued, **S38** offline policy. **Micro-authorization caveat:** if the BUILD finds any DEFERRED site *breaks usability* for `local` (e.g. a subsystem throws on a null actor when reached in local mode), I REVERT and return for a scope extension (a new/amended token) — I will not silently widen this diff.

## 5 · The verbatim frozen diff (Tier-1)

### 5.1 `apps/desktop/src/main/auth/authService.ts` — enter local mode
```
   async restoreSession(): Promise<void> {
     const stored = await secureStore.getRefreshToken();
     if (!stored) {
-      this.setStatus({ state: 'unauthenticated' });
+      // S17 local-first (FG-6): no stored account → the device-local principal,
+      // NOT the sign-in wall. Signing in later (the affordance) transitions
+      // local → authenticating → authenticated (DECISIONS D-11).
+      await this.enterLocalMode();
       return;
     }
```
```
+  /**
+   * Enter device-local mode (S17). Loads-or-creates the stable LocalPrincipal
+   * from the local profile (id persisted → stable across restarts, FG-6
+   * condition 2 / pin 3) and flips status to `local`. Holds no token; cloud
+   * clients keep failing closed. Idempotent.
+   */
+  async enterLocalMode(): Promise<AuthStatus> {
+    const principal = await localPrincipalStore.loadOrCreate();
+    return this.setStatus({ state: 'local', principal });
+  }
```
(+ `import { localPrincipalStore } from './localPrincipalStore';` — new non-frozen module.)

### 5.2 `apps/desktop/src/main/runtimeCore.ts:482` — mail.send CST actor
```
     actor: () => {
       const st = authService.getStatus();
-      return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : null;
+      return resolveGovernedActor(st, (u) => u.displayName ?? u.email);
     },
```
### 5.3 `apps/desktop/src/main/runtimeCore.ts:771` — workforce/approval CST actor (→ boundDecisionClaimMint)
```
     actor: () => {
       const st = authService.getStatus();
-      return st.state === 'authenticated' ? st.session.user.id : null;
+      return resolveGovernedActor(st, (u) => u.id);
     },
```
### 5.4 `apps/desktop/src/main/runtimeCore.ts:3284` — secureBridge RBAC dispatch gate
```
   const secureBridgeDeps = {
-    isAuthenticated: () => authService.getStatus().state === 'authenticated',
+    isAuthenticated: () => hasActivePrincipal(authService.getStatus()),
     authorize: enterprise.authorize,
   };
```
(+ `import { resolveGovernedActor, hasActivePrincipal } from './auth/governedActor';`)

### 5.5 `apps/desktop/src/main/enterprise/index.ts:386` & `:691` — sessionEmail ×2 (identical closures)
```
-  sessionEmail: () => {
-    const st = authService.getStatus();
-    return st.state === 'authenticated' ? st.session.user.email : null;
-  },
+  sessionEmail: () => sessionEmailFor(authService.getStatus()),
```
(RBAC `:691` `const sessionEmail = (): string | null => sessionEmailFor(authService.getStatus());`, + `import { sessionEmailFor } from '../auth/localIdentity';`)

### 5.6 `apps/desktop/src/main/enterprise/index.ts:615` — bindOwner accepts local
```
   const bindOwner = (status: AuthStatus): void => {
-    if (status.state !== 'authenticated') return;
-    const u = status.session.user;
-    const claimed = orgStore.claimOwnerIdentity({ name: u.displayName ?? u.email, email: u.email });
-    if (claimed) log.info('Seeded owner bound to the signed-in account');
+    const email = sessionEmailFor(status);          // authenticated OR local; else null
+    if (email === null) return;                     // authenticating/error/unauthenticated → no claim
+    const name = principalDisplayName(status) ?? email;
+    const claimed = orgStore.claimOwnerIdentity({ name, email });
+    if (claimed) log.info('Owner bound to the active principal', { local: status.state === 'local' });
   };
```

### 5.7 New non-frozen helpers (full source; NOT frozen — land in the checkpoint)
```ts
// apps/desktop/src/main/auth/governedActor.ts
import type { AuthStatus, User } from '@neuropause/shared';

/** Reserved actor namespace for a device-local principal (DECISIONS D-12).
 *  A local actor is ALWAYS `local:<id>`: self-disclosing, never stripped. */
export const LOCAL_ACTOR_PREFIX = 'local:';

/** True when SOME principal (cloud or device-local) is active — the RBAC
 *  dispatch gate. Deny-by-default for authenticating/error/unauthenticated. */
export function hasActivePrincipal(status: AuthStatus): boolean {
  return status.state === 'authenticated' || status.state === 'local';
}

/** The authoritative governed actor for a CST admission, honestly:
 *  authenticated → picked cloud id, DENIED if it forges `local:` (pin 1);
 *  local → `local:<id>` (self-disclosing, correlates, pin 3);
 *  else → null → the mint's NO_ACTOR refusal (pin 4, deny-by-default). */
export function resolveGovernedActor(status: AuthStatus, pick: (u: User) => string | null): string | null {
  if (status.state === 'authenticated') {
    const id = pick(status.session.user);
    if (id === null || id.trim() === '' || id.startsWith(LOCAL_ACTOR_PREFIX)) return null;
    return id;
  }
  if (status.state === 'local') return `${LOCAL_ACTOR_PREFIX}${status.principal.id}`;
  return null;
}
```
```ts
// apps/desktop/src/main/auth/localIdentity.ts
import type { AuthStatus } from '@neuropause/shared';

/** The tenant/membership identity: an explicitly-synthetic, non-routable
 *  (RFC-6761 `.invalid`) address derived from the stable local id — the SAME
 *  value at every sessionEmail site + bindOwner (FG-6 condition 2). */
export function sessionEmailFor(status: AuthStatus): string | null {
  if (status.state === 'authenticated') return status.session.user.email;
  if (status.state === 'local') return `local-${status.principal.id}@device.invalid`;
  return null;
}

export function principalDisplayName(status: AuthStatus): string | null {
  if (status.state === 'authenticated') return status.session.user.displayName ?? status.session.user.email;
  if (status.state === 'local') return status.principal.displayName;
  return null;
}
```
(+ non-frozen `auth/localPrincipalStore.ts` — persists/creates the stable `LocalPrincipal` in userData; + renderer `App.tsx` local branch + the affordance. Renderer/store are non-frozen; their exact text lands in the checkpoint commit and is shown at review, not token-gated.)

## 6 · Threat analysis — both directions

**What the gate could break (frozen → the rest):**
- *A local principal gaining cloud authority.* No — cloud clients are token-gated; `local` holds no token; `getValidAccessToken()` → null → fail closed (V-6). Adding `local` to `secureBridgeDeps.isAuthenticated` opens only *local* enterprise RBAC (evaluated against the local-owner member), never a backend call.
- *A local actor mis-recorded as cloud-authenticated in an admission.* No — `resolveGovernedActor` emits `local:<id>` for `local`; the admission's `actor` is self-evidently local (condition 3).
- *A forged/compromised session claiming the local namespace.* Denied — an `authenticated` id matching `^local:` → `resolveGovernedActor` returns null → `NO_ACTOR` refusal (pin 1; the S33 confused-deputy edge, pinned now).
- *Exhaustiveness fall-through.* Every one of the 28 consumers is sorted in §4; DEFERRED ones fall to a safe, documented fallback (audit label / optional surface / deny), never into the `authenticated` branch.
- *Owner-claim collision.* The synthetic `local-<id>@device.invalid` cannot equal any real account email; first-claim-wins binds it only when the seeded owner row is unclaimed (fresh profile). O-13 (owner email immutable) is unaffected — a later real sign-in does not rebind a different account.

**What the rest could do to the gate (the rest → frozen):**
- *The renderer forging `state:'local'`.* The renderer never *sets* status — it only renders `getStatus()`/`onStatusChanged` from main. `local` is minted only by `authService.enterLocalMode()` in main. A hostile renderer cannot manufacture a principal (S33-aligned).
- *`local:` leaking into a real identity.* No code strips the prefix (pin 2); it is compared/stored whole in dedup, policy, tenancy, evidence.

## 7 · Verification plan (pinned tests + read-only confirmations)

**Pinned tests (new/updated; all green before the frozen commit is recorded):**
- `governedActor.test.ts` — V-1 local → `local:<id>`; V-2 authenticated → picked id; **V-3 forgery**: authenticated id `local:evil` → null (pin 1); V-4 authenticating/error/unauthenticated → null (pin 4); V-5 stability: same principal id → same actor (pin 3); no-strip: the string is emitted verbatim (pin 2).
- `localIdentity.test.ts` — synthetic email shape, `.invalid`, identical across sessionEmail sites + bindOwner; never a real-account shape.
- `boundDecisionClaimMint` — a `local:<id>` actor mints an admission whose `actor` is exactly `local:<id>` (self-disclosed); a null (deny) actor → `NO_ACTOR`.
- `tenantContext` — a `local` principal resolves (no `not_signed_in`/`not_a_member`) on a fresh profile via first-claim-wins; a mismatched local email → `not_a_member` (deny-by-default).
- `secureBridge`/RBAC — `local` passes the dispatch gate for local enterprise channels; **V-6**: each of the 10 cloud clients stays denied for `local`.
- renderer — `App.tsx` mounts the shell for `local`; the affordance renders + its CTA starts `loginOAuth`.
- Playwright `local-mode.spec` — fresh profile, **networking disabled**, no seed (`__NP_E2E__` false) → fully usable; the "Working locally" affordance is present.

**Read-only confirmations for you to run now (verify my claims before the token):**
```bash
# 0 exhaustive switches over AuthStatus (the "no compiler backstop" claim):
grep -rn "assertNever\|: never" apps/desktop/src --include=*.ts | grep -i auth
# The two CST actor sites + the RBAC gate, verbatim:
sed -n '482,485p;771,774p;3284,3286p' apps/desktop/src/main/runtimeCore.ts
# The three sessionEmail closures + bindOwner:
sed -n '386,389p;615,620p;691,694p' apps/desktop/src/main/enterprise/index.ts
# Freeze still INTACT + tree clean before we start:
bash certification/verify-freeze.sh | tail -3 ; git status --porcelain | wc -l
```

## 8 · Landing choreography (after the token)

1. Clean checkpoint (tree is clean at `f9ec89d`).
2. **Checkpoint commit (non-frozen, green):** the new helpers (`governedActor.ts`, `localIdentity.ts`, `localPrincipalStore.ts`), their tests, the renderer local branch + affordance + tests, DECISIONS D-11/D-12 — a declared-but-not-yet-wired gap covered by this gate doc (the frozen call sites still read the old closures). Full suites green.
3. `certification/freeze-baseline.sh` re-record → `verify-freeze.sh` **INTACT #1** (committed).
4. Apply the §5 frozen diff (auth.ts + authService.ts + runtimeCore ×3 + enterprise ×3) — the authorized diff + minimum accompaniment (the imports). Full suites green (unit + contract + renderer + `local-mode.spec` + `verify-e2e-strip` PASS + typecheck + lint).
5. One isolated frozen commit → re-record → **INTACT #2** (committed).
6. Evidence doc (`…SLICE-17-LOCAL-FIRST-EVIDENCE.md`): the frozen/non-frozen split, both INTACT baselines, this token quoted verbatim, the consumer-audit table, DECLARED_BASELINE bump if a new channel/declaration is added (none expected — no new IPC channel; the affordance's "Connect account" reuses the existing `loginOAuth`).

## 9 · Conditions honored (your 5 FG-6 conditions + the 4 condition-3 pins)

| condition | where |
|---|---|
| 1 · exhaustiveness, deny-by-default, no default-authenticated fall-through | §4 table (A touched / B auto-deny / C deferred-safe), all 28 sorted |
| 2 · minimal honest LocalPrincipal; synthetic non-routable identifier | §2 (no tokens/session/org/email), §3 (`@device.invalid`) |
| 3 · CST admission discloses local; never cloud-authenticated | §5.2/§5.3 `resolveGovernedActor`; boundDecisionClaimMint unchanged (actor is already a string) |
| 4 · local→authenticated transition; no orphaned local data | DECISIONS **D-11** |
| 5 · standard FG choreography; evidence with the consumer-audit table | §8 + §4 |
| pin 1 · `local:` reserved; forged authenticated `local:` DENIES | §5.7 `resolveGovernedActor`; V-3 |
| pin 2 · no stripping; the prefixed string IS the identity | §5.7 (emitted verbatim); no strip anywhere |
| pin 3 · stable id → correlation | §2 (persisted id); V-5 |
| pin 4 · only authenticated & local yield an actor; else NO_ACTOR | §5.7; V-4 |
| namespace convention documented as canonical | DECISIONS **D-12** |
