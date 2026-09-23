-- =========================================================================================
-- NP-PILOT-FIRST — WORK ITEM 3. An AUTHORIZED action must be representable.
--
-- pilot_monitor_events.outcome admitted only BLOCKED / DENIED / RECORDED, so an action that
-- passed every authorization control had NO outcome it could be written as. NP-015 measured
-- the consequence at the type level: "there is no ALLOW outcome in the type, so an authorized
-- action is structurally unrepresentable in the ledger, not merely unlogged by habit." Any
-- verification of "what the pilot did" therefore had to rest on other tables.
--
-- ADDITIVE ONLY. Every existing literal is preserved; the sole addition is ALLOW. A re-added
-- CHECK that silently drops a value would invalidate existing rows, and this programme has
-- already caught one such near-miss (0021 nearly dropped COMPLETION by writing COMPLETED).
-- =========================================================================================

ALTER TABLE pilot_monitor_events DROP CONSTRAINT IF EXISTS pilot_monitor_events_outcome_check;
ALTER TABLE pilot_monitor_events ADD CONSTRAINT pilot_monitor_events_outcome_check
  CHECK (outcome IN ('BLOCKED', 'DENIED', 'RECORDED', 'ALLOW'));
