# PROGRAM 13C — ROUND 13 REPORT

## VERDICT

# NOT CERTIFIED

**Security MEDIUM is now 0.** HIGH has been 0 since Round 10. Both remaining
findings are closed, and the structural invariant that would have caught Round
12's fourteen is built and bites.

Two blockers remain, and neither is a code-level MEDIUM:

1. **F22 is open. I did not attempt it, deliberately** — the Round 12 audit
   scoped it as a sprint, and the honest options this round were "do it properly"
   or "ship a partial tenant archive that lies about what it contains". §D.
2. **Ten certification gates require a launched application.** Unchanged since
   Round 11, unmovable by static work.

---

## A. REPOSITORY

| | |
|---|---|
| Branch | `feat/understanding-holds-motion-system` |
| HEAD at round open | `8b68391` (Round 12, pushed) |
| Worktree at open | clean |
| Verification | Linux container, clean install. **macOS gates are yours to run.** |

---

## B. M-13 — CLOSED

**The finding.** `pinned` and `favorite` lived on the install-global
`RegistryEntry`, and `registry:setFlags` was PUBLIC — no auth, no permission. So
tenant A un-pinning an app un-pinned it for tenant B, from a context that had not
signed in.

**Why five rounds walked past it:** the file contradicted itself. `registry.ts`
called the flags *"display flags shared by everyone who uses the install"* in one
comment and *"per-user display flags"* in another. Round 9 (F4) verified the
payload **whitelist** — the mutation can only reach those two fields — and that
verification was correct and is untouched. What it never asked was where the
write **landed**.

**The fix.** A `flagsByTenant` side table, following `usageByTenant` — the
pattern this same file already uses for the other per-tenant projection over a
shared row. Outside the checksummed `entries` map, for the same stated reason: a
value that changes on a user's click must not churn the integrity hash that
exists to detect out-of-band edits. `registry:setFlags` → `dashboard:read`, not
`cloud:operate`, because the act is per-user personalization and gating it as a
platform operation would take the pin button from every ordinary member.

**Legacy is preserved, not migrated.** A row's own flags remain as the default
any tenant sees until that tenant sets its own. The historical value was never
attributable to an organization — promoting it to one would invent provenance,
dropping it would unpin every app on every existing install.

**A self-check worth recording:** `export()` is a spread of `...this.file`, so
adding a second per-tenant map would have re-opened M-10 through a new field —
which is precisely how M-10 happened. The export filter ships in the same change
as the field, and there is a test for it.

- Test: `round13RegistryFlags.test.ts` — 11
- **NC-M13:** restore the shared-row write → **8 of 11 fail**, incl.
  *"A UNPINNING does not unpin B"* → `expected false to be true`

---

## C. M-14 — CLOSED

**The finding.** `ai:engineering-analyze` builds context from `unifiedStore`,
`graphStore` and `memoryStore`, runs `aiEngine`, and returns `rootCause` /
`engineeringRisk` / `recommendedAction` — an answer synthesised from the tenant's
records, on a channel with no authentication.

**It survived on the wrong axis.** The AI family gate justified it as a
*"non-persisting derivation"* — true, and it answers MUTABILITY. Its sibling
`founder:ask-v2` had already moved off public for the identical payload reason.
That sibling had two reasons (synthesis **and** a memory write); this one had the
first, which was always sufficient on its own.

**And the test suite was holding it open.** `channelAuthorityTenancy.test.ts`
listed the channel under *"the reads that were public are still public"* with the
message `must stay open`. The earlier decision had been encoded as a
**requirement**, so the only way to reopen the question was to change the test.
That row is removed with the reasoning in place.

Secondary, independent of disclosure: an unauthenticated caller could spend the
install's model credential in a loop, shipping retrieved tenant records to the
configured destination, with no rate limit above `runSecureHandler`.

Now `intelligence:read` in **both** the family gate and the central register —
NEW-M8's lesson: a channel classified in only one table can be moved by a
regression without either mechanism noticing. `founder:suggestions` stays public;
it returns fixed templates and coarse own-tenant counts, and the two were named
together in the old comment when they are not the same shape.

- Test: `round13AiAnalyzeAuthority.test.ts` — 5
- **NC-M14:** return to PUBLIC in both tables → **4 of 5 fail**

---

## D. PHASE 3 — THE CHANNEL→STORE INVARIANT (BUILT)

