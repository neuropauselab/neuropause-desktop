/**
 * P6.9 — Databricks workspace-profile resolution + adapter shape: `normalizeHost` upgrades a bare host to https and
 * strips trailing slashes, the env → profile / unconfigured paths behave, a malformed workspace URL degrades to
 * null (unconfigured) rather than throwing, and the adapter is ONE platform (`databricks`) with the sixteen domain
 * collectors. Pure-node; no live Databricks, no request issued.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { databricksAdapter, makeDatabricksHttp, normalizeHost, resolveDatabricksBaseConfig } from './databricksAdapter';
import { DatabricksClient } from './databricksClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const ENV_KEYS = ['NEUROPAUSE_DATABRICKS_HOST', 'NEUROPAUSE_DATABRICKS_TOKEN'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('normalizeHost', () => {
  it('prepends https:// to a bare workspace host', () => {
    expect(normalizeHost('dbc-1234-5e6f.cloud.databricks.com')).toBe('https://dbc-1234-5e6f.cloud.databricks.com');
  });
  it('keeps an explicit scheme and strips trailing slashes', () => {
    expect(normalizeHost('https://dbc-1234-5e6f.cloud.databricks.com/')).toBe('https://dbc-1234-5e6f.cloud.databricks.com');
    expect(normalizeHost('  https://x.databricks.com//  ')).toBe('https://x.databricks.com');
  });
});

describe('resolveDatabricksBaseConfig / makeDatabricksHttp', () => {
  it('returns null when unconfigured', () => {
    expect(resolveDatabricksBaseConfig()).toBeNull();
    expect(makeDatabricksHttp(gate, 'default')).toBeNull();
  });

  it('resolves a full profile (normalizing the host) and builds a client', () => {
    process.env.NEUROPAUSE_DATABRICKS_HOST = 'dbc-1234-5e6f.cloud.databricks.com';
    process.env.NEUROPAUSE_DATABRICKS_TOKEN = 'dapi-secret';
    const cfg = resolveDatabricksBaseConfig()!;
    expect(cfg.host).toBe('https://dbc-1234-5e6f.cloud.databricks.com');
    expect(cfg.token).toBe('dapi-secret');
    expect(makeDatabricksHttp(gate, 'default')).toBeInstanceOf(DatabricksClient);
  });

  it('degrades to null on a malformed workspace URL rather than throwing', () => {
    process.env.NEUROPAUSE_DATABRICKS_HOST = 'http://['; // survives normalizeHost (has a scheme), throws in new URL()
    process.env.NEUROPAUSE_DATABRICKS_TOKEN = 'dapi-secret';
    expect(makeDatabricksHttp(gate, 'default')).toBeNull();
  });
});

describe('databricksAdapter', () => {
  it('is one adapter (platform id databricks) with the sixteen domain collectors', () => {
    expect(databricksAdapter.platformId).toBe('databricks');
    expect(databricksAdapter.provider).toBe('databricks');
    expect(databricksAdapter.collectors).toHaveLength(16);
  });
});
