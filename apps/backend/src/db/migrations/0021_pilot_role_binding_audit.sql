-- =========================================================================================
-- NP-PILOT-FIRST — ENG-11. The lifecycle ledger must be able to express a ROLE BINDING.
--
-- pilot_lifecycle_events.kind admitted only WITHDRAWAL / TERMINATION / STOP / RESUME, so the
-- single most consequential act in the pilot — establishing who holds authority — was NOT
-- EXPRESSIBLE in the append-only record of lifecycle acts. Migration 0017 widened this same
-- vocabulary for COMPLETED, for the same reason: an act that the ledger cannot represent has
-- to be inferred from elsewhere, which is exactly the inference the ledger exists to remove.
--
-- ROLE_BINDING carries an actor (who performed the write) and a subject (who was bound), but
-- no enrollment — a binding is not a participation. The scope CHECK is widened to admit that
-- shape and no other.
-- =========================================================================================

ALTER TABLE pilot_lifecycle_events DROP CONSTRAINT IF EXISTS pilot_lifecycle_events_kind_check;
ALTER TABLE pilot_lifecycle_events ADD CONSTRAINT pilot_lifecycle_events_kind_check
  CHECK (kind IN ('WITHDRAWAL','TERMINATION','STOP','RESUME','COMPLETION','ROLE_BINDING'));

ALTER TABLE pilot_lifecycle_events DROP CONSTRAINT IF EXISTS pilot_lifecycle_scope;
ALTER TABLE pilot_lifecycle_events ADD CONSTRAINT pilot_lifecycle_scope CHECK (
  (kind IN ('WITHDRAWAL','TERMINATION','COMPLETION') AND enrollment_id IS NOT NULL AND subject_user_id IS NOT NULL)
  OR (kind IN ('STOP','RESUME') AND enrollment_id IS NULL AND subject_user_id IS NULL)
  -- A binding names WHO was bound (subject) and WHO wrote it (actor), and belongs to no
  -- participation. Requiring subject_user_id NOT NULL is what stops a binding event being
  -- recorded without saying who it bound.
  OR (kind = 'ROLE_BINDING' AND enrollment_id IS NULL AND subject_user_id IS NOT NULL)
);
