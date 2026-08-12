# PROGRAM 13C — D-5 EXECUTION REPORT
## TENANT AI PREFERENCE · FIRST-RUN HIGH CLOSURE

**12 August 2026** · branch `feat/understanding-holds-motion-system` · macOS arm64, Node v20.20.2
Static verification in a Linux container. **Every runtime result below was produced on the Mac.**

---

## 1 · ROOT CAUSE

`firstRun/FirstRunExperience.tsx` → `chooseProcessing()`:

```ts
await ipc.aiConfig.setMode('private_first');        // cloud:operate → DENIED
await ipc.aiConfig.setExternalConsent(allowExternal); // never reached
await ipc.firstRun.set({ aiModeChosen: true });       // never reached
setStep('workspace');                                 // never reached
```

Both onboarding buttons called it. `platformOperatorRegistry` deliberately never
self-seeds — *"EMPTY MEANS NOBODY … no bootstrap-if-empty path"* — so a fresh
install has zero operators, the first line threw, the catch swallowed it, and
the user clicked into silence. **No install could be set up.**

Two independently correct decisions composing into an unusable product. The
code's own comment — *"The ACTUAL routing configuration — not a stored marketing
preference"* — had the right instinct and the wrong authority tier.

## 2 · DECISION D-5 (OPTION A)

`ai:config.setMode` stays `cloud:operate`. The organization gets a preference
that can only **restrict**:

```
effective = min(platformMode, tenantMode)
local_only  <  private_first  <  external
```

## 3 · ARCHITECTURE

| | |
|---|---|
| Store | `tenant-ai-preference` — `Record<orgId, {mode, updatedAt}>`, TENANT / CUSTOMER_DERIVED / retention OWNER / authority ORG_ROLE |
| Ownership | `TenantOwnership`; `mine()` via `onlyMine`, writes via `requireTenant()` |
| Binding | inside `enterprise/index.ts`, below every `init*()` and above the Round-17 gates |
| **Not** `experience-profile` | its own declaration reads `scope: 'USER'`, `authority: 'USER'`, and *"on the PUBLIC channel list — no auth, no permission"*. The convenient home was an authorization bypass. |

**`AiMode` was reused, not reinvented.** `aiRouting.ts` already defined the three
modes with the exact semantics D-5 needed — `private_first` is documented as
*"use an external provider only when external consent is on"*, which **is** the
intersection rule. No second policy algebra was created.

`TenantAiMode` is deliberately **two** values. `'external'` is not offered, so
elevation is not something the resolver refuses — it is something the type
cannot express. Same idiom as the branded `TenantReadGrant`.

## 4 · THE LAW, PROVEN EXHAUSTIVELY

> for every platform policy P and tenant preference T: `rank(effective(P,T)) ≤ rank(P)`

All **nine** `AiMode × AiMode` combinations are asserted, including the value the
store cannot persist. A proof covering inputs the product cannot produce.

| Control | Result |
|---|---|
| **NC-D5-ELEVATE** — resolver returns the tenant value | **3 fail**, incl. *"a tenant preference widened platform policy"* |

Two further guards: a hand-edited `external` row is dropped at load, and a
tampered archive claiming `external` merges **0 rows**.

## 5 · A DEFECT MY OWN FIX INTRODUCED, CAUGHT BY THE FRESH-INSTALL RUN

`restrictedByPlatform` originally compared **modes only**. But `externalConsent`
is a *separate* platform flag defaulting to `false`, and under `private_first`
external is a fallback requiring it. So on a default install, choosing
"approved cloud AI" gave `restricted: false` — no notice — while external
routing stayed impossible.

**The silent no-op the view was written to prevent, reproduced inside it.** No
test then existing could see it; the running application could.

Corrected: restriction now means an **unfulfilled intent** — the tenant asked for
external and cannot have it, whether because the mode is stricter, consent is
off, or both. A tenant that chose `local_only` is never flagged; crying wolf on
the common correct case trains the notice to be ignored.

I also mis-predicted one corner in my own test (platform `external` + consent
off → I expected "not restricted"; the code said restricted and was right). Both
errors are recorded in the test file.

## 6 · AUTHORITY

| | |
|---|---|
| `ai:preference.get` | `org:read` |
| `ai:preference.set` | `org:manage`, audited |
| Neither | PUBLIC, nor `cloud:operate` |
| Neither | accepts a target id — ambient scope is the only selector |

`org:manage` rather than a new permission: `EnterprisePermissionSchema` is a
closed 45-value enum and `orgStore.load()` rewrites built-in role permissions
from seed on every load (record D-3). Adding a value is a role-seed migration on
a store that rewrites itself at boot. Trade-off recorded: the preference is not
separately grantable from org management.

