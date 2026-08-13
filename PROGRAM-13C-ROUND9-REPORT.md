# PROGRAM 13C — ROUND 9 FINAL REPORT

## 1. REPOSITORY

**HEAD:** `c97ea0b` (start of round: `228de68`, verified with `git rev-parse HEAD` — the brief named `9beb4ee` as the Round 8 baseline; the actual head was `228de68`, with `9beb4ee` its parent)
**BRANCH:** `feat/understanding-holds-motion-system`
**WORKTREE:** clean

Round 9 commits: `21f64cb`, `05c65cc`, `1178922`, `fb165f5`, `c97ea0b`.

---

## VERDICT

**PROGRAM 13C IS NOT CERTIFIED.**

Three independent reasons, any one of which is disqualifying:

1. **The fresh red team found seven HIGH.** Two are closed in this round. **Five remain open.** Four of the seven were proven by an executed test, not by reading.
2. **Native Mac build and runtime were not performed.** This round ran in a Linux container. Recorded as **NOT TESTED**, not converted to PASS.
3. **Real multi-organization runtime and restart verification were not performed**, for the same reason.

The twenty-one Round 8 findings are closed. That was necessary and is not sufficient.

---

## 2. ROUND 8 FINDINGS

| | Finding | Status |
|---|---|---|
| **F1** | marketplaceStore mutation ownership (HIGH) | **CLOSED** — one resolver per relation; `this.listings.get()` appears in no mutation body |
| **F2** | workforce install/uninstall authority (HIGH) | **CLOSED** — six lifecycle channels moved to `cloud:operate` |
| **F3** | live-sync engine | **CLOSED** — every shared scalar is now per organization |
| **F4** | RegistrySetFlags public write | **CLOSED** — two-key whitelist, verified against nine security-sensitive fields |
| **F5** | platform event delivery (HIGH) | **CLOSED** — forwarder uses the timeline's predicate; viewer resolved outside the principal |
| **F6** | connector event/lifecycle broadcasts | **CLOSED** — both gated on the viewer's workspace |
| **F7** | connector logs/lifecycle (HIGH) | **CLOSED** — owner stamped at write from the authoritative account lookup |
| **F8** | marketplaceStore.stats() | **CLOSED** — same predicate as `list()`; `allVersions()` scoped as a sibling |
| **F9** | eventBus.metrics() | **CLOSED for `diagnostics:get`** — **and the fresh red team found two other public channels serving the identical payload. See NEW-M2.** |
| **F10** | graph relationship-history cap | **CLOSED** — rows now carry an owner; cap per tenant |
| **F11** | timeline in-memory eviction | **CLOSED** — per-owner windows; `query()` and `export()` agree |
| **F12** | connector log/lifecycle caps | **CLOSED** — both caps per owner |
| **F13** | gateway audit cap | **CLOSED** — one hash chain per tenant |
| **F14** | connectorVault.clear() | **CLOSED** — fails closed with no resolved workspace |
| **F15** | desktop-session singleton (HIGH) | **CLOSED** — owner-keyed registry; the FAKE channel had the same defect |
| **F16** | screenshot artifact path | **CLOSED** for the enterprise channel — **the S2 sibling was missed. See NEW-L2.** |
| **F17** | cloud/livesync/store.ts | **CLOSED** — declared TENANT, owner-stamped, capped per owner (it had no cap at all) |
| **F18** | persistent stores missed by detector | **CLOSED** — detector widened; exposed exactly 15; all resolved |
| **F19** | INSTALL_GLOBAL + ORG_ROLE | **CLOSED** — refused at construction, generically |
| **F20** | executive-memory public channels | **CLOSED** — plus two siblings the sweep found |
| **F21** | AiConfigMigrate public channel | **CLOSED** — `cloud:operate` |

**21 of 21 closed. Two closures are narrower than they look** (F9, F16) and the fresh red team found the uncovered half of each; both are carried forward below rather than counted as complete.

