# Enterprise Digital Twin Platform (Phase 6 · Stage 13)

The enterprise-layer COMPOSITION over the digital twins, runtime surfaces and
recorded evidence the repository already has, implemented as one additive
subsystem (`apps/desktop/src/main/digitalTwinPlatform/`) that owns **no engine,
no store, no scheduler, no executor, no simulator, and no mutation surface**.
P15's Enterprise Digital Twin, the Execute Engine, the Runtime Supervisor, the
health history, the decision store, the Stage 6–12 platforms and the
manufacturing twin **stay authoritative and untouched** — Stage 13 composes
their outputs, computed per read (3 s TTL), stored nowhere.

**Structural honesty, stated up front:** this platform is
NOT a twin engine. There is no second twin model, no simulation runtime, no
physics, no state store, and no health computation anywhere in it. It
composes, never computes. P15 remains the authoritative twin: Stage 13 reads
`twin:*` and publishes beside it as `etwin:*`, adding no domain, no entity and
no band of its own. A failing read becomes an explicit unavailable entry with
its reason, never a fabricated value — `null` is never rendered as zero, and
an unreadable subject is never assumed steady.

## Relationship to the existing twin estate (composition, not duplication)

- **P15 Enterprise Digital Twin** (`twin/twinService.ts`,
  `TwinService.overview`): remains the authoritative twin. Its summary and its
  nine-domain projection are composed VERBATIM — Stage 13 recomputes no twin
  health, no band and no entity count. The existing `twin:*` channels are
  untouched.
- **Manufacturing Digital Twin**
  (`packages/shared/src/types/manufacturingDigitalTwin.ts`,
  `TWIN_SCENARIO_TYPES`): the second shipped twin. Its fifteen scenario types
  are typed and authored but have **no main-process importer**, so Stage 13
  registers the capability as declared rather than running, and says so.
- **Execute Engine** (`executeEngine.ts`) and **Runtime Supervisor**
  (`runtimeSupervisor.ts`): the execution and runtime surfaces P15 has no
  domain for. Their sessions, kinds, statistics, policies and recovery records
  are composed verbatim. Stage 13 can neither start, cancel, nor re-policy
  anything.
- **Health History Store** (`enterprise/healthHistoryStore.ts`) and
  **Executive Decision Store** (`enterprise/decisionStore.ts`): the two
  observation surfaces. Stage 13 reads their FOOTPRINT (counts) — never the
  records themselves.
- **Stage 6–12 platforms** (`insight/`, `knowledgeAssets/`,
  `automationPlatform/`, `operationsPlatform/`, `strategyPlatform/`,
  `enterpriseFederation/`, `analyticsPlatform/`): each publishes a narrow
  pre-composed slice, and Stage 13 consumes exactly that slice. **No dashboard
  logic is duplicated** — Stage 13 never reaches behind a platform to
  re-derive what that platform already decided.
- **Stage 12 analytics** (`analyticsPlatform/trendAnalytics.ts`): owns delta
  computation. Every trend in the twin's history view is Stage 12's, composed
  verbatim.
