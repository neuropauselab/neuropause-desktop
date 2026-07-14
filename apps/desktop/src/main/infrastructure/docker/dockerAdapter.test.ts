/**
 * P6.5 — Docker engine-profile resolution: the env → `DockerTarget` mapping for a Unix socket, a plain TCP
 * engine, an `https://` engine (TLS forced via the system trust store even with no client cert), and a full
 * mTLS engine (PEM newline restoration), plus the unconfigured / unsupported-scheme null paths. Pure-node; no
 * live engine, no socket opened (only the profile is resolved).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dockerAdapter, makeDockerHttp, resolveDockerBaseConfig } from './dockerAdapter';
import { DockerClient } from './dockerClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const ENV_KEYS = ['NEUROPAUSE_DOCKER_HOST', 'NEUROPAUSE_DOCKER_TLS_CA', 'NEUROPAUSE_DOCKER_TLS_CERT', 'NEUROPAUSE_DOCKER_TLS_KEY'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('resolveDockerBaseConfig', () => {
  it('returns null when unconfigured', () => {
    expect(resolveDockerBaseConfig()).toBeNull();
    expect(makeDockerHttp(gate, 'engine1')).toBeNull();
  });

  it('resolves a Unix socket target (no TLS) and builds a client', () => {
    process.env.NEUROPAUSE_DOCKER_HOST = 'unix:///var/run/docker.sock';
    expect(resolveDockerBaseConfig()!.target).toEqual({ socketPath: '/var/run/docker.sock' });
    expect(makeDockerHttp(gate, 'engine1')).toBeInstanceOf(DockerClient);
  });

  it('resolves a plain tcp:// engine on 2375 without TLS', () => {
    process.env.NEUROPAUSE_DOCKER_HOST = 'tcp://10.0.0.5:2375';
    expect(resolveDockerBaseConfig()!.target).toMatchObject({ host: '10.0.0.5', port: 2375, tls: false });
  });

  it('forces TLS for an https:// engine even with NO client cert (system trust store)', () => {
    process.env.NEUROPAUSE_DOCKER_HOST = 'https://engine.internal:2376';
    const target = resolveDockerBaseConfig()!.target;
    expect(target).toMatchObject({ host: 'engine.internal', port: 2376, tls: true });
    expect(target.cert).toBeUndefined();
    expect(target.ca).toBeUndefined();
  });

  it('resolves a full mTLS tcp:// engine on 2376, restoring PEM newlines', () => {
    process.env.NEUROPAUSE_DOCKER_HOST = 'tcp://engine.internal';
    process.env.NEUROPAUSE_DOCKER_TLS_CA = '-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----';
    process.env.NEUROPAUSE_DOCKER_TLS_CERT = '-----BEGIN CERTIFICATE-----\\nBBB\\n-----END CERTIFICATE-----';
    process.env.NEUROPAUSE_DOCKER_TLS_KEY = '-----BEGIN PRIVATE KEY-----\\nCCC\\n-----END PRIVATE KEY-----';
    const target = resolveDockerBaseConfig()!.target;
    expect(target).toMatchObject({ host: 'engine.internal', port: 2376, tls: true });
    expect(target.ca).toContain('\n');
    expect(target.ca).not.toContain('\\n'); // the escaped \n was restored to a real newline
    expect(target.cert).toContain('BBB');
    expect(makeDockerHttp(gate, 'engine1')).toBeInstanceOf(DockerClient);
  });

  it('returns null for an unsupported scheme (e.g. ssh://)', () => {
    process.env.NEUROPAUSE_DOCKER_HOST = 'ssh://user@host';
    expect(resolveDockerBaseConfig()).toBeNull();
    expect(makeDockerHttp(gate, 'engine1')).toBeNull();
  });
});

describe('dockerAdapter', () => {
  it('is one adapter (platform id docker) with the ten domain collectors', () => {
    expect(dockerAdapter.platformId).toBe('docker');
    expect(dockerAdapter.provider).toBe('docker');
    expect(dockerAdapter.collectors).toHaveLength(10);
  });
});
