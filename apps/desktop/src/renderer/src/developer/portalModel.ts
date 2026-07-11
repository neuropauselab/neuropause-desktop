/**
 * Pure model for the Developer Portal's platform surfaces (P3.0, Increment 7).
 *
 * These helpers translate between the UI's form state and the real API contracts
 * the portal drives — the Enterprise REST API (Increment 1), the generated OpenAPI
 * document (Increment 2), Enterprise Webhooks (Increment 4), and Plugin SDK v2
 * extensions (Increment 6). No React, no IPC, no business logic — just the small,
 * deterministic transforms the panels need, so they can be unit-tested in isolation.
 */
import {
  PLUGIN_EXTENSION_KINDS,
  type ApiMethod,
  type ApiVersion,
  type EnterpriseApiRequest,
  type OpenApiDocument,
  type OpenApiOperation,
  type PluginExtension,
  type PluginExtensionKind,
  type Webhook,
} from '@neuropause/shared';

/* ─────────────────────────── API Explorer ─────────────────────────── */

/** Extract the `:param` names from a path template, in order, de-duplicated. */
export function extractPathParams(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/:([A-Za-z0-9_]+)/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Fill a path template's `:params` from a value map, URL-encoding each segment. */
export function fillPathTemplate(
  template: string,
  params: Record<string, string>,
): { ok: true; path: string } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const path = template.replace(/:([A-Za-z0-9_]+)/g, (_full, name: string) => {
    const v = (params[name] ?? '').trim();
    if (!v) {
      missing.push(name);
      return `:${name}`;
    }
    return encodeURIComponent(v);
  });
  return missing.length ? { ok: false, missing } : { ok: true, path };
}

/** Coerce a raw query-string value into the scalar the API contract accepts. */
export function coerceQueryValue(raw: string): string | number | boolean {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  // Only treat as a number when the whole string is a finite numeric literal.
  if (t !== '' && /^-?\d+(\.\d+)?$/.test(t) && Number.isFinite(Number(t))) return Number(t);
  return raw;
}

export interface QueryPair {
  key: string;
  value: string;
}

/** Build a clean query record from editor rows — blank keys dropped, values coerced. */
export function buildQuery(pairs: readonly QueryPair[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const p of pairs) {
    const key = p.key.trim();
    if (!key) continue;
    out[key] = coerceQueryValue(p.value);
  }
  return out;
}

const BODY_METHODS: readonly ApiMethod[] = ['POST', 'PUT', 'PATCH'];

export interface ExplorerForm {
  method: ApiMethod;
  pathTemplate: string;
  params: Record<string, string>;
  query: readonly QueryPair[];
  bodyText: string;
  version: ApiVersion;
  apiKey: string;
}

export type BuildRequestResult =
  | { ok: true; request: EnterpriseApiRequest }
  | { ok: false; error: string };

/**
 * Assemble a validated {@link EnterpriseApiRequest} from the explorer form, or a
 * human error. Path params must all be filled; a body is only sent for write
 * methods and must be valid JSON when present.
 */
export function buildApiRequest(form: ExplorerForm): BuildRequestResult {
  const filled = fillPathTemplate(form.pathTemplate, form.params);
  if (!filled.ok) {
    return { ok: false, error: `Missing path parameter${filled.missing.length > 1 ? 's' : ''}: ${filled.missing.join(', ')}` };
  }

  let body: unknown;
  if (BODY_METHODS.includes(form.method)) {
    const text = form.bodyText.trim();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, error: 'Request body is not valid JSON' };
      }
    }
  }

  const query = buildQuery(form.query);
  const request: EnterpriseApiRequest = {
    method: form.method,
    path: filled.path,
    version: form.version,
    apiKey: form.apiKey.trim() || null,
  };
  if (Object.keys(query).length) request.query = query;
  if (body !== undefined) request.body = body;
  return { ok: true, request };
}

/** Pretty-print any JSON-ish response payload for display; strings pass through. */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/* ─────────────────────────── OpenAPI reference ─────────────────────────── */

export interface OpenApiOperationRow {
  path: string;
  method: ApiMethod;
  operation: OpenApiOperation;
}

export interface OpenApiTagGroup {
  tag: string;
  description?: string;
  operations: OpenApiOperationRow[];
}

const OPENAPI_METHOD_ORDER: readonly string[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Flatten an OpenAPI document's `paths` map into operation rows grouped by their
 * first tag, preserving the document's declared tag order (with any untagged or
 * unknown-tag operations collected under a trailing "Other" group).
 */
export function openApiOperationsByTag(doc: OpenApiDocument | null): OpenApiTagGroup[] {
  if (!doc) return [];
  const rows: OpenApiOperationRow[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of OPENAPI_METHOD_ORDER) {
      const op = methods[method];
      if (op) rows.push({ path, method: method.toUpperCase() as ApiMethod, operation: op });
    }
  }

  const declared = doc.tags.map((t) => t.name);
  const descOf = new Map(doc.tags.map((t) => [t.name, t.description]));
  const groups = new Map<string, OpenApiOperationRow[]>();
  const orderOf = (tag: string): number => {
    const i = declared.indexOf(tag);
    return i === -1 ? declared.length : i;
  };

  for (const row of rows) {
    const tag = row.operation.tags[0] ?? 'Other';
    const list = groups.get(tag) ?? [];
    list.push(row);
    groups.set(tag, list);
  }

  return [...groups.entries()]
    .sort((a, b) => orderOf(a[0]) - orderOf(b[0]) || a[0].localeCompare(b[0]))
    .map(([tag, operations]) => ({ tag, description: descOf.get(tag), operations }));
}

/** Count the operations across every path in a document. */
export function countOpenApiOperations(doc: OpenApiDocument | null): number {
  if (!doc) return 0;
  let n = 0;
  for (const methods of Object.values(doc.paths)) {
    for (const method of OPENAPI_METHOD_ORDER) if (methods[method]) n += 1;
  }
  return n;
}

/* ─────────────────────────── Webhooks ─────────────────────────── */

/** A one-line human summary of what an endpoint is subscribed to. */
export function webhookSubscriptionSummary(webhook: Pick<Webhook, 'subscription'>): string {
  const { categories, types } = webhook.subscription;
  if (categories.length === 0 && types.length === 0) return 'All events';
  const parts: string[] = [];
  if (categories.length) parts.push(`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`);
  if (types.length) parts.push(`${types.length} type${types.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Parse a comma/whitespace-separated event-type list into a clean, de-duplicated array. */
export function parseEventTypes(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/* ─────────────────────────── Plugin extensions ─────────────────────────── */

export interface ExtensionGroup {
  kind: PluginExtensionKind;
  items: PluginExtension[];
}

/**
 * Group registered extensions by kind, in the canonical kind order, omitting
 * kinds that have no registered extensions.
 */
export function groupExtensionsByKind(extensions: readonly PluginExtension[]): ExtensionGroup[] {
  const byKind = new Map<PluginExtensionKind, PluginExtension[]>();
  for (const ext of extensions) {
    const list = byKind.get(ext.kind) ?? [];
    list.push(ext);
    byKind.set(ext.kind, list);
  }
  return PLUGIN_EXTENSION_KINDS.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    items: (byKind.get(kind) ?? []).slice().sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.label.localeCompare(b.label)),
  }));
}

/** Count distinct plugins that have registered at least one extension. */
export function distinctExtensionPlugins(extensions: readonly PluginExtension[]): number {
  return new Set(extensions.map((e) => e.pluginId)).size;
}
