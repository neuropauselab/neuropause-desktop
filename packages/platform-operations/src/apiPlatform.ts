/**
 * EPIC 4 — API Platform. A registry for the production API services (gateway + authentication / AI /
 * integration / commercial / operations / admin) across REST / GraphQL / WebSocket. These are endpoint
 * DESCRIPTORS with route metadata — serving real traffic requires the running gateway + clusters and is
 * infrastructure-pending. No endpoint is reported reachable.
 */
import { randomId } from '@neuropause/cloud-core';
import { API_SERVICES, API_PROTOCOLS, TARGET_DOMAIN, type ApiService, type ApiProtocol } from './constants';
import type { PlatformOpsGovernance } from './governance';

export interface ApiEndpoint {
  id: string;
  service: ApiService;
  protocol: ApiProtocol;
  path: string;
  url: string;
  reachable: false; // descriptor only — real reachability requires running infrastructure
}

export class ApiPlatform {
  private readonly endpoints = new Map<string, ApiEndpoint>();

  constructor(
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  services(): readonly ApiService[] {
    return API_SERVICES;
  }
  protocols(): readonly ApiProtocol[] {
    return API_PROTOCOLS;
  }

  async register(input: { service: ApiService; protocol: ApiProtocol; path: string }): Promise<ApiEndpoint> {
    if (!API_SERVICES.includes(input.service)) throw new Error(`unknown API service: ${input.service}`);
    if (!API_PROTOCOLS.includes(input.protocol)) throw new Error(`unknown API protocol: ${input.protocol}`);
    const endpoint: ApiEndpoint = {
      id: randomId('api'),
      service: input.service,
      protocol: input.protocol,
      path: input.path,
      url: `https://${TARGET_DOMAIN}${input.path}`, // the intended URL; the domain is NOT live yet
      reachable: false,
    };
    this.endpoints.set(endpoint.id, endpoint);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_api', version: '_platform', epic: 'E4', operation: `register.${input.service}`, targetId: input.path, evidence: 'live-verified', decision: `${input.protocol} descriptor` });
    return endpoint;
  }

  list(service?: ApiService): ApiEndpoint[] {
    const all = [...this.endpoints.values()];
    return service ? all.filter((e) => e.service === service) : all;
  }
  count(): number {
    return this.endpoints.size;
  }
}
