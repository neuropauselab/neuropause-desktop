# NeuroPause Desktop — RC1 Feedback Program

How the pilot collects, categorizes, and acts on feedback for Release Candidate 1.
The goal is to validate **installation, usability, reliability, governance, and
workflow quality** with real technical users, and to decide whether RC1 meets the
exit criteria for Release 1.0.

---

## Pilot cohort

Invite **10–15 technical users**, with a spread across:

- Software engineers
- AI-heavy professionals
- Startup founders
- Product managers
- Enterprise IT users

A mixed cohort surfaces different failure modes: engineers stress the runtime and
connectors, IT users stress install/update/governance, founders and PMs stress
end-to-end workflow value.

## What to collect

For each tester, across their pilot:

- **Installation success** — did it install and launch cleanly?
- **Performance** — responsiveness; anything slow.
- **Crashes** — any crash, with a support bundle.
- **Workflow friction** — where the product got in the way.
- **Missing integrations** — connectors or capabilities they expected.
- **Feature requests** — captured but not acted on during RC (see Post-Release).
- **Reliability** — did recovery/backup/update behave as expected?
- **User satisfaction** — would they keep using it; overall impression.

## How testers report

Each report should include:

1. **What you did** (steps to reproduce).
2. **What you expected.**
3. **What happened.**
4. **A support bundle** — Operations → Release → **Support bundle**. It is redacted
   by default (no tokens, API keys, emails; connector credentials are never
   included).
5. **Severity** (see rubric below).

A lightweight intake form (one row per report) is enough:

```
ID | Tester | Date | Area | Severity | Summary | Repro | Support bundle | Status
```

## Severity rubric

Categorize every issue:

| Severity | Definition | Examples | Gates 1.0? |
| --- | --- | --- | --- |
| **Critical** | Data loss, crash on launch, security/privacy exposure, or a core workflow fully blocked with no workaround | App won't start after install; backup restore corrupts data; a secret appears in a bundle | **Yes** — must be zero |
| **High** | A core workflow broken or unreliable, but with a workaround; signing/update/recovery not working as specified | Auto-update fails to apply; a primary connector can't sync; Safe Mode doesn't disable plugins | Yes — must be resolved or downgraded with justification |
| **Medium** | Noticeable friction or a non-core feature broken; does not block representative workflows | Confusing flow; a secondary panel errors; perf slow but usable | No — fix as capacity allows |
| **Low** | Cosmetic or minor; nice-to-have | Copy/labeling; spacing; small polish | No — backlog |

When in doubt, rank **up** for anything touching data, security, or launch.

## Triage cadence

- Triage incoming reports continuously; assign severity on intake.
- Critical and High get immediate investigation.
- Roll forward fixes as new RCs (`1.0.0-rc.2`, …) on the beta feed — testers
  auto-update. Do **not** add features mid-RC.

## Exit-criteria tracking

RC1 becomes Release 1.0 only when every item holds (mirror of `RC1-CHECKLIST.md`):

- [ ] **No critical defects remain.**
- [ ] **Core workflows are reliable** across the cohort.
- [ ] **Auto-update works** — at least one tester received and installed an update
  from the feed.
- [ ] **Signing and notarization verified** — Release Diagnostics reads "Signed &
  notarized" on testers' machines.
- [ ] **Recovery mechanisms validated** — Safe Mode and Restore exercised
  successfully by testers.
- [ ] **Pilot users completed representative workflows** end-to-end.
- [ ] **Documentation complete** and accurate against the shipped build.

Track these as a simple scoreboard updated as evidence arrives:

```
Criterion                         | Status      | Evidence
No critical defects               | open/met    | <issue IDs>
Core workflows reliable           | open/met    | <tester confirmations>
Auto-update works                 | open/met    | <tester + version>
Signing & notarization verified   | open/met    | <Release Diagnostics screenshot>
Recovery validated                | open/met    | <tester confirmations>
Representative workflows complete  | open/met    | <tester confirmations>
Documentation complete            | open/met    | <reviewer>
```

When all are **met**, follow `RC1-RUNBOOK.md` §10 to promote to Release 1.0.

## Post-Release

After 1.0 ships, shift to customer adoption and prioritize improvements using real
usage evidence. Defer major architectural capabilities until deployment experience
shows a clear need. Feature requests captured during the pilot feed this backlog —
they are recorded during RC, not built during it.
