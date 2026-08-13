# PROGRAM 13C — ROUND 10 FINAL REPORT

## 1. REPOSITORY

**HEAD:** `3b4b036` (start of round: `be917d4`, verified with `git rev-parse HEAD`)
**BRANCH:** `feat/understanding-holds-motion-system`
**WORKTREE:** clean

Round 10 commits: `6f9b7c6`, `633084f`, `8059822`, `13f3831`, `3b4b036`.

---

## VERDICT

**PROGRAM 13C IS NOT CERTIFIED.**

Three disqualifying reasons:

1. **Fourteen MEDIUM security findings are open**, raised by this round's fresh red team and not yet closed.
2. **Real multi-organization runtime and restart persistence were not performed.** The native Mac BUILD is now verified — 25/25 including the backend bundle (§22) — but Phases 23 and 24 need a person to drive the application, and they remain **NOT TESTED**.
3. **The fresh red team has not been re-run** since this round's three HIGH fixes. The certification loop requires a red team that finds zero HIGH *after* the fixes, not before.

**What is no longer a reason:** the native build. It passed on the Mac against this exact commit, including the backend bundle that has been unverifiable in the container since Round 8.

**What did change:** all six HIGH findings carried in from Round 9 are closed, the three new HIGH this round's red team found are closed, and **five further HIGH findings were discovered by the new structural invariant and closed** — fourteen HIGH in total.

---

## 2. PREVIOUS ROUND 9 FINDINGS

| | Finding | Status |
|---|---|---|
| **NEW-H1** | inbox retention deletes across tenants | **CLOSED** — `capPerOwner`; B's 3 and C's 11 survive A's 200 |
| **NEW-H2** | webhook deliveries + DLQ destroyed cross-tenant | **CLOSED** — per-owner buckets; B's replay still works after A's 5,100 |
| **NEW-H3** | validation run history deleted cross-tenant | **CLOSED** — per-owner cap; `snapshot()` no longer applies a second rule |
| **NEW-H4** | memory retrieval starvation + IDF oracle | **CLOSED** — index partitioned by visibility key, not filtered after ranking |
| **NEW-H5** | 106 ERP stores on the session-only resolver | **CLOSED** in Round 9 |
| **NEW-H6** | organization directory tenant takeover | **CLOSED** — ownership gate on every mutator |
| **NEW-H7** | plugin grants on an organization role | **CLOSED** — `cloud:operate` + a composition-time invariant |
| **F22** | multi-tenant backup archive, no honest scope | **PARTIALLY CLOSED** — see §9 |
| MEDIUM ×12 | M1–M11 + siblings | **CLOSED** |

---

## 3. NEW-H1 CLOSURE — inbox

`items.length = MAX_INBOX` truncated one shared array and persisted the result. Replaced with `capPerOwner()` keyed on `(tenantId, workspaceId)` — the exact pair `recordInScope` enforces on every read, so eviction inside a bucket can only reach rows the writer already owned. Test: B=3, C=11, A floods past the cap; B and C asserted by count **and row identity**, in memory and in `inbox.json`, then again after a reload. Negative control: reverting the cap fails 4 tests while the six pre-existing tests stay green — which is precisely how it shipped.

## 4. NEW-H2 CLOSURE — webhooks

`selectEvictions` sorted every tenant's deliveries together. Now per-owner, with the terminal-first/oldest-first rule preserved *within* an owner. B keeps 5 deliveries and 2 dead letters and can still replay them after A enqueues 5,100. Negative control: 4 failures on revert; all 26 pre-existing webhook tests stayed green under the bug.

## 5. NEW-H3 CLOSURE — validation runs

Two install-wide trims, one of them inside `snapshot()` so the truncation was written to disk on every save. Both per-owner now; `snapshot()` returns `[...runs]` so memory and disk cannot hold different rules. Negative controls run separately for the cap (6 failures) and for the persist path (1 failure) — proving the persistence half was independently load-bearing.