- Stage 13 uses the DISTINCT **`etwin:*`** namespace and rides P15's OWN
  existing **`twin:read`** scope — the `eana:*`-beside-`intelligence:read`
  precedent. **No new permission is minted.** The renderer adds ONE **Platform**
  tab inside the EXISTING Twin Center — one entry appended to that Center's own
  tab strip, no new Center and no app-level navigation change (FINDING #8).

## The registry (typed data — every reference is REAL, locked by test)

`twinRegistryIssues()` + this document lock the registries
(`twinRegistry.stage13.test.ts`). Forty-six ids across five registries.

**Surfaces** (six): `p15-enterprise-twin` (`enterprise-twin`),
`manufacturing-twin` (`manufacturing-twin`), `execute-engine`
(`execution-surface`), `runtime-supervisor` (`runtime-surface`),
`health-history` and `decision-store` (`observation-surface`). Every entry
names the module it is projected from.

**Platforms** (the seven Phase 6 stages built after P15): `s6-insight`,
`s7-knowledge`, `s8-automation`, `s9-operations`, `s10-strategy`,
`s11-federation`, `s12-analytics`.

**Series** (honestly kind-tagged): `org-health-history` and
`engineering-health-history` (`daily-history` — the recorded daily series),
`decision-window-deltas` (`decision-window` — Stage 10's measured windows);
and `twin-domain-entities`, `twin-overall-health`, `execution-sessions`,
`supervisor-recoveries` (`point-in-time` — composed per pass and **declared
untrendable**, because no recorded series exists for them). Only the first
three are trendable, and only Stage 12 computes their deltas.

**Simulation capability** (registered, never invoked):
`p14-scenario-projection` (`scenario-projection`), `manufacturing-what-if`
(`deterministic-what-if`, fifteen authored scenarios),
`insight-heuristics` (`deterministic-heuristic`, the seven Stage 6 kinds),
`s12-forecast-inventory` (`capability-register`). Stage 13 invokes nothing —
`invoked` is false on every entry by construction, not by policy.

**State coverage** (twenty-two enterprise states, split nine / ten / three):

- `modelled-by-twin` (nine, one per P15 domain): `enterprise-posture`,
  `organization`, `infrastructure`, `workforce`, `application`, `connectors`,
  `marketplace`, `federation`, `strategy`. Each cites the P15 domain builder
  and its line.
- `modelled-elsewhere` (ten): `runtime-execution`, `commercial-financial`,
  `customer-crm`, `manufacturing-operations`, `supply-chain`,
  `governance-compliance`, `security-audit`, `knowledge`, `automation`,
  `analytics-kpi`. Each names the owning module outside the twin.
- `not-modelled` (three): `physical-sensor-telemetry`,
  `physical-facility-geography`, `energy-environmental`. Each cites the
  repository SEARCH that proved the absence and that search's stated result,
  plus what closing the gap would require. **No gap is asserted without
  evidence and no coverage is claimed without a named owning module.**

## The computed views (all pure; all per read; failures declared)

- **Runtime twin** (`runtimeTwin.ts`): the Execute Engine and Runtime
  Supervisor composed as one view — registered kinds, active and recent
  sessions (bounded to twelve rows each), the per-kind rollup, engine
  statistics verbatim, and one row per supervised subsystem. **The
  partial-engine rule:** if ANY of the four engine reads fails, the execution
  slice is `null` — an engine that half-answered is reported unreadable, never
  half-composed.
- **Platform twins** (`platformTwins.ts`): P15's domain rows verbatim, plus one
  row per Stage 6–12 platform built from that platform's own published slice.
  `attention` means the platform reported something outstanding, not that
  Stage 13 assessed it; a platform that could not be read is `unknown` and is
  never assumed steady.
- **State coverage map** (`stateCoverage.ts`): the registry joined to what is
  observable this pass. Coverage is a statement about the repository, not a
  score. A null `live` reading means nothing is observable for that row.
- **Simulation inventory** (`simulationInventory.ts`): a REGISTER of existing
  simulation capability. This module counts; it does not simulate.
- **History view** (`twinHistory.ts`): Stage 12's recorded deltas, composed
  verbatim, filtered to the two recorded kinds. Stage 13 computes no trend and
  applies no smoothing, extrapolation or prediction. A missing input is
  reported as unavailable, never as stability.
- **Twin dashboard + report** (`twinDashboard.ts`): the five views above plus
  P15's summary as ONE input, and a seven-section executive report. Its
  recommendations are Principle-C complete (the Stage 9 throwing guard) and
  point ONLY at existing governed surfaces — nothing executes from the twin,
  ever. Five rules, all named: `etwinrec:platform:attention`,
  `etwinrec:platform:unknown`, `etwinrec:runtime:failed`,
  `etwinrec:runtime:supervisor`, `etwinrec:twin:band`.

## IPC (read-only; fail-closed; zero mutation)

Seven channels, each `requireAuth` + RBAC **`twin:read`** (P15's own existing
scope), each a pure read of the 3 s-TTL composition:
`etwin:runtime`, `etwin:platforms`, `etwin:coverage`, `etwin:simulation`,
`etwin:history`, `etwin:dashboard`, `etwin:report`. There is no `etwin:*` write
channel and never will be. The subsystem lock (`index.stage13.test.ts`) proves
every handler carries `requireAuth` and the permission, and that the channel set
is exactly these seven. The runtime completeness lock (`runtimeAuthz.test.ts`)
covers the `etwin:` namespace, and `runtimeCore.ts` binds the seven handlers —
both landed late, and why they were once recorded as unwritable is FINDING #9.

**FINDING #5, resolved — and the deviation stated:** the audit tabulated SIX
channels (§5.3). Seven ship. For a period the sixth-and-final channel was
`etwin:dashboard` and `report()` was reachable only from the subsystem object
and the assistant, which meant the renderer tab had no way to fetch its own
report — unlike the Stage 12 precedent, where `EanaPlatformTab.tsx` fetches
`eana:report` over IPC. The audit had itself given `etwin:dashboard` the cell
"Composed dashboard + report", a shape it could not have: `EtwinDashboard` and
`EtwinReport` are separate types. Of the two ways to close that, one channel
returning a composite payload would have been unique in the entire channel
table; a report channel is what `estrat:`, `efed:` and `eana:` already publish.
So `etwin:report` was minted with its consumer, not before it. The count
moved from six to seven; the namespace, the scope, the empty request shape and
the zero-mutation guarantee did not move at all. The gap was asserted
explicitly while it was open, which is why the seventh channel arrived as a
deliberate act rather than as drift.

**FINDING #9, resolved — and its premise was false.** The three lines are
written. `runtimeCore.ts` constructs the subsystem, pushes its seven
`SecureHandlerDef`s onto `defs`, assigns `twinRef`, and passes
`twinAnswer:` into `initAssistant`; `runtimeAuthz.test.ts` carries the `etwin:`
row in `SELF_GATED_PREFIXES`. What this finding has to record is not the fix but
the reason it was ever filed, because the reason was wrong and it was wrong in a
way that would recur.

This finding used to state that the registration call, the assistant supply and
the completeness row could not be written because **neither file is in this
checkout** (task #1429). Both files existed, and always had. The workspace this
stage was authored in held a partial copy of the repository, and the staged
snapshot consulted to check what the wider tree contained was itself stale — it
predated the Stage 6–12 wiring by enough that `runtimeCore.ts` was 94,332 bytes
against the real 130,732. Every conclusion drawn from that snapshot inherited
the staleness. The claim "`initAssistant` has no caller anywhere here" was true
of the copy and false of the repository, where the composition root calls it with
eight stage ports already supplied. So was the sentence that generalized it:
that a tree-wide search for `analyticsAnswer`, `federationAnswer` and
`strategyAnswer` returns their declarations and nothing else. It returns their
call sites too. Stage 12 was not unwired; nothing was.

The correction matters beyond bookkeeping, because the false premise made a
second, larger claim look safe. If Stages 6–12 had really been unwired, then
Stage 13 shipping unwired would have been the established pattern and wiring it
alone would have been the deviation. The opposite was true: every sibling stage
was wired at its own composition root, and Stage 13's absence was a Stage 13 gap
and nothing more general. A finding that misidentifies which of two states is
the norm can license exactly the wrong repair, and this one nearly did.

What was real in the original finding stays real: the seven handlers each carry
`requireAuth: true` and `permission: 'twin:read'`, and
`index.stage13.test.ts` proves that for all seven. What was real about the
consequence also stays real, and is now unreachable rather than merely
documented — before the supply landed, a twin question reached the Stage 13
branch, found `deps.twin` unwired, and came back as
`unavailable: { system: 'twin', reason: 'twin platform port not wired' }`. That
refusal is why every port on that interface is optional rather than required: an
unsupplied subsystem has to read as unsupplied. `assistantTwin.stage13.test.ts`
still locks it, because a port that is wired today can be unwired by a future
edit and the failure must stay honest when it is.

The methodological lesson is the transferable part. The gap was found by asking
who CALLS `initAssistant` rather than by reading what the port declares —
`assistant/index.ts` declares `twinAnswer?`, `assistantService.ts` dispatches on
it, and `assistantTwin.stage13.test.ts` locks the path between them, so every
artefact in view looked wired while nothing supplied the function. That method
was right. It was applied to the wrong tree. Checking call sites is only as good
as the checkout the call sites are searched in, and this finding is the record of
what it costs to skip that second check.

The capability registry now records this stage as `production-complete`, and the
Platform tab renders composed panels rather than the absent-panel degradation the
honesty rules were holding open for it.

## Assistant (D-8) + monitoring

Ten twin questions ride the EXISTING `'intelligence'` structured-report kind
through one in-process port (`answerQuestion`, the ninth): `twin-status`,
`runtime-twin`, `execution-twin`, `platform-twins`, `state-coverage`,
`what-is-not-modelled`, `simulation-capability`, `twin-history`, `twin-drift`,
`twin-report`. NINE-WAY resolver disjointness (S5 brief/work-summary + S6 + S7
+ S8 + S9 + S10 + S11 + S12 + S13) is test-locked in both directions
(`twinPlatformModel.stage13.test.ts`). The service half is locked separately in
`assistantTwin.stage13.test.ts` — dispatch, isolation of the eight earlier
ports, the honesty contract, and branch ORDER. The two files divide because
neither can see the other's failure: a resolver test cannot see which branch
answers first, and a service test cannot see a widening that branch order never
reaches. That division was measured with four negative controls rather than
assumed, and one of them falsified the first draft of the claim; the surviving
version, including what the service lock does NOT cover, is recorded in that
file's header.

**The port is declared on both ends and supplied by `runtimeCore.ts`**, so a
twin question is answered. It was not always: the explicit unavailable described
in FINDING #9 is what an unsupplied port returns, and
`assistantTwin.stage13.test.ts` still locks that refusal as behaviour, because
the wiring can be removed by a later edit and the failure has to stay honest when
it is.

**FINDING #10 — the audit's port name is not the one that shipped, and the
convention won.** §5.5 names the assistant dependency `twinPlatformAnswer`. It
ships as **`twinAnswer`**, because all seven existing ports are `<domain>Answer`
— `intelligenceAnswer`, `knowledgeAnswer`, `automationAnswer`,
`operationsAnswer`, `strategyAnswer`, `federationAnswer`, `analyticsAnswer` —
and their service-side counterparts are the bare domain, where Stage 13's is
`twin`. The audit's name would have made the ninth port the only one spelled
unlike its eight siblings, for no gain: both names were free — no `twin`-prefixed
field exists on `AssistantSubsystemDeps` or `AssistantServiceDeps`, checked field
by field — and the collision a longer name would guard against, P15's own twin,
has no assistant port at all. This is the same reasoning that leaves
`resolveTwinQuestion` without the `Etwin` prefix every SHARED Stage 13 type
carries: the prefix keeps the shared type surface clear of P15's `Twin*`, and
neither of these is shared. The deviation is a NAME only — signature,
optionality, forwarding and the ten keys are all the audit's — and it is recorded
here rather than settled quietly, because the supplying line has since been
written against the shipped name (`runtimeCore.ts` supplies `twinAnswer`), and a
reader who returns to §5.5 for the port name will find one the repository does
not have. The audit is the stale side, not the code.

ONE delivery source — **`twin-watch`** (daily, 09:45) — emits governed
recommendation ITEMS (critical and high recommendations only) into the
EXISTING delivery engine with evidence, reasoning and confidence, deduped so a
standing condition is delivered once rather than every cadence; deep-links land
in the existing twin workspace. Items only — the watch never acts, and it never
invents an action: each item repeats its recommendation's own suggestion.

## Renderer

The EXISTING Twin Center gains one tab: **Platform**
(`renderer/src/digitalTwinPlatform/EtwinPlatformTab.tsx` over the pure, tested
view-model in `renderer/src/digitalTwinPlatform/etwinPlatformModel.ts`), whose
test lives at `twinCenter/etwinPlatformModel.stage13.test.ts`. The tab renders
the composed views verbatim — attribution, coverage gaps, the search evidence
behind every not-modelled row, disclosures, and unavailability always visible.
Nothing in the tab mutates anything. The seven existing tabs are untouched —
same ids, labels, icons and order — and the Center's tab strip gains exactly one
appended entry, `{ id: 'platform', label: 'Platform', icon: 'server' }`, after
**Command Center**. `server` rather than `grid` because **Twins** already holds
`grid` in that strip, and both siblings that appended a platform tab chose an
icon unused in theirs (S10 `globe`, S11 `checklist`). There is no new Center, no
app-level navigation change, and no vitest config change.

**FINDING #7 — the audit's §5.6 renderer path is incorrect; the repository was
followed instead.** §5.6 places the tab at
`renderer/src/twinCenter/EtwinPlatformTab.tsx`, and this document said so for a
period, on the stated reasoning that `twinCenter/**/*.test.ts` is already inside
the existing vitest glob and a `digitalTwinPlatform/` renderer directory would
need a config change. Listing the renderer tree disproves that reasoning. Every
one of the four sibling stages splits the two: the tab and the view-model live
in a **stage-named platform directory**, while only the **test** lives in the
Center directory — `operationsPlatform/eopsPlatformModel.ts` with
`operationsCenter/eopsPlatformModel.stage9.test.ts`,
`strategyPlatform/EstratPlatformTab.tsx` with
`strategyCenter/estratPlatformModel.stage10.test.ts`,
`enterpriseFederation/EfedPlatformTab.tsx` with
`federationCenter/efedPlatformModel.stage11.test.ts`,
`enterpriseAnalytics/EanaPlatformTab.tsx` with
`insightCenter/eanaPlatformModel.stage12.test.ts`. What keeps a stage inside the
existing glob is therefore **test** placement, not source placement, so no
config change is needed either way and §5.6's reason does not hold. Three of the
four platform directories mirror their main-process directory name, which makes
`renderer/src/digitalTwinPlatform/` — mirroring `main/digitalTwinPlatform/` —
the conventional name here. A second, independent reason the old text was wrong:
it named `twinCenter/twinCenterModel.ts` as the view-model's home, and that file
is **P15's own** presentation model. Adding Stage 13 logic to it would have
modified P15 in violation of D-1. The correction is recorded rather than quietly
applied, because the error was mine: the audit was trusted over the repository,
and the repository was right.

**FINDING #8 — this document twice said "no navigation change" about a change
that does add a navigation entry.** Wiring the tab appends
`{ id: 'platform', label: 'Platform', icon: 'server' }` to the `tabs` array in
`twinCenter/TwinCenterView.tsx`. That is a navigation entry under any plain
reading, and the two sentences above — in **Design decisions** and in
**Renderer** — denied one. The phrase was inherited from the sibling stages,
where it carries a narrower meaning: Stage 12's shipped
`insightCenter/InsightCenterHost.tsx` constructs a two-entry `TABS` array and
renders it inside a `<nav>` element, and its header comment still reads "No new
Center, no navigation changes — one tab inside the existing workspace". So in
this codebase the phrase has meant *app-level* navigation — whether a new Center
appears in the shell — and a tab added inside a Center has never counted against
it. Stage 13's claim was therefore true under the convention and false under the
reading a person checking the diff would actually apply. Relying on a convention
a reader has to reverse-engineer from a sibling stage is not a defence, so both
sentences now state the change directly instead: one appended entry, the seven
existing entries unchanged in id, label, icon and order, no new Center, no
vitest config change. Checking that convention also surfaced a smaller defect
worth naming, since it was caught by the same look rather than by the
typechecker: the entry first used `icon: 'grid'`, which **Twins** already holds
in the same strip, while each sibling that appended a platform tab had chosen an
icon unused in its own — the entry now uses `server`. Neither correction is
applied quietly, because in both cases the prose was checked against the
repository only after it had been written.

**Stated limitation — no icon name on this tab is gated by a typechecker.**
`components/ui/Icon.tsx` is outside the Stage 13 checkout, so
`import type { IconName } from '@renderer/components/ui/Icon'` does not resolve
and `IconName` degrades to `any`: the narrow typecheck cannot tell `server` from
a misspelling, and reporting it as "clean" would overstate what it checked. In
the repository proper the annotation resolves and every literal is checked at
build. What makes `server` safe to write meanwhile is the standard the
registries are already held to — a citation rather than an assertion. P15's own
`twinCenter/twinCenterModel.ts` annotates
`DOMAIN_ICON` as `Record<TwinDomainId, IconName>` with `infrastructure:` set to
`'server'`, and `REPLAY_ICON` likewise for `deployment:`, in the very Center this
tab joins. Every other icon on the Platform tab was taken from a shipped file the
same way rather than invented.

## Performance (test-enforced budgets)

Measured over a realistic seeded fixture after a warmup pass
(`twinBench.stage13.test.ts`), with the injected clock advanced past the TTL
between measurements so every figure is a genuine cold compose: runtime /
platform / coverage / simulation / history component builds ≤ 100 ms each; the
full dashboard ≤ 500 ms; the twin report ≤ 500 ms; a warm read (inside the 3 s
TTL) ≤ 20 ms. All seven surfaces ride ONE composed pass — that is asserted by
counting reads, not inferred from timing.

No number above is written down anywhere as a literal result: the four budgets
are the Stage 8–12 budgets carried forward unchanged, and every figure the bench
reports is measured at run time and interpolated into its own assertion message.

**FINDING #11 — a budget assertion is a wall-clock comparison, so these three
tests are the only nondeterministic ones in the stage, and the sibling precedent
has already been observed failing.** Fixtures, clock and ordering are fully
deterministic here; the VERDICT is not, because `≤ 100 ms` is a comparison
against elapsed real time on a loaded machine. This is not hypothetical and is
not being reported as a risk: `knowledgeAssets/knowledgeBench.test.ts` (Stage 7,
the same pattern) has failed **three times on its own ≤ 100 ms budget — once at a
measured 124.19 ms** — while passing three of three runs in isolation.

That count is written the way it is because the obvious way to write it was wrong
twice. Stated as a ratio it went stale on its own: it read two-in-five, then
three-in-eight, then three-in-ten, because the denominator advances every time
anyone runs the suite and I kept running the suite. So the durable figure is the
NUMERATOR — a failure observed is permanent, a pass only ever adds to the pile —
and the reader is owed the shape of the denominator rather than a snapshot of it:
**at the time of writing the tally stood at three in ten, the failure count has
not moved since the eighth run, and every run after that one has passed.** A
later author who sees this bench fail again should raise the numerator and say
so. A later author who sees it pass a hundred times has learned nothing that
contradicts this paragraph, which is the point — a flake is not disproved by
passing.

Stage 13's own bench passed all ten, and its headroom is why: forcing the budgets
to zero to make the harness print what it actually measures gives a 1.3 ms
runtime-twin build against 100 ms and a 0.3 ms dashboard build against 500 ms.
Stage 13 therefore has roughly two orders of magnitude of margin where Stage 7
has none.

That margin is a reason this stage does not flake TODAY. It is not determinism,
and it is not recorded as determinism. The budgets are deliberately left at the
S8–S12 values: raising them to buy safety would be writing down a number no
measurement supports, and Stage 7's test is an earlier stage's and is not
weakened from here. What the finding fixes is the claim — `twinBench.stage13.test.ts`
used to head itself "Deterministic", which was true of everything it controls and
false of the thing it asserts.
