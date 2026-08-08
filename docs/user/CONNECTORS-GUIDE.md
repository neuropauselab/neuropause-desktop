# NeuroPause — Connectors Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: users & administrators
>
> Maturity: connector **runtime** is Local-first · RC; each real connection is an **External dependency** (you sign in to the provider). A connector never shows as "connected" unless a real connection exists.

## What connectors are

Connectors link NeuroPause to outside systems so it can read/sync data from them. Open **Workspace → Connectors** — the Connector Center has three surfaces: **Overview** (health roll-up), **Connections** (browse / connect / manage / inspect), and **Marketplace** (discover connectors).

## Connectable today (13 — production)

These ship with a real data adapter and can be connected (each requires signing in to that provider / valid credentials):

**GitHub · Notion · Slack · Atlassian (Jira + Confluence) · Google Workspace · Microsoft Entra ID (+ Microsoft 365) · Salesforce · HubSpot · ServiceNow · SAP S/4HANA · Oracle Fusion Cloud ERP · Microsoft Dynamics 365 · Workday.**

*(Microsoft 365 rides the Microsoft Entra connector — it is not a separate entry.)*

## Preview (9 — catalog-only, not yet connectable)

Shown in the catalog for visibility but **without a data adapter**, so they are **Preview** and cannot be connected in this build:

**ChatGPT (OpenAI) · Claude (Anthropic) · Gemini (Google) · Perplexity · Cursor · Canva · Figma · Linear · Zapier.**

*(Some of these ship full sign-in configuration but no sync adapter yet — that's why they're Preview, not because sign-in is missing.)*

## How to connect

1. Open **Connectors → Connections** and pick a connectable integration.
2. Choose **Connect**. You'll be taken through that provider's sign-in (OAuth) or asked for the required credentials. **NeuroPause never asks you to paste secrets into a field it shouldn't** — sign-in happens with the provider.
3. On success, the connector shows the connected account and its health.

## Manage, sync, inspect

- **Reconnect / Refresh** — renew access when a token expires.
- **Sync** — pull data through the connector's adapter (with retry + rate-limiting + a circuit breaker built into the runtime).
- **Health** — see per-connector status; the Overview rolls this up.
- **Disconnect** — remove a connected account (a governed action).

## Permissions & data

- Connecting/managing connectors is gated by connector RBAC.
- Synced data flows into NeuroPause's local-first stores; connector **account** records that are cloud-linked live in the cloud plane.
- **Administrator note:** provider **OAuth apps/credentials** must be configured for a connection to work (client IDs, and server-side secrets where applicable). Until then, a connector is listed but not connectable. *(External dependency.)*

## Failure behavior (honest states)

- Provider not configured / secrets missing → the connector is shown but connecting reports an honest "not configured / external dependency", **not** a fake connected state.
- Auth expired → reconnect prompt.
- Sync failure → retried with backoff; repeated failures open the circuit breaker and surface a degraded status (not a false "healthy").

## Related

[Admin Guide](../admin/ADMIN-GUIDE.md) · [User Guide → Connectors](NEUROPAUSE-USER-GUIDE.md#25-connectors) · [Troubleshooting](../support/TROUBLESHOOTING.md)
