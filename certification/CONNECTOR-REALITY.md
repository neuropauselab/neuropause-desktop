# CONNECTOR-REALITY — every integration, classified (NP-010 §1)
### Read-only census, 2026-08-20. Classes: CERTIFIED-LIVE · READ-CAPABLE · RENDERS-ONLY · STUB · DEAD.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**The repo encodes its own truth line** — `connectorService.ts:582`:
`lifecycle: getAdapter(manifest.id) ? 'production' : 'preview'` — surfaced in the UI (`ConnectorCard.tsx:38`).
This census applies the NP-010 rubric on top of it, and separates READ (observation-class) from WRITE
(consequential-class) per the §0 two-axis frame.

## Headline classification

- **CERTIFIED-LIVE: 1 capability.** M365 `mail.send` — the only write with S23 kit evidence and a LIVE-VERIFIED run.
- **READ-CAPABLE: 13 connector families** with real GET-only sync adapters (could ingest with consent, at the
  operator's keyboard): github, notion, google-workspace (gmail/calendar/drive/people/tasks), slack, atlassian,
  salesforce (10 sObjects), hubspot (10 types), servicenow (10 tables), sap (11 OData sets), oracle (11 Fusion
  resources), dynamics365 (12 Dataverse tables), workday (12 HCM resources), microsoft-entra **(+M365 folded in:
  mail, calendar, drive, contacts, teams — `adapters/entra.ts:162`; there is NO separate microsoft-365 manifest,
  `manifests.ts:521-526`)**.
- **RENDERS-ONLY: 9 families** with full manifest/OAuth config and ZERO sync code — they connect and honestly report
  "connection verified, no data adapter yet" (`sync/registry.ts:2-5`): canva, figma, linear, zapier (env-gated), and
  chatgpt, claude, gemini, perplexity, cursor — **see F-N10-1 below: these five present as configured while 100%
  inert**.
- **GOVERNED-UNCERTIFIED write paths (exist, wired, NOT kit-certified):** 27 further M365 actions + 70 infrastructure
  actions + the workforce routing seam — see "The write surface" below. Everything below the certified line refuses
  at the boundary (the S5.1 predicate: connector-certified ≠ action-certified, proven in the calendar dry run).
- **DEAD (unimported): 35 of 46 packages** under `packages/` — zero references from `apps/` (prod OR tests).
- Identity probes exist for only 7 connectors (`connectionTest.ts:65-114`); the other 15 return honest
  `not_verifiable`.

## The write surface (§0 WRITE-DEEP — the full consequential-class inventory)

| Surface | Actions | Governance today | Kit status |
|---|---|---|---|
| **M365 `mail.send`** | 1 | Own CST-kernel path (`connectors/index.ts:602-641`) + FG-4 guard + read-back oracle | **CERTIFIED-LIVE** (S15/S16 + S23 back-fill) |
| M365 mail (other) | 10 (reply, forward, move, delete, draft…) | `governedAction` (CST) via `M365Executor` | UNCERTIFIED — refuses at the S5.1 line |
| M365 calendar | 5 (create, update, delete, invite, respond) | same | UNCERTIFIED; `calendar.create` kit **dry-run complete** (NP-002) |
| M365 drive | 8 (upload incl. real `PUT` `m365/drive.ts:84`, rename, share…) | same | UNCERTIFIED |
| M365 contacts / teams | 5 + 5 | same | UNCERTIFIED |
| **Infrastructure platforms** | **70 `mutates: true` actions** across 10 platforms (aws/azure/gcp/k8s/docker/vmware/cloudflare/snowflake/databricks/iac — `aws_ec2_stop`, `k8s_node_drain`, `azure_keyvault_rotate_secret`…) | `InfraActionExecutor` (`infrastructure/executor.ts`) — header says it "mirrors the connector M365Executor exactly"; confirmed-flag gated | UNCERTIFIED, **outside the Connector Center entirely** |
| **Workforce routing seam** | n/a | `executeEngine.register('connector', createWorkforceActionExecutor(runBinding))` at `runtimeCore.ts:2585`; `runBinding` (`:2504-2560`) routes approved worker actions to EITHER infra OR m365 executor, behind `verifyBoundaryB` + `confirmed` | The agentic path to both write surfaces — wired, not dormant |

Every one of the 13 sync adapters is **GET-only** (verified by mutation-verb grep across `adapters/` — only the
OAuth engine, the Slack Socket-Mode handshake, and the m365 drive upload appear). The 9 write scopes
(`Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite.All`… `manifests.ts:577-587`) live on the **microsoft-entra**
manifest; the executor lives under `connectors/m365/`.

## Findings

- **F-N10-1 · Five connectors look ready and are inert.** `credentials.ts:55-59` returns `isConfigured() === true`
  unconditionally for `authType: 'api_key'` — ChatGPT/Claude/Gemini/Perplexity/Cursor present as fully configured
  with no adapter, no identity probe, no HTTP client anywhere. The only cards in the Center whose appearance
  overstates reality. (Fix candidate: honest "no data path yet" state, like the env-gated four already get.)
- **F-N10-2 · A stale honesty comment.** `cloudPlatformManifests.ts:6-9` claims "deliberately NO
  collector/provider-API code here" — but `aws/awsCollectors.ts`, `azure/azureClient.ts` etc. now exist.
- **F-N10-3 · Auth email cannot deliver.** `apps/backend/src/auth/mailer.ts` is a logging mailer only ("does NOT
  send email") — verification/reset flows are complete and tested but the delivery leg was never filled.
- **F-N10-4 · Slack realtime disables itself** even when the app token is set (Electron main has no global
  `WebSocket`; `ws` declared but not imported there — `connectors/index.ts:491-497`).
- **N-N10-5 · The CST kernel is a vendored tarball**, not in-tree (`file:vendor/neuropause-cst-1.3.0.tgz`, deep
  `dist/` imports). Deliberately frozen; recorded so nobody looks for it under `packages/`.

## The 46 packages (the "41 preview packages" resolved to file-level truth)

- **Production-imported (6):** `shared` (2,244 refs — includes the Graph parsing cores the real adapters use) ·
  `shared-cloud` · `cloud-core` · `runtime` (backend runtime) · `companion-protocol` (mobile E2E crypto) ·
  `solution-packs` (+ `industry` as its transitive dep).
- **Mentioned-but-never-imported (4):** `sdk`, `cli` (catalog strings/docs), `workspace`, `integrations` (comments).
- **DEAD — zero references from apps, prod or test (35):** ai-runtime, automation, autonomous-ops, business,
  certification, ckdl, cloud-sdk, cloudops, commercial, connectivity, connectors, customer-deployment,
  customer-experience, deploy, deployment-orchestrator, enterprise-connectivity, environment-provisioning,
  execution, federation, infrastructure, integration-platform, intelligence, nems, operations, operator-deployment,
  persistence, platform-automation, platform-operations, production, release, reliability, security,
  trust-platform, workforce, workplace. They form a self-referential dependency pyramid reachable from neither app
  entry point. Four of them (`connectors`, `integrations`, `connectivity`, `enterprise-connectivity`) are a complete
  **parallel connector platform** (~80 files incl. a real fetch client) that no shipping code touches — the
  41-package lesson in file-level detail. They stay archived, off the critical path (CLAUDE §4).

## Backend integrations

| Integration | Reality |
|---|---|
| **Razorpay** | **REAL and fully wired**: `razorpay@^2.9.6`; `billing/razorpayGateway.ts` creates/cancels subscriptions with env keys; webhook HMAC-SHA256 timing-safe verified (`billing/webhook.ts:14`); mounted in `app.ts:57,144`; fails closed without env (`billingConfigured()`). Desktop never touches card data — `billingClient.ts` opens the hosted checkout in the system browser; the desktop `ecosystem/billing` module is a separate LOCAL store ("No charging, no I/O") unconnected to it. |
| OAuth login providers | REAL ×4 (google/github/microsoft/apple — Apple with ES256 client-secret + JWKS verification), each env-gated |
| Qdrant + embeddings | REAL (Ollama `nomic-embed-text` / OpenAI / Voyage, env-selected) |
| Alert webhook | REAL outbound POST when `ALERT_WEBHOOK_URL` set |
| Email delivery | **NOT real** (F-N10-3) |

## What this means for §2 and §4

- **§2 (read-wide):** the 13 READ-CAPABLE families are the consent-gated second wave of the ingestion spine; the
  ERP-grade sources (sap, oracle, dynamics365, salesforce, workday) already sync business-object-shaped reads.
  File-based ingestion (no credentials) proceeds first per the directive.
- **§4 (write-deep ladder):** candidate rungs, ranked in the program summary for the operator's ruling — every rung
  its own S23 kit run; oracle availability noted per candidate; everything below the line keeps refusing.
