-- NP-PILOT-FIRST-008 — the tables behind ENG-04, ENG-05, ENG-06, ENV-01 and ENV-02.
--
-- EVERY TABLE HERE SHIPS EMPTY, AND THAT IS THE POINT. Each one is a control that fails
-- closed while its content is undecided:
--
--   pilot_environment_identity  no row  => the application REFUSES TO START as a pilot
--   pilot_role_bindings         no row  => every authority decision is DENY
--   pilot_authority_decisions   no row  => every authority decision is DENY
--   pilot_closure               no row  => the retention clock has not started, so
--                                          NOTHING is ever eligible for processing
--
-- None of these can be filled by application code. A migration that seeded any of them would
-- be the system granting itself authority, declaring its own environment, or starting its own
-- retention clock.

-- ---------------------------------------------------------------------------------------
-- ENV-01 / ENV-02 — the environment's identity, asserted BY THE DATABASE ITSELF.
--
-- A configuration string saying "this is the pilot database" is a claim by whoever set the
-- variable. This row is a claim by the database being connected to. Requiring BOTH, and
-- requiring them to match, is what makes the target identity authentic rather than asserted:
-- pointing a PILOT-configured application at a database that does not carry this row fails
-- closed, and so does pointing it at one carrying a different id.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_environment_identity (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),        -- singleton
  environment_class text NOT NULL CHECK (environment_class = 'PILOT'),
  environment_id text NOT NULL,
  target_id text NOT NULL,                                -- this database's declared identity
  declared_by text NOT NULL,                              -- who declared it, for the record
  declared_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately NO INSERT. The CHECK also means this table can never describe production.

-- ---------------------------------------------------------------------------------------
-- ENG-04 — role bindings. A BINDING IS A FACT ABOUT AN AUTHENTICATED SUBJECT, NOT A NAME.
--
-- `subject_id` is an authenticated identifier. It is NOT a display name, an email, a job
-- title, or a repository permission. NP-PILOT-FIRST-HUMAN-001 D05 designates three PEOPLE;
-- it supplies no identifiers, so this table stays empty and every route keeps refusing.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_role_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN (
    'FIRST_PILOT_HUMAN_DECISION_AUTHORITY',
    'PILOT_OPERATOR_TECHNICAL_OPERATIONS',
    'INDEPENDENT_PILOT_VERIFIER'
  )),
  decision_ref text NOT NULL,          -- the human instrument that created this binding
  bound_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (subject_id, role)
);
CREATE INDEX IF NOT EXISTS pilot_role_bindings_subject_idx ON pilot_role_bindings (subject_id);

-- ---------------------------------------------------------------------------------------
-- ENG-04 — decision artifacts. A BINDING SAYS WHO; A DECISION SAYS WHAT THEY MAY DO.
--
-- `authenticated` is the load-bearing column and it defaults to FALSE. An unsigned instrument
-- may be RECORDED here - it is a real artifact and its existence is a fact - but it authorizes
-- nothing until a human process sets this true. That is why the column exists rather than the
-- row simply being absent: a refusal that names the instrument is more auditable than silence.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_authority_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument text NOT NULL UNIQUE,
  authenticated boolean NOT NULL DEFAULT false,
  actions text[] NOT NULL,
  environment_class text NOT NULL CHECK (environment_class = 'PILOT'),
  effective_from timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------
-- ENG-05 — pilot closure. THE RETENTION CLOCK STARTS HERE AND NOWHERE ELSE.
--
-- D13 sets retention at 90 days AFTER PILOT CLOSURE, not after row creation. With no row
-- here the pilot has not closed, so no retention period has begun and nothing is eligible -
-- which is the correct state for a pilot that has never run.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_closure (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),        -- singleton
  closed_at timestamptz NOT NULL,
  closed_by uuid NOT NULL REFERENCES users(id),
  closure_reason text NOT NULL
);

-- ---------------------------------------------------------------------------------------
-- ENG-05 — holds. A HOLD OUTRANKS THE RETENTION CLOCK, ALWAYS.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_retention_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_class text NOT NULL CHECK (hold_class IN ('LEGAL', 'INCIDENT', 'AUDIT')),
  subject_user_id uuid REFERENCES users(id) ON DELETE CASCADE,  -- NULL = pilot-wide
  reason text NOT NULL,
  placed_by uuid NOT NULL REFERENCES users(id),
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS pilot_retention_holds_subject_idx ON pilot_retention_holds (subject_user_id);

-- ---------------------------------------------------------------------------------------
-- ENG-05 — the retention ledger. IDEMPOTENCE LIVES IN THIS TABLE, NOT IN A FLAG.
--
-- A processed row is recorded here with the class and method actually applied. Re-running the
-- job finds the record and does nothing, so a second run is a no-op rather than a second
-- destructive pass. `method` records PSEUDONYMIZED or DELETED verbatim - D13 forbids calling
-- a reversible mapping anonymization, so the ledger must not blur the two either.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_retention_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_class text NOT NULL,
  subject_user_id uuid,                -- NOT a FK: the subject may since have been removed
  method text NOT NULL CHECK (method IN ('PSEUDONYMIZED', 'DELETED', 'PRESERVED_UNDER_HOLD')),
  processed_at timestamptz NOT NULL DEFAULT now(),
  closure_at timestamptz NOT NULL,     -- the closure this run was measured against
  -- NULLS NOT DISTINCT IS LOAD-BEARING, and was found by a concurrency test rather than by
  -- reading this file. A plain UNIQUE treats every NULL as distinct, so two concurrent runs
  -- BOTH claimed the pilot-wide rows (subject_user_id IS NULL) and both processed them. The
  -- serial idempotence test passed anyway, because the PLAN deduplicates in JavaScript where
  -- null compares equal - so the plan was masking a constraint that never fired.
  -- Requires PostgreSQL 15+.
  UNIQUE NULLS NOT DISTINCT (data_class, subject_user_id, closure_at)
);

-- ---------------------------------------------------------------------------------------
-- ENG-06 — the monitoring ledger.
--
-- The programme's standing law: the log is diagnostic, the evidence store is the record. A
-- monitor that only wrote to the application log would leave an audit unable to see that a
-- refusal ever happened.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_monitor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_class text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  outcome text NOT NULL CHECK (outcome IN ('BLOCKED', 'DENIED', 'RECORDED')),
  actor_id uuid,
  subject_user_id uuid,
  action text,
  reason_code text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pilot_monitor_events_class_idx ON pilot_monitor_events (alert_class, created_at DESC);
