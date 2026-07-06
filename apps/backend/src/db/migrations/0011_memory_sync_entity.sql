-- 0011_memory_sync_entity.sql
--
-- Add 'memory' as a valid syncable entity type. AI Memory remains local-first and
-- device-owned; this only lets ORG-SCOPED memory ride the existing sync_state
-- transport as an OPAQUE payload. The backend does not interpret memory semantics
-- and performs no server-side merge — each device reconciles locally via
-- resolveMemorySync. Backward-compatible: purely additive to the allowed set, no
-- data change, no new table.
--
-- Note: the inline column CHECK created in 0009 is named
-- `sync_state_entity_type_check` by Postgres convention. If your instance named it
-- differently, inspect with `\d sync_state` and adjust the DROP below.

ALTER TABLE sync_state DROP CONSTRAINT IF EXISTS sync_state_entity_type_check;

ALTER TABLE sync_state ADD CONSTRAINT sync_state_entity_type_check CHECK (entity_type IN (
  'organization', 'membership', 'workspace_settings',
  'connected_account', 'connector_config', 'org_prefs', 'memory'));
