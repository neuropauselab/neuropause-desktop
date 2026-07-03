-- 0002_store: the NeuroPause AI Store catalog, distribution, and engagement schema.
-- Designed to scale to 100k+ applications: normalized core, denormalized ranking
-- counters kept fresh by triggers, full-text + trigram search, and tight indexes
-- on every hot read path. Extensible enums are modeled as TEXT + CHECK so new
-- application/runtime/permission kinds can be added without an ALTER TYPE migration.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy name search (GIN trigram)

-- ───────────────────────────── Publishers ──────────────────────────────────

-- Organizations: a publishing company / team. Enterprise publishers are flagged.
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  website       TEXT,
  logo_url      TEXT,
  is_enterprise BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Developers: the entity that owns and ships applications. May be an individual
-- or an organization account (then organization_id is set).
CREATE TABLE developers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'individual'
                    CHECK (kind IN ('individual', 'organization')),
  organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  website         TEXT,
  support_url     TEXT,
  email           TEXT,
  avatar_url      TEXT,
  bio             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX developers_organization_id_idx ON developers (organization_id);

-- Verified developers: one row per verified developer (presence == verified).
CREATE TABLE developer_verifications (
  developer_id UUID PRIMARY KEY REFERENCES developers (id) ON DELETE CASCADE,
  tier         TEXT NOT NULL DEFAULT 'standard'
                 CHECK (tier IN ('standard', 'partner', 'enterprise')),
  verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by  TEXT,
  notes        TEXT
);

-- ───────────────────────────── Taxonomy ────────────────────────────────────

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  parent_id   UUID REFERENCES categories (id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX categories_parent_id_idx ON categories (parent_id);
CREATE INDEX categories_sort_order_idx ON categories (sort_order);

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────────── Applications ────────────────────────────────

CREATE TABLE applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  tagline            TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  developer_id       UUID NOT NULL REFERENCES developers (id) ON DELETE RESTRICT,
  category_id        UUID NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  app_type           TEXT NOT NULL DEFAULT 'web'
                       CHECK (app_type IN ('web', 'desktop_plugin', 'electron',
                                           'native', 'ai_agent', 'mcp_server', 'automation')),
  status             TEXT NOT NULL DEFAULT 'published'
                       CHECK (status IN ('draft', 'published', 'unlisted', 'removed')),
  icon_glyph         TEXT,
  icon_tone          TEXT,
  icon_url           TEXT,
  homepage_url       TEXT,
  launch_url         TEXT,
  repository_url     TEXT,
  is_open_source     BOOLEAN NOT NULL DEFAULT FALSE,
  license            TEXT,
  pricing_kind       TEXT NOT NULL DEFAULT 'free'
                       CHECK (pricing_kind IN ('free', 'freemium', 'paid', 'subscription', 'enterprise')),
  install_count      BIGINT NOT NULL DEFAULT 0,
  download_count     BIGINT NOT NULL DEFAULT 0,
  is_staff_pick      BOOLEAN NOT NULL DEFAULT FALSE,
  trending_score     NUMERIC NOT NULL DEFAULT 0,
  first_published_at TIMESTAMPTZ,
  latest_release_at  TIMESTAMPTZ,
  search_tsv         TSVECTOR,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX applications_developer_id_idx   ON applications (developer_id);
CREATE INDEX applications_category_id_idx    ON applications (category_id);
CREATE INDEX applications_app_type_idx       ON applications (app_type);
CREATE INDEX applications_pricing_kind_idx   ON applications (pricing_kind);
-- Hot ranking paths, scoped to the only rows browse queries ever read.
CREATE INDEX applications_trending_idx   ON applications (trending_score DESC) WHERE status = 'published';
CREATE INDEX applications_installs_idx   ON applications (install_count DESC)  WHERE status = 'published';
CREATE INDEX applications_new_idx        ON applications (first_published_at DESC) WHERE status = 'published';
CREATE INDEX applications_updated_idx    ON applications (latest_release_at DESC)  WHERE status = 'published';
CREATE INDEX applications_staff_pick_idx ON applications (is_staff_pick) WHERE is_staff_pick;
CREATE INDEX applications_open_source_idx ON applications (is_open_source) WHERE is_open_source;
-- Search: weighted full-text (GIN) + trigram on name for typo tolerance.
CREATE INDEX applications_search_tsv_idx ON applications USING GIN (search_tsv);
CREATE INDEX applications_name_trgm_idx  ON applications USING GIN (name gin_trgm_ops);

-- Many-to-many application <-> tags.
CREATE TABLE app_tags (
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  tag_id         UUID NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (application_id, tag_id)
);
CREATE INDEX app_tags_tag_id_idx ON app_tags (tag_id);

-- ───────────────────────── Versions / Releases ─────────────────────────────

CREATE TABLE versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  version        TEXT NOT NULL,                       -- semver, e.g. 1.4.2
  is_prerelease  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, version)
);
CREATE INDEX versions_application_id_idx ON versions (application_id);

