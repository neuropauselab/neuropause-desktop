/**
 * Typed client for the backend /billing API. Main-process only — the renderer
 * reaches it through IPC, never the backend directly. Mirrors orgClient: every
 * call is authenticated with the access token from the auth service (refreshing
 * transparently). This client adds NO billing logic — the subscription/Razorpay
 * work lives entirely in the backend; this just invokes the existing endpoint.
 */
import type { BillingPlanId } from '@neuropause/shared';
import { config } from '../config';
import { authService } from '../auth/authService';

export class BillingApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BillingApiError';
    this.status = status;
    this.code = code;
  }
}

interface BillingRequestInit {
  method?: string;
  body?: unknown;
}

async function billingRequest<T>(path: string, init: BillingRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const token = await authService.getValidAccessToken();
  if (!token) throw new BillingApiError(401, 'not_authenticated', 'Sign in to manage billing.');
  headers.Authorization = `Bearer ${token}`;

  const url = `${config.backendUrl}/billing${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new BillingApiError(
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
    throw new BillingApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  return json as T;
}

export interface CheckoutResult {
  subscriptionId: string;
  checkoutUrl: string;
}

export const billingClient = {
  /** Create a subscription checkout for an org+plan; returns the hosted checkout URL. */
  checkout: (orgId: string, plan: BillingPlanId, seats?: number) =>
    billingRequest<CheckoutResult>(`/${orgId}/checkout`, {
      method: 'POST',
      body: seats !== undefined ? { plan, seats } : { plan },
    }),
};