## 6. NEW-H4 CLOSURE — memory retrieval

The index is partitioned by the full visibility key (`sys` / `t‹tenant›` / `w‹tenant,ws›` / `p‹tenant,ws,user›`) — the exact fields `memoryVisibleTo` matches — and a query reads the union of partitions the viewer may see, taking `N`, every posting list and the normaliser from that union. A tenant-only key would have closed the oracle between organizations and left it open between colleagues.

The agent added a **small-corpus oracle test** on its own initiative, because the 200-note flood triggers starvation first and would have masked the score channel: with the partition reverted, A's own `lexicalScore` reads **0.667 instead of 1 from just five foreign documents**.

## 7. NEW-H6 CLOSURE — organization directory takeover

`createUnit`/`createUser`/`createRole` stamped `orgId` from the resolver. **Update and delete did not** — each was a bare `this.<map>.get(id)` over one install-wide Map.

This store decides who everyone is. Membership resolves by matching the signed-in email against an `OrgUser` row, so rewriting a row's `email` transfers its holder. `guardOwnerUserPatch` stripped `roleIds` and `status` — not `email` — and `user-owner` plus the thirteen seeded unit ids are compile-time constants. Create an organization, call `updateUser('user-owner', {email})`, become the victim tenant's Owner.

The permission check did not stop it because a permission is evaluated in the caller's own organization while the write lands in someone else's. **A permission answers "may this person do this kind of thing"; only ownership answers "to THIS row."**

Fixed with one ownership gate (`owns`/`ownedUnit`/`ownedUser`/`ownedRole`/`ownedOrganization`) that every mutator passes through, bound to `activeTenantScope` **before** `load()`, and registered so an unbound seam refuses startup. There is deliberately **no seed bypass** — `applySeed` writes straight into the Maps, so the store seeds itself without a flag that says "skip the check".

The `orgId`-parameterised reads stay ungated, and the comment says why: they are the *inputs to the tenant resolver*, so gating them on its answer is circular and would resolve nobody on any install.

Negative control: **8 of 11 fail** without the gate, including every step of the exploit chain.

## 8. NEW-H7 CLOSURE — plugin capability grants

`plugins:grant`/`revoke` moved to `cloud:operate`; `grant()` now refuses a permission the manifest never declared. The durable part is `assertPlatformStoreChannelAuthority`, which reads a store's own `declareStoreScope` record and **throws at composition** when a mutating channel over a `PLATFORM_GLOBAL`/`PLATFORM_OPERATOR` store carries a non-platform permission. That is what stops the declaration being documentation.

## 9. F22 — backup archive

**Enforced:** every archive carries a scope block in its manifest; restore refuses an archive without one; restore refuses unless the caller acknowledges the declared boundary; `restoreBoundary` is a *required* constructor dep, so no composition root can exist without writing down that its restores put every tenant back at once; the whole family is `cloud:operate`.

**Not enforced, and declared as such:** the archive is still **not partitioned per tenant**, and a restore is still all-or-nothing. The boundary is named and gated, not narrowed. Partitioning means re-serialising every store's rows through its own tenant filter across every domain — not contained, not attempted, and stated plainly in the declaration rather than implied by the parts that were done.

**One residual, stated in-file:** the archive's scope block is a declaration, not authentication. An attacker who can write into `<backupsDir>` can write the block too. Its job is that every archive states what it is; the security work is done by containment, coverage and the `cloud:operate` gate.

## 10. BACKUP SECURITY

**NEW-M6 (path traversal, was PROVEN):** ids are charset-validated at the wire and again in the manager; `..` in either separator style at any position, absolute paths, NUL, dotfiles, percent-encoded and partially-encoded forms all rejected; **resolved-real-path containment** via `fs.realpath` so a symlinked archive directory is refused; manifest entries contained on read *and* on write, plus a domain-coverage check so a planted manifest cannot name a path backup does not cover. Restore pre-flights every entry before the safety snapshot, so a refusal never half-restores.

