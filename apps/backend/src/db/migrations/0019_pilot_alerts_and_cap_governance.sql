-- NP-PILOT-FIRST-009 — ENG-07 (alert delivery) and ENG-10 (governed cap).
--
-- Both tables ship EMPTY, and as in 0018 that is the control, not an omission.

-- ---------------------------------------------------------------------------------------
-- ENG-07 — alert DELIVERY, recorded separately from alert DETECTION.
--
-- `pilot_monitor_events` records that a condition was detected and refused. This table
-- records what happened when someone tried to TELL a human about it. They are deliberately
-- two tables, because they fail independently: a delivery outage must never erase the
-- detection, and a detection must never be re-run to retry a delivery.
--
-- `monitor_event_id` is UNIQUE, which is what makes replay inert: a redelivered alert finds
-- the row and produces no second consequential action (§7 H).
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_event_id uuid NOT NULL UNIQUE REFERENCES pilot_monitor_events(id) ON DELETE CASCADE,
  sink text NOT NULL,
  status text NOT NULL CHECK (status IN ('DELIVERED', 'FAILED')),
  failure_reason text,                       -- a CODE, never a provider error body
  payload jsonb NOT NULL,                    -- the redacted alert, exactly as sent
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_failure_has_reason CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS pilot_alert_deliveries_status_idx
  ON pilot_alert_deliveries (status, attempted_at DESC);

-- ---------------------------------------------------------------------------------------
-- ENG-10 — the governed participant cap.
--
-- `pilot_control.max_participants` is the OPERATIVE value and stays NULL. This table is the
-- DECISION RECORD that may set it: who decided, under which authenticated binding, against
-- which instrument, in which environment.
--
-- WHY A SEPARATE TABLE RATHER THAN AN UPDATE: an UPDATE leaves only the value. The question a
-- governance audit asks is not "what is the cap" but "who set it, on what authority, and
-- when" - and an unconsumed value that nothing can attribute is exactly the write-only record
-- this programme keeps finding. The cap becomes effective only through a decision recorded
-- here, in the same transaction as the write it authorizes.
--
-- `superseded_by` rather than DELETE: a cap decision is evidence and is never removed. A later
-- decision supersedes an earlier one and both remain readable.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_cap_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_by uuid NOT NULL REFERENCES users(id),
  role text NOT NULL,
  instrument text NOT NULL,
  environment_id text NOT NULL,
  max_participants integer NOT NULL CHECK (max_participants > 0),
  reason text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES pilot_cap_decisions(id)
);
CREATE INDEX IF NOT EXISTS pilot_cap_decisions_active_idx
  ON pilot_cap_decisions (decided_at DESC) WHERE superseded_by IS NULL;
