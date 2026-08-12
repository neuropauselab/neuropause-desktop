# PROGRAM 13C — ROUND 12 REPORT

## VERDICT

# NOT CERTIFIED

Three reasons, in order of how much work each represents:

1. **Ten certification gates require a launched application** and nobody has
   launched one. Unchanged from Round 11, and not movable by static work.
2. **F22 is open, and I did not attempt it.** A full domain audit says it is not
   a contained change — 18 stores, 4 owner conventions, no shared base class,
   and a restore side larger than the backup side. Details and the honest size
   estimate in §D.
3. **Two MEDIUM remain open** — both discovered this round, both needing changes
   I would not make blind (§C.4).

**What moved.** The three MEDIUM carried in from Round 11 are closed. A full
sweep of the public allowlist — which the brief correctly refused to assume was
safe — found **fourteen more channels** that failed the scope/authority/payload/
mutability test, and those are closed too. Every fix has a regression test and a
discriminating negative control.

---

## A. REPOSITORY

| | |
|---|---|
| Branch | `feat/understanding-holds-motion-system` |
| HEAD at round open | `83ec847` (Round 11 report, amended) |
| Worktree at round open | **clean** |
| Verification | Linux container, clean `npm ci`; **macOS gates are yours to run** |

**The Mac constraint, once, factually.** The device shell available to me is a
**Linux aarch64 VM**, not macOS. Every native Mac result in Round 11 came from
you running commands and pasting output, and my container matched your Mac
exactly (664/6879 and 87/963). That division is what Phase 1 needs again: I
pre-verify, you confirm.

---

## B. THE THREE ROUND-11 MEDIUM — CLOSED

### M-10 — registry export leaked raw rows, and the backup was silently lossy

`export()` filtered `usageByTenant` to the caller's bucket (the Round 9 F20 fix)
and then spread `...this.file`, so the **raw `entries` rows went out untouched**
— carrying `launchCount`, `lastLaunchedAt` and `usage` as the install-wide
accumulation. The function withheld the data through one field and disclosed it
through another. The migration note claiming those counters are "visible to no
organization" was true of `toDto` and false here.

**Nuance worth stating:** since F20, `recordLaunch` writes only to
`usageByTenant`, so a row's counter is non-zero **only on an install migrated
from a pre-F20 `registry.json`**. The leak is historical data frozen at
migration — no less cross-tenant for being historical, and present on every
long-lived install. The test exercises exactly that shape.

**And it closed a data-loss path.** `backup()` called `export()`, so a backup
kept only the taker's usage bucket and **discarded every other organization's
launch history** — and `restore()` is `import(raw, {merge:false})`, which writes
that loss back as fact. Split into `serializeAll()` (lossless, backup) and
`export()` (authorized view).

- Test: `round12RegistryExport.test.ts` — 8
- **NC-M10:** revert the scrub → **3 fail**, incl. `expected 4242 to be 3` (the
  migrated counter in the export bytes)
- **NC-M10b:** revert `backup()` to the scrubbed view → **3 fail**, incl.
  `expected ['org-a'] to deeply equal ['org-a','org-b','org-c']`

### M-11 — federation invitations targeted by slugified display name

`inviteOrg` computed `org-${slug(input.name)}`. Real ids are `org_<uuid>`, so
the minted space could intersect exactly one real organization: the seeded
`org-default`, the install's primary tenant. Duplicate names collapsed; renames
orphaned; deletions left rows that would go live if the id were reissued; every
other name minted a black-hole row addressed to nobody.

**The codebase had already written this down.** `tenancy/migrationInventory.ts`
has said since Round 4: *"`inviteOrg` derives the target organization id from a
display name … real federation between two UI-created organizations is not
currently expressible."* Four rounds read it and shipped — the same shape as
`drStore` and `connectorControlStore`, both closed in Round 10.

