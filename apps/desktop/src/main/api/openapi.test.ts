/**
 * P3.0 Increment 2 — OpenAPI 3.1 generator tests.
 *
 * Verifies the doc covers every route, documents Bearer + per-route scope security,
 * derives request bodies from the (injected) Zod schema with path params stripped,
 * and wraps list routes in ApiListPage with the standard list-control query params.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IpcChannel } from '@neuropause/shared';
import type { OpenApiParameter } from '@neuropause/shared';
import { buildOpenApiSpec } from './openapi';
import { ENTERPRISE_API_ROUTES } from './routeRegistry';

const createSchema = z
  .object({ moduleId: z.string(), title: z.string().optional(), fields: z.record(z.string(), z.string()).optional() })
  .strict();

const deps = {
  resolveSchema: (ch: string) => (ch === IpcChannel.EnterpriseModuleCreate ? createSchema : undefined),
  serverUrl: 'https://api.test',
  apiVersion: '9.9.9',
};

function queryNames(params: OpenApiParameter[] | undefined): string[] {
  return (params ?? []).filter((p) => p.in === 'query').map((p) => p.name);
}

describe('buildOpenApiSpec', () => {
  it('emits a valid 3.1 doc with an operation for every route + the shared components', () => {
    const doc = buildOpenApiSpec(deps);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('9.9.9');
    expect(doc.servers[0].url).toBe('https://api.test/v1');

    const opCount = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
    expect(opCount).toBe(ENTERPRISE_API_ROUTES.length);

    expect(doc.components.securitySchemes.ApiKeyAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.components.schemas.ApiError).toBeDefined();
    expect(doc.components.schemas.ApiListPage).toBeDefined();
    expect(doc.security).toEqual([{ ApiKeyAuth: [] }]);
  });

  it('documents path params and per-operation Bearer scope security', () => {
    const doc = buildOpenApiSpec(deps);
    const getOne = doc.paths['/modules/{moduleId}/records/{id}']?.get;
    expect(getOne?.security).toEqual([{ ApiKeyAuth: ['records:read'] }]);
    const pathNames = (getOne?.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name);
    expect(pathNames).toEqual(['moduleId', 'id']);
  });

  it('generates the create body from the Zod schema, stripping the path param', () => {
    const doc = buildOpenApiSpec(deps);
    const post = doc.paths['/modules/{moduleId}/records']?.post;
    const body = post?.requestBody?.content['application/json'].schema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(body.properties.title).toEqual({ type: 'string' });
    expect(body.properties.moduleId).toBeUndefined(); // path param removed from the body
    expect(body.required ?? []).not.toContain('moduleId');
  });

  it('wraps list routes in ApiListPage and adds the standard list-control query params', () => {
    const doc = buildOpenApiSpec(deps);
    const list = doc.paths['/modules/{moduleId}/records']?.get;
    expect(list?.responses['200'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ApiListPage',
    });
    expect(queryNames(list?.parameters)).toEqual(
      expect.arrayContaining(['limit', 'cursor', 'sort', 'order', 'status', 'search']),
    );
  });

  it('exposes the standard error responses on every operation', () => {
    const doc = buildOpenApiSpec(deps);
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item)) {
        for (const code of ['400', '401', '403', '404', '429']) {
          expect(op.responses[code]).toBeDefined();
        }
      }
    }
  });
});