**NEW-M7:** `backup:create`, `list` and `validate` moved off the public list to `cloud:operate` — `list`'s `sizeBytes` measures other tenants' data volume. Manual backups capped at 10, with `pre-migration` exempt (pruning the rollback anchor turns a failed migration into data loss).

Negative control: reverting containment destroyed a real victim directory outside the root; 4 failures.

---

## 11. RETENTION INVARIANT — the architectural core

`registerTenantStore(name, hasScope)` satisfied the store-scope gate and **takes no retention argument at all.** All three of Round 9's proven HIGH findings were in stores that passed the gate that way. The question was never asked, so the wrong answer was never caught.

`retentionScope` (`OWNER | INSTALL | NONE`) and `retentionAuthority` (`OWNER | PLATFORM_OPERATOR | SYSTEM | NONE`) are now enums `declareStoreScope` checks:

- `TENANT`/`WORKSPACE`/`USER` + `INSTALL` → **throws.** The entire finding class, made unrepresentable.
- `INSTALL_GLOBAL`/`PLATFORM_GLOBAL` + `OWNER` → throws (a global store has no per-owner rows).
- a removal with no authority, or an authority with no removal → throws.

A prose `retention` string was already mandatory. **Prose cannot be checked.**

The gate demands the enum of any file that persists *and* removes. **63 stores. All 63 now declare.**

### What it found on its first run — five HIGH

| | Finding | What it did |
|---|---|---|
| **R10-F1** | `enterpriseRecordStore` | The eviction **TRIGGER** was `records.size > maxRecords` — every tenant's rows — while victim selection was correctly scoped. Once one tenant filled the 50,000-row cap, **every other tenant's `create()` hard-deleted the row it had just written.** No status, no audit line, no event, no recovery. This is the backing store for all 106 ERP/CRM/HR/finance modules. Round 7 fixed *whose* row dies and left *when* untouched. |
| **R10-F2** | `medicalDevice/traceStore` | Identical shape over **regulated recall evidence**. A second manufacturer on a filled install could not retain a single traceability edge. |
| **R10-F3** | `globalGovStore` | `persist()` wrote `audit.slice(0, 500)` to disk, **permanently erasing every other organization's federated audit trail**, while the in-memory cap had been correctly fixed in Round 8 and every read filtered correctly. |
| **R10-F5** | `federation/dr/drStore` | `INSTALL_GLOBAL` + `ORG_ROLE`. Its own reason had named the cost in prose **since Round 4** — *"a federation:manage holder in one tenant can trigger an install-wide backup or a recovery validation."* Five rounds of review read that sentence and shipped. The enum refused to compile it. |
| **R10-B1** | `connectorControlStore` | One workspace's "enable" deleted the shared legacy key, **silently restarting connector sync for every other workspace that had deliberately disabled it** — a safety control, cleared across tenants. Round 8 wrote the reach into this store's own retention string verbatim ("cleared install-wide") and shipped. |

Plus **R10-B3A-F1 (HIGH)**, found while classifying: `nps:uninstall` reached `registry.remove(slug)` — deleting install-wide catalogue rows including `grantedPermissions` and `permissionGrants` — carrying `requireAuth` and **no permission at all**. Weaker than the F19 class this program has spent four rounds closing: F19 was an organization role over an install-wide resource; this was no role.

Plus four MEDIUM: tenant-less relationship index keys, and three bare-id mutations resolved without ownership.

**Three of these five were prose that had been reviewed and shipped for multiple rounds.** That is the argument for the enum, stated as evidence rather than as a claim.

## 12. RESOLVER-ATTACHMENT INVARIANT

Round 9's H5 was a boundary bound to the *wrong resolver* — every "is it bound?" invariant passed. `resolverAttachment.test.ts` now fails the build if any `bindScope` in the main process receives a session-only resolver, and pins the two composition lines that mattered by name.

