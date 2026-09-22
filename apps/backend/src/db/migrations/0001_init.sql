-- 0001_init: core identity, sessions, and audit schema.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";    -- case-insensitive email column

-- Application users. One row per person.
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        CITEXT NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  password_hash TEXT,                 -- null for OAuth-only accounts
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (email);

-- Federated identities. A user may link several providers.
CREATE TABLE auth_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,             -- google | github | microsoft | apple
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX auth_identities_user_id_idx ON auth_identities (user_id);

-- Refresh-token sessions. We store only a SHA-256 hash of the opaque token.
-- Rotation: issuing a new token marks the previous as rotated and links them,
-- enabling reuse detection (a presented-but-rotated token => revoke the chain).
CREATE TABLE auth_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  rotated_to      UUID REFERENCES auth_sessions (id) ON DELETE SET NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

-- Audit log of security-relevant events.
--
-- NOT APPEND-ONLY, despite what this comment said until NP-PILOT-FIRST-005 measured it. The
-- application itself UPDATEs this table: account deletion runs
--   UPDATE audit_log SET ip = NULL, detail = '{"redacted": true}'::jsonb WHERE user_id = $1
-- and nothing prevents it. Across all 17 migrations, zero triggers, rules or REVOKEs target
-- this table (every trigger in the schema is a `set_updated_at`), and the application role is
-- the migration role. Append-only was a description of intent, not of an enforced property,
-- and the redaction statement is a deliberate privacy control rather than a violation - the
-- claim was simply stated more strongly than the schema supports.
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_user_id_idx ON audit_log (user_id);
CREATE INDEX audit_log_action_idx ON audit_log (action);

-- Keep updated_at fresh on users.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
