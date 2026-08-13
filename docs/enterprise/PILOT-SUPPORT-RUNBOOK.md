# NeuroPause — Pilot Support Runbook

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilot support owners, IT, NeuroPause pilot leads
>
> How support works during a NeuroPause pilot. Grounded in the diagnostics the product actually ships. **No support SLA is stated** — response targets are an operator/commercial decision, not a product-enforced value.

## 1. Support model (pilot)

A pilot is supported by a named **pilot support owner** on the customer side and a **NeuroPause pilot lead**. Issues are logged with a consistent classification and triaged by severity. This runbook standardizes what to collect, how to classify, and where to escalate — so an issue can be understood without the engineer sitting next to the user.

## 2. Issue classification

Use one label per issue (the same set the program uses):

| Label | Meaning |
|---|---|
| **BUG** | Implemented behaviour is wrong |
| **MISSING** | A reasonable capability isn't implemented |
| **BACKEND DEP** | Fails because the backend is unreachable/misconfigured |
| **EXTERNAL DEP** | Needs a provider you configure (AI, OAuth, Qdrant, billing) |
| **CONFIG** | Environment/setup issue |
| **KNOWN LIMITATION** | Documented, accepted for the pilot |
| **USABILITY** | Works, but confusing |

## 3. Severity

| Sev | Definition | Examples |
|---|---|---|
| **S1** | Pilot blocked; no workaround | Cannot sign in at all; data loss on normal restart |
| **S2** | Major workflow broken; workaround exists | One ERP family won't save; a governed action won't run |
| **S3** | Minor/limited impact | A Preview surface is empty; a label is confusing |
| **S4** | Cosmetic / enhancement | Spacing, wording, feature request |

## 4. Diagnostics to collect (what the product actually provides)

NeuroPause ships real diagnostic tooling — collect these before escalating:

- **Support bundle** — the desktop generates a **redacted** support bundle (`SupportGenerateBundle`); it reveals in the file manager on generation. It includes the rotating application log (`logs/app.log`), `crashes.log`, and `audit.log` (all rotation-bounded).
- **Crash export** — `CrashExport` archives crashes.
- **Diagnostics report** — `diagnostics:get` (Release Diagnostics surfaces the current build's changelog section via build-info).
- **System health snapshot** — `neurocore:systemHealth`.
- **Backend request id** — every backend error response carries a `requestId` (and **never** contains secrets). Always capture it for backend-side issues.
- **Backend logs** — pino JSON with redaction; tail by `x-request-id`.

See the operator [Operations Guide](../guides/OPERATIONS-GUIDE.md) for the incident flow (detect → triage → contain → collect → recover) and [Troubleshooting](../support/TROUBLESHOOTING.md) for user-facing symptoms.

## 5. First-response checklist

1. Reproduce; capture exact steps, expected vs actual.
2. Note environment: build (`1.0.0-rc.15`), OS, whether the backend is reachable (`GET /health`), which providers are configured.
3. Generate a support bundle; capture the `requestId` for any backend error.
4. Classify (label + severity).
5. Check [Known issues](#7-known-issues-pilot) and [Troubleshooting](../support/TROUBLESHOOTING.md) for a documented answer.
6. If unresolved, escalate with the bundle attached.

## 6. Escalation path

1. **Pilot support owner** (customer) — triage, dedupe, apply documented fixes/config.
2. **NeuroPause pilot lead** — for BUG/MISSING and anything S1/S2 with a support bundle + `requestId`.
3. **Engineering** — via the pilot lead, for confirmed defects, with reproduction + bundle.

Security-sensitive reports (suspected secret exposure, auth bypass) go **directly to the NeuroPause pilot lead**, flagged SECURITY, and must never include secret values (the product redacts; keep it that way).

## 7. Known issues (pilot)

These are documented and expected — see the [Release Blockers](../product/RELEASE-BLOCKERS.md) register for the full, owned list. Highlights:

- **Cold-launch auth requires the backend.** If the backend is unreachable at launch, users are stranded on the login screen despite local data (KNOWN LIMITATION).
- **Signing/notarization are operator-gated.** Until Apple/Windows credentials are configured, builds are unsigned and Gatekeeper/SmartScreen will warn (EXTERNAL / OPERATOR).
- **Semantic search, live AI, connectors, billing** are each off until you configure the provider (EXTERNAL DEP) — the product shows an honest state, never a fake one.
- **Preview surfaces** (Digital Twin, Industry, Enterprise Marketplace, Cloud, Federation, …) run on seeded/in-memory data.
- **Desktop visual QA** is a human task and is treated as pending sign-off.

## 8. Bug-report template

```
Title:
Build: 1.0.0-rc.15   OS/arch:
Classification: BUG | MISSING | BACKEND DEP | EXTERNAL DEP | CONFIG | KNOWN LIMITATION | USABILITY
Severity: S1 | S2 | S3 | S4
Surface / module:
Steps to reproduce:
Expected:
Actual:
Backend reachable (/health ok?): yes/no
Providers configured (AI / OAuth / Qdrant / billing):
requestId (if backend error):
Support bundle attached: yes/no
Notes:
```

## Related
[Enterprise Pilot Guide](ENTERPRISE-PILOT-GUIDE.md) · [Pilot Acceptance Criteria](PILOT-ACCEPTANCE-CRITERIA.md) · [Pilot Feedback Form](PILOT-FEEDBACK-FORM.md) · [Troubleshooting](../support/TROUBLESHOOTING.md) · [Data & Security Guide](DATA-AND-SECURITY-GUIDE.md)