The piece I recommended at the end of Round 12, and the reason it matters:

> Round 12's sweep found fourteen public channels carrying tenant data, nine of
> them one defect, and **every automated mechanism passed the whole time**.
> `assertAllChannelsClassified` asks *"is this channel classified?"* — the answer
> was yes for all fourteen. Nothing asked whether the classification **matched the
> payload**.

That is the third instance of one meta-shape: a gate checking **presence** where
it needed to check **correspondence**. Data → authority (R10). Presence →
attachment (R10). Classified → correctly classified (here).

**New module: `ipc/channelResource.ts`.** A handler declares which store it
reaches; the store already declares its own scope and classification. Joining
them makes the question mechanical:

```
channel → store → { scope, classification } + { public?, effect }
```

**The rules, each a finding this program actually shipped:**

| Rule | The finding it makes unrepresentable |
|---|---|
| `PUBLIC_CUSTOMER_DERIVED` | the Round 12 class, all fourteen |
| `PUBLIC_GLOBAL_MUTATION` | Round 11 updater / nps / pilot |
| `PUBLIC_SCOPED_MUTATION` | `platform:emit` (Round 12) |
| `UNKNOWN_STORE` | fail closed — "I could not check" must not read as "this is fine" |

A public **read** of `INSTALL_METADATA` stays legal; that is the `plugins:list` /
`registry:list` standard, and a rule banning it would push stores into declaring
scopes they do not have.

**Why a declaration and not a source scan.** `storeScopeGate` can scan for
persistence because writing a file is syntactically visible. What a handler
*reaches* is not — handlers close over injected ports and reach stores several
frames deep. A regex would produce confident wrong answers, which is worse than
none.

**The test that matters is the synthetic one.** The suite builds a channel that
does not exist in the product, points it at a CUSTOMER_DERIVED store, and
requires the mechanism to refuse it — so it **catches a new channel**, not just
today's fourteen. It also asserts the same channel gated is clean, a metadata
read is clean, and both public-mutation rules fire.

- Test: `round13ChannelStoreInvariant.test.ts` — 11
- **NC-CHANNEL-STORE:** remove the customer-derived rule → **4 of 11 fail**

### The honest limit, stated in the file itself

**Coverage is partial, and that is the gap.** A channel with no declaration is
invisible to these rules — the mechanism proves things about what it has been
told, not about the whole IPC surface. Wiring a declaration onto every sensitive
handler is mechanical but wide, and it is the natural next increment.

So this is a **forcing function, not a proof of completeness** — the same status
`storeScopeGate` states about itself. The rules are real and they bite; the
population they run over still has to grow. The round that calls it complete is
the round that gets the next fourteen.

---

## E. F22 — STILL OPEN, STILL NOT ATTEMPTED

Round 12 audited this in depth and the conclusion has not changed: **18
tenant-derived stores, four different owner conventions** (`tenantId`, `orgId`, a
`MemoryOwner` union, NDJSON scope buckets), **no shared base class**, and **no
tenant-parameterized filter** — `TenantOwnership.onlyMine()` reads the ambient
scope; there is no `onlyFor(tenantId)`.

**Restore is the larger half.** It is `fs.copyFile` at whole-file granularity
today, so restoring one tenant's `memory.json` **deletes the other two outright**.
Per-tenant restore needs a read-modify-write merge per store (18 inverse filters),
a new integrity model (a whole-file sha256 cannot validate a merge), a manifest
schema change, loosening a validator that currently fail-closed requires
`tenants: 'ALL'`, and a restart signal — every store holds its collection in
memory, so the next live write reverts the merge.

**Why I shipped nothing rather than something.** The coherent partial slice is
~10 mechanical stores — but four of the five most sensitive domains (memory,
graph, unified entities, ERP records) are in the seven **bespoke** ones. A partial
tenant archive is a dangerous object: it looks like "tenant X's backup" while
silently omitting X's most sensitive data. That is a regression in honesty, which
is the specific failure this architecture exists to prevent, and
`backup/backupArchive.ts:50-53` already declares the current state accurately.

**F22 = OPEN.** Required next action: the sequenced work in §D of the Round 12
report — the `onlyFor(tenantId)` primitive, then the 10 mechanical stores, then
the 7 bespoke, then the restore merge and manifest. Test required: a per-tenant
archive containing only that tenant's rows across all 18 domains, plus
cross-tenant restore denial.

