-- NP-PILOT-FIRST-004: pilot governance controls.
--
-- Additive only. No existing column is dropped or retyped; the one ALTER replaces a CHECK
-- constraint with a strict superset of its previous value set, so every row that satisfied
-- the old constraint still satisfies the new one.
--
-- Closes, in schema terms:
--   C-05  consent bound to an authoritative terms object rather than a free-form string
--   C-03  withdrawal and termination as states distinct from completion
--   C-04  a pilot-scoped stop that does not require stopping the backend
--   G6    a control point capable of enforcing a human-approved enrollment boundary

-- C-05 --------------------------------------------------------------------------------
-- The authoritative terms registry. A consent may only name a row that exists here.
-- NOTE: this table ships EMPTY. Until a human publishes real terms, no version is known,
-- so consent — and therefore enrollment — fails closed. That is the intended state.
CREATE TABLE IF NOT EXISTS pilot_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  digest text NOT NULL,                      -- sha256 of the exact content that was accepted
  content_reference text NOT NULL,           -- where that content is retrievable
  published_at timestamptz,                  -- NULL unless status = 'PUBLISHED'
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_terms_published_at_required
    CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);

-- Bind each consent to the exact terms object accepted. Nullable because pre-existing
-- consents predate the registry: an ABSENT binding is distinguishable from a wrong one,
-- and enrollment treats an unbound consent as not usable rather than as valid.
ALTER TABLE consents ADD COLUMN IF NOT EXISTS terms_id uuid REFERENCES pilot_terms(id);
ALTER TABLE consents ADD COLUMN IF NOT EXISTS terms_digest text;

-- C-03 --------------------------------------------------------------------------------
-- WITHDRAWN (participant leaves) and TERMINATED (operator ends one participation) are
-- distinct from COMPLETED. Collapsing them would destroy the difference between a pilot
-- that finished, one the participant left, and one an operator ended.
ALTER TABLE pilot_enrollments DROP CONSTRAINT IF EXISTS pilot_enrollments_state_check;
ALTER TABLE pilot_enrollments ADD CONSTRAINT pilot_enrollments_state_check CHECK (state IN (
  'PILOT_ACTIVE','DAY7_READY','DAY7_REVIEWED','DAY30_READY','OUTCOME_PENDING',
  'CONTINUE','PAID_PENDING_HUMAN_DECISION','INSTITUTIONAL_PENDING','EXTENDED','STOPPED','COMPLETED',
  'WITHDRAWN','TERMINATED'
));

-- An append-only record of every lifecycle exit, with actor, subject and reason.
CREATE TABLE IF NOT EXISTS pilot_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for pilot-wide events (STOP / RESUME), which belong to no single participation.
  enrollment_id uuid REFERENCES pilot_enrollments(id) ON DELETE CASCADE,
  subject_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('WITHDRAWAL','TERMINATION','STOP','RESUME')),
  previous_state text NOT NULL,
  new_state text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A participation event must name its participation; a pilot-wide event must not.
  CONSTRAINT pilot_lifecycle_scope CHECK (
    (kind IN ('WITHDRAWAL','TERMINATION') AND enrollment_id IS NOT NULL AND subject_user_id IS NOT NULL)
    OR (kind IN ('STOP','RESUME') AND enrollment_id IS NULL AND subject_user_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS pilot_lifecycle_enrollment_idx
  ON pilot_lifecycle_events(enrollment_id, created_at);

-- C-04 + G6 ---------------------------------------------------------------------------
-- One control row for the pilot as a whole. Stop is a PILOT state, not an infrastructure
-- action: the backend keeps serving every other route while the pilot refuses new activity.
--
-- max_participants is NULL and STAYS NULL until a human approves a number. NULL is not
-- "unlimited": enroll() refuses while the boundary is undecided.
CREATE TABLE IF NOT EXISTS pilot_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),   -- singleton
  stopped boolean NOT NULL DEFAULT false,
  stop_actor_id uuid REFERENCES users(id),
  stop_reason text,
  stop_at timestamptz,
  max_participants integer CHECK (max_participants IS NULL OR max_participants > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_control_stop_fields_required
    CHECK (stopped = false OR (stop_actor_id IS NOT NULL AND stop_reason IS NOT NULL AND stop_at IS NOT NULL))
);
INSERT INTO pilot_control (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
