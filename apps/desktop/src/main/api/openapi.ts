/**
 * OpenAPI 3.1 generator (P3.0, Increment 2).
 *
 * Builds the spec from two live sources — the route table and each route's EXISTING
 * Zod contract schema (resolved from the handler registry) — so it stays in sync with
 * the API automatically and is never handwritten. Path params come from the pattern,
 * request bodies from the channel's Zod schema (minus path params) via the converter,
 * query params from the route's declared controls + list controls, and every operation
 * documents the Bearer API-key security + its required scope + the standard error set.
 */
import type { ZodTypeAny } from 'zod';
import type {
  ApiVersion,
  IpcChannelName,
  JsonSchema,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
} from '@neuropause/shared';
import { ENTERPRISE_API_ROUTES } from './routeRegistry';
import type { ApiRoute } from './types';
import { zodToJsonSchema } from './zodToJsonSchema';

export interface OpenApiGenDeps {
  /** Resolve a channel's request Zod schema (from the handler registry). */
  resolveSchema: (channel: IpcChannelName) => ZodTypeAny | undefined;
  serverUrl?: string;
  version?: ApiVersion;
  apiVersion?: string;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function pathParamNames(pattern: string): string[] {
  return pattern.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1));
}
function toOpenApiPath(pattern: string): string {
  return pattern.split('/').map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s)).join('/') || '/';
}
function opId(route: ApiRoute): string {
  const p = route.path.replace(/[:/]/g, ' ').trim().split(/\s+/).filter(Boolean).join('_') || 'root';
  return `${route.method.toLowerCase()}_${p}`;
}
function tagFor(path: string): string {
  const seg = path.split('/').filter(Boolean)[0] ?? 'root';
  return seg.startsWith(':') ? 'root' : seg;
}

function listControlParams(): OpenApiParameter[] {
  return [
    { name: 'limit', in: 'query', required: false, description: 'Page size (1–200, default 50)', schema: { type: 'integer', minimum: 1, maximum: 200 } },
    { name: 'cursor', in: 'query', required: false, description: 'Opaque cursor from a prior nextCursor', schema: { type: 'string' } },
    { name: 'sort', in: 'query', required: false, description: 'Field to sort by (supports fields.*)', schema: { type: 'string' } },
    { name: 'order', in: 'query', required: false, description: 'Sort order', schema: { type: 'string', enum: ['asc', 'desc'] } },
  ];
}

function errorResponse(description: string): OpenApiResponse {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } };
}

function requestBodySchema(route: ApiRoute, deps: OpenApiGenDeps, pathParams: string[]): JsonSchema | null {
  if (route.kind === 'special') {
    if (route.path.endsWith('/bulk')) {
      return {
        type: 'object',
        required: ['operations'],
        properties: {
          operations: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              required: ['op'],
              properties: {
                op: { type: 'string', enum: ['create', 'update', 'delete', 'setStatus'] },
                id: { type: 'string' },
                title: { type: 'string' },
                fields: { type: 'object', additionalProperties: true },
                tags: { type: 'array', items: { type: 'string' } },
                metadata: { type: 'object', additionalProperties: true },
                status: { type: 'string' },
              },
            },
          },
        },
      };
    }
    return null;
  }
  const schema = deps.resolveSchema(route.channel);
  if (!schema) return { type: 'object' };
  const json = zodToJsonSchema(schema);
  if (json.properties && typeof json.properties === 'object') {
    const props = { ...(json.properties as Record<string, unknown>) };
    for (const p of pathParams) delete props[p];
    const required = Array.isArray(json.required)
      ? (json.required as string[]).filter((r) => !pathParams.includes(r))
      : [];
    return {
      type: 'object',
      properties: props,
      ...(required.length ? { required } : {}),
      additionalProperties: json.additionalProperties ?? false,
    };
  }
  return json;
}

function buildOperation(route: ApiRoute, deps: OpenApiGenDeps): OpenApiOperation {
  const pathParams = pathParamNames(route.path);
  const params: OpenApiParameter[] = pathParams.map((name) => ({
    name, in: 'path', required: true, description: `${name} path parameter`, schema: { type: 'string' },
  }));
  if (route.list) params.push(...listControlParams());
  for (const q of route.query ?? []) {
    params.push({
      name: q.name, in: 'query', required: false, description: q.description,
      schema: q.enum ? { type: q.type, enum: q.enum } : { type: q.type },
    });
  }

  const op: OpenApiOperation = {
    operationId: opId(route),
    summary: route.summary,
    tags: [tagFor(route.path)],
    security: [{ ApiKeyAuth: [route.scope] }],
    parameters: params.length ? params : undefined,
    responses: {
      '200': route.list
        ? { description: 'Paginated list', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiListPage' } } } }
        : { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } },
      '400': errorResponse('Invalid request'),
      '401': errorResponse('Missing or invalid API key'),
      '403': errorResponse('Missing scope or RBAC permission'),
      '404': errorResponse('No such route or resource'),
      '429': errorResponse('Rate limit or quota exceeded'),
    },
  };

  if (WRITE_METHODS.has(route.method)) {
    const body = requestBodySchema(route, deps, pathParams);
    if (body) op.requestBody = { required: route.method !== 'PATCH', content: { 'application/json': { schema: body } } };
  }
  return op;
}

/** Generate the full OpenAPI 3.1 document. Deterministic over its inputs. */
export function buildOpenApiSpec(deps: OpenApiGenDeps): OpenApiDocument {
  const version = deps.version ?? 'v1';
  const serverUrl = deps.serverUrl ?? 'https://api.neuropause.dev';
  const paths: OpenApiDocument['paths'] = {};
  const tags = new Set<string>();

  for (const route of ENTERPRISE_API_ROUTES) {
    const p = toOpenApiPath(route.path);
    const op = buildOperation(route, deps);
    tags.add(op.tags[0]);
    if (!paths[p]) paths[p] = {};
    paths[p][route.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'NeuroPause Enterprise API',
      version: deps.apiVersion ?? '1.0.0',
      description:
        'Production REST API over the NeuroPause Enterprise runtime. Every endpoint executes an existing enterprise handler under the same RBAC + audit. Generated from the route table + Zod contracts — never handwritten.',
    },
    servers: [{ url: `${serverUrl}/${version}`, description: `NeuroPause ${version} gateway` }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Ecosystem API key as a Bearer token. Keys are created in the Developer Portal and carry scopes.',
        },
      },
      schemas: {
        ApiError: {
          type: 'object',
          required: ['status', 'ok', 'error'],
          properties: { status: { type: 'integer' }, ok: { const: false }, error: { type: 'string' } },
        },
        ApiListPage: {
          type: 'object',
          required: ['data', 'nextCursor', 'total', 'limit'],
          properties: {
            data: { type: 'array', items: {} },
            nextCursor: { type: ['string', 'null'] },
            total: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  };
}
