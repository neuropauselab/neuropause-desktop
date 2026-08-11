# Program 13C — Remediation Round 7

**Starting commit:** `02e279f` (NOT `2074287` — that was the code commit; `02e279f`
is the Round 6 report correction on top of it. Verified, not assumed.)
**Branch:** `feat/understanding-holds-motion-system`
**Working tree at start:** CLEAN

---

## Verdict

**This round did not close out. It opened up.**

The four named items were closed. Then the final red team — run without the prior
finding list — found **four new HIGH and eleven more**, in subsystems six previous
rounds had swept past. Nine are fixed. **Seven remain open.**

**HIGH = 0 at the end of this session. Program 13C is NOT certified, and this
session does not certify it.**

| Round 7 objective | Status |
|---|---|
| 1. `setPolicyEnabled` authorization model | **DONE** — `cloud:operate`, an install-level capability no organization role can hold |
| 2. `offlineConnectors` bounded retention | **DONE** — migrated onto `TenantDedupe`; TTL + per-tenant cap |
| 3. System-global behavioural proof | **DONE** — proved against the persisted bytes; two declarations were truncated mid-sentence and one made a claim that was false |
| 4. Native Mac verification preparation | **DONE** — `NATIVE-MAC-VERIFICATION.md`, 39 surfaces, nothing marked verified |
| 5. Final fresh red team | **DONE** — and it is the reason this report is not a closure report |

| Gate | Result |
|---|---|
| Desktop main tests | **639 files / 6444 tests, exit 0** (from 635 / 6389) |
| Renderer + shared tests | **87 files / 963 tests, exit 0** |
| Package workspaces (46) | **all pass** |
| Typecheck | **green** — 0 `error TS` |
| Lint | **green** — `--max-warnings 0` |
| Desktop build | **green** |
| Backend bundle (`tsup`) | **NOT VERIFIED HERE** — esbuild host/binary skew in the Linux container. Verified green on the Mac last round; re-run there. |
| **macOS runtime** | **NOT PERFORMED** |

---

## 1 — The platform operator

`setPolicyEnabled` was behind `cloud:manage`. Round 6 stated the cost and it
understated it: the exposure was not "an admin can do an admin thing", it was that
**anyone can create an organization and become its Owner**, and Owner was defined
as `[...ALL_ENTERPRISE_PERMISSIONS]`. A control over every tenant on the machine
was two clicks from any signed-in user.

A stricter role could not fix this. **Every role in this product is per
organization** — whatever you grant tenant A's Admin, tenant B's Admin holds the
identical thing in their own org. So the fix is a permission no role can hold:

- `cloud:operate`, listed in `PLATFORM_ONLY_PERMISSIONS`
- `BUILT_IN_ROLE_SPECS` now filters the Owner wildcard through that list. **This
  was a live trap**: any capability added to `ALL_ENTERPRISE_PERMISSIONS` was
  granted to every organization's Owner on the next reconcile, silently
- the authorizer handles platform-only permissions **before** `resolveActor` and
  never consults org roles
- operators are listed **out of band** (`platform-operators.json`). There is
  deliberately no IPC to grant it: an in-app grant path is reachable by whoever is
  signed in, which is the person this authority exists to sit above
- the store demands a `PlatformAuthority` — an unforgeable value — so the
  operation cannot run even if the IPC gate is later moved or forgotten. A
  background job has no session and cannot obtain one
- every change records actor, authority, operation, policy, before, after,
  timestamp, into the tamper-evident governance trail

**Three tests had to change, and all three were asserting the escalation as
correct.** `authzGate.test.ts` and `multiOrgTenancy.test.ts` iterated
`ALL_ENTERPRISE_PERMISSIONS` and asserted the Owner held every one. They now
assert both halves: the Owner is genuinely a wildcard *within* their organization,
and that wildcard stops at the install boundary.

---

## 2 — Bounded retention

`offlineConnectors` was correctly keyed and unbounded. It now uses `TenantDedupe`
— the primitive Round 6 defined — with a 12-hour TTL and a per-tenant cap of 500.
That is the point of having defined a class: the thirteenth site gets the eviction
rule by using the type.

Eviction here causes **re-announcement**, never silence. `TenantDedupe` gained
`forget(scope, id)` for edges whose condition can clear, returning whether
anything was there — publishing a recovery notice to a tenant that never saw the
failure is its own small leak.

---

## 3 — The system-global stores, proved

Not by reading the types — a type is also something somebody wrote, and a field
can carry tenant data without being named for it. Each store is driven as tenant A
then tenant B with unmistakable markers, and **the persisted bytes are searched**.