-- Update channels are global (stable / beta / canary).
CREATE TABLE update_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- A release publishes a version on a channel, with the artifact + integrity data
-- the package manager (NPMX) needs to fetch, verify, and (optionally) delta-apply.
CREATE TABLE releases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  version_id           UUID NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
  channel_id           UUID NOT NULL REFERENCES update_channels (id) ON DELETE RESTRICT,
  artifact_url         TEXT,                           -- null for web apps (nothing to download)
  artifact_size_bytes  BIGINT,
  sha256               TEXT,                           -- integrity digest
  signature            TEXT,                           -- detached signature (base64)
  signature_key_id     TEXT,                           -- which publisher key signed it
  min_host_version     TEXT,                           -- minimum NeuroPause version
  is_delta             BOOLEAN NOT NULL DEFAULT FALSE,
  delta_base_version_id UUID REFERENCES versions (id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'published'
                         CHECK (status IN ('published', 'rolled_back', 'deprecated')),
  released_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, channel_id)
);
CREATE INDEX releases_application_id_idx ON releases (application_id);
CREATE INDEX releases_channel_id_idx     ON releases (channel_id);
CREATE INDEX releases_released_at_idx    ON releases (released_at DESC);

-- Human-readable release notes per version.
CREATE TABLE changelogs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  version_id     UUID NOT NULL UNIQUE REFERENCES versions (id) ON DELETE CASCADE,
  body           TEXT,                                 -- markdown
  highlights     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX changelogs_application_id_idx ON changelogs (application_id);

-- ─────────────────────── Media / Pricing / Ratings ─────────────────────────

CREATE TABLE screenshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  thumbnail_url  TEXT,
  caption        TEXT,
  width          INTEGER,
  height         INTEGER,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX screenshots_application_id_idx ON screenshots (application_id, sort_order);

CREATE TABLE pricing_plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  price_cents    INTEGER NOT NULL DEFAULT 0,
  currency       CHAR(3) NOT NULL DEFAULT 'USD',
  interval       TEXT NOT NULL DEFAULT 'month'
                   CHECK (interval IN ('once', 'month', 'year', 'custom')),
  features       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pricing_plans_application_id_idx ON pricing_plans (application_id, sort_order);

-- Aggregate rating + 1→5 star distribution, maintained by trigger on reviews.
CREATE TABLE app_ratings (
  application_id UUID PRIMARY KEY REFERENCES applications (id) ON DELETE CASCADE,
  rating_avg     NUMERIC(3, 2) NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  count_1        INTEGER NOT NULL DEFAULT 0,
  count_2        INTEGER NOT NULL DEFAULT 0,
  count_3        INTEGER NOT NULL DEFAULT 0,
  count_4        INTEGER NOT NULL DEFAULT 0,
  count_5        INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title          TEXT,
  body           TEXT,
  version_id     UUID REFERENCES versions (id) ON DELETE SET NULL,
  is_edited      BOOLEAN NOT NULL DEFAULT FALSE,
  helpful_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, user_id)                     -- one review per user per app
);
CREATE INDEX reviews_application_id_idx ON reviews (application_id, created_at DESC);
CREATE INDEX reviews_user_id_idx        ON reviews (user_id);

