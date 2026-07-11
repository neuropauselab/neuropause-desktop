/**
 * Enterprise resource generator (P3.0, Increment 5) — pure.
 *
 * Emits the TypeScript source for the typed `EnterpriseResource` from the shared
 * route manifest, so there are ZERO handwritten request builders: every method is
 * generated and delegates to the single `Transport.request`. The manifest is the
 * same route list the OpenAPI document is generated from, so the SDK, the spec, and
 * the runtime never diverge.
 */
import type { ApiRouteInfo } from '@neuropause/shared';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const QUERY_TYPE = 'Record<string, string | number | boolean | undefined>';

function pascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Deterministic, collision-free method name: method + every path segment (params included). */
export function methodName(route: ApiRouteInfo): string {
  const segs = route.path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? s.slice(1) : s));
  return [route.method.toLowerCase(), ...segs]
    .map((w, i) => (i === 0 ? w : pascal(w)))
    .join('')
    .replace(/[^A-Za-z0-9]/g, '');
}

function pathParams(path: string): string[] {
  return path.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1));
}

/** Path with `:param` turned into `${encodeURIComponent(param)}` (template-literal body). */
function pathTemplate(path: string): string {
  return path
    .split('/')
    .map((s) => (s.startsWith(':') ? '${encodeURIComponent(' + s.slice(1) + ')}' : s))
    .join('/');
}

function generateMethod(route: ApiRouteInfo): string {
  const name = methodName(route);
  const params = pathParams(route.path);
  const isWrite = WRITE_METHODS.has(route.method);
  const args = [...params.map((p) => `${p}: string`)];
  if (isWrite) args.push('body?: unknown');
  args.push(`query?: ${QUERY_TYPE}`);
  const ret = route.list ? 'ApiListPage<T>' : 'T';
  const req = [
    `method: '${route.method}'`,
    'path: `' + pathTemplate(route.path) + '`',
    'query',
    ...(isWrite ? ['body'] : []),
    `scope: '${route.scope}'`,
  ].join(', ');
  return [
    `  /** ${route.method} ${route.path} — ${route.summary} */`,
    `  ${name}<T = unknown>(${args.join(', ')}): Promise<${ret}> {`,
    `    return this.t.request<${ret}>({ ${req} }).then((r) => r.data);`,
    '  }',
  ].join('\n');
}

/** Generate the complete `EnterpriseResource` source. Pure + deterministic. */
export function generateEnterpriseResource(routes: readonly ApiRouteInfo[]): string {
  const methods = routes.map(generateMethod).join('\n\n');
  return `/**
 * AUTO-GENERATED from ENTERPRISE_API_ROUTE_MANIFEST — do not edit by hand.
 * Regenerate with: npm run generate -w @neuropause/sdk
 *
 * Every method delegates to the single Transport request builder (no per-endpoint
 * request code) and executes an existing enterprise handler under gateway auth + RBAC.
 */
import type { ApiListPage } from '@neuropause/shared';
import type { Transport } from '../transport';

export class EnterpriseResource {
  constructor(private readonly t: Transport) {}

${methods}
}
`;
}
