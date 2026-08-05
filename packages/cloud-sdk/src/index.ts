/**
 * @neuropause/cloud-sdk — a typed client facade over the NeuroPause CLOUD
 * PLATFORM API (sync, notifications, and other cloud-owned surfaces).
 *
 * STATUS: PREVIEW foundation (NCEA Phase 10.2, consolidated 10.2A). The client
 * and its resource groups are real and typed; the TRANSPORT is an interface. The
 * only transport shipped is `inMemoryTransport` (tests/offline). A production
 * HTTP transport (fetch + signing + retry) is a follow-up.
 *
 * OWNERSHIP: identity/users/orgs/DEVICES are owned by the backend and are served
 * by `@neuropause/sdk` (the backend client), NOT here. This SDK is scoped to
 * cloud-platform capabilities only, so there is one client per authoritative API.
 */
import type { ApiResponse, NotificationId } from '@neuropause/shared-cloud';

export interface CloudTransport {
  request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
}

export interface CloudClientOptions {
  /** Base URL for a production HTTP transport. Unused by the in-memory transport. */
  baseUrl?: string;
}

/** Minimal deterministic in-memory transport for tests and offline use. */
export function inMemoryTransport(
  handler: (method: string, path: string, body?: unknown) => ApiResponse<unknown>,
): CloudTransport {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
      return handler(method, path, body) as ApiResponse<T>;
    },
  };
}

export class CloudClient {
  constructor(
    private readonly transport: CloudTransport,
    readonly options: CloudClientOptions = {},
  ) {}

  readonly sync = {
    push: (body: unknown) => this.transport.request<{ accepted: number }>('POST', '/v1/sync', body),
    pull: (since: number) => this.transport.request<unknown[]>('GET', `/v1/sync?since=${since}`),
  };

  readonly notifications = {
    send: (body: { userId: string; title: string; channels: string[] }) =>
      this.transport.request<{ notificationId: NotificationId }>('POST', '/v1/notifications', body),
    history: (userId: string) =>
      this.transport.request<unknown[]>('GET', `/v1/notifications?userId=${encodeURIComponent(userId)}`),
  };
}
