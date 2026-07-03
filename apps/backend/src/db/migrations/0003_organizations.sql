-- 0003_organizations: SaaS tenancy — memberships (org<->user with role) and
-- workspaces. Reuses `organizations` and `users` from earlier migrations, plus
-- the shared gen_random_uuid()/citext/set_updated_at() established in 0001/0002.

-- A user's membership in an organization, with a role. Pending invitations live
-- here too (status = 'invited'): an invite is a membership row keyed by email,
-- with no user_id, until it is accepted and bound to a user.
CREATE TABLE memberships (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id            UUID REFERENCES users (id) ON DELETE CASCADE,   -- null while invited
  role               TEXT NOT NULL DEFAULT 'member'
                       CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'invited', 'suspended')),
  invited_email      CITEXT,                 -- set while status = 'invited'
  invite_token_hash  TEXT UNIQUE,            -- SHA-256 of the opaque invite token
  invite_expires_at  TIMESTAMPTZ,
  invited_by         UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user has at most one membership per organization.
CREATE UNIQUE INDEX memberships_org_user_unique
  ON memberships (org_id, user_id) WHERE user_id IS NOT NULL;

-- At most one pending invite per (org, email).
CREATE UNIQUE INDEX memberships_org_invite_unique
  ON memberships (org_id, invited_email) WHERE status = 'invited' AND invited_email IS NOT NULL;

CREATE INDEX memberships_user_id_idx ON memberships (user_id);
CREATE INDEX memberships_org_id_idx ON memberships (org_id);

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Workspaces: a container within an organization. Mirrors the desktop's local
-- workspace concept, but owned by the cloud org.
CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workspaces_org_id_idx ON workspaces (org_id);

CREATE TRIGGER workspaces_set_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
