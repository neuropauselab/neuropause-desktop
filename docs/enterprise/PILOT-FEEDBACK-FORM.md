# NeuroPause — Pilot Feedback Form

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilot evaluators & support owners
>
> A single structured template for pilot feedback — bugs, usability issues, and feature requests. **Collect only what's needed to reproduce and prioritize.** Do not include sensitive personal data, real customer records, or any secret/credential in a report.

## How to submit

Copy the template, fill it in, and submit it through your pilot's agreed channel (attach a redacted support bundle for defects — see the [Pilot Support Runbook](PILOT-SUPPORT-RUNBOOK.md)). One item per report keeps triage clean.

## Privacy note

Capture the **workflow and behaviour**, not the data. Redact names, financials, and any personal information in screenshots. NeuroPause support bundles are already redacted and never contain secrets — keep it that way.

## Report template

```
--- NeuroPause Pilot Feedback ---
Type:           BUG | USABILITY | FEATURE REQUEST
Severity:       S1 (blocked) | S2 (major) | S3 (minor) | S4 (cosmetic)
Frequency:      always | often | sometimes | once

Reporter role:  (e.g. finance user / admin / developer)   [no personal name needed]
Organization:   (pilot org name or code)
Build:          1.0.0-rc.15
OS / arch:      (e.g. macOS 15, Apple Silicon)

Surface / module: (e.g. Business → Finance, AI Workforce, Operations)
Workflow:         (what you were trying to do)
Expected:         (what you expected to happen)
Actual:           (what actually happened)

Steps to reproduce:
1.
2.
3.

Backend reachable (/health ok?):   yes / no
Providers configured (AI / OAuth / Qdrant / billing):
requestId (if a backend error was shown):
Support bundle attached (redacted):  yes / no
Screenshot attached (redacted):      yes / no

Impact on the pilot:
Suggestion / desired outcome:
```

## Field guide

- **Type** — a defect (BUG), something confusing that works (USABILITY), or something missing (FEATURE REQUEST).
- **Severity / Frequency** — drive prioritization; see the runbook's severity table.
- **Reporter role, not name** — role is enough to prioritize; avoid personal data.
- **requestId** — every backend error carries one (no secrets); it lets support trace the exact request.
- **Support bundle** — generated in-app (`SupportGenerateBundle`), already redacted; the fastest path to a fix.

## Where reports go

Triage follows the escalation path in the [Pilot Support Runbook](PILOT-SUPPORT-RUNBOOK.md). Confirmed defects and missing capabilities are reconciled against the [Release Blockers](../product/RELEASE-BLOCKERS.md) register so nothing is silently dropped.

## Related
[Pilot Support Runbook](PILOT-SUPPORT-RUNBOOK.md) · [Pilot Test Pack](PILOT-TEST-PACK.md) · [Pilot Acceptance Criteria](PILOT-ACCEPTANCE-CRITERIA.md)
