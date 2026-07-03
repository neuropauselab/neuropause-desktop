-- 0009_sync_state: server-side store for cloud sync of org-scoped, non-private
-- entities. One row per (org, entity_type, entity_id) holds the latest snapshot; a
-- global monotonic `seq` drives pull cursors, while a per-record `version` plus
-- `updated_at` drive last-write-wins conflict resolution. Deleted rows are retained
-- as tombstones so deletions propagate. AI Memory, Timeline, and the Knowledge
-- Graph are local-first and are intentionally not represented here.

CREATE SEQUENCE IF NOT EXISTS sync_state_seq;

CREATE TABLE sync_state (
  org_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN (
                 'organization', 'membership', 'workspace_settings',
                 'connected_account', 'connector_config', 'org_prefs')),
  entity_id    TEXT NOT NULL,
  version      INTEGER NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT false,
  data         JSONB,
  device_id    TEXT,
  seq          BIGINT NOT NULL DEFAULT nextval('sync_state_seq'),
  PRIMARY KEY (org_id, entity_type, entity_id)
);

-- Pull queries scan an org's changes above a cursor in seq order.
CREATE INDEX sync_state_org_seq_idx ON sync_state (org_id, seq);