**Its limits are stated in the file, not claimed away:** it reads the argument text at the binding site and cannot follow a resolver passed through a variable, returned by a helper, or supplied to a generic factory. It is one of three overlapping mechanisms — never-bound, declared-but-unbound, bound-to-the-wrong-thing — each blind to what the others see.

**And the fresh red team immediately found the gap: it only looked at DATA.** See §25.

---

## 13. BACKGROUND PRINCIPAL

**NEW-M9:** the automation tick ran with no principal, so `activeTenantScope` fell to the session and **every tenant except the signed-in one silently never fired.** Now `rule.tenantId → principalForOwnedWork → runAsPrincipal → fireScheduledRule`, fanned out per operable organization. A rule with no stored owner is skipped and logged, never run as the reader. The occurrence bucket takes the owner as an argument, resolved before any `await` — the post-await re-read was a second instance of the same defect.

`taskScheduler` — the file the red team named as root cause — gained the `principals` option its two corrected siblings already had; with none declared it runs under `runOutsidePrincipal`, so "this job named no tenant" is *stated* rather than inherited from whatever context the boot-time registration happened to be in.

## 14. QUEUE IDENTITY

**NEW-M10:** `memory/index.ts` and `graph/index.ts` armed a debounce and resolved the principal *inside* the callback, while `backgroundPrincipal.ts` states the contract is capture-at-enqueue and `memory/index.ts` asserted, in a comment, the opposite of what its code did. Queue items now carry `{ principal, tenantId, workspaceId, operation, enqueuedAt }`, keyed `tenantId::workspaceId`, so a debounce coalesces *within* an owner and never *across* one. The false comments now quote themselves as wrong. **No cross-tenant write was reachable** — both destinations are owner-scoped — so this is correctness plus a load-bearing comment that lied, and it is reported that way.

## 15. PUBLIC CHANNELS

**NEW-M2/M8:** ten stale rows removed. Seven channels were on `PUBLIC_CHANNELS` *and* gated by a module gate, so `assertAllChannelsClassified` — which accepts a channel on the allowlist regardless — could not detect a regression on any of them. It now **throws** for any channel that is both, before returning the unclassified list: omission and contradiction are different statements and get different reports. Three channels serving the same `bus.metrics()` payload that `diagnostics:get` was gated for last round are now gated identically.

## 16. ECOSYSTEM TENANT RESOLUTION

**NEW-M5:** `developerOrg` returned the seeded organization's id for every API request, so audit, usage, quota and billing rows for every tenant filed under `org-default` — and one tenant could exhaust another's quota. Now the API key row's own `tenantId`, captured from the row `verifyKey` just verified, split on *whether a credential was presented* rather than on whether it resolved.

## 17. GLOBAL EVENT RING

**NEW-M11:** the 500-event replay ring was install-wide with no tenant filter, and `subscribe({replay:true})` re-dispatched the whole buffer to any late subscriber. Partitioned per owner using the same key scheme as `timelineService`; `replay()` and `subscribe` share one authorized read re-checked through `recordInScope`. It had no production caller — fixed anyway, because "nothing calls it yet" is a schedule, not a boundary.

## 18. FULL RETENTION SWEEP

63 stores inspected end to end. Six behavioural caps fixed this round beyond the named findings; the rest declared after reading what each removal actually reaches. **Program total: twenty-four install-wide caps found across ten rounds.**

Three checks that earned their place, each having caught a real finding: check the **trigger** separately from the victim selection; check **`persist()`/`snapshot()`** separately from the in-memory path; treat a single-row `delete(id)` from a renderer id as the same class.

## 19. IPC SWEEP

Renderer-supplied ids are identifiers everywhere they were found to be authority: the org directory (§7), the relationship store, `connectorStore.remove`, `resourceStore`, `skip(pendingId)`, and the validation scheduler. Authority moved to `cloud:operate` on: plugin grants, backup create/list/validate/restore/delete, recovery run, support bundle, registry import/backup, the five `nps:*` package-lifecycle channels, federation DR writes, and marketplace worker install.

