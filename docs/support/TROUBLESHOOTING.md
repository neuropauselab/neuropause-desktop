# NeuroPause — Troubleshooting (User & Pilot)

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: users, evaluators, pilot leads
>
> Everyday problems and their honest explanations. Many "issues" are actually NeuroPause telling the truth (no fake success, no false "Live"). For operator/production-grade incident handling, see the operator [Troubleshooting](../guides/TROUBLESHOOTING.md) and the operations runbooks.

## I can't sign in

- **Most common cause:** the backend isn't reachable. Sign-in at launch is a **hard dependency** (a known limitation). Confirm the backend is up: `GET /health` should return `{"status":"ok","components":{"database":"up","redis":"up"}}`.
- Check `PUBLIC_BACKEND_URL` points at the right host/port (default `:4000`).
- Invalid credentials are rejected by design. If you're sure they're right, confirm the account exists in *this* organization.

## The app shows an AI "fallback" instead of a real answer

This is expected when **no AI provider is configured**. Configure an Anthropic key or a local Ollama model in Settings to enable live AI. NeuroPause deliberately shows an honest deterministic fallback rather than inventing a result.

## Search only returns basic matches

Semantic ranking is an **external dependency** (a vector store plus embeddings). When it isn't enabled, search falls back to **local lexical** matching. Enable semantic search to improve ranking; nothing is broken if it's off.

## A connector won't connect

A connector is listed but **not connectable until its OAuth app credentials are supplied**. A "not configured" state is honest, not a failure. Provide the connector's OAuth app credentials (server-side), then retry. Note which connectors are **Preview** — see the [Connectors Guide](../user/CONNECTORS-GUIDE.md).

## Operations doesn't say "Live"

The status indicator shows **"Live" only when data actually loaded**. A non-Live, degraded, or empty state is truthful — it means data hasn't loaded (often because a dependency isn't up), not that the screen is broken.

## My records aren't syncing across devices

Cross-device **sync is opt-in** and needs the backend. Each device keeps its own local data; sync reconciles through `/sync`. If the backend is unreachable, in-session work continues locally and sync defers until connectivity returns.

## Records seem missing after switching machines

Business data is **local-first** — it lives on the device where you created it. Another machine won't have it unless sync is enabled and has run. This is by design, not data loss.

## The app won't launch / a screen looks wrong

- Running from source: confirm `npm install` completed and you launched with `npm run dev`.
- Preview surfaces run on seeded/in-memory data — an empty or modeled view there is expected.
- Desktop **visual QA on macOS is a human task** and is still being signed off; if a visual glitch appears, capture a screenshot for the pilot log.

## Where are logs / how do I report an issue?

Backend errors carry a `requestId` (and never contain secrets) — include it when reporting. Classify issues the way the pilot team does: **BUG / MISSING / BACKEND DEP / EXTERNAL DEP / CONFIG / KNOWN LIMITATION**. See the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) §12.

## Related
[FAQ](FAQ.md) · [Quick Start](../user/QUICK-START.md) · [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [operator Troubleshooting](../guides/TROUBLESHOOTING.md)