**Two invariants rejected my first placement, and both were right.** The
permissions went into `ENTERPRISE_CHANNEL_PERMISSIONS`; the enterprise gate
refuses channels outside its namespace, and `runtimeAuthz.test` reported
`ai:preference.*` unaccounted because `ai:` is not a self-gated prefix. Moved to
`aiAuthzGate`, dual-listed in `RUNTIME_CHANNEL_PERMISSIONS` — `withAiAuthz`
cross-checks the two and throws on disagreement.

## 7 · CHANNEL → STORE

The registry shipped in Round 13 with **zero** production declarations — the
"coverage partial" line in five reports. These are the **first two**.

## 8 · F22

`TENANT_DERIVED_DOMAINS` **18 → 19**. Adapter written (`ownerOf` / `snapshot` /
`merge`). The Round-14 denominator guard updated to 19 *with its reasoning*: it
permits growth and still fails on a quiet deletion. The store file is registered
in `storePaths.ts`, so it is inside backup and pre-migration rollback.

## 9 · RUNTIME EVIDENCE — MAC, FRESH INSTALL, ZERO OPERATORS

Clean state: userData moved aside, `operators: 0`, `Experience profile { state: 'pending' }`,
`dataVersion: 0 → 2`, **`Secure IPC handlers registered { count: 720 }`** (718 + 2).

### Run A — "Keep it on this device"

Try Free Locally → *Where should your AI work?* → **Keep it on this device** →
Start Personal → **into the application.** No `cloud:operate` refusal, no dead end.

```
tenantMode: 'local_only'   platformMode: 'private_first'
platformExternalConsent: false   effectiveMode: 'local_only'   restrictedByPlatform: false
```

**The intersection narrowed in production.** And the Ask surface corroborated it
at the point of use, with no local model present:

> *No AI route is available — deterministic answers still work, and nothing is sent anywhere.*

That is `local_only`'s documented contract observed in the running product —
evidence the preference reaches the router, not merely the disk.

### Run B — "Allow approved cloud AI"

```
tenantMode: 'private_first'   platformMode: 'private_first'
platformExternalConsent: false   effectiveMode: 'private_first'   restrictedByPlatform: true
```

Modes agree and the tenant is **still** restricted, because consent is off. This
is the case my first implementation got wrong.

**Stated precisely:** the write completing proves `chooseProcessing(true)` ran to
its end, so the step advance is **inferred**, and the amber notice rendering is
**not yet visually confirmed**.

## 10 · AUTOMATED VERIFICATION

| Gate | Result |
|---|---|
| Desktop main suite | **677 files / 7048 tests** (was 675 / 7021) |
| Failures | 1 — `knowledgeBench.test.ts`, wall-clock budget, untouched file, **3/3 pass in isolation** |
| Typecheck node / web | 0 / 0 |
| `packages/shared` typecheck | clean |
| Lint | clean |
| Negative controls | **26** |
| 46 workspaces, backend build | **NOT RUN** |

---

## 11 · GATE STATUS

| Gate | Verdict |
|---|---|
| **HIGH — fresh install cannot complete onboarding** | **CLOSED (local path); cloud path PASS on data, notice unconfirmed** |
| D-5 intersection law | **PASS** — 9/9 exhaustive + NC-D5-ELEVATE |
| Tenant RBAC / cross-tenant | **PASS** (unit); runtime cross-tenant NOT RUN |
| F22 19-domain honesty | **PASS** |
| Channel→store | first 2 declared; coverage still **PARTIAL** |
| 1 Native Mac launch | PARTIAL — dev build; packaged `.app` not rebuilt |
| 2 Real A/B/C | **PASS** |
| 3 Cross-tenant matrix | PARTIAL — reads only |
| 4 Runtime ownership | NOT TESTED |
| 5 Retention | NOT TESTED |
| 6 Background principal | NOT TESTED |
| 7 Queue identity | NOT TESTED |
| 8 Restart #1 | **PASS** |
| 9 Restart #2 (SIGKILL) | **PASS** |
| 10 Real backup/restore | NOT TESTED |
| Fresh red team | NOT TESTED |

# PROGRAM 13C — NOT CERTIFIED

Five gates untested. The verdict does not turn on judgement.

**What changed today:** the application went from unable to complete
`initRuntimeCore` for fourteen rounds, to booting, to completing a fresh install
end to end. Three runtime gates earned, one HIGH closed, six defects found — the
composition-order outage, an unbound tenant memo, a contract drift blocking every
install, an authority composition making first-run impossible, and two in my own
remediation. **Every one of them was found by launching the application.**

## 12 · REMAINING

1. Confirm the amber notice renders (one look)
2. Gates 4, 5, 6, 7, 10 — per-subsystem setup, a second sitting
3. Rebuild the packaged `.app` → converts gate 1 to PASS
4. 46 workspaces + backend build on the Mac
5. Channel→store coverage beyond the first two
6. F22 5/19 → the thirteen remaining, four still needing decisions
7. Release provenance: build-info bakes HEAD with no dirty check
8. Fresh running-app red team

**Do not write another static round.**