---

## 20. AUTOMATED TESTS

| Gate | Result |
|---|---|
| Desktop main | **660 files / 6822 tests, exit 0** (Round 9: 650 / 6662) |
| Renderer + shared | **87 files / 963 tests, exit 0** |
| Package workspaces | **43 of 43 pass** |
| Typecheck | **0 errors**, every release workspace, node and web |
| Lint | **clean**, `--max-warnings 0` |
| Desktop build | **green** |
| Backend build | **PASS — verified natively on the Mac** (see §22). The container's esbuild host skew was not worked around; it did not need to be |

No assertion weakened, no test disabled, no timeout relaxed. Where an existing test asserted the old behaviour it was corrected to bind the boundary as production does **and strengthened with a cross-owner case** — including `federationAuthz.test.ts`, whose `expect(p).toMatch(/^federation:/)` *was the finding's own assumption* and now asserts the authority axis instead.

## 21. NEGATIVE CONTROLS

Every behavioural fix was reverted, its tests confirmed failing, then restored and re-verified. Counts: org ownership **8 of 11** (including the full exploit chain) · inbox 4 · webhooks 4 · run cap 6 · run persist 1 · memory index 5 · memory oracle (small corpus) 1 · plugin authority 7 · backup containment 4 · enterpriseRecordStore 2 · traceStore 1 · globalGovStore 1 · resourceStore 1 · connectorControl 1 · relationship keys 2 · bare-id mutations 2 · authority resolver + operator predicate + marketplace door **3 of 7** · validation scheduler 1 · principals M9 7, M9-scheduler 5, M10 6, M8 5, M2 3, M5 4, M11 8.

One honest note from an agent: a first-pass scheduler test **passed both ways** under fake timers. It was rewritten on real timers, confirmed to discriminate, and reported rather than counted.

---

## 22. NATIVE MAC — **VERIFIED**

Run 12 August 2026 on macOS 26.5.2, arm64, Node v20.20.2, against `201d70d`.
**25 checks, 25 PASS, 0 FAIL.**

| Gate | Result |
|---|---|
| `npm ci` | **PASS** |
| Typecheck, all release workspaces | **PASS** |
| Lint | **PASS** |
| Desktop main tests | **PASS — 660 files / 6822 tests** |
| Renderer + shared tests | **PASS — 87 files / 963 tests** |
| Desktop build | **PASS** |
| **Backend build (`tsup`)** | **PASS — natively** |
| 18 named security suites | **PASS**, each run individually |

**The backend bundle is the one that matters here.** It has failed in the Linux container every round on an esbuild host/binary skew, and every previous report had to record it as unverified rather than claim it. It builds end to end on the Mac. That gate is now a result.

**Integrity of the run:** the script reported the worktree `DIRTY`, which is its own false positive — it tests for any `git status --porcelain` output and cannot distinguish its own results file from an edit. `git diff --stat` was empty and `git status --short` showed exactly one untracked entry, `P13C-ROUND10-MAC-RESULTS.txt`. **Zero tracked-file changes**, so the run is against `201d70d` and nothing else.

**Cross-check:** the macOS and container runs agree exactly — 660/6822 and 87/963 in both. The security suites are not host-sensitive, which is the useful negative: nothing was passing in one environment and failing in the other.

## 22b. WHAT THE MAC RUN DID NOT COVER

Phases 23 and 24 below remain **NOT TESTED**. The automated half of `scripts/p13c-round10-mac-verify.sh` is complete; its hand-checklist is not, and no line of it may be marked PASS by inference from the build passing.

## 23. REAL A/B/C RUNTIME

**NOT PERFORMED.** A/B/C fixtures with real data (3 / 7 / 11) exist throughout at unit and integration level — org members, marketplace listings, connector logs, events, live-sync queues, graph history, timeline events, gateway audit rows, memories, notifications, webhook deliveries, validation runs. **No organization was created in a running application.** The script's Phase 23 checklist covers it, including the retention-under-load case that is the sharpest manual check available.

