# NeuroPause — Telemetry & Diagnostics Policy

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: enterprise security, IT, evaluators
>
> What NeuroPause collects, what it does not, and where it goes — based on the actual implementation. Honesty rule: this describes shipped behaviour, not aspiration.

## Summary

**NeuroPause ships no third-party usage-analytics or product-telemetry SDK.** A repository scan of first-party code (`apps/desktop/src`, `apps/backend/src`, `packages/`) found **no** Segment, Mixpanel, Amplitude, PostHog, Google Analytics, Datadog, Bugsnag, or Sentry integration. There is **no automatic usage phone-home to NeuroPause or any third party.** What exists is **operator-facing diagnostics** that stay inside the operator's own environment.

## What is collected (and where it stays)

| Signal | Where it lives | Leaves the environment? |
|---|---|---|
| Application log (`logs/app.log`, rotating) | On the device (userData) | No — only if a user generates a support bundle and shares it |
| Crash log (`crashes.log`) | On the device | No — only via a shared crash export |
| Audit log (`audit.log`, JSONL) | On the device (desktop) / backend audit table | No — operator-reviewable in place |
| Backend structured logs (pino, **redacted**) | Operator's backend host | No — stays in operator infra |
| Backend metrics (`GET /metrics`, Prometheus text) | Operator's backend | No — scraped by the operator's own monitoring |
| Health/liveness (`GET /health`, `/live`) | Operator's backend | No |
| Tracing (OTLP spans) | **IPC-only, uncorrelated** on desktop | No — not exported to a collector by default |

Support bundles are **user-initiated and redacted**; backend logs and error responses **never contain secrets** (errors carry a `requestId`, not values).

## What is NOT collected

- No third-party analytics/tracking SDK; no advertising identifiers; no behavioural tracking.
- No automatic transmission of usage data, documents, or business records to NeuroPause.
- No keystroke/screen capture.

## The one routine outbound connection

The desktop **update check** (electron-updater) contacts the **configured update feed URL** (default `https://neuropause033.com/updates`, channel `beta`) to discover new versions. This is a version check, not usage telemetry. It is inert in unpackaged/dev builds and only active in packaged builds; the feed is operator-hosted.

## Storage & retention

- Device logs are **rotation-bounded** (bounded size; old entries roll off) — see the Phase-8 data-safety work.
- Backend log/metric retention is governed by the **operator's** logging/monitoring stack, not by NeuroPause.
- The audit log is append-only and grows with privileged actions; operators manage its lifecycle.

## Controls

- **Users** choose when to generate and share a support bundle (nothing is auto-sent).
- **Operators/admins** control backend log verbosity, metric scraping, retention, and whether to point the update feed at their own host.
- **Optional external crash/error reporting** (e.g. an APM/Sentry-style service) is **not configured** in this build; if an operator wants it, it is a deliberate future integration, not a hidden default.

## Honest gaps

- There is no in-app privacy dashboard to toggle diagnostics; control is via operator configuration and user-initiated bundles.
- OTLP spans are generated but not wired to an external collector, so distributed tracing across desktop↔backend is not correlated out of the box.

## Related
[Data & Security Guide](DATA-AND-SECURITY-GUIDE.md) · [Pilot Support Runbook](PILOT-SUPPORT-RUNBOOK.md) · [Operations Guide](../guides/OPERATIONS-GUIDE.md)