Three things came out of it:

- **Two declarations were truncated mid-sentence.** `drStore`'s reason ended at
  "describe the". A reason that is an incomplete sentence is not a reason.
- **`observabilityStore`'s declaration made a false claim** — it said a production
  install "fills them from real runtime activity". Nothing fills them:
  `usage.push` and `security.push` exist only inside `applySeed`, behind
  `demoSeedsEnabled()`. The true reason is *stronger* than the one written, and it
  was not the one written.
- **`drStore`'s `objectCount` and `sizeBytes` are fabricated**, not measured —
  `createBackup` reads nothing. That is the entire basis of its classification: if
  they were real aggregates, an install-wide object count is a volume side channel
  a tenant can subtract their own from. Asserted directly, and the condition that
  would end the declaration is written into it.

Each declaration now answers all six questions, including **the condition under
which it stops being true**.

---

## 4 — The final red team: four new HIGH

Run without the prior finding list. Every one of these is a **sibling of something
already fixed in the same file or directory**.

### F1 — `infra:discover` took a renderer `accountId` and never checked it — **FIXED**

One call, with tenant A's `connectors:manage` and tenant B's account id:

- ran **live signed provider API calls** against B's AWS/Azure/GCP account
- wrote the returned inventory into **A's** partition
- **re-owned** B's existing rows (`upsertMany` took `prev` with no ownership check)
- **deleted** B's rows (raw `Map.delete`, narrowed only by renderer-supplied fields)
- overwrote B's discovery cursors and status

`InfraAction` was given `ownsAccount` **earlier in this same round**. `InfraDiscover`
— the more powerful channel — was not. The fix was applied to the instance, not the
class, inside the round that named that failure mode.

### F2 — `infra:platforms` enumerated every tenant's cloud accounts — **FIXED**

Account ids, regions, health, discovery schedule, failure counts, on `connectors:read`.
`resourceCount` read `0` for a foreign account because *that* was scoped — so the
row looked inert while being another tenant's. **An empty field made a populated
row look harmless.** Also `InfraStats`, and `probe()` through the **public**
`diagnostics:get`.

`AccountDiscoveryState` had no tenant field; the key `platformId:accountId` looked
specific and was never checked. **A key is not an authorization check** — the
second subsystem in one round where that sentence applied.

### F3 — the memory audit trail was public and unscoped — **FIXED**

`exec:memory.audit` sat in `PUBLIC_CHANNELS`: no auth, no permission. The log had
no tenant field, no `bindScope`, no registration. `MemoryAuditEvent.detail` is a
plain-language summary **written by the assistant** and carries record titles
verbatim. The memory *store* beside it was scoped; the conversation store was
pulled off the public list rounds ago. The audit log of the same subsystem was
never touched.

### F7a — the AI destination was install-wide, gated on a tenant role — **FIXED**

One `ai-config.json`. `AiConfigSetProvider` / `SetModel` / `SetCredential` /
`SetMode` / `SetExternalConsent` were `org:manage`. **An administrator of tenant A
could point `ollamaUrl` at a host they control and flip `externalConsent`, and
tenant B's retrieved records would leave the device to that host on the next
assistant call.**

The comment above that table already described this exposure precisely. The fix it
describes moved the channels off the public list onto a *tenant* permission —
a real improvement, on the wrong axis. They are now `cloud:operate`. So are
`AiConfigResetToEnv` and `AiConfigClearCredential`, which were **public** while
their `set` twins required a permission, and which delete the install's AI
credential for every tenant.

---

## 5 — Also fixed this round

| Finding | Was |
|---|---|
| **H-2 sandbox profiles** | `<profiles>/persistent/<profileKey ?? 'default'>` — no tenant segment. Two tenants running any persistent scenario shared **one Chromium user-data directory**: cookies, localStorage, logged-in sessions. Not disclosure — **credential inheritance**. A directory name is neither a store nor an IPC handler, which is why six sweeps walked past it. Now tenant-segmented, traversal-sanitized, and an unresolved tenant gets a disposable profile rather than a shared one. |
| **relationshipStore, half migrated** | `PendingRelationship` had an owner; `RelationshipLink` did not. A half-migration reads as done because the class holds a `TenantOwnership`. `counts`/`outgoing`/`incoming`/`linkFor` filtered nothing, and `splice(0, …)` was an **install-wide cap deleting another tenant's links**. |
| **Six broadcasts under the wrong principal** | A background pass runs as A while the window shows B. The store is *correct* — which is why this survived seven rounds of auditing stores — and the reader is standing on the wrong side of it. `runOutsidePrincipal` existed for exactly this and had **one** caller. Now seven. |
| **The desktop toast** | `deliveryEngine.tick()` fans out over every organization and called every channel for each. The inbox half was fixed; the OS notification was not. Tenant B's "Organization health is at-risk (42/100)" appeared on whoever's screen was in front. |
| **Assistant conversation cap** | Install-wide `slice(0, 100)` — a conversation in A deleted B's least-recently-updated ones, on disk. |
| **`memoryAuditLog` cap** | Install-wide `slice`. A's memory activity destroyed B's audit evidence. |
| **`traceStore.evictOldest`** | Global `splice` over **regulated traceability evidence for a recall**. Every read in that file filtered on tenant; the retention policy did not. |
| **Three unscoped summaries** | `tenancyStore.summary` (projects/teams/workers), `apiPlatformStore.summary` (webhooks), `federationStore.summary` (`?? ''` as a real key). |

