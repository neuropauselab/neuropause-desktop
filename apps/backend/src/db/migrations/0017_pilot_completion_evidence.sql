-- NP-PILOT-FIRST-005 — COMPLETION becomes a recordable lifecycle exit.
--
-- Migration 0016 declared pilot_lifecycle_events "an append-only record of every lifecycle
-- exit". Measured, that was overstated on the second half: EXITED_STATES is
-- ('WITHDRAWN','TERMINATED','COMPLETED'), and the kind CHECK admitted only
-- ('WITHDRAWAL','TERMINATION','STOP','RESUME'). A COMPLETION was therefore NOT EXPRESSIBLE —
-- the one exit the 30-day pilot exists to produce left no row in the ledger built to record
-- exits, and had to be inferred from a state literal on pilot_enrollments.
--
-- Widening the vocabulary is what makes the existing claim true. Nothing else changes: the
-- scope rule still requires a COMPLETION to name its participation, exactly as a WITHDRAWAL
-- and a TERMINATION do.
--
-- HONEST BOUND, recorded rather than implied: "append-only" remains a CONVENTION here, not an
-- enforced property. Measured across all 17 migrations, zero triggers, rules or REVOKEs target
-- this table (every trigger in the schema is a `set_updated_at`), and the application role is
-- the migration role. Nothing in this pilot is tamper-EVIDENT: no row hash, no chain, no
-- signature. The read-back's DEVIATION detection compares two equally mutable stores and must
-- not be read as tamper detection.

ALTER TABLE pilot_lifecycle_events DROP CONSTRAINT IF EXISTS pilot_lifecycle_events_kind_check;
ALTER TABLE pilot_lifecycle_events ADD CONSTRAINT pilot_lifecycle_events_kind_check
  CHECK (kind IN ('WITHDRAWAL','TERMINATION','COMPLETION','STOP','RESUME'));

-- The scope rule, restated with COMPLETION on the participation side. A participation-scoped
-- row must name its enrollment AND its subject; a pilot-wide row (STOP/RESUME) must name
-- neither, because it belongs to no single participation.
ALTER TABLE pilot_lifecycle_events DROP CONSTRAINT IF EXISTS pilot_lifecycle_scope;
ALTER TABLE pilot_lifecycle_events ADD CONSTRAINT pilot_lifecycle_scope CHECK (
  (kind IN ('WITHDRAWAL','TERMINATION','COMPLETION') AND enrollment_id IS NOT NULL AND subject_user_id IS NOT NULL)
  OR (kind IN ('STOP','RESUME') AND enrollment_id IS NULL AND subject_user_id IS NULL)
);