-- ──────────────────── Engagement: downloads / installs ─────────────────────

-- Append-only download event log (NPMX records each fetch).
CREATE TABLE downloads (
  id             BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  release_id     UUID REFERENCES releases (id) ON DELETE SET NULL,
  user_id        UUID REFERENCES users (id) ON DELETE SET NULL,
  channel        TEXT,
  ip             INET,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX downloads_application_id_idx ON downloads (application_id, created_at DESC);
CREATE INDEX downloads_user_id_idx        ON downloads (user_id);

-- Current per-user installation state (the server mirror of the local registry).
CREATE TABLE installations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  application_id       UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  version_id           UUID REFERENCES versions (id) ON DELETE SET NULL,
  channel_id           UUID REFERENCES update_channels (id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'installed'
                         CHECK (status IN ('installed', 'updating', 'paused', 'uninstalled', 'failed')),
  install_location     TEXT,
  granted_permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- PermissionKey[]
  last_launched_at     TIMESTAMPTZ,
  launch_count         INTEGER NOT NULL DEFAULT 0,
  installed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  uninstalled_at       TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, application_id)
);
CREATE INDEX installations_user_id_idx        ON installations (user_id);
CREATE INDEX installations_application_id_idx ON installations (application_id);
CREATE INDEX installations_recent_idx         ON installations (user_id, last_launched_at DESC);

CREATE TABLE bookmarks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, application_id)
);
CREATE INDEX bookmarks_user_id_idx ON bookmarks (user_id, created_at DESC);

-- ───────────────────── Merchandising: collections ──────────────────────────

CREATE TABLE collections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  subtitle       TEXT,
  description    TEXT,
  kind           TEXT NOT NULL DEFAULT 'manual'
                   CHECK (kind IN ('manual', 'auto')),
  auto_rule      TEXT,                                 -- for kind='auto': a StoreSectionKey
  is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
  hero_image_url TEXT,
  accent         TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collections_featured_idx ON collections (is_featured, sort_order);

CREATE TABLE collection_apps (
  collection_id  UUID NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, application_id)
);
CREATE INDEX collection_apps_application_id_idx ON collection_apps (application_id);

-- The top hero banner rotation.
CREATE TABLE featured_apps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  headline       TEXT NOT NULL,
  subheadline    TEXT,
  banner_image_url TEXT,
  accent         TEXT,
  cta_label      TEXT,
  starts_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at        TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX featured_apps_active_idx ON featured_apps (is_active, sort_order);
CREATE INDEX featured_apps_application_id_idx ON featured_apps (application_id);

-- ──────────────────── Security: permissions / packages ─────────────────────

-- Declared capabilities an app requests; surfaced in the install permission dialog.
CREATE TABLE app_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  permission     TEXT NOT NULL
                   CHECK (permission IN ('network', 'filesystem_read', 'filesystem_write',
                                         'clipboard', 'notifications', 'camera', 'microphone',
                                         'local_models', 'automation', 'background')),
  required       BOOLEAN NOT NULL DEFAULT TRUE,
  reason         TEXT,
  scope          TEXT,                                 -- e.g. allowed domains for 'network'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, permission)
);
CREATE INDEX app_permissions_application_id_idx ON app_permissions (application_id);