Classifying the F18 stores surfaced **two findings nobody had reported**, both fixed: `registry.json` held `launchCount` / `usage.*` accumulated install-wide and served on four PUBLIC channels — the `worker-registry` shape again; and `backup:restore` / `registry:import` / `recovery:run` / `support:generateBundle` sat on `org:manage` over files spanning every tenant.

---

## 3. STRUCTURAL SECURITY

- **Persistent stores inventoried:** 15 newly exposed this round, on top of Round 8's 21 declarations and ~42 pre-existing declaration sites
- **Declared:** 11 of the 15, each with scope / persistence / authority / classification / retention / reason
- **Undeclared:** 0 by the widened detector
- **Module-level state:** covered — this was `cloud/livesync/store.ts`, the file holding every organization's pending record mutations
- **Closure state:** covered — the binding pattern is scope-agnostic, so a `const` inside a factory matches as a top-level one does
- **Singleton state:** covered — reduces to a binding at the construction site
- **Filesystem state:** covered — the detector's trigger is the write itself
- **Unjustified global state:** 0 declared. `INSTALL_GLOBAL` + `ORG_ROLE` now throws at construction, generically, with no store name in the rule

**The detector's remaining blind spot is stated in the file rather than claimed away.** It is a regex over source. It cannot follow a collection reached only through an imported helper, or one built by a generic factory elsewhere. `assertAllStoreScopesBound()` is the second mechanism — **Round 8 built it, documented it as called from the composition root, and never called it outside its own test.** It is wired now. That is a finding about this program's own instrumentation, recorded rather than quietly fixed.

**The fresh red team then found the next layer of the same problem:** `registerTenantStore(name, hasScope)` satisfies the gate and **has no retention parameter at all**, so a store using it is never asked whose rows a removal can reach. Three of the four proven retention HIGHs below are in stores that passed the gate exactly this way.

---

## 4. AUTHORITY MODEL

- **Tenant authority:** `tenantContext.ts` — no parameter from a caller, no default-org fallback
- **Workspace authority:** membership checked against the workspace's own organization
- **Platform authority:** `cloud:operate`, in `PLATFORM_ONLY_PERMISSIONS`, filtered out of the Owner wildcard. Now also required by the workforce install lifecycle, `aiConfig:migrate`, backup restore/delete, recovery run and support bundle
- **Background authority:** explicit principals via `AsyncLocalStorage`; `runOutsidePrincipal` for renderer-facing values. **The fresh red team found the largest store family in the product bound to a resolver that ignores it — closed this round**
- **Channel/resource cross-check:** two per-family gates (memory, AI) in the `withWorkforceAuthz` shape, throwing at composition on an unclassified channel and cross-checking every row against `runtimeAuthz`

---

## 5. RETENTION

- **Stores audited:** every persistent collection in cloud, connectors, graph, timeline, gateway, marketplace, workforce, memory, registry and the 15 newly classified
- **Global deletion operations found and fixed this round:** 8 — connector logs, connector lifecycle ring, live-sync conflict log, graph history, timeline window, timeline warm-up, gateway audit, marketplace events. Program total: **18**
- **Tenant-scoped deletion:** newest-N-per-owner throughout, following `marketplaceStore.event()`
- **Cross-tenant deletion tests:** one tenant driven far past the cap (graph 85 vs 20, timeline 200 vs 20, gateway 500 vs 50, live-sync 200), then the others asserted at their exact counts by identity

**Four more install-wide caps were found by the fresh red team and are OPEN** — see NEW-H1, H2, H3.

---

## 6. IPC

- **Sensitive channels audited:** the full `RUNTIME_INVOKABLE_CHANNELS` set across memory, AI, registry, workforce, marketplace, backup, recovery, support, migration
- **Renderer authority violations found and fixed:** 7 marketplace mutation paths, `connectorVault.clear`, `registry:setFlags`
- **Resource ownership checks:** renderer identifier → principal → resource lookup → ownership → authorization → operation, enforced in marketplace, connectors, desktop sessions, live-sync
- **Channels moved off PUBLIC:** `diagnostics:get`, `memory:exec-forget`, `memory:exec-pin`, `memory:exec-resolve`, `memory:exec-search`, `memory:get`, `aiConfig:migrate`, `founder:ask-v2`