---

## F. AUTOMATED VERIFICATION

| Gate | Round 12 | **Round 13** |
|---|---|---|
| Desktop main suite | 668 / 6944 | **670 files / 6966 tests, 0 fail** |
| Typecheck node | 0 | **0** |
| Typecheck web | 0 | **0** |
| Lint (`apps/desktop/src` + `packages/shared/src`) | clean | **clean** |
| Negative controls | 12 | **+4 = 16 total, all discriminate** |
| Renderer + shared | 87 / 963 | not re-run — **run on the Mac** |
| 46 package workspaces | 46/46 | not re-run — **run on the Mac** |
| Desktop / backend build | PASS (macOS) | not re-run — **run on the Mac** |

**New tests:** `round13RegistryFlags` (11), `round13ChannelStoreInvariant` (11),
`round13AiAnalyzeAuthority` (5) = **27**.

**Three existing assertions changed, all because production behaviour changed:**

1. `channelAuthorityTenancy` — the `must stay open` row for
   `ai:engineering-analyze`. Removed with reasoning; it had encoded the wrong
   decision as a requirement (§C).
2–3. `channelAuthorityTenancy` F4 — two cases read `getRaw(SLUG).pinned`. M-13
   moved where the flags land, not whether they are whitelisted, so they now read
   the DTO. **The raw-row assertions that constitute the F4 property — that
   nothing outside the two display flags reaches the row — are untouched.**

**One negative control I had to redo.** My first NC-M13 attempt mangled the file
into a syntax error, so vitest reported *"no tests"*. That is not a discriminating
control — it proves nothing — so it was redone surgically and produced a real
8-of-11. Recording it because a broken NC that looks like a failure is exactly the
false confidence this program exists to avoid.

---

## G. GATES STILL NOT TESTED — 10

Native Mac app launch · real A/B/C organizations · cross-tenant attack matrix ·
real runtime ownership · real retention under load · real background principal ·
real queue identity · restart #1 and #2 / persistence · real backup/restore ·
**fresh red team against the running application**.

The red team this round was again **code-level** and produced nothing new — the
allowlist sweep was exhausted in Round 12 and M-13/M-14 were its last two
findings. That is a meaningful signal, but it is **not** Phase 25.

---

## H. CERTIFICATION GATE

| | |
|---|---|
| HIGH | **0** |
| Security MEDIUM | **0** ✅ |
| M-13 / M-14 | **CLOSED** |
| Channel→store invariant | **PASS** (partial coverage, stated) |
| Retention / resolver / authority invariants | PASS |
| Desktop suite / typecheck / lint | PASS |
| Negative controls | PASS (16/16 discriminate) |
| **F22** | **OPEN** |
| Workspaces / builds / renderer | **RE-RUN ON MAC** |
| All 10 runtime gates | **NOT TESTED** |

# PROGRAM 13C — STATUS: NOT CERTIFIED

**BLOCKER 1 — F22.** *Files:* `backup/backupManager.ts`,
`backup/backupArchive.ts`, `storage/storePaths.ts`. *Root cause:* install-wide
verbatim archive; whole-file restore; 18 stores across 4 owner conventions with no
tenant-parameterized read. *Required fix:* §E. *Required test:* per-tenant archive
proven to contain only that tenant across all 18 domains + cross-tenant restore
denial.

**BLOCKER 2 — the ten runtime gates.** *Root cause:* they require a launched
application driven by a person; I have no macOS host and no GUI. *Required
action:* Phases 17–25 on your Mac. *Required test:* the A/B/C matrix against
persisted state, not response codes.

**Not a blocker, but the next thing worth building:** extend the channel→store
declarations to the full sensitive IPC surface, so the invariant covers the
population rather than a seeded subset (§D).

---

## I. WHERE THIS PROGRAM ACTUALLY IS

Across Rounds 11–13: **nineteen MEDIUM closed**, HIGH at 0 since Round 10,
**sixteen discriminating negative controls**, every static gate green, and — for
the first time — a structural invariant that asks whether a classification is
*correct* rather than merely *present*.

What is left is not more static review. Two of the three Round-13 findings were
found by reading comments that contradicted each other, and the code-level red
team is now returning nothing. The remaining risk is concentrated in exactly the
two places static work cannot reach: **an unpartitioned backup archive**, and
**an application nobody has yet run three tenants through**.
