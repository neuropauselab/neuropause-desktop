/**
 * Enterprise REST API subsystem (P3.0, Increment 1) — composition root.
 *
 * Exposes two secure channels: `api:request` (the single REST gateway entrypoint)
 * and `api:routes` (the static route index). Both are thin — the request handler
 * delegates to `handleEnterpriseApiRequest`, which reuses the Ecosystem gateway +
 * the existing handler registry. The runtime injects the real gateway decision,
 * handler resolver, and secure-run function.
 */
import { EmptyRequest, EnterpriseApiRequestRequest, IpcChannel } from '@neuropause/shared';
import type { EnterpriseApiRequestRequest as TApiRequest } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { enterpriseApiRouteIndex, handleEnterpriseApiRequest, type ApiGatewayDeps } from './apiGateway';
import { ENTERPRISE_API_ROUTES } from './routeRegistry';

const log = createLogger('enterprise-api');

export type EnterpriseApiDeps = ApiGatewayDeps;

export interface EnterpriseApiSubsystem {
  handlers: SecureHandlerDef[];
}

export function initEnterpriseApi(deps: EnterpriseApiDeps): EnterpriseApiSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EnterpriseApiRequest,
      schema: EnterpriseApiRequestRequest,
      handler: (p) => handleEnterpriseApiRequest(p as TApiRequest, deps),
    },
    {
      channel: IpcChannel.EnterpriseApiRoutes,
      schema: EmptyRequest,
      handler: () => enterpriseApiRouteIndex(),
    },
  ];
  log.info('Enterprise REST API initialized', { routes: ENTERPRISE_API_ROUTES.length });
  return { handlers };
}
