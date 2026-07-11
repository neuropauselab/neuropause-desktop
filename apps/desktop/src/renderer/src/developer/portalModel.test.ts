/** P3.0 Increment 7 — Developer Portal pure-model tests (request building, OpenAPI
 *  flattening, webhook summaries, extension grouping). */
import { describe, expect, it } from 'vitest';
import type { OpenApiDocument, OpenApiOperation, PluginExtension } from '@neuropause/shared';
import {
  buildApiRequest,
  buildQuery,
  coerceQueryValue,
  countOpenApiOperations,
  distinctExtensionPlugins,
  extractPathParams,
  fillPathTemplate,
  groupExtensionsByKind,
  openApiOperationsByTag,
  parseEventTypes,
  prettyJson,
  webhookSubscriptionSummary,
} from './portalModel';

describe('path templates', () => {
  it('extracts params in order, de-duplicated', () => {
    expect(extractPathParams('/modules/:moduleId/records/:id')).toEqual(['moduleId', 'id']);
    expect(extractPathParams('/health')).toEqual([]);
    expect(extractPathParams('/x/:a/:a')).toEqual(['a']);
  });

  it('fills templates and URL-encodes segments', () => {
    expect(fillPathTemplate('/modules/:id/records', { id: 'fin oice/1' })).toEqual({ ok: true, path: '/modules/fin%20oice%2F1/records' });
  });

  it('reports every missing param', () => {
    const r = fillPathTemplate('/a/:x/:y', { x: '  ' });
    expect(r).toEqual({ ok: false, missing: ['x', 'y'] });
  });
});

describe('query coercion', () => {
  it('coerces booleans and finite numbers, leaves everything else a string', () => {
    expect(coerceQueryValue('true')).toBe(true);
    expect(coerceQueryValue('false')).toBe(false);
    expect(coerceQueryValue('42')).toBe(42);
    expect(coerceQueryValue('-3.5')).toBe(-3.5);
    expect(coerceQueryValue('12abc')).toBe('12abc');
    expect(coerceQueryValue('')).toBe('');
  });

  it('drops blank keys and coerces values', () => {
    expect(buildQuery([{ key: 'limit', value: '25' }, { key: '  ', value: 'x' }, { key: 'q', value: 'hi' }])).toEqual({ limit: 25, q: 'hi' });
  });
});

describe('buildApiRequest', () => {
  it('builds a GET with query + trimmed key, no body', () => {
    const r = buildApiRequest({ method: 'GET', pathTemplate: '/modules/:id/records', params: { id: 'crm' }, query: [{ key: 'limit', value: '10' }], bodyText: '{ ignored }', version: 'v1', apiKey: '  npk_x  ' });
    expect(r).toEqual({ ok: true, request: { method: 'GET', path: '/modules/crm/records', version: 'v1', apiKey: 'npk_x', query: { limit: 10 } } });
  });

  it('errors on missing path params', () => {
    const r = buildApiRequest({ method: 'GET', pathTemplate: '/modules/:id', params: {}, query: [], bodyText: '', version: 'v1', apiKey: '' });
    expect(r).toEqual({ ok: false, error: 'Missing path parameter: id' });
  });

  it('parses a JSON body for write methods and nulls a blank key', () => {
    const r = buildApiRequest({ method: 'POST', pathTemplate: '/modules/:id/records', params: { id: 'crm' }, query: [], bodyText: '{"name":"Acme"}', version: 'v2', apiKey: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request).toEqual({ method: 'POST', path: '/modules/crm/records', version: 'v2', apiKey: null, body: { name: 'Acme' } });
  });

  it('rejects invalid JSON bodies', () => {
    const r = buildApiRequest({ method: 'POST', pathTemplate: '/x', params: {}, query: [], bodyText: '{bad', version: 'v1', apiKey: '' });
    expect(r).toEqual({ ok: false, error: 'Request body is not valid JSON' });
  });

  it('omits an empty body for write methods', () => {
    const r = buildApiRequest({ method: 'PUT', pathTemplate: '/x', params: {}, query: [], bodyText: '   ', version: 'v1', apiKey: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect('body' in r.request).toBe(false);
  });
});

describe('prettyJson', () => {
  it('passes strings through and formats objects', () => {
    expect(prettyJson('hi')).toBe('hi');
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

function op(over: Partial<OpenApiOperation> & { tags: string[] }): OpenApiOperation {
  return { operationId: 'id', summary: 's', security: [], responses: { '200': { description: 'ok' } }, ...over };
}

const DOC: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'NeuroPause', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  tags: [{ name: 'Records' }, { name: 'Graph' }],
  paths: {
    '/modules/{id}/records': { get: op({ tags: ['Records'] }), post: op({ tags: ['Records'] }) },
    '/graph/nodes': { get: op({ tags: ['Graph'] }) },
    '/misc': { get: op({ tags: [] }) },
  },
  components: { securitySchemes: { ApiKeyAuth: {} }, schemas: {} },
  security: [],
};

describe('openApiOperationsByTag', () => {
  it('groups by first tag in declared order, methods ordered, untagged under Other', () => {
    const groups = openApiOperationsByTag(DOC);
    expect(groups.map((g) => g.tag)).toEqual(['Records', 'Graph', 'Other']);
    expect(groups[0].operations.map((o) => o.method)).toEqual(['GET', 'POST']);
    expect(groups[2].operations[0].path).toBe('/misc');
  });

  it('counts operations and handles null docs', () => {
    expect(countOpenApiOperations(DOC)).toBe(4);
    expect(openApiOperationsByTag(null)).toEqual([]);
    expect(countOpenApiOperations(null)).toBe(0);
  });
});

describe('webhooks', () => {
  it('summarizes subscriptions', () => {
    expect(webhookSubscriptionSummary({ subscription: { categories: [], types: [] } })).toBe('All events');
    expect(webhookSubscriptionSummary({ subscription: { categories: ['enterprise'], types: [] } })).toBe('1 category');
    expect(webhookSubscriptionSummary({ subscription: { categories: ['enterprise', 'system'], types: ['automation.completed'] } })).toBe('2 categories · 1 type');
  });

  it('parses event-type lists, trimming + de-duplicating', () => {
    expect(parseEventTypes('a.b,  a.b\n c.d ,')).toEqual(['a.b', 'c.d']);
    expect(parseEventTypes('')).toEqual([]);
  });
});

function ext(over: Partial<PluginExtension>): PluginExtension {
  return { id: 'e', pluginId: 'p', pluginVersion: '1', kind: 'executive_kpi', label: 'L', spec: {}, registeredAt: '2026-01-01T00:00:00.000Z', ...over };
}

describe('extensions', () => {
  it('groups by kind in canonical order, omitting empty kinds, sorting items', () => {
    const groups = groupExtensionsByKind([
      ext({ id: 'g', kind: 'graph_node', pluginId: 'z', label: 'B' }),
      ext({ id: 'k', kind: 'executive_kpi', pluginId: 'a', label: 'A' }),
      ext({ id: 'k2', kind: 'executive_kpi', pluginId: 'a', label: 'C' }),
    ]);
    // executive_kpi precedes graph_node in the canonical kind order
    expect(groups.map((g) => g.kind)).toEqual(['executive_kpi', 'graph_node']);
    expect(groups[0].items.map((i) => i.label)).toEqual(['A', 'C']);
  });

  it('counts distinct plugins', () => {
    expect(distinctExtensionPlugins([ext({ pluginId: 'a' }), ext({ pluginId: 'a' }), ext({ pluginId: 'b' })])).toBe(2);
    expect(distinctExtensionPlugins([])).toBe(0);
  });
});
