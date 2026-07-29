/**
 * Database schema (NCEA 12.0, Phase 1/2/3/4/5). The ordered, reversible migration
 * set. Every service owns its OWN table (no shared mutable tables); every row is
 * tenant-scoped (`tenant_id`) and carries an optimistic-concurrency `version` plus
 * created/updated/deleted timestamps. Operational and knowledge entities share a
 * uniform (tenant_id, id, doc jsonb, version, …) shape so one generic repository
 * serves them all while each keeps a distinct table and its own indexes.
 */
import type { Migration } from './migrations';

/** A standard tenant-scoped, versioned, soft-deletable entity table. */
function entityTable(name: string, jsonIndexes: string[] = []): { up: string; down: string } {
  const idx = jsonIndexes
    .map((field) => `CREATE INDEX ${name}_${field}_idx ON ${name} ((doc->>'${field}')) WHERE deleted_at IS NULL;`)
    .join('\n');
  return {
    up: `
      CREATE TABLE ${name} (
        tenant_id  text    NOT NULL,
        id         text    NOT NULL,
        doc        jsonb   NOT NULL,
        version    integer NOT NULL DEFAULT 1,
        created_at bigint  NOT NULL,
        updated_at bigint  NOT NULL,
        deleted_at bigint,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE INDEX ${name}_tenant_idx ON ${name} (tenant_id) WHERE deleted_at IS NULL;
      ${idx}
    `,
    down: `DROP TABLE IF EXISTS ${name};`,
  };
}

const OPERATIONAL_TABLES: Array<[string, string[]]> = [
  ['organizations', []],
  ['users', ['orgId']],
  ['ai_employees', ['ownerPrincipalId', 'role']],
  ['workspaces', ['ownerOrgId']],
  ['projects', ['workspaceId', 'status']],
  ['tasks', ['workspaceId', 'projectId', 'status']],
  ['policies', ['workspaceId']],
  ['connectors', ['state']],
  ['sessions', ['principalId']],
  ['runtime_metadata', []],
];

const KNOWLEDGE_TABLES: Array<[string, string[]]> = [
  ['ckdl_entities', ['kind']],
  ['ckdl_relationships', ['type', 'from', 'to']],
  ['ckdl_decisions', ['status', 'owner']],
  ['ckdl_evidence', ['type', 'aboutKey']],
  ['ckdl_objectives', ['kind', 'owner']],
  ['ckdl_trust_inputs', ['entityKey']],
];

function batch(tables: Array<[string, string[]]>): { up: string; down: string } {
  const parts = tables.map(([name, idx]) => entityTable(name, idx));
  return {
    up: parts.map((p) => p.up).join('\n'),
    down: parts
      .map((p) => p.down)
      .reverse()
      .join('\n'),
  };
}

const op = batch(OPERATIONAL_TABLES);
const kn = batch(KNOWLEDGE_TABLES);

/** The append-only event store + snapshot tables. */
const EVENTS: Migration = {
  version: 4,
  name: 'event_store',
  up: `
    CREATE TABLE events (
      seq          bigserial PRIMARY KEY,
      tenant_id    text   NOT NULL,
      stream       text   NOT NULL,
      type         text   NOT NULL,
      topic        text   NOT NULL,
      schema_version integer NOT NULL DEFAULT 1,
      payload      jsonb  NOT NULL,
      at           bigint NOT NULL,
      hash         text   NOT NULL
    );
    CREATE INDEX events_stream_idx ON events (tenant_id, stream, seq);
    CREATE INDEX events_tenant_seq_idx ON events (tenant_id, seq);
    CREATE INDEX events_type_idx ON events (tenant_id, type);
    CREATE TABLE event_snapshots (
      tenant_id text   NOT NULL,
      stream    text   NOT NULL,
      seq       bigint NOT NULL,
      state     jsonb  NOT NULL,
      at        bigint NOT NULL,
      PRIMARY KEY (tenant_id, stream)
    );
  `,
  down: `DROP TABLE IF EXISTS event_snapshots; DROP TABLE IF EXISTS events;`,
};

/**
 * Object-storage METADATA only — bytes live in the blob store, not Postgres.
 * Uses the uniform entity shape (id == storage key) so the generic repository
 * serves it; the (tenant_id, id) primary key enforces per-tenant key uniqueness.
 */
const blobTable = entityTable('blob_metadata', ['kind']);
const BLOBS: Migration = { version: 5, name: 'blob_metadata', up: blobTable.up, down: blobTable.down };

/**
 * Row-level security policies (Phase 9). These are valid, applied Postgres
 * policies; ENFORCEMENT requires connecting as a non-superuser role that sets
 * `app.tenant_id` per session. In-container validation runs PGlite as superuser
 * (which bypasses RLS by design), so tenant isolation is ALSO enforced at the
 * repository layer (every query is tenant-scoped) and tested there. On a
 * production cluster with a scoped role, these policies are the second line.
 */
const RLS: Migration = {
  version: 6,
  name: 'row_level_security',
  up: [...OPERATIONAL_TABLES, ...KNOWLEDGE_TABLES]
    .map(
      ([name]) => `
      ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${name}_tenant_isolation ON ${name}
        USING (tenant_id = current_setting('app.tenant_id', true));
    `,
    )
    .join('\n'),
  down: [...OPERATIONAL_TABLES, ...KNOWLEDGE_TABLES]
    .map(([name]) => `DROP POLICY IF EXISTS ${name}_tenant_isolation ON ${name}; ALTER TABLE ${name} DISABLE ROW LEVEL SECURITY;`)
    .join('\n'),
};

/** The canonical, ordered schema. Each service owns its tables; all reversible. */
export const SCHEMA: Migration[] = [
  {
    version: 1,
    name: 'tenants',
    up: `
      CREATE TABLE tenants (
        tenant_id  text   PRIMARY KEY,
        name       text   NOT NULL,
        status     text   NOT NULL DEFAULT 'active',
        created_at bigint NOT NULL
      );
    `,
    down: `DROP TABLE IF EXISTS tenants;`,
  },
  { version: 2, name: 'operational_core', up: op.up, down: op.down },
  { version: 3, name: 'knowledge_graph', up: kn.up, down: kn.down },
  EVENTS,
  BLOBS,
  RLS,
];

/** Table names, grouped by owning service — used by backup and by tenancy tooling. */
export const OPERATIONAL_TABLE_NAMES = OPERATIONAL_TABLES.map(([n]) => n);
export const KNOWLEDGE_TABLE_NAMES = KNOWLEDGE_TABLES.map(([n]) => n);
export const TENANT_SCOPED_ENTITY_TABLES = [...OPERATIONAL_TABLE_NAMES, ...KNOWLEDGE_TABLE_NAMES];
