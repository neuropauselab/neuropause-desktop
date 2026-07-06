/**
 * Typed client for the backend /devices API. Main-process only — the renderer
 * reaches it through IPC, never the backend directly. Mirrors orgClient: every
 * call is authenticated with the access token from the auth service. The current
 * device's identity is assembled here (livesync deviceId + OS/arch + app version),
 * so the renderer only supplies the org.
 */
import { hostname } from 'node:os';
import { app } from 'electron';
import type { Device } from '@neuropause/shared';
import { config } from '../config';
import { authService } from '../auth/authService';
import { getDeviceId } from '../cloud/livesync/liveSyncInstance';

export class DeviceApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DeviceApiError';
    this.status = status;
    this.code = code;
  }
}

interface DeviceRequestInit {
  method?: string;
  body?: unknown;
}

async function deviceRequest<T>(path: string, init: DeviceRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const token = await authService.getValidAccessToken();
  if (!token) throw new DeviceApiError(401, 'not_authenticated', 'Sign in to manage devices.');
  headers.Authorization = `Bearer ${token}`;

  const url = `${config.backendUrl}/devices${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new DeviceApiError(
      0,
      'network_error',
      (err as Error).message || 'Network request failed',
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const body = (json ?? {}) as { error?: { code?: string; message?: string } };
    throw new DeviceApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  return json as T;
}

/** This device's identity, assembled from the livesync id + native runtime info. */
export function currentDeviceInfo(): {
  deviceId: string;
  name: string;
  platform: string;
  os: string;
  arch: string;
  appVersion: string;
} {
  return {
    deviceId: getDeviceId(),
    name: hostname() || 'This Mac',
    platform: 'desktop',
    os: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
  };
}

export const deviceClient = {
  /** Register (upsert) THIS device against the given org. */
  registerCurrent: (orgId: string): Promise<{ device: Device }> =>
    deviceRequest<{ device: Device }>('', {
      method: 'POST',
      body: { orgId, ...currentDeviceInfo() },
    }),

  list: (orgId: string): Promise<Device[]> =>
    deviceRequest<{ devices: Device[] }>(`?orgId=${encodeURIComponent(orgId)}`).then(
      (r) => r.devices,
    ),

  revoke: (orgId: string, deviceId: string): Promise<{ device: Device }> =>
    deviceRequest<{ device: Device }>(`/${encodeURIComponent(deviceId)}/revoke`, {
      method: 'POST',
      body: { orgId },
    }),

  remove: (orgId: string, deviceId: string): Promise<void> =>
    deviceRequest<void>(`/${encodeURIComponent(deviceId)}?orgId=${encodeURIComponent(orgId)}`, {
      method: 'DELETE',
    }),
};
