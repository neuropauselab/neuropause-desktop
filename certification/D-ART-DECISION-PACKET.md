# D-ART — ARTIFACT PROVENANCE DECISION PACKET
### For the operator to decide from · 21 Aug 2026 · drawn against HEAD `7ff0bb4` · **NOTHING DECIDED**

> # ⚠ STATUS: **PROPOSED / NOT ADOPTED** — operator ruling, 21 Aug 2026.
> This file is **UNTRACKED and non-authoritative**. `D-ART` was **not** repository vocabulary before this file
> existed (0 hits), so **this packet is not evidence that D-ART was ever authoritative** — see
> ARCHITECTURE-MAPPING §5.0, *"a governance apparatus can be conjured entirely in conversation and then cited as
> though it constrains."*
>
> **Extract only its MEASURED FACTS** — the artifact hashes, tag relationships, build-info schemas, and the
> bundling measurement. **The twenty statements, the option letters, and the dependency graph are PROPOSALS**,
> and the governance home question remains **OPEN**.

> **READ THIS FIRST — WHERE THIS VOCABULARY COMES FROM.**
> **`D-ART` appears 0 times in this repository. `PHASE 1D` / `PHASE 1E` appear 0 times.** Both were coined in
> the working prompts of 21 Aug, not in any governing document. The twenty statements were drafted by Claude in
> a governance packet and restated back in a later directive. **This file is the first time D-ART enters the
> repository at all.**
>
> That matters for two reasons. First, the operator's objection is correct on its face: *a selection made
> against an unread option is a manufactured decision*, and until now the option letters existed only in
> conversation. Second, per the standing no-vocabulary-drift rule, **introducing D-ART into the corpus is
> itself a governance act** — if the operator would rather these become F-P rows in `CONTROL-REGISTER.md`, or
> not exist at all, that is a ruling to make before anything cites them.
>
> **Nothing in this file is decided, recommended, ranked, or authorized.** No option is called best, safest,
> cheapest or preferred. Selecting one authorizes no implementation and no installation.

**Where this file sits and why.** `docs/governance/` exists but holds nine documents all dated 24 Jul that no
live document references. The register the session ritual actually reaches — `CLAUDE.md:73` → `BLOCKERS.md` →
`certification/CONTROL-REGISTER.md` — lives here. This packet is placed beside that register rather than in the
older tree. **No new directory was created.**

---

## THE THREE THINGS THE OPERATOR ASKED ME TO ESTABLISH

**1 · What "PHASE 1D / PHASE 1E" are, and where defined.**
**NOT_ESTABLISHED — they are defined nowhere.** Zero occurrences across every `.md` in the repository. They are
prompt-only phase labels, roughly meaning: *1C* = the authorized full-suite test run; *1D* = read-only artifact
and release provenance reconciliation; *1E* = a hypothetical future controlled installation. **The repository's
own vocabulary is Waves and Slices (`CLAUDE.md` §5) and NP-/F-P- identifiers.** The operator is right that this
phase vocabulary appears in no document they hold.

**2 · Is D-ART downstream of F-P39, or a parallel workstream?**
**PARALLEL, and unrecorded.** F-P39's envelope declares its scope explicitly: in scope is a production read-back
reconciler; **out of scope** are the mock-reader divergence, the body limb, F-P8, and P1 — it never mentions
artifact provenance, build-info, release manifests, installers, or installation. No register row, no
`BLOCKERS.md` entry, and no bucket ties artifact provenance to F-P39 or to the ceremony. **So D-ART competes
with Bucket 1 for the same nights.** Bucket 1 is unchanged: **P1 · F-P8 · F-P39**.

**3 · Does the installation branch contain the bundling fork?**
**NO — not for the desktop artifact, and this is measured, not assumed.**

