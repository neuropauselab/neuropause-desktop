/**
 * The HTTP implementation of LicenseTransport — calls the backend license API
 * (GET /license/:orgId) with the authenticated cloud session. Errors are typed so
 * the validator can report a useful reason. Dependencies (base URL, token getter,
 * fetch) are injected with real defaults, mirroring the sync transport, so this is
 * unit-testable without module mocking.
 */
import type { OrgLicense } from '@neuropause/shared';
import { config } from '../config';
import { authService } from '../auth/authService';
import type { LicenseTransport } from './types';

export class LicenseTransportError extends Error {
  readonly status?: number;
  readonly kind: 'network' | 'http';
  readonly code?: string;
  constructor(message: string, opts: { status?: number; kind: 'network' | 'http'; code?: string }) {
    super(message);
    this.name = 'LicenseTransportError';
    this.status = opts.status;
    this.kind = opts.kind;
    this.code = opts.code;
  }
}

export interface HttpLicenseTransportDeps {
  baseUrl?: string;
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createHttpLicenseTransport(deps: HttpLicenseTransportDeps = {}): LicenseTransport {
  const baseUrl = deps.baseUrl ?? config.backendUrl;
  const getToken = deps.getToken ?? (() => authService.getValidAccessToken());
  const doFetch = deps.fetchImpl ?? fetch;

  return {
    async fetchLicense(orgId: string): Promise<OrgLicense> {
      const token = await getToken();
      if (!token) {
        throw new LicenseTransportError('Sign in to check the license.', {
          status: 401,
          kind: 'http',
          code: 'not_authenticated',
        });
      }

      const url = `${baseUrl}/license/${encodeURIComponent(orgId)}`;
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        throw new LicenseTransportError((err as Error).message || 'Network request failed', {
          kind: 'network',
        });
      }

      const text = await res.text();
      const json = text ? (JSON.parse(text) as unknown) : undefined;
      if (!res.ok) {
        const body = (json ?? {}) as { error?: { code?: string; message?: string } };
        throw new LicenseTransportError(
          body.error?.message ?? `Request failed with status ${res.status}`,
          { status: res.status, kind: 'http', code: body.error?.code },
        );
      }
      return json as OrgLicense;
    },
  };
}
