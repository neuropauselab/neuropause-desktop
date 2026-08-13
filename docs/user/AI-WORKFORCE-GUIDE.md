# NeuroPause — AI Workforce Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: users & operators
>
> Maturity: **Local-first governance · RC**; live model execution is an **External dependency** (an AI provider). NeuroPause does **not** offer unrestricted autonomous AI — every action is governed.

## What the AI Workforce is

The **AI Workforce** is where you run and supervise **AI workers** — configurable AI agents that do work for you *under governance*. Open it from **AI & Operations → AI Workforce**. In-depth management lives in **Workforce Admin** (under Advanced).

The core principle, applied to every AI action:

```
Intent  →  Governance  →  Permission  →  Execution  →  Evidence
```

An AI action only runs when policy and permissions allow it, and it always leaves a record. NeuroPause never displays success for an AI operation that did not actually execute (this was hardened in Phase 1).

## Key concepts

- **Workers** — the AI agents available to you (discoverable, configurable, installable via the Enterprise Marketplace).
- **Skills / delegation** — you delegate a skill to a worker with input; the worker proposes or performs work.
- **Approvals** — sensitive actions produce a proposal that a human approves or rejects in the approval center. Reason-gated where configured.
- **Execution** — approved work runs through the existing ExecuteEngine + workforce runtime.
- **Governance** — approval chains and compliance rules gate what can run.
- **History & audit** — every job and decision is recorded (actor, action, result).
- **Automation Studio** — build automations (trigger → condition → action) that run governed actions.

## How to use it

1. Open **AI Workforce**. Review **Mission Control** (workforce status) and the **Workers** roster.
2. **Delegate** a skill to a worker, or trigger an **automation**.
3. If the action needs approval, find it in **Approvals**, review the proposal + reason, and **approve/reject**.
4. Watch **Execution / Analytics** for results; check **History** for the audit trail.
5. For install/config/health/delegation planning, use **Workforce Admin** (Advanced).

## The AI provider dependency (important)

Live generation (an AI worker actually reasoning/acting with a model) requires an **AI provider** configured in **Settings → AI**:

- **Claude (Anthropic)** — default; needs an `ANTHROPIC_API_KEY` and network access to Anthropic. *(External dependency.)*
- **Ollama** — a locally-running model server (default `http://localhost:11434`). *(External/local dependency.)*

If no provider is configured, NeuroPause reports it honestly and falls back to a **deterministic, non-generative path** — it does not fabricate an AI result. See [Troubleshooting → AI unavailable](../support/TROUBLESHOOTING.md).

## Failure behavior

- No provider → honest "not configured", deterministic fallback.
- Provider error / timeout → the action fails honestly with a message; no fake success.
- Not permitted → blocked by governance/permissions with a clear reason.

## What NeuroPause does *not* claim

- No "unlimited autonomous AI." Execution is approval-gated and permissioned.
- No hidden model calls — the provider and model are set explicitly in Settings.
- Automation actions perform real work or report honest failure (never a silent no-op reported as success).

## Related

[Knowledge Guide](KNOWLEDGE-GUIDE.md) · [User Guide → AI Workforce](NEUROPAUSE-USER-GUIDE.md#14-ai-workforce) · [Admin Guide](../admin/ADMIN-GUIDE.md)
