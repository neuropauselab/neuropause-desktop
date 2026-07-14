/**
 * P6.10 — IaC source resolution + adapter shape: `normalizeHost`, per-flavor env → profile resolution (three
 * independent backends), the `default` → sole-backend fallback, the malformed-host degrade-to-null, and the single
 * adapter (`iac`) with all provisioning collectors. Pure-node; no live backend.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { iacAdapter, makeIacHttp, normalizeHost, resolveIacSource, resolveIacSources } from './iacAdapter';
import { IacClient } from './iacClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const ENV_KEYS = [
  'NEUROPAUSE_IAC_TERRAFORM_TOKEN', 'NEUROPAUSE_IAC_TERRAFORM_ORG', 'NEUROPAUSE_IAC_TERRAFORM_HOST',
  'NEUROPAUSE_IAC_OPENTOFU_TOKEN', 'NEUROPAUSE_IAC_OPENTOFU_ORG', 'NEUROPAUSE_IAC_OPENTOFU_HOST',
  'NEUROPAUSE_IAC_PULUMI_TOKEN', 'NEUROPAUSE_IAC_PULUMI_ORG', 'NEUROPAUSE_IAC_PULUMI_HOST',
] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = {}; for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('normalizeHost', () => {
  it('prepends https and strips trailing slashes', () => {
    expect(normalizeHost('app.terraform.io')).toBe('https://app.terraform.io');
    expect(normalizeHost('https://tfe.corp.example/')).toBe('https://tfe.corp.example');
  });
});

describe('resolveIacSources / makeIacHttp', () => {
  it('returns no sources when unconfigured', () => {
    expect(resolveIacSources().size).toBe(0);
    expect(makeIacHttp(gate, 'terraform')).toBeNull();
    expect(makeIacHttp(gate, 'default')).toBeNull();
  });

  it('resolves three independent backends with their default hosts', () => {
    process.env.NEUROPAUSE_IAC_TERRAFORM_TOKEN = 't'; process.env.NEUROPAUSE_IAC_TERRAFORM_ORG = 'acme';
    process.env.NEUROPAUSE_IAC_OPENTOFU_TOKEN = 'o'; process.env.NEUROPAUSE_IAC_OPENTOFU_ORG = 'acme';
    process.env.NEUROPAUSE_IAC_PULUMI_TOKEN = 'p'; process.env.NEUROPAUSE_IAC_PULUMI_ORG = 'acme';
    const sources = resolveIacSources();
    expect([...sources.keys()].sort()).toEqual(['opentofu', 'pulumi', 'terraform']);
    expect(sources.get('terraform')!.host).toBe('https://app.terraform.io');
    expect(sources.get('pulumi')!.host).toBe('https://api.pulumi.com');
    expect(makeIacHttp(gate, 'terraform')).toBeInstanceOf(IacClient);
    expect(makeIacHttp(gate, 'pulumi')).toBeInstanceOf(IacClient);
  });

  it('answers to `default` when exactly one backend is configured', () => {
    process.env.NEUROPAUSE_IAC_TERRAFORM_TOKEN = 't'; process.env.NEUROPAUSE_IAC_TERRAFORM_ORG = 'acme';
    expect(resolveIacSource('default')!.flavor).toBe('terraform');
    expect(makeIacHttp(gate, 'default')).toBeInstanceOf(IacClient);
  });

  it('does NOT answer to `default` when multiple backends are configured (ambiguous)', () => {
    process.env.NEUROPAUSE_IAC_TERRAFORM_TOKEN = 't'; process.env.NEUROPAUSE_IAC_TERRAFORM_ORG = 'acme';
    process.env.NEUROPAUSE_IAC_PULUMI_TOKEN = 'p'; process.env.NEUROPAUSE_IAC_PULUMI_ORG = 'acme';
    expect(resolveIacSource('default')).toBeNull();
  });

  it('degrades to null on a malformed host rather than throwing', () => {
    process.env.NEUROPAUSE_IAC_TERRAFORM_TOKEN = 't'; process.env.NEUROPAUSE_IAC_TERRAFORM_ORG = 'acme';
    process.env.NEUROPAUSE_IAC_TERRAFORM_HOST = 'http://['; // survives normalizeHost, throws in new URL()
    expect(makeIacHttp(gate, 'terraform')).toBeNull();
  });
});

describe('iacAdapter', () => {
  it('is one adapter (platform id iac) with the provisioning collectors', () => {
    expect(iacAdapter.platformId).toBe('iac');
    expect(iacAdapter.provider).toBe('iac');
    expect(iacAdapter.collectors).toHaveLength(8);
    expect(iacAdapter.collectors.every((c) => c.domain === 'provisioning')).toBe(true);
  });
});
