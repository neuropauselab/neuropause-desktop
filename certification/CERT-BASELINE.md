# CERT-2026-08-13-A — frozen certification baseline

**§0 of STARTHEREv6.** Every value below was read from a command, printed in this
document beside the command that produced it. Nothing is typed from memory.

**Every subsequent verdict references `CERT-2026-08-13-A`.** No finding may be
recorded against "the current tree".

---

## The baseline

| field | value | read by |
|---|---|---|
| **run id** | `CERT-2026-08-13-A` | assigned |
| **client commit** | `018f1f9317680dc519e3d12fd34483771f102c2a` | `git rev-parse HEAD` |
| **branch** | `feat/understanding-holds-motion-system` | `git rev-parse --abbrev-ref HEAD` |
| **working tree** | **DIRTY** — see below | `git status --porcelain` |
| **desktop version** | `1.0.0-rc.15` | `apps/desktop/package.json` |
| **backend version** | `0.1.0` | `apps/backend/package.json` |
| **schema version** | 12 migrations | `ls apps/backend/src/db/migrations/*.sql \| wc -l` |
| **IPC channels** | 769 declared | parsed from `packages/shared/src/ipc/channels.ts` |
| **authority-gated** | 186 | parsed from `RUNTIME_CHANNEL_PERMISSIONS` |
| **public allowlist** | 64 | parsed from `PUBLIC_CHANNELS` |
| **electron** | 42.8.1 | `package.json` devDependencies |
| **node** | 20 | `.nvmrc` |
| **server deployment** | **NONE** — cluster destroyed 4 Aug | DO console + Activity log |
| **api contract version** | not versioned | `[Certain]` — no version header exists |
| **OAuth configuration** | none — `/auth/providers` → `[]` | observed against a live backend |
| **policy version** | not versioned | `[Certain]` — governance policies carry no version field |
| **env** | local / development | — |

### Two fields the spec asks for and this product cannot supply

`api contract version` and `policy version` do not exist. They are recorded as
absent rather than filled with a plausible value, because a baseline whose
fields are invented is worse than one with holes in it. Both are small additions
and both belong on the E list.

### The working tree is dirty, and that is the point of §0

At the moment of freezing:

```
 M apps/desktop/src/main/config.ts              ← round19b (F-6), applied
 M certification/PROGRAM-13C-FINAL-CERTIFICATION.md  ← round19, applied
?? apps/desktop/src/main/config.test.ts         ← round19b, applied
?? certification/*.md, certification/evidence/  ← today's records
?? round12…round19b.patch, *.sh                 ← 20 stale patch files
```

**`round20b.patch` was NOT applied** — nothing in the working tree carries it.
Everything recorded against F-7 and F-8 below was verified in the analysis
container against a byte-identical copy with the patch applied, not on this tree.

That distinction is exactly what §0 exists to make impossible to lose.

---

## Artifact under test

| | |
|---|---|
| Windows installer | `aec87bd`, sha256 `693ae976fa5d07eab47d0c877e8379a735c4817be900015d1abe21b0b97a587b` |
| baked backend URL | `https://api.neuropause033.com` — **host destroyed 4 Aug** |
| update feed | `https://neuropause033.com/updates` — **apex has no A record** |
| signing | NOT CONFIGURED — PE certificate table empty |

**The shipped installer predates every fix recorded today.** It does not contain
F-6, F-7, F-8 or F-9. Any founder-facing verdict against that binary is a verdict
about `aec87bd`, not about this baseline.

---

## Test state at this baseline (with round21 applied, in the container)

| suite | result | command |
|---|---|---|
| desktop node | **770 files / 8055 tests / 0 failures** | `npx vitest run` |
| desktop UI | **13 files / 133 tests / 0 failures** | `npx vitest run --config vitest.ui.config.ts` |
| backend unit | 37 files / 418 tests | `npm test -w @neuropause/backend` |
| backend integration | 2 files / 17 tests | `TEST_DATABASE_URL=… npm run test:integration -w @neuropause/backend` |
| typecheck | 0 errors | `npm run typecheck` |
| lint | 0 | `npm run lint` |
| bench | compose 57.7 ms / 100 ms budget | `npm run bench` |
| `format:check` | **FAILS** — real Prettier drift | pre-existing, unrelated |