**OPEN:** the org-directory mutators take bare renderer ids with no ownership resolution — NEW-H6, the most severe finding of the round.

---

## 7. EVENTS

- **Event sources audited:** bus, subscribers, timeline, connector broadcasts, live-sync status fan-out, infra broadcasts, native notifier
- **Tenant-scoped:** stamped once at materialization from the resolver; a producer cannot supply `tenantId`
- **Global:** only a genuine `systemPrincipal` yields `scopeKind: 'system'`
- **Cross-tenant broadcast tests:** A=3 / B=7 / C=11 events; each viewer receives its own count exactly; principal-A-while-viewer-B delivers nothing

---

## 8. MARKETPLACE

- **Ownership:** two resolvers — PUBLISHER for lifecycle, CONSUMER for install/rate on anything published
- **Mutation paths:** `addVersion`, `submit`, `review`, `publish`, `rollback`, `install`, `rate` — all routed; raw Map access removed from every mutation body
- **A/B/C tests:** 3 / 7 / 11 real listings driven through create→version→submit→review→publish. Negative control: reverting `rollback` alone fails 4 tests including the exploit

---

## 9. WORKFORCE

- **Install authority:** `cloud:operate` on all six lifecycle channels; reads unchanged on `workforce:read`
- **Install/uninstall tests:** an Owner holding every organization permission (asserted > 30, so the test cannot pass on an empty array) is refused; a platform operator succeeds
- **OPEN:** `marketplace:install` reaches the same installer on `workforce:manage` — NEW-M4

---

## 10. CONNECTORS

- **Account scope:** workspace, unchanged
- **Log scope:** workspace, stamped at write from the store's own seam
- **Lifecycle scope:** owner from the authoritative account lookup, not the event
- **Retention:** both caps per owner
- **Tests:** A=3 / B=7 / C=11 log entries; four negative controls (8, 10, 3, 1 failures on revert)

---

## 11. DESKTOP SESSIONS

- **Session scope:** per tenant — the enterprise runner executes every scenario under a tenant-level principal with no workspace, so a workspace key would split one tenant's sessions while adding no boundary between tenants
- **Cross-tenant screenshot:** denied, with real sessions open for both so the allow case is demonstrably non-empty
- **Cross-tenant control:** click, type, navigate, close all denied; the victim's session asserted still open afterwards
- **The fake channel had the same defect** — the gates would have stayed green

---

## 12. TESTS

| Gate | Result |
|---|---|
| Desktop main | **650 files / 6662 tests, exit 0** (Round 8: 641 / 6469) |
| Renderer + shared | **87 files / 963 tests, exit 0** |
| Package workspaces | **43 of 43 pass** (3 have no test script) |
| Typecheck | **0 errors** across every release workspace, node and web |
| Lint | **clean**, `--max-warnings 0` |
| Desktop build | **green** |
| Backend build | **NOT VERIFIED THIS ROUND** — Round 8 recorded it green on the Mac; the Linux container's esbuild host skew was not worked around, and I did not re-run it natively |

**No assertion was weakened, no test disabled, no timeout relaxed.** Where an existing test asserted the old behaviour — the platform integration test, nine connector supervisor tests, four live-sync suites, the gate's own fixture, one Round 3 sweep case — it was corrected to wire the boundary as production does **and strengthened with a cross-tenant negative case**.

**Negative controls were run for every behavioural fix** and are the reason the suite is worth anything: reverting each filter individually fails 4 (marketplace), 6 (events), 8/10/3/1 (connectors), 13 of 19 (sessions), 18/4 (live-sync), 6/6 (channel authority), 4/4/6 (retention), 3/9/1 (classification), 2 (notifier).

