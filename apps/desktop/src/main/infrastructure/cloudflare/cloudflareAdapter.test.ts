/**
 * P6.7 — Cloudflare account-profile resolution: the env → `CloudflareConfig` mapping (API token), the unconfigured
 * null path, and the one-adapter/twelve-collector shape. Pure-node; no live Cloudflare, no request issued.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudflareAdapter, makeCloudflareHttp, resolveCloudflareBaseConfig } from './cloudflareAdapter';
import { CloudflareClient } from './cloudflareClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
let saved: string | undefined;
beforeEach(() => { saved = process.env.NEUROPAUSE_CLOUDFLARE_API_TOKEN; delete process.env.NEUROPAUSE_CLOUDFLARE_API_TOKEN; });
afterEach(() => { if (saved === undefined) delete process.env.NEUROPAUSE_CLOUDFLARE_API_TOKEN; else process.env.NEUROPAUSE_CLOUDFLARE_API_TOKEN = saved; });

describe('resolveCloudflareBaseConfig', () => {
  it('returns null when unconfigured', () => {
    expect(resolveCloudflareBaseConfig()).toBeNull();
    expect(makeCloudflareHttp(gate, 'default')).toBeNull();
  });

  it('resolves an API-token profile and builds a client', () => {
    process.env.NEUROPAUSE_CLOUDFLARE_API_TOKEN = 'cf-token-abc';
    expect(resolveCloudflareBaseConfig()).toEqual({ token: 'cf-token-abc' });
    expect(makeCloudflareHttp(gate, 'default')).toBeInstanceOf(CloudflareClient);
  });
});

describe('cloudflareAdapter', () => {
  it('is one adapter (platform id cloudflare) with the twelve domain collectors', () => {
    expect(cloudflareAdapter.platformId).toBe('cloudflare');
    expect(cloudflareAdapter.provider).toBe('cloudflare');
    expect(cloudflareAdapter.collectors).toHaveLength(12);
  });
});
