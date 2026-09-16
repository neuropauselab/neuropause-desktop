# DECISION MEMO — S104: architecture-defeat verdict (adversarial control-plane audit)

**Purpose.** Record the result of an adversarial attempt to DEFEAT the NeuroPause architecture — not to prove the software works, but to prove whether the architecture survives an attempt to break it by composing legitimate capabilities, exploiting alternate doors, manipulating identity/tenant, replaying commands, or using AI/legacy paths. **No STOP was found.** No production code changed; no frozen surface touched.

## Verdict

**The current NeuroPause architecture could not be defeated by any attack attempted.** Every consequential economic mutation is gated by a server-side RBAC `authorize` on a server-resolved actor; there is no renderer- or AI-reachable door that bypasses it; composition, replay, envelope forgery, cross-tenant reference, and status forgery all fail closed with zero economic side effect.

## 1. Actual architecture map (governed path)

renderer → preload (static channel allowlist, no RBAC) → IPC secure bridge (`runSecureHandler`: auth → `authorize(permission)` → Zod `.strict()` → handler) → EITHER the enterprise-module handlers (`buildModuleHandlers`: `ctx.authorize(descriptor.permissions.write/read)` inline before every store write) OR `platform:command.dispatch` → `dispatchCommand` (`resolveScope()` tenancy + `authorize(PERMISSION_FOR_COMMAND[type])`) → domain command → `DurableCommandJournal` (intent-first, atomic idempotency+event+outbox) → module `runAction`/store → GL/inventory posting inside the RBAC-gated action → audit/event/outbox → response. **Every economic posting lives inside an RBAC-gated action; the actor is server-resolved from `authService.getStatus()`, never the payload.**

## 2. Trust-boundary map (all enforced, cited by the S104 red-team sweep)

- **Channel classification is fail-closed at boot** — `assertAllChannelsClassified` (`runtimeAuthz.ts:1310`) throws if any invokable channel is neither RBAC-gated nor on the vetted public allowlist (and throws if it is on both). A privileged channel cannot ship ungated.
- **Envelope actor/tenant are validated, never trusted** — `commandBus.ts:521-524` derives tenant from `resolveScope()` and rejects `CROSS_TENANT_CLAIM`/`CROSS_WORKSPACE_CLAIM`; RBAC (`:532`) uses the server-resolved principal; the envelope `actor` is an audit label with no authorization role.
- **Legacy action door has an origin token** — governed verbs (ship/convertToInvoice/issue) are refused on `enterprise:module.action` unless stamped with the unguessable per-process `INTERNAL_ACTION_ORIGIN`, not exported to `@neuropause/shared` and unreachable through the `.strict()` renderer schema.
- **SetStatus is record-status only** — the schema accepts `active/archived/deleted`; it cannot set a domain `fields.status`.
- **onChange economic postings key on machine-owned statuses** — the one on-status posting (production variance on `completed`) is fenced by the module validate hook; no sampled onChange posts on a status a renderer can set.

## 3. Alternate-door census — no external bypass

Every `.store.create/update/setStatus/softDelete`, `applyGlDerivedEntries`, `postStockMovement`, `postAdjustmentMovement` call resolves to one of: inside `buildModuleHandlers` after `authorize`; inside a module `runAction`/`onChange` reachable only from an authorized door; or a command-bus rollback closure (only on a failed commit of an already-authorized command). The only other mutating economic channel, `dp:import`, is triple-gated (`data:import` + `data:approve` + per-module write). No renderer-reachable direct-store path was found.

## 4. Composition-attack matrix — all fail closed (focused test `architectureDefeatMatrix.test.ts`, 8/8)