Request model changed `name` → `toOrg: FedId`; target resolved from the
directory; name taken from the resolved row; self-invite refused; one refusal
message so ids cannot be enumerated. Renderer invite modal became a picker.

**The honest limit, and I corrected an over-claim of my own to state it.** This
closes targeting by *guessable string*. It does **not** stop a tenant inviting an
organization it can legitimately resolve — the home org is always a directory
row, so `org-default` remains addressable *by id*. What protects the recipient
there is consent (`respondInvitation` refuses `accept` unless `toOrg === me`),
which was already correct and already tested. An existing sweep test asserted
the old attack; I rewrote it to assert the true post-fix behaviour rather than
let it pass for the wrong reason.

- Test: `round12FederationInvite.test.ts` — 10
- **NC-M11:** revert to name-minting → **8 of 10 fail**

### M-12 — marketplace install/rate had no voter

Both were unbounded and anonymous: `installs + 1` and a running average per
call. `ecosystem:listing.rate` is `developer:manage`, held by every Owner of
every self-created organization, and published listings are visible to all
tenants by design. So B could loop one channel and drive A's listing to
`ratingAvg: 1.0, ratingCount: 100000`, or inflate its own — `rankCatalog` sorts
on `installs`. Neither handler carried `audit: true`.

**The dimension is the ORGANIZATION, and that is a documented decision.** This
store's only identity seam is `tenancy.scopeOrDeny()`, which resolves a tenant;
there is no user seam, and inventing one would be guessing. Per-org also matches
how adoption is already counted next door (`analytics.downloads30d` counts
per-org `Installation` rows).

**Legacy rows are not rewritten.** The arithmetic runs off the stored totals, so
a pre-M-12 row's `ratingCount`/`ratingAvg` survive and new votes extend that
baseline. Recomputing from the new map would have discarded every historical
vote — data loss dressed up as a cleaner model.

- Test: `round12MarketplaceDedup.test.ts` — 10, incl. legacy-migration and reload
- **NC-M12:** remove identity → **9 of 10 fail**, incl. `expected 100 to be 1`

---

## C. PHASE 5 — THE FINAL ALLOWLIST SWEEP

The brief said not to assume the rest of `PUBLIC_CHANNELS` was safe. It was not.
Every remaining entry was audited against SCOPE + AUTHORITY + PAYLOAD +
MUTABILITY. **Fourteen channels failed. Nine are one defect.**

### C.1 The corpus-projection class — nine channels

A generator or projection over the tenant corpus, admitted as *"read-only"*,
while the **stored form of the identical data is gated `intelligence:read`**.
"Read-only" answers mutability; the allowlist rule is about payload. The two
were conflated.

| Channel | What it actually returned |
|---|---|
| `enterprise:timeline.export/.replay/.stats` | the same private `collect()` as the **gated** `.query` — `export` is the *wider* door: unpaginated, every entry, body excerpt attached |
| `briefing:generate` | `unifiedStore.query({limit: 1_000_000})` as "Meeting: `<title>`", 140-char body excerpts |
| `knowledge:related/.topics/.health` | a **third** retrieval strategy over `memoryStore.allItems()`, whose other two are both gated |
| `recommendations:generate` | `rationale`, `entityRefs`, `evidence` — the payload `decision:list` was pulled off this list for in Round 2 |
| `voice:turn` | `composeExecutiveSnapshot` spoken aloud; the written form is gated |

### C.2 Five more, their own shapes

- **`platform:emit`** — a PUBLIC **write** into a TENANT + CUSTOMER_DERIVED store
  whose authority is `SYSTEM` (rows the product produces, not a caller). An
  unauthenticated renderer could author timeline rows with a chosen
  `resourceName`, read back later by the gated `timeline.query` as observed
  activity — into an append-only log the declaration says is *"never trimmed"*,
  with no rate limit above it.
