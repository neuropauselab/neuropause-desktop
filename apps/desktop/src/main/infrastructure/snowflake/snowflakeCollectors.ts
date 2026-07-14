/**
 * Snowflake DomainCollectors (P6.8). Each collector discovers ONE Snowflake object type via the P6.0
 * `DomainCollector` contract — it runs a credit-free `SHOW` metadata statement through the SQL transport, maps each
 * returned row into a `CloudResource` with its typed relationships, and returns a `DiscoveryPage`. The Discovery
 * Engine degrades a domain on 403 (the discovery role lacks a grant → unauthorized) / 404 (unprovisioned) and sinks
 * the resources into the Resource Store + Graph.
 *
 * Snowflake specifics: the ACCOUNT is the scope. Rows come back with every cell as a STRING (or null) keyed by the
 * lower-cased column name (`snowflakeQuery` parses by name, not index — Snowflake appends SHOW columns over time).
 * Objects form a containment tree — a schema is `member_of` its database, a table/view/stage/pipe/stream/task is
 * `member_of` its schema — and every resource's `nativeId` is its qualified name (`DB`, `DB.SCHEMA`,
 * `DB.SCHEMA.OBJECT`), so the graph resolves the `member_of` edges (case-insensitively). A stream `uses` its base
 * table; a task `uses` its warehouse. Ownership is surfaced as the `owner` attribute (the owning role).
 */
import {
  makeResource,
  makeResourceId,
  type DiscoveryContext,
  type DomainCollector,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { snowflakeQuery } from './snowflakeClient';

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
};

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const bool = (v: unknown): boolean => String(v).trim().toLowerCase() === 'true';
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
/** A qualified Snowflake name (`DB`, `DB.SCHEMA`, `DB.SCHEMA.OBJECT`) — the nativeId + relationship-target scheme. */
const qual = (...parts: Array<string | null>): string => parts.filter((p): p is string => !!p).join('.');
const page = (resources: ReturnType<typeof makeResource>[]) => ({ resources, cursor: null, hasMore: false });
/**
 * A TYPE-PRECISE relationship target: the target resource's full id (`platform:account:type:nativeId`). Snowflake
 * gives each object type its OWN name namespace, so a warehouse and a database can share a name — a bare native id
 * would collide in the graph's type-agnostic native index. Emitting the resolved id (which includes the type)
 * binds the edge to exactly the right resource. Used only where the target's type is known.
 */
const ref = (ctx: DiscoveryContext, type: string, nativeId: string | null): string | null =>
  nativeId ? makeResourceId(ctx.platformId, ctx.accountId, type, nativeId) : null;

function build(ctx: DiscoveryContext, domain: InfrastructureDomain, resourceType: string, m: MappedResource) {
  return makeResource({
    platformId: ctx.platformId,
    provider: 'snowflake',
    accountId: ctx.accountId,
    domain,
    resourceType,
    region: null, // the account IS the scope.
    now: ctx.now,
    nativeId: m.nativeId,
    name: m.name,
    status: m.status,
    health: m.health,
    tags: m.tags,
    attributes: m.attributes,
    relationships: m.relationships,
  });
}

interface SfCollectorSpec {
  id: string;
  domain: InfrastructureDomain;
  label: string;
  resourceType: string;
  statement: string;
  map: (row: Rec, ctx: DiscoveryContext) => MappedResource;
}
function sfCollector(spec: SfCollectorSpec): DomainCollector {
  return {
    id: spec.id,
    domain: spec.domain,
    label: spec.label,
    resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const rows = await snowflakeQuery(ctx.http, spec.statement);
      const resources = rows
        .map((row) => spec.map(row, ctx))
        .filter((m) => m.nativeId)
        .map((m) => build(ctx, spec.domain, spec.resourceType, m));
      return page(resources);
    },
  };
}

/* ── health mappers ──────────────────────────────────────────────────────────── */

const warehouseHealth = (state: string | null): ResourceHealth =>
  state === 'STARTED' ? 'healthy' : state === 'SUSPENDED' ? 'unknown' : 'degraded'; // suspended is an intentional cost state
