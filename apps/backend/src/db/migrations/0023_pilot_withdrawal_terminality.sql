-- =========================================================================================
-- NP-PILOT-FIRST — WORK ITEM 4. WITHDRAWN IS TERMINAL, AT THE DATABASE BOUNDARY.
--
-- MEASURED DEFECT, not a hypothetical. With a role that is NOT superuser and NOT the table
-- owner — the privilege class the pilot runtime actually uses — one statement revived a
-- withdrawn participant:
--
--     UPDATE pilot_enrollments SET state='PILOT_ACTIVE' WHERE id=...   ->  UPDATE 1
--
-- Terminality lived only in application predicates (`state NOT IN (...)` inside two of the
-- three writers). Those predicates are correct and are not removed; they simply cannot bind a
-- caller who issues SQL directly. Pilot tables carried 0 triggers and 0 RLS policies.
--
-- SCOPE IS DELIBERATELY NARROW. The invariant implemented here is the one the work item
-- states: WITHDRAWN must not become anything else. TERMINATED and COMPLETED are also in
-- EXITED_STATES and remain guarded by application predicates only — recorded as a measured
-- observation, not silently widened into policy this work item was not asked to make.
--
-- A BEFORE UPDATE row trigger is used because it rejects the row before the update takes
-- effect, and because the runtime role can neither drop it nor disable it: ALTER TABLE ...
-- DISABLE TRIGGER requires ownership, which the runtime role does not hold.
-- =========================================================================================

CREATE OR REPLACE FUNCTION pilot_enforce_withdrawal_terminality() RETURNS trigger AS $$
BEGIN
  -- Only the transition out of WITHDRAWN is refused. Same-state updates, and updates to any
  -- other column while the row stays WITHDRAWN, are untouched: terminality is a statement
  -- about the LIFECYCLE, not a freeze on the row.
  IF OLD.state = 'WITHDRAWN' AND NEW.state IS DISTINCT FROM 'WITHDRAWN' THEN
    RAISE EXCEPTION
      'pilot withdrawal is terminal: % cannot become %', OLD.state, NEW.state
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pilot_enrollments_withdrawal_terminality ON pilot_enrollments;
CREATE TRIGGER pilot_enrollments_withdrawal_terminality
  BEFORE UPDATE ON pilot_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION pilot_enforce_withdrawal_terminality();
