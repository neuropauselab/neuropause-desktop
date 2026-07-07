-- V8.2 Part 1: background embedding pipeline resume/idempotency state.
-- One row per embedded memory; content_hash drives skip-if-unchanged, and the
-- row's existence makes a crashed run resumable (completed memories are skipped).
CREATE TABLE IF NOT EXISTS embedding_state (
  memory_id          TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  embedding_version  TEXT NOT NULL,
  embedded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS embedding_state_org_idx ON embedding_state (org_id);