| | | |
|---|---|---|
| Desktop **declared** dependencies | **8, none db-ish** | `companion-protocol`, `cst`, `shared`, `solution-packs`, `electron-updater`, `qrcode.react`, `recharts`, `ws` |
| Desktop **transitive** graph | **REACHES AN EMBEDDED POSTGRES** | `desktop → @neuropause/solution-packs → @neuropause/industry → @neuropause/persistence → @electric-sql/pglite` (`packages/persistence/package.json:19`; pglite **is** installed in `node_modules`) |
| pglite in the **shipped bundle** | **0 occurrences** | control `health-monitor` = 2 in the same file, so the grep is sound. Desktop imports only `industrySnapshot()` from the **runtime-free `/catalog` subpath** (`canonicalIndustryCatalog.ts:6-7,17`) — pglite tree-shakes out |
| Desktop persistence | JSON files under `userData` | `StorePersistence = 'file' \| 'keychain' \| 'memory'` (`tenancy/storeScope.ts:71`) — the type admits no database |
| Backend dependencies | **`pg`, `ioredis`** | `apps/backend/package.json:28,31` |
| `infra/compose/` | **ABSENT** | S18 roadmap-only; but `docker-compose.yml`, `.prod.yml`, `.edge.yml` **do exist at repo root** for backend/dev infra |
| CST `durable.js` | uses `node:sqlite` — **deliberately routed around** | Node-20 floor (`package.json:8`); `durableIdempotencyStore.ts:8-12` substitutes a JSON atomic-rename store |

> **CORRECTION, recorded rather than quietly fixed.** An earlier draft of this section said the desktop has
> "NO database dependencies." That is true of the **declared** list and **false of the transitive graph** — the
> dependency chain does reach an embedded Postgres. The conclusion below survives, but it rests on
> *what ships*, not on *what is declared*, and the difference matters to anyone who checks.

**The thing that would be installed — the desktop app — requires no database and no Docker today**, because the
shipped bundle contains no database engine, not because none is reachable in the dependency graph. Postgres and
Redis belong to the *backend*, a separate deployable the desktop already runs without (local-first mode, S17).
**The recorded constraint — requires-Docker is incompatible with a consumer desktop install — is therefore not
currently binding on the desktop installer.** It becomes binding the moment a v1 definition includes the backend.

**Two live tethers to preserve.** (a) `np-local-up.sh:41` fails with *"docker not found… or rule the bundling
fork"* — the fork is already referenced in a repository script. (b) The bundle measured is `out/`, built 20 Aug
and **23 commits stale**; a rebuild could pull pglite in if an import path changed. **The tree-shake result is a
property of the current bundle, not a guarantee about future ones.**

---

## THE REGISTER

**Reversibility legend.** *Yes* = a later decision changes behaviour going forward at ordinary cost.
*Expensive* = reversible, but it invalidates prior artifacts, shipped installs, or the update path.
*No* = rewrites history or cannot be undone once users exist.

### DEPENDENCY-FREE (8) — nothing upstream is waiting

