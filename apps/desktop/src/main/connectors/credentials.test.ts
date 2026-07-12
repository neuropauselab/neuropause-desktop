import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorManifest } from '@neuropause/shared';
import { resolveCredentials, resolveWebhookSecret } from './credentials';

// buildInfo imports electron; the baked lookup is stubbed here.
vi.mock('../buildInfo', () => ({
  getBakedClientId: (name: string) =>
    name === 'NEUROPAUSE_TESTPROV_CLIENT_ID' ? 'baked-id' : null,
}));

function manifest(oauth: Record<string, unknown> | null): ConnectorManifest {
  return { id: 'testprov', oauth } as unknown as ConnectorManifest;
}

const ID_ENV = 'NEUROPAUSE_TESTPROV_CLIENT_ID';
const SECRET_ENV = 'NEUROPAUSE_TESTPROV_CLIENT_SECRET';

describe('resolveCredentials', () => {
  beforeEach(() => {
    delete process.env[ID_ENV];
    delete process.env[SECRET_ENV];
  });
  afterEach(() => {
    delete process.env[ID_ENV];
    delete process.env[SECRET_ENV];
  });

  it('falls back to the baked client id when the env var is absent', () => {
    const creds = resolveCredentials(manifest({ clientIdEnv: ID_ENV }));
    expect(creds).toEqual({ clientId: 'baked-id', clientSecret: null });
  });

  it('lets a runtime env var win over the baked id', () => {
    process.env[ID_ENV] = 'env-id';
    const creds = resolveCredentials(manifest({ clientIdEnv: ID_ENV }));
    expect(creds?.clientId).toBe('env-id');
  });

  it('never bakes secrets: a confidential client without its secret stays unavailable', () => {
    const creds = resolveCredentials(
      manifest({ clientIdEnv: ID_ENV, clientSecretEnv: SECRET_ENV }),
    );
    expect(creds).toBeNull();
  });

  it('returns null without an oauth block', () => {
    expect(resolveCredentials(manifest(null))).toBeNull();
  });
});

const WEBHOOK_ENV = 'NEUROPAUSE_TESTPROV_WEBHOOK_SECRET';

describe('resolveWebhookSecret', () => {
  afterEach(() => {
    delete process.env[WEBHOOK_ENV];
  });

  it('returns null when the manifest declares no webhookSecretEnv (or no oauth)', () => {
    expect(resolveWebhookSecret(manifest({ clientIdEnv: ID_ENV }))).toBeNull();
    expect(resolveWebhookSecret(manifest(null))).toBeNull();
  });

  it('reads the named env var, and null once it is unset', () => {
    process.env[WEBHOOK_ENV] = 'wh-secret';
    expect(resolveWebhookSecret(manifest({ webhookSecretEnv: WEBHOOK_ENV }))).toBe('wh-secret');
    delete process.env[WEBHOOK_ENV];
    expect(resolveWebhookSecret(manifest({ webhookSecretEnv: WEBHOOK_ENV }))).toBeNull();
  });
});
