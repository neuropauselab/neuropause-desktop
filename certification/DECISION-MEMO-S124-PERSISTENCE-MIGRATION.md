# DECISION-MEMO-S124 — Persistence schema migration / upcaster-on-read (POLICY-BLOCKED)

**Date:** 2026-09-05 · **Session:** S124 · **Status:** POLICY-OPEN / BLOCKED (no migration rules invented)

## Context
S124 inspected `packages/persistence` for the previously-identified `schemaVersion` / upcaster-on-read /
snapshot-migration concepts, to evaluate a safe harvest into a canonical persisted shape.

## Findings (source-verified)
- `packages/persistence/src/eventStore.ts` implements a real **upcaster-on-read** seam
  (`Upcaster = (payload, fromVersion) => payload`, applied in `toEvent` by `row.schema_version`), but it
  is coupled to the **SQL event store** (per-row `schema_version` columns, `event_snapshots` table,
  PGlite/Postgres driver). It is the parallel `@neuropause/*` relational architecture — importing it would
  drag in a second persistence spine (forbidden by S106/S107 Rule 3 and directive §8).
- The **canonical** desktop persistence is `platform/persistence/durableJsonStore.ts` (a single atomic
  JSON file via the shared store envelope) plus the ~106 enterprise `EnterpriseRecordStore`s. Its
  `RecordFile<T>` carries an OPTIONAL file-level `schemaVersion?: number` that is **written but never
  consumed for migration** — there is **no upcaster-on-read seam**, and individual records carry no
  per-record version.

## The open question
Adding a real upcaster-on-read to the canonical JSON stores requires **inventing a format/policy
contract**:
1. What does `schemaVersion` mean per store (file-level vs per-record)?
2. The version-numbering scheme and the "current version" for each of the ~107 stores.
3. A per-type migration registry and the ordering/reversibility rules.
4. Failure semantics when an on-read migration fails (fail-closed vs quarantine vs partial).

These are migration **policy/format** decisions, not definitional math.

## Decision
Per directive §8 and the standing rule *never invent migration semantics*:

1. **STOP** the persistence-migration branch this session. No `schemaVersion` consumption, no upcaster,
   no format change was added to any canonical store.
2. The canonical `DurableJsonStore` remains unchanged (its `schemaVersion?` field stays write-only /
   reserved, exactly as today — backward-compatible).
3. Do **not** import the SQL `eventStore` upcaster architecture (second-spine prohibition).

## What is NOT decided here (future OPERATOR-GATED slice)
- The version-numbering + per-type migration contract for canonical stores.
- Whether migration is file-level or per-record.
- On-read migration failure semantics.

Until a migration-format policy is ratified, canonical persistence stays as-is. The concept is
recorded as a **SAFE HARVEST CANDIDATE (blocked on format policy)**, not activated.
