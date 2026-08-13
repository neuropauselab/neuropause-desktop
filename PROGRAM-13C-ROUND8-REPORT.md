# PROGRAM 13C — ROUND 8 REPORT

**HEAD at start:** `b7eab58` (verified with `git rev-parse HEAD`, not assumed — the
Round 7 brief named `b7eab58` as the commit and `02e279f` as the head; the actual
head was `b7eab58`, with `02e279f` its parent)
**WORKTREE at start:** clean
**Branch:** `feat/understanding-holds-motion-system`

---

## VERDICT

**PROGRAM 13C IS NOT CERTIFIED. HIGH > 0.**

Round 8 delivered its primary architectural objective and closed the seven open
findings. The structural gate then found six more findings on its first run, and
the final independent red team found **twenty-one**, of which **five are HIGH**.

Per the strict stop condition — *"If the fresh red team discovers a new HIGH: FIX
IT, then rerun the fresh red team"* — this session stops here and does not
certify. The HIGH findings are documented below with file:line and exploit paths,
unfixed. Fixing them and re-running the red team is Round 9.

---

## THE SEVEN OPEN FINDINGS — ALL CLOSED

**1. `automation:history` / `automation:monitor` — CLOSED.** `AutomationRunRecord`
now carries an owner, stamped from the resolver at `add()`. Not a read filter: the
round required the persisted record to have an authoritative boundary. The monitor
aggregate is scoped in the same commit, and the ring cap became per tenant — it
was install-wide, the seventh such cap this program has found.

**2. Plugin install / enable / disable / capability grants — CLOSED.** Moved to
`cloud:operate`. The resource is one `plugins.json`, one set of enable flags, and
executable code running in-process for every tenant; `marketplace:manage` and
`org:manage` are organization roles, and anyone may create an organization and own
it. Third instance of the Round 7 class after the AI destination and rate
policies. Deliberately the SAME capability rather than a new `plugins:operate` — a
second platform permission is a second thing to forget, and the axis is what
matters.

**3. `marketplace/orgPolicyStore` — CLOSED, and the classification was the
question.** The type is called `OrgMarketplacePolicy` and the store held exactly
ONE. `requireApproval` and `blockedPublishers` are decisions an organization makes
about software its own people may install, so the name was right and the storage
was wrong. The file format is now a map keyed by tenant; a legacy single policy is
adopted by nobody, because the data contains no evidence of who set it.

**4. Infra changed-broadcasts — CLOSED, and NOT with `runOutsidePrincipal`.** That
primitive fixes a scoped aggregate computed under the wrong principal. This
payload was a list of identifiers, and no principal makes another tenant's
resource ids belong to the viewer. The ids are gone from the wire; the event now
says whose change it was. **A change notification does not have to say what
changed.**

**5. `ai/routingUsageStore` — CLOSED.** Inspected the persisted bytes: five
integers and a timestamp, genuinely install-level. Still taken off the public
channel list — a rising `total` while you are idle is another tenant working, the
same inference channel closed on `graphStore.counts`.

**6. `flags:get` — CLOSED.** The payload `planTier` is ignored; the plan resolves
through `developerStore.planFor()`, which reads the caller's own tenant. The field
stays on the schema unread, as the record that it was once trusted.

**7. `orgIntelligence` connector counts — CLOSED, and the test was the other half.**
Production called `all()`, which filters on the active workspace, under a
background principal whose workspaceId is `''` — so every count was 0 for every
tenant. **The test mocked the store as `all: () => []`, so it agreed with the bug.**
There is now a `forOrganization(workspaceIds)` query, and the suite gives A three
connectors, B seven, C zero and asserts the numbers. **A ZERO IS NOT A COUNT.**

---

## STRUCTURAL SCOPE GATE — BUILT, AND IT WORKED IMMEDIATELY

`tenancy/storeScope.ts` + `tenancy/storeScopeGate.test.ts`.

Six scopes, closed set, no `UNKNOWN`: `TENANT`, `WORKSPACE`, `USER`,
`INSTALL_GLOBAL`, `PLATFORM_GLOBAL`, `EPHEMERAL`. Every declaration must state
persistence, authority, data classification, **retention** and a reason.

Three rules are **enforced at construction**, not documented:

- `CUSTOMER_DERIVED` data cannot be `INSTALL_GLOBAL` or `PLATFORM_GLOBAL`
- `PLATFORM_GLOBAL` requires `PLATFORM_OPERATOR` authority
- an empty reason or an empty retention statement throws