`round21.patch` sha256 `da139276896605996f13a360572cbc6bfb9e83843dfa168cfe125b75beb6082b`.

---

## The taxonomy ruling, recorded so it stops recurring

The certification specification defined GATE 4 as a governance decision case,
GATE 5 as refusal correctness, GATE 6 as adversarial conditions and GATE 7 as
reproducibility — while stating outright that it lacked the authoritative label
for G4. **Program 13C's gates 4–7 were already defined and keep their numbers:**

| number | Program 13C meaning — **authoritative** |
|---|---|
| Gate 4 | runtime ownership |
| Gate 5 | retention |
| Gate 6 | background principal |
| Gate 7 | queue identity |

The specification's four ideas are good and are renamed rather than renumbered:

| was | now |
|---|---|
| spec GATE 4 | **Governance decision case** |
| spec GATE 5 | **Refusal correctness** |
| spec GATE 6 | **Adversarial conditions** |
| spec GATE 7 | **Verdict reproducibility** |

Third taxonomy collision in this programme. The rule from here: **numbers belong
to Program 13C's gate matrix and to nothing else.** New concepts get names.

---

## Verdict vocabulary — adopted

`PASS` · `FAIL` · `BLOCKED` · `NOT RUN`. Nothing else. No "probably", no "looks
good", no "almost". A `BLOCKED` row must name blocker, owner, required evidence
and next action, or it is not a `BLOCKED` row.

---

## Gate matrix at this baseline

| gate | verdict | evidence |
|---|---|---|
| Backend-unreachable is legible (F-7) | **PASS (dev)** | screenshot, both directions, container |
| Fresh-install onboarding reachable (F-4) | **PASS (dev)** | screenshot + `users` row, container |
| Login offers only configured providers (F-8) | **PASS (dev)** | 7 tests + 2 negative controls |
| Primary action readable (F-9) | **PASS (dev)** | token trace + negative control |
| Dev run cannot target production (F-6) | **PASS** | 6 tests + negative control, applied on this tree |
| Native packaged launch (Windows) | **FAIL** | `aec87bd` cannot reach its API |
| Backend availability | **FAIL** | `api.neuropause033.com` destroyed 4 Aug |
| D-5 AI policy intersection law | PASS | unchanged |
| F22 tenant-domain honesty | PASS 6/19 | runtime-confirmed 13 Aug |
| Channel → store coverage | **FAIL** 1.0% | 2 of 194 declared |
| Gate 4 · runtime ownership | **NOT RUN** | needs a person; expected verdicts undeclared |
| Gate 5 · retention | **NOT RUN** | as above |
| Gate 6 · background principal | **NOT RUN** | as above |
| Gate 7 · queue identity | **NOT RUN** | as above |
| Real A/B/C tenants | **NOT RUN** | production has never held one tenant |
| Cross-tenant reads | **NOT RUN** | |
| Cross-tenant mutations | **NOT RUN** | |
| Restart persistence | **NOT RUN** | |
| Forced-termination persistence | **NOT RUN** | |
| Backup/restore (Gate 10) | **BLOCKED** | blocker: no production caller for `createTenantArchive`. owner: engineering. evidence required: a restore drill. next: wire it or descope it |
| Restore drill (B7) | **NOT RUN** | six archives verified as *archives*; never restored |
| Fresh running-app red team | **NOT RUN** | |
| `apps/backend` in scope | **BLOCKED** | blocker: scope undecided. owner: Saurabh. evidence required: a written decision. next: state it |

**PROGRAM 13C = NOT CERTIFIED.**

`(dev)` on four rows is load-bearing: every one was observed against a local
backend in a Linux container under software rendering, which is not the
configuration any founder has. They lose the label when C2 runs against a build
pointing at a working production API — not before.