| ID | STATEMENT | OPTIONS — what each commits to | WHAT BECOMES HARD TO UNDO | DEPENDS ON | REVERSIBLE? | DECIDABLE WITHOUT A v1 DEFINITION? |
|---|---|---|---|---|---|---|
| **01** | What is the canonical source of record for provenance claims? | **A** local git is authoritative — provenance is whatever this working tree says · **B** remote is authoritative — every provenance claim requires contacting GitHub · **C** both, with a stated precedence rule · **D** some other governed source | Every downstream provenance edge is keyed to this. Changing it later means re-deriving every claim already made. B makes network access a prerequisite of assurance. | — (root) | **Expensive** | **YES** — this is about repositories, not about what ships |
| **02** | Which of the four machine-readable identities is canonical? | **A** `NeuroPause` (bundle/builder) · **B** `NeuroPause OS` (release manifest) · **C** `@neuropause/desktop` (package) · **D** `com.neuropause.desktop` (OS id) · **E** one canonical + governed aliases | **userData currently resolves to `@neuropause/desktop`.** Choosing anything else eventually means migrating every installed user's profile directory, or accepting a permanent mismatch between brand and storage. | — (root) | **Expensive → No once users exist** | **NO** — identity depends on what v1 actually ships (desktop only, or desktop + backend + cloud) |
| **09** | What test evidence must a governed release carry? | **A** manifest `testSummary` (the mechanism that already exists, historical) · **B** a durable runner artifact bound to a commit · **C** both · **D** none · **E** other governed mechanism | B requires a reporter/`outputFile` configuration change — an implementation, not a policy. A alone repeats the current situation where the summary is written by hand at release time. | — (root) | **Yes** | **PARTIAL** — "governed release" is undefined until v1 says what a release is |
| **10** | Is an SBOM required? | **A** no · **B** per release · **C** per artifact · **D** other | B/C add a generation step to every release and a retention obligation. Adding it later leaves historical releases permanently without one. | — (root) | **Yes** (additive) | **NO** — SBOM demand is set by the buyer; consumer and enterprise answer differently |
| **11** | Is artifact attestation required? | **A** none · **B** in-toto / SLSA-compatible · **C** internal signed attestation · **D** other | B commits to a supply-chain toolchain and its key management. C commits to custody of an internal key. | — (root) | **Yes** (additive) | **NO** — same dependency as 10 |
| **12** | Should releases be signed? | **A** remain unsigned development artifacts · **B** sign governed releases · **C** other | B commits to certificates (**recurring cost**), key custody, rotation, and CI secret handling. A means Gatekeeper and SmartScreen warn every user, forever. Manifest currently records `signingStatus: NOT CONFIGURED`. | — (root) | **Expensive** — once shipped signed, unsigning breaks update trust | **NO** — depends on v1's distribution channel and OS targets |
| **13** | What is the disposition of rc.15's version↔tag conflict? | **A** leave the conflict visible · **B** annotate it in place · **C** other explicit disposition | Bytes are hash-verified; the commit and branch are corroborated; only the **version label** conflicts (tag `8522dca` is 134 commits behind build commit `aec87bd`). Retagging would rewrite history and destroy the evidence of how it happened. | — (independent) | **A/B yes · retag = No** | **YES** — a historical record question, independent of v1 |
| **14** | What is the disposition of installed rc.1? | **A** leave uncorroborated · **B** retro-tag `e5c10e6` · **C** declare unsupported · **D** other | rc.1 is installed, its commit is ancestral, but no `v1.0.0-rc.1` tag or manifest exists. B invents a release record after the fact for a build nobody can reproduce. **UNCORROBORATED is not WRONG.** | — (independent) | **A/C yes · retro-tag = No** | **YES** — historical record question |

> **Of the eight, only three are genuinely decidable today: 01, 13, 14.** One (09) is partial. **Four — 02, 10,
> 11, 12 — are gated on a v1 definition**: they turn on what ships and who buys it, not on anything measurable in
> the repository. Listing them as "ready" would have been misleading.

### DEPENDENCY-BLOCKED (12) — a required upstream decision is still OPEN