**The inversion that matters:** the gate does not look for seams. It looks for
PERSISTENCE — a file that writes state and retains a collection — which is
mechanical and hard to hide. The old registry enumerated stores that opted in,
which is why Round 7 found seven stores holding cloud account ids, assistant-written
record titles and regulated recall evidence while coverage read as complete.

**Result on first run: 21 undeclared persistent stores.** All 21 are now declared.
The exemption list is **empty** — no file is claimed to be "not a store".

### What classifying them found — six findings, all fixed

| Finding | Was |
|---|---|
| `companion/deviceRegistryStore` | Rows carried `boundTenantId` since the subsystem shipped and **no read consulted it**, while the list channel was **PUBLIC** and revoke was `org:manage`. One tenant could enumerate and **unpair another tenant's phones**. |
| `ecosystem/marketplace` | No publisher field at all (`developerId` was the constant `dev-owner`), so drafts — including a tenant's AI worker name and first goal, written by `EcosystemShareWorker` — and the submission trail with actor emails were readable by every tenant. Published listings remain public, because that is what publishing means. |
| `workforce/registry` | The catalogue is genuinely install-level. `trustScore` and `health.{jobsRun,jobsFailed}` were not: they accumulated every tenant's runs onto the shared row and were served install-wide — a live meter of another tenant's job volume and failure rate. **A store can be correctly classified and still hold one field that is not.** |
| `dataPlane/mappingMemory` | Install-wide `splice` cap; one tenant's imports deleted another's remembered mappings, so the next import of that file silently guesses again. |
| `federation/governance/globalGovStore` | Install-wide `slice(0,500)` on the federated audit trail. |
| `ecosystem/marketplace` events | Install-wide event cap evicting another publisher's review history. |

**Retention caps found by this program so far: ten.** Four in this round.

---

## GATES

| Gate | Result |
|---|---|
| Desktop main tests | **641 files / 6469 tests, exit 0** (from 639 / 6444) |
| Renderer + shared tests | **87 files / 963 tests, exit 0** |
| Package workspaces (46) | **all pass** |
| Typecheck | **green** — 0 `error TS` |
| Lint | **green** — `--max-warnings 0` |
| Desktop build | **green** |
| Backend bundle (`tsup`) | **GREEN — verified on the Mac.** `npm run build` completes end to end. The Linux container's failure is an esbuild host/binary skew and was not worked around. |
| **Native Mac build** | **GREEN** — run on macOS after the commit below |
| **Native Mac RUNTIME** | **STILL NOT PERFORMED** — the app has not been launched and exercised with two organizations signed in |
| Persistent stores inventoried | **21 newly declared + 42 pre-existing declaration sites** |
| Unregistered persistent tenant-sensitive stores | **0 by the gate's detector; the red team found ~14 the detector misses — see F17/F18** |
| Unjustified global stores | **0 declared; 1 legal-but-wrong combination — see F19** |

---

## FRESH INDEPENDENT RED TEAM — 21 FINDINGS, 5 HIGH

Run without the prior finding list.

### HIGH — 5, ALL OPEN

**F1 — `marketplaceStore` mutations take bare ids with no ownership check.**
Reads are publisher-scoped (`:239`, `:258`); every write resolves the renderer's id
straight out of the Map: `addVersion` `:341`, `submit` `:367`, `review` `:396`,
`publish` `:409`, `rollback` `:424`, `install` `:441`, `rate` `:451`. Tenant B's
Admin calls `ecosystem:listing.rollback` with tenant A's published listing id and
**unpublishes A's product**, writing an event into A's trail attributed to B.
*This is my own Round 8 fix, half-applied: I scoped the reads and not the writes,
in the round whose stated lesson is that a fix beside a sibling is not a class.*

**F2 — Workforce install/uninstall is install-wide behind `workforce:manage`**
(`workforce/authzGate.ts:46-51`). One `workforce-installs.json` and one
process-wide registry; `uninstall` removes the package for every tenant. The
install store's own declaration cites the plugin analogy as justification — and
the plugin channels were moved to `cloud:operate` in this very round. Same
resource class, opposite answers.

**F5 — Every tenant's platform events are mirrored raw to the single renderer**
(`platform/subscribers.ts:186`, `platform/index.ts:165`). No filter, no principal
handling. The same rows read through `timeline:query` are hard-filtered, and that
filter's comment explains why: an event carries `actor.id`, `resource.id` and
free-form metadata. Background fan-outs publish into the same bus, so workspace
B's sync pass sends B's ids and names into A's window.

**F7 — Connector logs and lifecycle history are install-wide** while the account
listing is workspace-scoped (`connectorService.ts:127`,
`connectorRuntimeSupervisor.ts:443`). Filtered by `connectorId` only. Any member
with `connectors:read` calls `connector:logs` for `google` and receives another
workspace's `accountId`s, provider error strings and sync timings — the exact rows
`connectorStore.get()` refuses to resolve.

