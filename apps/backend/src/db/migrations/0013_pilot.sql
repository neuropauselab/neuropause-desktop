-- Pilot lifecycle: consent records, enrollments, event ledger, human decisions.
-- Additive only; no existing table is altered.
CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consents_user_idx ON consents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pilot_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN (
    'PILOT_ACTIVE','DAY7_READY','DAY7_REVIEWED','DAY30_READY','OUTCOME_PENDING',
    'CONTINUE','PAID_PENDING_HUMAN_DECISION','INSTITUTIONAL_PENDING','EXTENDED','STOPPED','COMPLETED'
  )),
  consent_id uuid NOT NULL REFERENCES consents(id),
  decision_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pilot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES pilot_enrollments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pilot_events_enrollment_idx ON pilot_events(enrollment_id, created_at);

CREATE TABLE IF NOT EXISTS human_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id),
  decision_type text NOT NULL,
  subject text NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