## 24. RESTART

**NOT PERFORMED.** Store-level reload tests pass — the org store still refuses a foreign tenant after reopening from disk; marketplace, live-sync and the retention suites all re-assert after reload. **The application was never closed and restarted.**

Worth flagging for that run: two startup assertions now execute before any handler is registered, and `assertAllStoreScopesBound()` **had never been called in production before Round 9** despite being documented as such. If the app fails to launch, that is a real finding, not a script problem.

---

## 25. FRESH RED TEAM

Two independent exercises, told only *"the product claims strong multi-tenant isolation — break it."*

**HIGH 3 · MEDIUM 14 · LOW 15.** All three HIGH are **closed in this round**:

**RT-H1 — `marketplace/index.ts:182`.** `marketplace:install` ran on `workforce:manage` and reached byte-for-byte the same `installService.install` that `workforce:install` requires `cloud:operate` for. The comment above it — *"the SAME authority as a direct worker install, so no escalation"* — **was true when written** and became false when Round 9 moved the front door. `withWorkforceAuthz` throws on any unclassified `workforce:*` channel, and this one is `marketplace:*`: **a family gate cannot see a handler registered outside its family.**

**RT-H2 — `enterprise/index.ts:603`.** `authorizationOrgId` read the raw session resolver while every store in the subsystem resolved through `activeTenantScope`. Inside `runAsPrincipal`, **data resolved to the principal's organization and authority to the session's.** The companion gateway runs every LAN request under the paired device's principal, so a person who is Admin in A and read-only in B could write in B from a B-bound phone while A was on screen — B's own revocation was not the thing being consulted.

**This is Round 9's H5 one layer out, and it defeated the invariant built this round to prevent it** — because that invariant only inspected `bindScope`, i.e. data.

**RT-H3 — `sandbox/validation/scheduler.ts`.** One install-wide schedule Map with no tenant dimension, toggleable by an organization role, firing with **no principal** — so a pipeline the file's own comment describes as mutating real platform data ran inside whichever tenant was signed in at 02:00. Schedules now carry an owner and run under it, or do not run.

### And one that was not a leak

`createAuthorize` has accepted an `isPlatformOperator` dep since the platform authority model was built. `authzGate` has exactly one line that can satisfy a `cloud:operate` permission. **Nothing ever passed it.** The registry was wired into a different object, so the predicate was `undefined` and **every `cloud:operate` channel refused everyone, platform operators included.**

It failed **closed** — which is why ten rounds of isolation testing never saw it, and why it is not scored as an isolation finding. What it means is that the ~40 install-wide channels this program spent four rounds moving onto platform authority **had never once been exercised through it**, and that `marketplace:install` on an organization role was, until RT-H1 was fixed, the only working door to the install-wide worker registry. Now wired, late-bound, still false when unbound.

### 26. REMAINING FINDINGS

**HIGH: 0 open.** **MEDIUM: 14 open** — including two `nps:*` control channels still public while their siblings are platform-gated; `runtime:list`/`runtime:health` exposing every organization's running processes; runtime instances carrying no owner; a shared per-connector rate limiter one tenant can stall for another; marketplace install/rating counters unpartitioned; the companion `activeCount` and crash-archive public reads; the updater's install-wide channel on no authority; `federation` invitation targeting derived from a caller-supplied name; and `registry:export` public while writing the same bytes requires `cloud:operate`.

**LOW: 15 open**, including two declarations whose prose is now stale — a false statement inside a declaration blinds the next reviewer exactly as a missing one does.

**F22's partition half remains open.**

**The fresh red team has NOT been re-run since the three HIGH were fixed.**

---

## 27. CERTIFICATION

# NOT CERTIFIED