| ID | STATEMENT | OPTIONS — what each commits to | WHAT BECOMES HARD TO UNDO | DEPENDS ON | REVERSIBLE? |
|---|---|---|---|---|---|
| **03** | What is the canonical release identity? | **A** `NeuroPause OS` (what the manifest says today) · **B** `NeuroPause` · **C** a release identity separate from product identity · **D** other | Sets manifest content, artifact naming, and how an installed product is later reconciled to a release. | **02** | **Yes** (forward-only; past artifacts keep their labels) |
| **04** | What source reference must every governed release carry? | **A** full commit SHA · **B** full SHA + release tag · **C** full SHA + tag + tree hash · **D** other | Only C approaches reproducibility — **and a tree hash alone does not establish it.** Anything less leaves bytes↔commit permanently uncorroborated. | **01** | **Yes** forward · **No** for past releases |
| **05** | What must a build provenance record contain? | **A** current mechanism (`build-info.json`) · **B** commit + environment + build command · **C** full durable record (source ref, tree state, build id, environment, toolchain, command, config, dependency state, timestamp, artifact relationship) · **D** other | `build-info.json` is **gitignored and untracked**, so no historical build claim is auditable. A accepts that permanently. C commits to a build-pipeline change. | **04** | **Yes** forward · **No** retrospectively |
| **06** | Which artifacts require manifests? | **A** release/windows surface only · **B** all release artifacts · **C** all distributable artifacts · **D** all generated artifacts · **E** other | B–D add a generation and retention obligation to every build; the `dist/` surface currently has none. | **05, 03** | **Yes** |
| **07** | What artifact hash standard is governed? | **A** retain dual (SHA-256 sidecars + SHA-512 in `beta.yml`) · **B** standardize SHA-256 · **C** another algorithm · **D** multiple under explicit governance | **electron-updater's feed depends on SHA-512.** Changing it touches the auto-update path for already-installed clients. | **06** | **Expensive** (update path) |
| **08** | Where must authoritative release artifacts live? | **A** working directory / ephemeral · **B** Git LFS · **C** external artifact store · **D** artifact registry · **E** external store + durable manifest pointer · **F** other | Installer bytes are **gitignored**; manifests are tracked but the bytes they describe are not. A accepts that a released artifact is unrecoverable from history. B–E commit to storage **cost** and operational upkeep. | **07** | **Expensive** — bytes already lost stay lost |
| **15** | What artifact continuity rule is required, and which edges must be OBSERVED / CORROBORATED / VERIFIED / ESTABLISHED? | Governance defines the required chain: SOURCE → BUILD → ARTIFACT → MANIFEST → HASH → RELEASE → INSTALLER → INSTALLATION → INSTANCE | This is the convergence point: **five inbound edges, and everything from 16 to 20 sits behind it.** The whole installation branch is gated on this single node. | **08, 09, 10, 11, 12** | **Yes** (policy) |
| **16** | What evidence is mandatory before installation eligibility may be declared? | Candidate 18-field minimum carried forward (path, type, SHA-256, version, product identity, release identity, source ref, manifest/hash agreement, target, authority, rollback, pre-install snapshot, artifact identity, build identity, manifest ref/hash, previous artifact identity, authority ref, installation record) — **this list is not approved** | Sets the bar for every future install. Too low and installs proceed on unproven bytes; too high and no artifact ever qualifies. | **15** | **Yes** (policy) |
| **17** | Who may authorize installation? | **A** Founder · **B** Founder + designated technical authority · **C** a governance gate · **D** single-use authority · **E** standing authority | **E creates a durable capability that later installs inherit.** Developer access is not authority; a Claude/Coworker instruction is not authority. | **16** | **Yes** (policy) — but each *granted* authorization is one-way once used |
| **18** | What rollback standard is required? | **A** none · **B** preserve previous bundle · **C** snapshot + restore procedure · **D** full rollback verification · **E** other | rc.1 is currently installed. Under A, installing over it destroys the only artifact whose lineage is at least ancestral. | **17** | **Yes** |
| **19** | What must an installed product expose or retain? | **A** current identity/version only · **B** + release identity · **C** + artifact hash · **D** release + artifact hash · **E** other | B–D require a build change, so the **already-installed base can never gain it** — only future builds. | **18** | **Expensive** (installed base keeps the old shape) |
| **20** | What post-install oracle must reconcile installed ↔ source? | Governance names the dimensions it must reconcile: installed bundle identity · version · artifact hash · release reference · source reference · build reference · manifest reference | Without it, an installed product can never be tied back to a commit. With it, every install becomes verifiable evidence. | **19** | **Yes** (additive) |

---

## DEPENDENCY GRAPH (as supplied)

```
SPINE      01 → 04 → 05 → 06 → 07 → 08 → 15 → 16 → 17 → 18 → 19 → 20
IDENTITY   02 → 03 → 06
TEST       09 → 15
SUPPLY     10, 11, 12 → 15
HISTORICAL 13, 14  (independent)
```

**D-ART-15 is the convergence point.** Eight roots feed it directly or through the spine; twelve nodes sit
behind it. **A downstream item may be selected while its dependency is OPEN, but must then be marked
`DEPENDENCY_OPEN` and must not be implemented.**

## STATE

All twenty: **OPEN**. Selected: **0**. Implementation-authorized: **0**. Implemented: **0**. Verified: **0**.

**A selection moves an item `OPEN → DECIDED_PENDING_IMPLEMENTATION_AUTHORITY` and nothing further.** It does not
authorize implementation, and it never authorizes installation — including `D-ART-17`, which establishes *who
may authorize*, never *install now*.

**INSTALLATION ELIGIBILITY: NOT_ESTABLISHED · INSTALLATION AUTHORITY: ABSENT · INSTALLATION: BLOCKED (0 of 10
gate conditions satisfied).**

**Bucket 1 unchanged: P1 · F-P8 · F-P39.** F-P39's revised envelope and its seven acceptance criteria stand.
Latch INTACT. External effects 0.