**Retention caps found so far in this program: six.** Three in this round alone.
The rule is now stated wherever it is fixed: **a retention cap is a write, and it
deletes what a read filter merely hides.**

---

## 6 — STILL OPEN

**These are the reason this session does not certify.**

| # | Finding | Sev |
|---|---|---|
| 1 | `automation:history` / `automation:monitor` unscoped — `AutomationRunRecord` has no tenant field; `AutomationList` beside it is scoped | MEDIUM |
| 2 | Plugin install/enable/disable (`marketplace:manage`) and capability grants (`org:manage`) — install-wide registries and fs/network grants, gated on tenant roles. Same shape as F7a; the same `cloud:operate` fix applies | MEDIUM |
| 3 | `marketplace/orgPolicyStore` — one install-wide `requireApproval` / `blockedPublishers` policy | MEDIUM |
| 4 | Infra `changed` broadcasts leak foreign resource and account ids into the renderer | LOW-MED |
| 5 | `ai/routingUsageStore` — install-wide AI run counters on a **public** channel | LOW |
| 6 | `flags:get` takes `planTier` from the renderer payload | LOW |
| 7 | `orgIntelligence` reads `connectorStore.all()` under a tenant principal with `workspaceId: ''`, so connector counts are **always 0** in every scheduled brief — a dead feature whose isolation assertions pass vacuously | LOW |

**And the structural finding underneath all of them:** the registry gate cannot
see a store that never registers. `traceStore`, `discoveryState`, `memoryAuditLog`,
`automationRunHistory`, `orgPolicyStore`, `aiConfigStore` and `routingUsageStore`
call neither `registerTenantStore` nor `declareSystemGlobalStore`. **The migration
inventory's claim of coverage is an enumeration of stores that opted in.** Round 6
widened the scan from `bindScope` to `bindWorkspace`; that helped and it is still
detection by naming convention. A subsystem with no seam at all is invisible to
both.

---

## 7 — What this round establishes about method

**1. The fixes were applied to the instances that were found, not to the class.**
Every single finding in the final red team is a sibling of something correctly
fixed nearby: `InfraDiscover` next to a guarded `InfraAction`; the memory audit log
next to a scoped memory store; a retention cap next to a scoped delete; two
broadcasts next to six that call `runOutsidePrincipal`. Round 6's lesson was "a
list of instances is not a definition of a class". Round 7 demonstrates that
knowing that is not the same as doing it — **F1 was created and missed inside the
round that fixed its sibling.**

**2. A subsystem with no seam is invisible to a gate that checks seams.**
`infrastructure/` had 54 files and zero tenant references. Six sweeps found
nothing because every sweep looked for a boundary that was *wrong*.

**3. An empty field can make a populated row look harmless.** `resourceCount: 0`
is the inverse of "empty is not isolation", and it is subtler.

**4. Authority and resource must share an axis.** Three findings (F7a, plugins,
rate policies) are install-level resources gated by organization-level roles. The
capability built in this round is the general answer; it has been applied to two
of the three.

---

## Before certification

1. **Close the seven open findings.** Two of them (plugins, AI routing usage) are
   the same shape as one already fixed and should take one pass.
2. **Make the registry gate structural rather than lexical.** A subsystem that
   holds persistent state and never declares a scope should fail the build.
3. **Run `NATIVE-MAC-VERIFICATION.md` on the Mac** and record what was actually
   observed. Every defect in this round was reachable through a store or an IPC
   handler; none would have been visible from a build.
4. Re-run the final red team **after** those, without the finding list.

Program 13C remains the tenant operating security gate. **It is not green, and
this session does not certify it.**
