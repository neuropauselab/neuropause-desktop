# Constitutional Compliance Report — Cloud Foundation (NCEA 10.2)

How this package honors the NCEA constitution. **Enforced** = guaranteed by code
+ tests; **Preserved** = an existing guarantee this package does not break;
**Design-only** = respected in structure but awaiting production hardening.

## Architectural rules (from the Phase 10.2 brief)

| Rule | Status | Evidence |
|---|---|---|
| Governance remains inside NeuroPause OS | **Enforced** | No policy/authority code here; `createCloud()` only coordinates. The gateway *checks* authz but makes no constitutional decision. |
| Cloud coordinates services | **Enforced** | `src/index.ts` composes services; the cloud is a coordination surface. |
| Runtime makes constitutional decisions | **Preserved** | Nothing here overrides the desktop runtime; the cloud requests, the OS decides. |
| Synchronize state | **Enforced** | `SYNCABLE_STATE_KINDS` allow-list; `SyncEngine.push()` accepts only these kinds. |
| **Never synchronize secrets** | **Enforced** | `syncSchema.ts` rejects any secret-like key (recursive) — `sync.test.ts` proves top-level, nested, and in-array rejection. |
| Preserve local-first desktop behavior | **Preserved** | Cloud is additive; no desktop file touched; `standalone` is a first-class mode. |
| Every capability deployable without the cloud | **Preserved / Design** | Services are in-memory modules behind interfaces; nothing here is required for the desktop to run. |

## The ten principles

| # | Principle | Status | Evidence |
|---|---|---|---|
| 1 | Governance precedes execution | **Enforced** | Gateway authorizes before invoking a handler (`gateway.ts`, `gateway.test.ts`). |
| 2 | Purpose precedes computation | **Design** | Events/timeline carry typed intent; formal purpose-binding stays in the OS. |
| 3 | Evidence precedes trust | **Enforced** | Audit provenance is content-derived + verifiable (`auditChain.ts`, `audit.test.ts`). |
| 4 | Relationships are first-class | **Enforced** | Orgs/teams/memberships + device↔user modeled (`organizations`, `devices`). |
| 5 | **Synchronize state, never secrets** | **Enforced** | Schema-level secret rejection + version-vector convergence (`sync/*`, 11 tests). |
| 6 | Cloud hosts services, not authority | **Enforced** | Coordination-only composition; no authority relocated (`index.ts`). |
| 7 | Every action is observable | **Enforced** | Trace ids on every gateway decision; redacting logger; metrics registry. |
| 8 | Every decision is verifiable | **Enforced** | `verifyChain()` detects tampering + broken links (`audit.test.ts`). |
| 9 | Every runtime is governed | **Preserved** | The governed runtime is the desktop OS; this package adds no ungoverned authority. |
| 10 | Every surface has a defined responsibility | **Enforced** | This package is scoped strictly to *cloud coordination* (STATUS.md role table). |

## Secret-handling posture (auditable)

- API keys / connector credentials / tokens: **never** enter sync (schema-rejected),
  **never** logged (key-based redaction in `lib/logger.ts`), and are **not**
  exposed in any public DTO (`DevicePublic`, `SessionPublic` are secret-free).
- The signing/token `secret` is injected via `createCloud({ secret })` — never
  hard-coded; tests use an explicit test-only value.

## Honest non-compliance / deferred

- **TLS, at-rest encryption, real IdP/SCIM, multi-tenant isolation** — design
  targets, not implemented (deployment-layer follow-up).
- **Sequencing** — building 10.2 ahead of the 10.1 desktop signing/certification/
  pilot gate is, per NCEA, premature; this package is design-ahead only and is
  explicitly labeled Preview so it cannot be mistaken for production readiness.

*No customers, pilots, certification, or runtime-at-scale results are claimed.*