**F15 — One shared desktop-session singleton for every tenant**
(`sandbox/enterprise/desktopChannel.ts:38-92`). Constructed once at composition;
scenario steps reach it per tenant. While tenant A's session is open, a scenario
run by tenant B calls `screenshot` and receives **PNG bytes of tenant A's window**,
or drives clicks into it, or closes it. Cross-tenant read AND control. Same class
as the Round 7 shared browser profile, one directory over.

### MEDIUM — 12 open

F3 live-sync engine behind `cloud:manage` (a shared pointer and egress toggle);
F6 connector event/lifecycle broadcasts carrying foreign ids;
F8 `marketplaceStore.stats()` counting the drafts `list()` now hides;
F9 `eventBus.metrics()` on the public `diagnostics:get`;
F10 graph relationship-history cap (rows have **no owner field at all**);
F11 timeline in-memory window evicted globally, so `export()` disagrees with `query()`;
F12 connector log and lifecycle caps;
F13 gateway audit cap (self-documented as "NOT a fix", still live);
F17 `cloud/livesync/store.ts` — **one file holding every organization's pending
record mutations, declaring nothing**;
F18 ~14 persisting files the gate's detector misses because their state is not a
`private` field — including `ai/aiConfigStore`, `connectorVault`, `secureStore`;
F20 the executive-memory family is public including **destructive writes**
(`ExecMemoryForget`, `ExecMemoryPin`) while the same store's `MemoryForget`
requires `operations:manage`;
F21 `AiConfigMigrate` public against the `cloud:operate` resource.

### LOW — 4 open

F4 `RegistrySetFlags` public write; F14 `connectorVault.clear()` optional
workspace; F16 screenshot artifacts with no tenant path segment; F19 the gate
permits `INSTALL_GLOBAL` + `ORG_ROLE`, which is the Round 7 finding class as a
legal declaration — and `workerRegistry` uses it.

---

## THE HONEST ASSESSMENT

**The mechanism works. That is the finding of this round, and it cuts both ways.**

The gate was built first and immediately produced 21 undeclared stores and six
findings, four of them retention caps able to delete another tenant's data. No
sweep in eight rounds had found them, because every sweep looked for a boundary
that was *wrong* rather than for state nobody had classified.

And then F1 happened. I scoped `marketplaceStore`'s reads and left its seven
write paths taking bare renderer ids — **in the round whose primary lesson is that
fixing an instance beside a sibling is not fixing a class.** F2 is the same shape:
plugin channels moved to `cloud:operate` while the workforce install channels,
which the plugin declaration cites as its own precedent, were not touched.

Three structural gaps remain, and they are more useful than the individual bugs:

1. **The gate's detector requires a `private` field.** Module-level and closure
   stores are invisible to it — including the live-sync queue holding every
   organization's pending mutations. The detector needs to match state, not
   syntax.
2. **`INSTALL_GLOBAL` + `ORG_ROLE` is still legal.** The Round 7 finding class can
   be expressed as a valid declaration, and one store does.
3. **Nothing enforces the authority axis at the CHANNEL level.** F2, F3, F20 and
   F21 are all channels whose resource is shared and whose permission is not. A
   gate that cross-checks a channel's permission against its resource's declared
   scope would catch the whole family.

---

## STOP CONDITIONS — EVALUATED

| Condition | State |
|---|---|
| HIGH = 0 | **NO — 5 open.** STOP. |
| No unresolved security MEDIUM | **NO — 12 open.** STOP. |
| All seven open findings closed | YES |
| Structural scope registry enforced | YES, with the three gaps above |
| Unregistered persistent tenant-sensitive store = 0 | **NO** by the red team's stricter detector |
| Critical tests contain positive A/B/C data | YES for what this round touched |
| Native Mac verification completed | **BUILD yes; the 39-surface checklist NO** |
| Runtime multi-organization verification completed | **NO** |
| Fresh independent red team completed | YES |
| No critical finding from the fresh red team | **NO** |

**PROGRAM 13C IS NOT CERTIFIED.**

### Round 9, in order

1. F1 and F2 first — both are half-applied fixes from this round.
2. F5, F7, F15 — three subsystems where a shared thing serves every tenant.
3. Widen the gate's detector to module-level and closure state; make
   `INSTALL_GLOBAL` + `ORG_ROLE` illegal; add a channel-permission-versus-resource-scope
   cross-check.
4. Then `NATIVE-MAC-VERIFICATION.md` on the Mac, and only then a red team whose
   result decides certification.
