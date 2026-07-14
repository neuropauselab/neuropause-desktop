/**
 * P6.6 — VMware vCenter-profile resolution: the env → `VmwareConfig` mapping (host + username + password), the
 * unconfigured / partial-config null paths, and the one-adapter/ten-collector shape. Pure-node; no live vCenter,
 * no session opened (only the profile is resolved).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeVmwareHttp, resolveVmwareBaseConfig, vmwareAdapter } from './vmwareAdapter';
import { VmwareClient } from './vmwareClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const ENV_KEYS = ['NEUROPAUSE_VMWARE_HOST', 'NEUROPAUSE_VMWARE_USERNAME', 'NEUROPAUSE_VMWARE_PASSWORD'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('resolveVmwareBaseConfig', () => {
  it('returns null when unconfigured', () => {
    expect(resolveVmwareBaseConfig()).toBeNull();
    expect(makeVmwareHttp(gate, 'vc1')).toBeNull();
  });

  it('returns null when the profile is only partially set', () => {
    process.env.NEUROPAUSE_VMWARE_HOST = 'https://vcenter.example.com';
    expect(resolveVmwareBaseConfig()).toBeNull(); // username + password still missing
    process.env.NEUROPAUSE_VMWARE_USERNAME = 'administrator@vsphere.local';
    expect(resolveVmwareBaseConfig()).toBeNull(); // password still missing
  });

  it('resolves a full vCenter profile and builds a client', () => {
    process.env.NEUROPAUSE_VMWARE_HOST = 'https://vcenter.example.com';
    process.env.NEUROPAUSE_VMWARE_USERNAME = 'administrator@vsphere.local';
    process.env.NEUROPAUSE_VMWARE_PASSWORD = 's3cret';
    expect(resolveVmwareBaseConfig()).toEqual({ server: 'https://vcenter.example.com', username: 'administrator@vsphere.local', password: 's3cret' });
    expect(makeVmwareHttp(gate, 'vc1')).toBeInstanceOf(VmwareClient);
  });

  it('degrades to null on a malformed vCenter URL rather than throwing', () => {
    process.env.NEUROPAUSE_VMWARE_HOST = 'not a url';
    process.env.NEUROPAUSE_VMWARE_USERNAME = 'admin';
    process.env.NEUROPAUSE_VMWARE_PASSWORD = 'pw';
    expect(makeVmwareHttp(gate, 'vc1')).toBeNull();
  });
});

describe('vmwareAdapter', () => {
  it('is one adapter (platform id vmware) with the ten domain collectors', () => {
    expect(vmwareAdapter.platformId).toBe('vmware');
    expect(vmwareAdapter.provider).toBe('vmware');
    expect(vmwareAdapter.collectors).toHaveLength(10);
  });
});