---

## 13. NATIVE MAC

| | |
|---|---|
| **Build** | **NOT TESTED** |
| **Runtime** | **NOT TESTED** |
| **Verification checklist** | **NOT PERFORMED** |

This round executed in an isolated Linux container. An Electron macOS application cannot be built or launched from it. `NATIVE-MAC-VERIFICATION.md` is unchanged and still records the Round 8 build; **nothing in it was marked verified by this round.**

Stated plainly because the brief requires it: **NOT TESTED has not been converted to PASS.**

---

## 14. REAL MULTI-ORG

| | |
|---|---|
| **A / B / C** | **NOT PERFORMED at runtime.** A/B/C fixtures with real data (3 / 7 / 11) exist at the unit and integration level throughout — marketplace listings, connector logs, events, live-sync queues, graph history, timeline events, gateway audit rows, memories — but no organization was created in a running application |
| **Tenant switching** | **NOT TESTED** |
| **Background activity during switch** | **NOT TESTED at runtime.** Covered in-process by principal-vs-viewer tests |
| **Cross-tenant attacks** | performed against the code, not against a running instance |

---

## 15. RESTART

**NOT PERFORMED at runtime.** Store-level reload tests exist and pass — the marketplace refuses B on A's listing after reopening from disk, and live-sync counts and cursors survive a reload still separated. The application was never closed and restarted, so persistence, filesystem, cache, sessions, connector state, automation, AI and audit are **NOT TESTED** as a running system.

---

## 16. FRESH RED TEAM

Two independent exercises, run without the prior finding list, on disjoint surfaces.

| Severity | Count |
|---|---|
| **HIGH** | **7** (4 proven by executed test) |
| **MEDIUM** | **13** |
| **LOW** | **12** |

### NEW FINDINGS — HIGH

**NEW-H1 — `notifications/inboxStore.ts:114` — PROVEN — CLOSED? NO, OPEN.**
`this.items.length = MAX_INBOX` truncates one shared array, then persists. Tenant B held 3 notifications, tenant A delivered 200, **B's rows were gone from `inbox.json`**. Every read was hardened — `visible()`, `markRead()`, `page()`, even the de-dupe key. The cap was not.

**NEW-H2 — `webhooks/webhookStore.ts:403` — PROVEN — OPEN.**
`selectEvictions` sorts every tenant's deliveries together. B had 5 deliveries and 2 dead letters; A enqueued 5,100; B's history, **dead-letter queue** and stats all went to zero. The DLQ is the replay and forensics surface, so this destroys evidence.

**NEW-H3 — `sandbox/validation/runStore.ts:26,46` — PROVEN — OPEN.**
Two install-wide trims on the shared runs array, one of them inside `snapshot()`, so the truncation is written to disk on every save. B's certification run history deleted by A's volume.

**NEW-H4 — `memory/memoryRetriever.ts:86` — PROVEN — OPEN.**
The lexical index spans every tenant. `search()` takes the global top-N *before* any ownership predicate exists. B writes ~200 notes containing a term and **A can no longer recall A's own memories** for it. This is also a `query()`/`export()` divergence: `counts()` still sees the memory that `recall()` cannot find.

**NEW-H5 — `enterprise/index.ts:950` — PROVEN — CLOSED THIS ROUND.**
All 106 ERP/CRM/HR/finance module stores were bound to `tenantContext.scope()`, which is not principal-aware, while every other store in the same file binds `activeTenantScope`, which is. Reachable two ways, both cross-tenant **writes**: the companion gateway listens on the LAN and wraps every operation in `runAsPrincipal` for the *paired* tenant — a principal that never reached these stores; and the sandbox executor does the same for scenarios. Both carry comments asserting the property that did not hold.