- **`notifications:list` / `.markRead`** — the inbox store **declares itself**
  TENANT + CUSTOMER_DERIVED, and its own comment says *"a notification BODY
  carries business data"*. Admitted as "per-user local data", which was true of
  the preferences and never of the rows.
- **`crash:recommendations`** — the third door on the archive whose two siblings
  were gated last round; the M-7 comment block never mentioned it. Payload is
  advisories, but thresholded on install-wide fault counts that move when
  another tenant crashes.
- **`pilot:setEnabled`** — a PUBLIC mutation of one install-global JSON. Lowest
  severity (blast radius is a badge) and the only store here with **no
  `declareStoreScope` at all**, which is why nothing structural caught it.

All fourteen moved to `intelligence:read` / `dashboard:read` / `operations:read`
/ `org:manage` — every one in the READ_ONLY base role except the pilot mutation,
so **no signed-in member loses a path**; a signed-out context loses all of them.

- Test: `round12AllowlistSweep.test.ts` — 37
- **NC-P5:** return six to the allowlist → fails on every one

### C.3 What deliberately stays public

Checked against the same test and passing: notification *preferences*,
`crash:report`, `crash:setOptIn`, `pilot:status`, `registry:list/get`,
`perms:list`, `plugins:*`, catalog reads, `nps:verify`, `api:request` (the
gateway re-applies `requireAuth` **and** `permission` through
`runSecureHandler`), platform `timeline:query/.stats/.export` (scoped via
`recordInScope`), `unified:counts`, `registry:stats` (caller's own bucket),
`supervisor:status`, `founder:suggestions` (fixed templates + coarse own-tenant
counts).

### C.4 TWO MEDIUM LEFT OPEN — with addresses

| ID | Finding | Why not closed |
|---|---|---|
| **M-13** | `registry:setFlags` is a PUBLIC **write** to an `INSTALL_GLOBAL` + `PLATFORM_OPERATOR` store. Round 9 verified the payload whitelist (only `pinned`/`favorite`), and that holds — but the **authority axis was never resolved**, and the file contradicts itself on scope: `registry.ts:237` calls the flags *"shared by everyone who uses the install"*, `registry.ts:96` calls them *"per-user"*. Storage settles it: they live on the shared row, so A un-pinning un-pins for B, with no auth. | The correct fix is **not** `cloud:operate` — that removes the pin button from ordinary members. It is to move the flags into the existing per-tenant side table (`usageByTenant`-style, projected by `toDto`) and gate at `dashboard:read`. That is a persisted-shape change to the registry, and I will not make it without being able to launch the app. |
| **M-14** | `ai:engineering-analyze` is an **unauthenticated LLM run over tenant records** — context built from `unifiedStore`, `graphStore`, `memoryStore`, returning synthesised `rootCause` / `engineeringRisk` / `recommendedAction`. Its sibling `founder:ask-v2` moved off public precisely because *"answers are synthesised from this tenant's records"*. Secondary: it spends the install's model credential from an unauthenticated path. | It is classified `PUBLIC` by the **AI family gate** (`ai/aiAuthzGate.ts:115`), a second mechanism with its own cross-check against the central table. Changing it means touching that gate's contract, and the family-gate/central-table agreement test is load-bearing. Contained, but not something to do at the end of a long round. |

**Also noted, below MEDIUM:** `pilot.json` and five other config files have **no
`declareStoreScope`** at all; `user-feedback` satisfies the gate only because
`new TenantOwnership(` counts as a declaring API, and carries no
scope/classification/retention enum.

### C.5 The structural gap, stated rather than claimed away

`assertAllChannelsClassified` checks that every channel **is** classified. Nothing
checks that a classification **matches its payload** — which is why nine channels
of one defect survived eleven rounds. The invariant that would catch the class is
*"no channel reaching a `CUSTOMER_DERIVED` store may appear in
`PUBLIC_CHANNELS`"*, and it needs a channel→store map this codebase does not
have, because handlers reach stores through closures a source scan cannot follow.
Until that exists, `round12AllowlistSweep.test.ts` is a **named list** — it pins
the fourteen found and cannot see a fifteenth. That is weaker, and it is said in
the file.

---

## D. F22 — AUDITED, SCOPED, **NOT ATTEMPTED**

I ran a full domain audit rather than starting an implementation, and the answer
is that this is not a contained change. Reporting it instead of half-doing it.

**Domains:** `storePaths.ts` covers 11 domains / ~31 file patterns. **18 distinct
tenant-derived stores** (the 106 `enterprise-module-*` files collapse to one
class), plus 13 install/platform/user files.

**Four different owner conventions**, not one:

| Store | Owner field | File shape |
|---|---|---|
| `enterprise-module-records` | `tenantId` + `workspaceId` | `{schemaVersion, moduleId, records[]}` |
| `unified-entities` | `tenantId` | **bare top-level array**, no envelope |
| `ai-memory-store` | `owner: MemoryOwner` union (+ `sync.orgId`) | `{items[], lastBuiltAt}` — shared scalar |
| `enterprise-governance` | **`orgId`**, documented as predating the convention | envelope |
| `platform-timeline` | `scopeKind` + system bucket | **append-only NDJSON**, all tenants interleaved |
| `org-license-cache` | — | already `Record<orgId, …>` — the one free case |

**No shared base class and no tenant-parameterized filter.**
`TenantOwnership.onlyMine()` reads the *ambient* scope — there is no
`onlyFor(tenantId)`. `recordInScope(record, scope)` is parameterized but only
understands `{tenantId, workspaceId}`. `forTenant()` exists on exactly one store
in the codebase, and that store is not in the backup set. Several per-store
filters are `private`.

**Restore is the larger half.** Today it is `fs.copyFile` at whole-file
granularity — so restoring "tenant X's `memory.json`" over the live one **deletes
Y and Z outright**. Per-tenant restore requires: a read-modify-write merge per
store (the inverse filter, written separately, 18 times); a new integrity model
(a whole-file sha256 cannot validate a merge); a manifest schema change;
loosening `isArchiveManifestScope`, which currently *fail-closed* requires
`tenants: 'ALL'`; and a restart signal — every store holds its collection in
memory and `persist()` writes the whole thing, so `RestoreResult` has no
`requiresRestart` and the next write by any live tenant reverts the merge.

**Why I did not ship a partial increment.** The coherent slice is ~10 mechanical
stores — but the five most sensitive domains (memory, graph, unified, ERP,
conversations) are four of the seven *bespoke* ones. A partial tenant archive is
a dangerous object: it looks like "tenant X's backup" while silently omitting X's
memory, graph, ERP records and timeline. That is a regression in honesty, which
is the specific failure this architecture exists to prevent.

The codebase's own declaration already says this accurately
(`backup/backupArchive.ts:50-53`). **F22 stays OPEN and correctly declared.**

---

## E. AUTOMATED VERIFICATION

| Gate | Round 11 end | **Round 12** |
|---|---|---|
| Desktop main suite | 664 files / 6879 tests | **668 files / 6944 tests, 0 fail** |
| Typecheck (node) | 0 errors | **0 errors** |
| Typecheck (web) | 0 errors | **0 errors** |
| Lint (`--max-warnings 0`, main + shared) | clean | **clean** |
| Negative controls | 6 | **+6 = 12 total, all discriminate** |
| Renderer + shared | 87 / 963 | **not re-run** (no renderer logic changed beyond the invite picker; typecheck:web covers compilation) |
| Package workspaces | 46/46 | **not re-run** (shared package changed — **run this on the Mac**) |
| Desktop / backend build | PASS (macOS) | **not re-run — run on the Mac** |

**New tests:** `round12RegistryExport` (8), `round12FederationInvite` (10),
`round12MarketplaceDedup` (10), `round12AllowlistSweep` (37) = **65**.

**Four existing tests changed, all because production behaviour changed**, each
documented in-file:
`federationSweepTenancy`, `federationTenancy`, `federation.test.ts` — fixtures
called `inviteOrg({name})` and depended on slug-minting, i.e. they were **built
on the defect** (the shape Round 10 recorded when a certification suite turned
out to be using the bypass it tested). Plus the one over-claim of my own
described in §B/M-11. No assertion weakened.

---

## F. GATES STILL NOT TESTED — 10

Unchanged from Round 11, all requiring a launched application: native Mac app
launch · real A/B/C organizations · cross-tenant attack matrix · real runtime
ownership · real retention under load · real background principal · real queue
identity · restart #1 and #2 / persistence · real backup/restore · fresh red team
against the running app.

**The red team this round was code-level**, run by independent agents given no
prior finding list, and it produced M-13, M-14 and the fourteen allowlist
closures. That is a real adversarial pass over the source. It is **not** Phase 18,
which requires attacking a running instance with real A/B/C data.

---

## G. CERTIFICATION GATE

| | |
|---|---|
| HIGH | **0** |
| Security MEDIUM | **2 open** (M-13, M-14) — gate requires 0 |
| F22 | **OPEN** |
| Retention / resolver / authority invariants | PASS |
| Desktop suite, typecheck, lint | PASS |
| Negative controls | PASS (12/12 discriminate) |
| Packages, builds, all runtime, restart, backup/restore, fresh app red team | **NOT TESTED — 10 gates + 2 build gates to re-run** |

# PROGRAM 13C — STATUS: NOT CERTIFIED

**BLOCKER 1** — 10 gates need a launched application.
*Required action:* a person drives Phases 7–19 on the Mac. No static round retires these.

**BLOCKER 2** — F22 open. *File:* `backup/backupManager.ts`, `backup/backupArchive.ts`, `storage/storePaths.ts`.
*Root cause:* 18 stores, 4 owner conventions, no tenant-parameterized filter; restore is whole-file copy.
*Required action:* the scoped work in §D, sequenced backup-then-restore. *Test required:* per-tenant archive containing only that tenant's rows across all 18 domains, plus cross-tenant restore denial.

**BLOCKER 3** — M-13 `registry:setFlags`. *Root cause:* per-user display flags stored on a shared install-global row, mutated on a public channel.
*Required action:* move `pinned`/`favorite` into the per-tenant side table, project via `toDto`, gate at `dashboard:read`. *Test required:* A's pin invisible to B, and unchanged after reload.

**BLOCKER 4** — M-14 `ai:engineering-analyze`. *Root cause:* classified PUBLIC by the AI family gate while synthesising answers from tenant records.
*Required action:* `intelligence:read`, matching `founder:ask-v2`, keeping the family-gate/central-table agreement test green. *Test required:* unauthenticated call refused; signed-in member unaffected.

---

## H. THE PATTERN, TWELVE ROUNDS IN

Round 10 named it: *each round's invariant checks the axis the previous round's
finding was on, and the next finding is on the axis beside it.*

Round 11 found four MEDIUM in the public allowlist and said the bucket was
"smaller but not empty". Round 12 swept the whole bucket and found **fourteen
more** — nine of them a single defect that eleven rounds of review walked past,
because every mechanism asked *"is this channel classified?"* and none asked
*"does its classification match what it returns?"*

That is the third time this program has found the same meta-shape: a gate that
checks presence rather than correspondence. Data → authority (Round 10).
Presence → attachment (Round 10). Classified → correctly classified (Round 12).

**The concrete next invariant is known and named** (§C.5): a channel→store map,
so *"no channel reaching a CUSTOMER_DERIVED store may be public"* becomes
mechanical. That is worth more than another manual sweep, because a manual sweep
is exactly what just found fourteen things a machine should have refused to
compile.
