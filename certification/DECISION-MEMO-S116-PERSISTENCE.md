# DECISION MEMO — S116 · PERSISTENCE (event schema-version + upcaster-on-read)

**Date:** 2026-09-04 · **Status:** BLOCKED-POLICY (memo only; no code this session)

## Summary
`packages/persistence` is a **PREVIEW** relational (PGlite/Postgres) stack, imported by cloud packages only, **never by apps/desktop**. Adopting its `createPersistenceLayer` / `SqlDriver` / `TableRepository` / `EventStore` / `BackupManager` / `TenantRegistry` in the desktop main process would stand up a **second, complete persistence spine** with different transaction semantics (SQL ACID vs. the live per-store JSON write-serialization). That is a STOP condition — do not harvest wholesale. Classification: the whole SQL layer = **C** (parallel spine); `schema.ts` = **E** (desktop-irrelevant DDL); `cache.ts`/`objectStore` S3 = **D** (preview).

## The one genuinely portable idea — and why it is a memo, not a harvest
`eventStore.ts` carries `Upcaster` + `schema_version` (forward-migrate-on-read). The live `DomainEventLog` (`apps/desktop/src/main/platform/command/domainEventLog.ts`, hash-chained per tenant, S109) has **no `schemaVersion` field**. Its tamper-evidence idea was already harvested at S109; the versioning idea is NOT mechanically portable because it needs a policy:
- **What is v1?** the baseline schema version for every existing event type.
- **Where/how do producers stamp `schemaVersion`?** the write contract for `DomainEvent`.
- **Replay contract:** upcasters run on read; who owns the upcaster registry, ordering, and idempotency; how a failed upcast behaves (fail-closed vs. quarantine).
- **Recovery interaction:** how versioning composes with the existing backup/recovery registry (S36) and the intent journal, without changing transaction semantics.

Reference prior art (do NOT import): `eventStore.ts` symbols `Upcaster`, `EventStore.registerUpcaster`, `EventInput.schemaVersion`, `StoredEvent.schemaVersion`, `toEvent(...upcasters)`.

## Recommendation
Defer. If/when event-schema evolution becomes a real need, define the versioning + upcaster-on-read policy above and implement it as an ADDITIVE, pure `schemaVersion` field + a pure upcaster registry on the live `DomainEventLog` (no SQL, no second spine, no tx-semantics change) — behind its own slice with the recovery-policy pattern used by S37/S38. No safe Class-A slice exists to implement today.