**NEW-H6 — `enterprise/org/orgStore.ts:304,313,361,375,403,412` — PROVEN — OPEN. The most severe finding of the round.**
Create stamps `orgId` from the resolver. **Update and delete do not** — each is a bare `this.<map>.get(id)` over one install-wide Map. `enterprise:org.updateUser {id:'user-owner', email:'attacker@…'}` passes the owner guard, which strips only `roleIds` and `status`. Membership is decided by email on the `OrgUser` row, so the attacker becomes the victim tenant's Owner. `user-owner` and the thirteen unit ids are **compile-time constants** — no discovery needed. This is full tenant takeover from a self-created organization.

**NEW-H7 — `ipc/runtimeAuthz.ts:277` — OPEN.**
`plugins:grant` / `plugins:revoke` are `marketplace:manage` — an organization role — and mutate `grantedPermissions` on a store declared `PLATFORM_GLOBAL` + `PLATFORM_OPERATOR` whose own reason names this exposure. Every sibling moved to `cloud:operate` in Round 8; these two were left behind. `plugins:list` is public, so no discovery is needed.

### NEW FINDINGS — MEDIUM (selected)

**NEW-M1** `platform/subscribers.ts` native notifier — the forwarder's unscoped sibling eight lines away. A's record name into macOS Notification Center, which **survives the workspace switch, shows on the lock screen and syncs to the person's other devices**. **CLOSED THIS ROUND.**
**NEW-M2** `ReleaseDiagnosticsGet` / `Export` are PUBLIC and serve the identical `bus.metrics()` payload F9 was closed for. The classification was applied to one channel, not to the data. **OPEN.**
**NEW-M3** `memoryRetriever` IDF is computed over the global document count, so a tenant's own relevance score is a numeric oracle over another tenant's corpus — proven: A's score for A's own memory moved 1 → 0.453 → 0.229 as B's private corpus grew. **OPEN.**
**NEW-M4** `registerTenantStore` has no retention parameter, so three of the four proven retention HIGHs were never asked the question. **The most useful structural finding of the round. OPEN.**
**NEW-M5** `ecosystem/index.ts:283` stamps every API request with the seeded organization instead of the credential's tenant — audit, usage, quota and billing rows for every tenant file under `org-default`. **OPEN.**
**NEW-M6** `backup/backupManager.ts:191` — backup id is never charset-validated; `../../..` escapes `userData` for both `fs.rm` and, via a planted manifest, arbitrary file write. `cloud:operate` only. **OPEN.**
**NEW-M7** `backup:create` is unauthenticated, copies every tenant's records, and is uncapped for manual triggers. **OPEN.**
**NEW-M8** Seven channels sit on `PUBLIC_CHANNELS` *and* are gated by a module gate, so the startup invariant cannot detect a regression on any of them. **OPEN.**
**NEW-M9** The automation tick runs with no principal, so only the signed-in tenant's scheduled rules ever fire. Fail-closed, but wrong. **OPEN.**
**NEW-M10** `memory/index.ts:147` and `graph/index.ts:90` resolve the principal at drain time while the comment asserts the opposite. **OPEN.**
**NEW-M11** `platform/eventBus.ts:111` replay ring is one install-wide 500-event buffer with no tenant filter — latent, no production caller found. **OPEN.**

### REMAINING FINDINGS

**Open at the end of Round 9: 5 HIGH, 12 MEDIUM, 12 LOW,** plus **F22** — `backupManager` archives every tenant's record files with no partition, which has no honest declaration in the current vocabulary. Its authority half was fixed; the partition half is real work.

---

## 17. CERTIFICATION

# NOT CERTIFIED

The mandatory criteria and their actual state:

| Criterion | State |
|---|---|
| HIGH = 0 | **FAILED — 5 open** |
| No unresolved security MEDIUM | **FAILED — 12 open** |
| All Round 8 HIGH closed | PASS |
| All Round 8 MEDIUM/LOW closed | PASS (F9 and F16 narrower than they read) |
| Structural scope enforcement production-enforced | PASS — and the startup gate was wired this round after never having been called |
| No unclassified production persistent state | PASS by the detector; its blind spot is stated |
| Module / closure / singleton / filesystem state covered | PASS |
| INSTALL_GLOBAL + incompatible ORG_ROLE impossible | PASS |
| Channel/resource authority mismatch impossible | **FAILED — NEW-H7, NEW-M8** |
| Renderer cannot supply authority | **FAILED — NEW-H6** |
| Background principal explicit | **FAILED — NEW-M9, NEW-M10** |
| Retention scoped | **FAILED — NEW-H1, H2, H3** |
| Broadcast delivery scoped | PASS |
| A/B/C positive security tests pass | PASS |
| Persistence/restart tests pass | PASS at store level; **NOT TESTED as an application** |
| Full automated tests / typecheck / lint / desktop build | PASS |
| Backend build verified | **NOT VERIFIED THIS ROUND** |
| Native Mac build | **NOT TESTED** |
| Native Mac runtime | **NOT TESTED** |
| Real multi-organization runtime | **NOT TESTED** |
| Fresh independent red team completed | PASS |
| Fresh red team HIGH = 0 | **FAILED — 7 found** |

---

## 18. EVIDENCE

**Repository**
`git status` · `git branch --show-current` · `git rev-parse HEAD` · `git log --oneline -15`

**Test suites**
`npx vitest run src/main` → 650 files / 6662 tests, exit 0
`npx vitest run src/renderer src/shared` → 87 files / 963 tests, exit 0
43 package workspaces, each `npx vitest run`, all pass
Targeted: `marketplaceOwnership`, `eventDeliveryTenancy`, `connectorLogTenancy`, `desktopSessionTenancy`, `liveSyncTenancy`, `channelAuthorityTenancy`, `retentionScopeTenancy`, `storeClassification`, `round9RedTeam`, `storeScopeGate`, `authzGate`

**Static gates**
`npm run typecheck:release` → exit 0, every workspace, node and web
`npx eslint apps/desktop apps/backend packages/shared packages/companion-protocol packages/cloud-core packages/shared-cloud --max-warnings 0` → clean
`npm run build -w @neuropause/desktop` → green

**Negative controls** — each fix reverted, the new tests confirmed failing, then restored and re-verified green: marketplace rollback (4), event forwarder (6), connector log filter (8), connector history filter (10), connector caps (3), connector event stamp (1), desktop session ownership (13 of 19), desktop fail-open (4), live-sync ownership (18), live-sync cap (4), AiConfigMigrate (6), ExecMemoryForget (6), graph cap (4), timeline window (4), gateway chain (6), vault clear (3), registry counters (9), backup authority (1), native notifier (2).

**Detector measurement** — a standalone scan compared the Round 8 predicate against the widened one over every non-test file in `src/main`: old 0 undeclared, new 15 undeclared, all 15 invisible to the old one. That is the measured value behind F18, not an estimate.

**Runtime verification** — none. No macOS build, no application launch, no organization created in a running instance, no restart. Recorded as NOT TESTED.

---

## WHAT THIS ROUND ACTUALLY ESTABLISHED

Round 8's lesson was that a fix beside a sibling is not a class. Round 9 closed all twenty-one findings and then the fresh red team found seven more HIGH — and **the two most severe were not missing boundaries at all.**

`enterprise/index.ts:950` had a boundary. It was bound to the wrong resolver, one line out of step with every other store in the same file, across the largest data surface in the product. Every invariant this program has built asks *is a boundary bound?* and the answer was yes.

`orgStore` mutators had permission checks. They were evaluated in the caller's own organization and then the write landed in someone else's.

**The gap this round exposes is that the invariants check for the presence of a mechanism, not for what the mechanism is attached to.** A gate that asks "is a scope declared?" is answered by `registerTenantStore`, which cannot state a retention policy — which is why three install-wide caps that delete other tenants' rows sat underneath perfectly correct read filters and passed every gate.

That is Round 10's work, and it is a different kind of work from Rounds 1–9.