| Criterion | State |
|---|---|
| HIGH = 0 | **PASS** — 14 closed this round, 0 open |
| No unresolved security MEDIUM | **FAILED — 14 open** |
| No known tenant takeover | **PASS** |
| No cross-tenant deletion | **PASS** |
| No cross-tenant retention | **PASS** — 63 stores declared, class unrepresentable |
| No renderer authority | **PASS** |
| No authority/resource mismatch | **PASS** for known cases; 3 MEDIUM are of this shape |
| No unscoped customer-data archive | **FAILED** — F22 partition open |
| No public tenant-data channel | **FAILED** — several MEDIUM |
| Background principals explicit | **PASS** |
| Queue identity immutable | **PASS** |
| Retention structurally declared | **PASS** |
| Resolver attachment structurally verified | **PARTIAL** — data yes, authority now pinned, the general gate still reads binding sites only |
| Automated tests green | **PASS** |
| Negative controls green | **PASS** |
| Native Mac build | **PASS** — 25/25, backend bundle included |
| Native Mac runtime | **NOT TESTED** |
| Real A/B/C in the running app | **NOT TESTED** |
| Restart / persistence | **NOT TESTED** |
| Fresh red team HIGH = 0 | **NOT RE-RUN** after the fixes |
| Fresh red team MEDIUM = 0 | **FAILED** |

---

## 28. EVIDENCE

**Repository:** `git status` · `git branch --show-current` · `git rev-parse HEAD` · `git log --oneline -20`

**Tests:** `npx vitest run src/main` → 660 files / 6822 tests, exit 0 · `npx vitest run src/renderer src/shared` → 87 / 963 · 43 package workspaces each `npx vitest run`, all pass.

**New this round:** `round10OrgOwnership` (11) · `round10AuthorityPrincipal` (7) · `round10InboxWebhookRetention` (8) · `round10RunsMemoryIsolation` (16) · `round10RetentionBatch1` (6) · `Batch2` (8) · `Batch3a` (10) · `round10BackupPluginAuthority` (34) · `round10PrincipalsChannels` (39) · `resolverAttachment` (4) · `storeScopeGate` (12, including the new retention gate).

**Static gates:** `npm run typecheck:release` → 0 · `npx eslint … --max-warnings 0` → clean · `npm run build -w @neuropause/desktop` → green.

**Measurement, not estimate:** a standalone scan compared every non-test file in `src/main` against the persistence, retained-state and removal predicates. 63 files persist and remove; 63 declare. The five HIGH in §11 came from reading those 63, not from a finding list.

**Negative controls:** §21, each reverted, failed, restored and re-verified, with counts.

**Runtime:** none. No macOS build, no launch, no organization created in a running instance, no restart. Recorded as NOT TESTED.

---

## WHAT THIS ROUND ESTABLISHED

Round 9 ended on the observation that every invariant this program had built asks whether a mechanism is *present*, never what it is *attached to*.

Round 10 built the invariant that asks — and it worked: **five HIGH findings in its first run across 63 stores**, three of them defects whose own store had described them in prose that had been reviewed and shipped for multiple rounds. `drStore` named its own vulnerability in Round 4 and shipped five more times. A retention string in `connectorControlStore` said "cleared install-wide" and shipped. **The enum refused to compile what the prose had been permitted to assert.**

Then the fresh red team found the same class one layer further out. The resolver-attachment gate built this round checks `bindScope` — *data*. `authorizationOrgId` was the *authority* path, resolving from the session while every store beside it resolved from the principal. And the platform-operator predicate had been declared, documented and never passed, so the authority model those four rounds of work depend on had never executed once.

The pattern is now legible enough to name: **each round's invariant checks the axis the previous round's finding was on, and the next finding is on the axis beside it.** Data, then authority. Presence, then attachment. Whose rows, then who may remove them.

That is not a reason to stop building invariants — the five findings above were free once the right question was mechanical. It is a reason not to read a green gate as a proof. What remains for Round 11 is fourteen MEDIUM, F22's partition, and the three verifications only your Mac can perform.