-- Installable package metadata + manifest per runtime. One app may ship several
-- packages (e.g. a web app and an MCP server). Drives the plugin architecture.
CREATE TABLE plugin_packages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  version_id       UUID REFERENCES versions (id) ON DELETE SET NULL,
  runtime          TEXT NOT NULL
                     CHECK (runtime IN ('web', 'desktop_plugin', 'electron',
                                        'native', 'ai_agent', 'mcp_server', 'automation')),
  entry            TEXT NOT NULL,                       -- URL / main file / command
  manifest         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full plugin manifest
  sandbox          TEXT NOT NULL DEFAULT 'iframe'
                     CHECK (sandbox IN ('none', 'iframe', 'process', 'container')),
  sha256           TEXT,
  signature        TEXT,
  signature_key_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, runtime)
);
CREATE INDEX plugin_packages_application_id_idx ON plugin_packages (application_id);
CREATE INDEX plugin_packages_runtime_idx        ON plugin_packages (runtime);

-- ───────────────────────────── Triggers ────────────────────────────────────

-- keep updated_at fresh (set_updated_at() defined in 0001).
CREATE TRIGGER organizations_set_updated_at  BEFORE UPDATE ON organizations  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER developers_set_updated_at     BEFORE UPDATE ON developers     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER applications_set_updated_at   BEFORE UPDATE ON applications   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER reviews_set_updated_at        BEFORE UPDATE ON reviews        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER installations_set_updated_at  BEFORE UPDATE ON installations  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER collections_set_updated_at    BEFORE UPDATE ON collections    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER plugin_packages_set_updated_at BEFORE UPDATE ON plugin_packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maintain the weighted search vector on applications.
CREATE OR REPLACE FUNCTION applications_tsv_refresh() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.tagline, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applications_tsv
  BEFORE INSERT OR UPDATE OF name, tagline, description ON applications
  FOR EACH ROW EXECUTE FUNCTION applications_tsv_refresh();

-- Recompute the rating aggregate + distribution whenever reviews change.
CREATE OR REPLACE FUNCTION recalc_app_ratings() RETURNS trigger AS $$
DECLARE
  aid UUID;
BEGIN
  aid := COALESCE(NEW.application_id, OLD.application_id);
  INSERT INTO app_ratings AS r
    (application_id, rating_avg, rating_count, count_1, count_2, count_3, count_4, count_5, updated_at)
  SELECT
    aid,
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE rating = 1),
    COUNT(*) FILTER (WHERE rating = 2),
    COUNT(*) FILTER (WHERE rating = 3),
    COUNT(*) FILTER (WHERE rating = 4),
    COUNT(*) FILTER (WHERE rating = 5),
    now()
  FROM reviews WHERE application_id = aid
  ON CONFLICT (application_id) DO UPDATE SET
    rating_avg   = EXCLUDED.rating_avg,
    rating_count = EXCLUDED.rating_count,
    count_1 = EXCLUDED.count_1, count_2 = EXCLUDED.count_2, count_3 = EXCLUDED.count_3,
    count_4 = EXCLUDED.count_4, count_5 = EXCLUDED.count_5,
    updated_at = now();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviews_recalc_ratings
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION recalc_app_ratings();

-- Increment the denormalized download counter.
CREATE OR REPLACE FUNCTION bump_download_count() RETURNS trigger AS $$
BEGIN
  UPDATE applications SET download_count = download_count + 1 WHERE id = NEW.application_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER downloads_bump_count
  AFTER INSERT ON downloads
  FOR EACH ROW EXECUTE FUNCTION bump_download_count();

-- Increment the install counter only on transition into 'installed'.
CREATE OR REPLACE FUNCTION bump_install_count() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'installed') THEN
    UPDATE applications SET install_count = install_count + 1 WHERE id = NEW.application_id;
  ELSIF (TG_OP = 'UPDATE' AND NEW.status = 'installed' AND OLD.status <> 'installed') THEN
    UPDATE applications SET install_count = install_count + 1 WHERE id = NEW.application_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER installations_bump_count
  AFTER INSERT OR UPDATE ON installations
  FOR EACH ROW EXECUTE FUNCTION bump_install_count();