| Attack | Result | Economic side effect |
|---|---|---|
| REPLAY (same key, different command) | second command SUPPRESSED (replays first's cached result) | ZERO — the second command never executes; no ship, no duplicate order |
| REPLAY (terminal payment, own key) | replayed | ZERO — no duplicate GL/cash |
| ENVELOPE forge tenant | `CROSS_TENANT_CLAIM` | ZERO |
| ENVELOPE forge actor + advisory principal | `UNAUTHORIZED` | ZERO |
| APPROVE → MODIFY (approved PO → draft) | refused (S49/S50) | ZERO |
| APPROVE → MODIFY (issued invoice amount edit) | refused (S60) | ZERO |
| REVERSE → REVERSE | second refused (at-most-once) | ZERO |
| REVERSE → DELETE (reversal record) | refused (S64) | ZERO |
| DELETE original cleared payment | refused (S61) | ZERO |
| CROSS-TENANT reference (ship A's order from B) | refused (invisible) | ZERO |
| F-S98-1 all-domain (production/PO/adjustment/SO/invoice status forge) | refused/inert | ZERO |

## 5. Idempotency-key-confusion finding (documented, classified SAFE)

The command idempotency identity is `${tenantId}::${idempotencyKey}` (`durableCommandJournal.ts:152-157`) — NOT command-type-scoped. So dispatching a DIFFERENT command with a REUSED key makes the second command **replay the first's cached result without executing** — i.e., command SUPPRESSION (self-denial), never a duplicate or unauthorized effect. This cannot cause an economic mutation: the replay returns cached data and re-emits nothing. **Classification A (safe from economic bypass).** A robustness observation (a caller reusing a key across command types self-denies) — a correctness footgun the caller controls, not a security defect; not worth a production change absent an operator ruling.

## 6. Temporal / durability reasoning (no re-injection needed)

Concurrency and crash-recovery were certified in prior sessions and are unchanged: `DurableCommandJournal` is intent-first with a single-flight in-flight map keyed `${tenant}::${key}` (S40), `DurableJsonStore` serializes writes per store (S33), and every S94–S103 journey proved restart durability + replay idempotency on the real path. Two simultaneous same-key commands collapse to one via the in-flight map; a restart between journal-intent and mutation reconciles to `RECONCILIATION_REQUIRED` rather than a duplicate effect (S40). No impossible durable state is reachable that produces a duplicate economic effect.

## 7. AI / agent escape — none

No AI/workforce/liveBrain file imports `dispatchCommand`, `enterprise:module.action`, or any `.store.*`/`postStockMovement`/`applyGlDerivedEntries` primitive. AI output is advisory/proposal-only; the one place AI data becomes a mutation (reorder → draft PR) passes through the full governed command bus with server-resolved RBAC and mints only a `draft`. The CST/liveBrain execution gate governs a separate `mail.send` track, not the ERP command bus. AI is not an alternate economic execution plane.

## 8. Classification of all findings

- **A — SAFE / PROVEN:** the governed path, all trust boundaries, the alternate-door census, the composition-attack matrix, envelope forgery, cross-tenant reference, F-S98-1 all-domain, idempotency-key confusion (suppression not bypass), AI escape, temporal/durability reasoning.
- **C — POLICY-OPEN (carried, unchanged):** payroll/adjustment/variance approval + SoD; payment-reversal SoD; period-reopen dual-control; maintenance & project cost→GL (DECISION-MEMO-S101/S102/S103/S99/S75) — none bypassable into an economic mutation.
- **D / STOP:** NONE.

## Founder-level answer

*Can the current NeuroPause architecture be defeated by composing legitimate capabilities, exploiting alternate doors, manipulating identity/tenant context, replaying commands, crossing transaction boundaries, abusing timing/recovery, or using AI/legacy paths?* — **No.** Every consequential economic mutation flows only through a server-side-authorized, tenant-validated, machine-owned-status governed action; no alternate door, replay, forged envelope, cross-tenant reference, composition, or AI/legacy path reaches an economic mutation it should not. The architecture survived the attempt to defeat it. The only open items are undefined business-policy layers (approval/SoD/thresholds/dual-control/accounting mappings), which are fail-closed against unauthorized actors and documented, not defects.
