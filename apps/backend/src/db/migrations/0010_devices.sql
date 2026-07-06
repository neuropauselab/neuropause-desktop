-- 0010_devices: trusted-device registry. One row per (org, device): the same
-- installation registered against two orgs is two rows. device_id is the client's
-- stable installation id (the livesync device id). trust_status gates access;
-- last_seen is refreshed on registration and heartbeat. Rows cascade-delete with
-- their org and their owning user.

CREATE TABLE devices (
  org_id        UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL,
  os            TEXT NOT NULL,
  arch          TEXT NOT NULL,
  app_version   TEXT NOT NULL,
  trust_status  TEXT NOT NULL DEFAULT 'trusted'
                  CHECK (trust_status IN ('trusted', 'blocked', 'revoked')),
  last_seen     TIMESTAMPTZ NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, device_id)
);

-- Device lists are scanned per org, newest-seen first.
CREATE INDEX devices_org_last_seen_idx ON devices (org_id, last_seen DESC);
-- Support cascade + per-user lookups.
CREATE INDEX devices_user_idx ON devices (user_id);