const taskHealth = (state: string | null): ResourceHealth => (state === 'started' || state === 'STARTED' ? 'healthy' : 'degraded');
function monitorHealth(used: number | null, quota: number | null): ResourceHealth {
  if (quota == null || quota <= 0 || used == null) return 'unknown';
  const ratio = used / quota;
  return ratio >= 1 ? 'critical' : ratio >= 0.9 ? 'degraded' : 'healthy';
}

/* ── collectors ──────────────────────────────────────────────────────────────── */

export const SNOWFLAKE_COLLECTORS: DomainCollector[] = [
  sfCollector({
    id: 'sf_warehouses', domain: 'compute', label: 'Warehouses', resourceType: 'warehouse', statement: 'SHOW WAREHOUSES',
    map: (w) => {
      const state = str(w.state);
      return { nativeId: str(w.name) ?? '', name: str(w.name) || 'warehouse', status: state, health: warehouseHealth(state), attributes: { size: str(w.size), type: str(w.type), state, autoSuspend: num(w.auto_suspend), running: num(w.running), owner: str(w.owner) } };
    },
  }),
  sfCollector({
    id: 'sf_databases', domain: 'databases', label: 'Databases', resourceType: 'database', statement: 'SHOW DATABASES',
    map: (d) => ({ nativeId: str(d.name) ?? '', name: str(d.name) || 'database', status: str(d.kind), health: 'healthy', attributes: { owner: str(d.owner), kind: str(d.kind), retentionTime: num(d.retention_time) } }),
  }),
  sfCollector({
    id: 'sf_schemas', domain: 'databases', label: 'Schemas', resourceType: 'schema', statement: 'SHOW SCHEMAS IN ACCOUNT',
    map: (s, ctx) => {
      const db = str(s.database_name);
      return { nativeId: qual(db, str(s.name)), name: str(s.name) || 'schema', health: 'healthy', attributes: { owner: str(s.owner), database: db }, relationships: rel('member_of', ref(ctx, 'database', db)) };
    },
  }),
  sfCollector({
    id: 'sf_tables', domain: 'databases', label: 'Tables', resourceType: 'table', statement: 'SHOW TABLES IN ACCOUNT',
    map: (t, ctx) => {
      const db = str(t.database_name);
      const schema = str(t.schema_name);
      return { nativeId: qual(db, schema, str(t.name)), name: str(t.name) || 'table', status: str(t.kind), health: 'healthy', attributes: { owner: str(t.owner), kind: str(t.kind), rows: num(t.rows), bytes: num(t.bytes), database: db, schema }, relationships: rel('member_of', ref(ctx, 'schema', qual(db, schema))) };
    },
  }),
  sfCollector({
    id: 'sf_views', domain: 'databases', label: 'Views', resourceType: 'view', statement: 'SHOW VIEWS IN ACCOUNT',
    map: (v, ctx) => {
      const db = str(v.database_name);
      const schema = str(v.schema_name);
      return { nativeId: qual(db, schema, str(v.name)), name: str(v.name) || 'view', health: 'healthy', attributes: { owner: str(v.owner), isSecure: bool(v.is_secure), isMaterialized: bool(v.is_materialized), database: db, schema }, relationships: rel('member_of', ref(ctx, 'schema', qual(db, schema))) };
    },
  }),
  sfCollector({
    id: 'sf_stages', domain: 'storage', label: 'Stages', resourceType: 'stage', statement: 'SHOW STAGES IN ACCOUNT',
    map: (st, ctx) => {
      const db = str(st.database_name);
      const schema = str(st.schema_name);
      return { nativeId: qual(db, schema, str(st.name)), name: str(st.name) || 'stage', status: str(st.type), health: 'healthy', attributes: { owner: str(st.owner), type: str(st.type), cloud: str(st.cloud), database: db, schema }, relationships: rel('member_of', ref(ctx, 'schema', qual(db, schema))) };
    },
  }),
  sfCollector({
    id: 'sf_pipes', domain: 'serverless', label: 'Pipes', resourceType: 'pipe', statement: 'SHOW PIPES IN ACCOUNT',
    map: (p, ctx) => {
      const db = str(p.database_name);
      const schema = str(p.schema_name);
      const invalid = str(p.invalid_reason);
      return { nativeId: qual(db, schema, str(p.name)), name: str(p.name) || 'pipe', status: invalid ? 'invalid' : 'valid', health: invalid ? 'critical' : 'healthy', attributes: { owner: str(p.owner), database: db, schema, invalidReason: invalid }, relationships: rel('member_of', ref(ctx, 'schema', qual(db, schema))) };
    },
  }),
  sfCollector({
    id: 'sf_streams', domain: 'serverless', label: 'Streams', resourceType: 'stream', statement: 'SHOW STREAMS IN ACCOUNT',
    map: (st, ctx) => {
      const db = str(st.database_name);
      const schema = str(st.schema_name);
      const baseTable = str(st.table_name);
      return {
        nativeId: qual(db, schema, str(st.name)), name: str(st.name) || 'stream', status: bool(st.stale) ? 'stale' : 'fresh', health: bool(st.stale) ? 'degraded' : 'healthy',
        attributes: { owner: str(st.owner), sourceType: str(st.source_type), stale: bool(st.stale), baseTable, database: db, schema },
        // A stream's base object may be a table OR a view (ambiguous type) — target the bare qualified name so the
        // graph resolves it case-insensitively to whichever exists; the schema edge is type-precise.
        relationships: [...rel('member_of', ref(ctx, 'schema', qual(db, schema))), ...rel('uses', baseTable)],
      };
    },
  }),
  sfCollector({
    id: 'sf_tasks', domain: 'serverless', label: 'Tasks', resourceType: 'task', statement: 'SHOW TASKS IN ACCOUNT',
    map: (t, ctx) => {
      const db = str(t.database_name);
      const schema = str(t.schema_name);
      const state = str(t.state);
      const warehouse = str(t.warehouse);
      return {
        nativeId: qual(db, schema, str(t.name)), name: str(t.name) || 'task', status: state, health: taskHealth(state),
        attributes: { owner: str(t.owner), state, schedule: str(t.schedule), warehouse, database: db, schema },
        relationships: [...rel('member_of', ref(ctx, 'schema', qual(db, schema))), ...rel('uses', ref(ctx, 'warehouse', warehouse))],
      };
    },
  }),
  sfCollector({
    id: 'sf_users', domain: 'identity', label: 'Users', resourceType: 'user', statement: 'SHOW USERS',
    map: (u) => ({ nativeId: str(u.name) ?? '', name: str(u.name) || 'user', status: bool(u.disabled) ? 'disabled' : 'enabled', health: bool(u.disabled) ? 'degraded' : 'healthy', attributes: { disabled: bool(u.disabled), defaultRole: str(u.default_role), defaultWarehouse: str(u.default_warehouse) } }),
  }),
  sfCollector({
    id: 'sf_roles', domain: 'identity', label: 'Roles', resourceType: 'role', statement: 'SHOW ROLES',
    map: (r) => ({ nativeId: str(r.name) ?? '', name: str(r.name) || 'role', health: 'healthy', attributes: { owner: str(r.owner), assignedToUsers: num(r.assigned_to_users), grantedToRoles: num(r.granted_to_roles) } }),
  }),
  sfCollector({
    id: 'sf_resource_monitors', domain: 'security', label: 'Resource Monitors', resourceType: 'resource_monitor', statement: 'SHOW RESOURCE MONITORS',
    map: (rm) => {
      const used = num(rm.used_credits);
      const quota = num(rm.credit_quota);
      return { nativeId: str(rm.name) ?? '', name: str(rm.name) || 'resource-monitor', status: str(rm.level), health: monitorHealth(used, quota), attributes: { creditQuota: quota, usedCredits: used, level: str(rm.level) } };
    },
  }),
  sfCollector({
    id: 'sf_network_policies', domain: 'security', label: 'Network Policies', resourceType: 'network_policy', statement: 'SHOW NETWORK POLICIES',
    map: (np) => ({ nativeId: str(np.name) ?? '', name: str(np.name) || 'network-policy', health: 'healthy', attributes: { allowedIps: num(np.entries_in_allowed_ip_list), blockedIps: num(np.entries_in_blocked_ip_list) } }),
  }),
];
