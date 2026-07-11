/**
 * AI Sandbox — Enterprise Scenario Runner (S3): SDK + CLI channel adapters.
 *
 * The SDK and CLI are, by design, thin clients whose real backend is the Enterprise REST
 * gateway. The desktop-embedded runner therefore drives those channels by invoking the
 * SAME in-process gateway the SDK/CLI use as their transport — rather than importing the
 * TS-source `@neuropause/sdk` / `@neuropause/cli` workspaces into the Electron main bundle
 * (which is not runtime-safe). This is the real code path, not a mock: every call reaches
 * the real secure-handler core through the gateway. Pure over the injected `restRaw`.
 */
import type { PlatformCliResult, PlatformSdkResult } from './platform';

export type RestRaw = (req: {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  apiKey?: string | null;
}) => Promise<{ status: number; ok: boolean; data?: unknown; error?: string }>;

/** The SDK enterprise resource, backed by the in-process gateway. Method names mirror
 *  `@neuropause/sdk`'s generated `EnterpriseResource`. */
export function createGatewaySdk(restRaw: RestRaw, apiKey: string | null = null): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const get = async (path: string, query?: Record<string, string | number | boolean>): Promise<unknown> => {
    const res = await restRaw({ method: 'GET', path, query, apiKey });
    if (!res.ok) throw new Error(res.error ?? `GET ${path} → ${res.status}`);
    return res.data;
  };
  const post = async (path: string, body?: unknown): Promise<unknown> => {
    const res = await restRaw({ method: 'POST', path, body, apiKey });
    if (!res.ok) throw new Error(res.error ?? `POST ${path} → ${res.status}`);
    return res.data;
  };
  return {
    getHealth: () => get('/health'),
    getMetrics: () => get('/metrics'),
    getModules: () => get('/modules'),
    getModulesModuleIdRecords: (moduleId) => get(`/modules/${String(moduleId)}/records`),
    getModulesModuleIdRecordsId: (moduleId, id) => get(`/modules/${String(moduleId)}/records/${String(id)}`),
    postModulesModuleIdRecords: (moduleId, body) => post(`/modules/${String(moduleId)}/records`, body),
    postModulesModuleIdRecordsIdActionsAction: (moduleId, id, action, body) => post(`/modules/${String(moduleId)}/records/${String(id)}/actions/${String(action)}`, body),
    getTimeline: () => get('/timeline'),
    getAutomation: () => get('/automation'),
    getAutomationMonitor: () => get('/automation/monitor'),
    getGraphCounts: () => get('/graph/counts'),
    getObservabilityHealth: () => get('/observability/health'),
  };
}

/** Run an SDK method by name against the gateway-backed resource. */
export async function runGatewaySdk(sdk: Record<string, (...args: unknown[]) => Promise<unknown>>, method: string, args: unknown[]): Promise<PlatformSdkResult> {
  const fn = sdk[method];
  if (typeof fn !== 'function') return { ok: false, error: `unknown sdk method "${method}"` };
  try {
    return { ok: true, data: await fn(...args) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The CLI, backed by the in-process gateway. Commands mirror `@neuropause/cli`'s surface. */
export function createGatewayCli(restRaw: RestRaw, apiKey: string | null = null): (argv: string[]) => Promise<PlatformCliResult> {
  return async (argv: string[]): Promise<PlatformCliResult> => {
    const [cmd, sub, third] = argv;
    const call = async (method: string, path: string, body?: unknown): Promise<PlatformCliResult> => {
      const res = await restRaw({ method, path, body, apiKey });
      if (!res.ok) return { code: 1, stdout: [], stderr: [res.error ?? `${method} ${path} → ${res.status}`] };
      return { code: 0, stdout: [JSON.stringify(res.data)], stderr: [] };
    };
    switch (cmd) {
      case 'health':
        return call('GET', '/health');
      case 'metrics':
        return call('GET', '/metrics');
      case 'modules':
        return call('GET', '/modules');
      case 'timeline':
        return call('GET', '/timeline');
      case 'automation':
        return call('GET', sub === 'monitor' ? '/automation/monitor' : '/automation');
      case 'records': {
        // records <moduleId> [list|get <id>|create]
        const moduleId = sub ?? '';
        if (third === 'get') return call('GET', `/modules/${moduleId}/records/${argv[3] ?? ''}`);
        if (third === 'create') return call('POST', `/modules/${moduleId}/records`, {});
        return call('GET', `/modules/${moduleId}/records`);
      }
      default:
        return { code: 1, stdout: [], stderr: [`unknown command "${argv.join(' ')}"`] };
    }
  };
}
