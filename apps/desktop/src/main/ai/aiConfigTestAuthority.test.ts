/**
 * `aiConfig:test` MUST NOT BE AN UNAUTHENTICATED KEY-VALIDITY ORACLE —
 * AND GATING IT MUST NOT BREAK THE LOCAL PROBE THAT SHARES THE CHANNEL.
 *
 * THE DEFECT. The channel was classified `PUBLIC` in `ai/aiAuthzGate.ts` and
 * listed in `PUBLIC_CHANNELS` in `ipc/runtimeAuthz.ts`, so `withAiAuthz` stamped
 * it with neither `requireAuth` nor `permission`. Its handler falls back to the
 * stored credential —
 *
 *   req.secret || vault.getSecret(...) || process.env.<PROVIDER>_KEY || ''
 *
 * — and then makes a REAL request to api.openai.com / api.anthropic.com. So an
 * untrusted renderer frame could call it with `{provider:'openai'}` and NO
 * secret and learn whether the install's stored key is valid, without ever
 * possessing that key, and bill the owner for every attempt. Two distinct
 * harms: a validity ORACLE, and unmetered SPEND.
 *
 * Bounded honestly: the response is `{ok, detail, latencyMs}`, so the key
 * itself could never be read back. This closes the oracle and the spend, not a
 * key-exfiltration hole — there was not one.
 *
 * THE AUTHORITY IS `org:manage`, AND THE REASON IS THE OTHER HALF OF THIS
 * CHANNEL. `testConnection` short-circuits at `aiConfigIpc.ts:395`:
 * `provider === 'ollama'` is a bare GET against `http://localhost:11434` —
 * no vault read, no cloud host, no spend. `cloud:operate` (which the
 * credential-WRITING siblings carry) is in `PLATFORM_ONLY_PERMISSIONS` and no
 * organization role can hold it, so gating there would have put a localhost
 * probe behind platform-operator authority — the "D-5 trap" that
 * `aiAuthzGate.ts` names, and that `AiConfigPullModel` already avoided by
 * taking `org:manage` for this same local-AI setup path.
 *
 * WHY THE VAULT FALLBACK IS KEPT. Settings sends `keyInput.trim() || undefined`
 * (`AiSettingsPanel.tsx:125`), so testing an ALREADY-SAVED key legitimately
 * relies on it. Deleting the fallback would close the oracle by breaking the
 * feature; gating the channel closes it while the real workflow keeps working.
 *
 * EVERY AUTHORITY ASSERTION BELOW DRIVES THE REAL `createAuthorize`. An earlier
 * draft of this file used `authorize: () => undefined` — a stub that grants
 * unconditionally — which made "the workflow still works" unfalsifiable and hid
 * the localhost-probe regression completely. CLAUDE.md §2 #27: the expectation
 * must come from the consumer, never from a permitter invented by the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IpcChannel,
  isPlatformOnlyPermission,
  type EnterprisePermission,
  type OrgRole,
  type OrgUser,
} from '@neuropause/shared';

const mockState = vi.hoisted(() => ({ userDataDir: '', enc: true }));
vi.mock('electron', () => ({
  app: {
    getPath: () => mockState.userDataDir,
    getAppPath: () => mockState.userDataDir,
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => mockState.enc,
    encryptString: (s: string) => Buffer.from(`enc::${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('decrypt failed');
      return s.slice(5);
    },
  },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined },
}));

import { credentialStore } from '../security/secureStore';
import { OPENAI_CREDENTIAL_ID } from './providerManager';
import { initAiConfig } from './aiConfigIpc';
import { runSecureHandler, type AnySecureHandlerDef } from '../ipc/secureBridge';
import { createAuthorize } from '../enterprise/authzGate';

const STORED_KEY = 'sk-stored-DO-NOT-SPEND-abcdef123456';

/** Counts every request that would have left the machine. */
let outbound: string[] = [];

function installCountingFetch(): void {
  vi.stubGlobal('fetch', async (input: unknown) => {
    outbound.push(String(input));
    return { ok: true, status: 200, json: async () => ({ data: [] }) } as unknown as Response;
  });
}

function testDef(): AnySecureHandlerDef {
  const def = initAiConfig().handlers.find((d) => d.channel === IpcChannel.AiConfigTest);
  if (!def) throw new Error('aiConfig:test handler not registered');
  return def as AnySecureHandlerDef;
}

/**
 * A REAL authorizer, built from the production `createAuthorize` over a fixture
 * actor — the same construction `channelAuthorityTenancy.test.ts` uses. Nothing
 * here decides the answer; the enterprise gate does.
 */
function authorizeFor(input: {
  email: string;
  permissions: EnterprisePermission[];
  operators?: string[];
}): (p: EnterprisePermission) => void {
  const member = {
    id: 'u-1',
    orgId: 'org-alpha',
    kind: 'human',
    name: input.email,
    email: input.email,
    status: 'active',
    roleIds: ['r-1'],
  } as unknown as OrgUser;
  const role = {
    id: 'r-1',
    orgId: 'org-alpha',
    name: 'Fixture',
    permissions: [...input.permissions],
  } as unknown as OrgRole;
  const operators = new Set((input.operators ?? []).map((e) => e.toLowerCase()));
  return createAuthorize({
    sessionEmail: () => input.email,
    activeOrgId: () => 'org-alpha',
    usersFor: () => [member],
    rolesFor: () => [role],
    ownerMember: () => null,
    isPlatformOperator: (e) => operators.has(e.toLowerCase()),
  });
}

/** An ordinary organization manager — holds `org:manage`, is NOT a platform operator. */
const orgManager = (): ((p: EnterprisePermission) => void) =>
  authorizeFor({ email: 'manager@alpha.test', permissions: ['org:manage'] });

/** A signed-in principal with no management authority. */
const plainMember = (): ((p: EnterprisePermission) => void) =>
  authorizeFor({ email: 'member@alpha.test', permissions: ['org:read'] });

const AS_MANAGER = { isAuthenticated: () => true, authorize: orgManager() };

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-aitest-'));
  mockState.enc = true;
  outbound = [];
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  installCountingFetch();
  await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, STORED_KEY);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('aiConfig:test — the authority boundary', () => {
  it('is stamped with an authority, not left open', () => {
    const def = testDef();
    // The channel reads the vault credential and spends against it. It must
    // carry a real lock, and the caller must be a real principal.
    expect(def.permission, 'aiConfig:test must declare a permission').toBeDefined();
    expect(def.permission).toBe('org:manage' satisfies EnterprisePermission);
    expect(def.requireAuth, 'aiConfig:test must require a principal').toBe(true);
  });

  /**
   * THE ORACLE, CLOSED. An unauthenticated caller must not be able to turn the
   * install's stored key into a yes/no answer — and, critically, must not cause
   * a single billable request.
   */
  it('an UNAUTHENTICATED caller cannot trigger a credential-backed live test', async () => {
    const def = testDef();
    await expect(
      runSecureHandler(def, { provider: 'openai' }, { isAuthenticated: () => false }),
    ).rejects.toThrow();
    expect(outbound, 'no request may leave the machine').toEqual([]);
  });

  it('a signed-in principal WITHOUT org:manage cannot either', async () => {
    const def = testDef();
    await expect(
      runSecureHandler(def, { provider: 'openai' }, {
        isAuthenticated: () => true,
        authorize: plainMember(),
      }),
    ).rejects.toThrow(/org:manage/);
    expect(outbound).toEqual([]);
  });

  // Spend is the second harm and it is separate from the oracle: even a refused
  // call must not have cost anything by the time it is refused.
  it('refusal happens BEFORE the provider is contacted, not after', async () => {
    const def = testDef();
    for (const deps of [
      { isAuthenticated: () => false },
      { isAuthenticated: () => true, authorize: plainMember() },
    ]) {
      await runSecureHandler(def, { provider: 'openai' }, deps).catch(() => undefined);
    }
    expect(outbound).toEqual([]);
  });
});

/**
 * THE REGRESSION THIS FILE EXISTS TO PREVENT A SECOND TIME.
 *
 * The first version of the fix chose `cloud:operate` — the lock the
 * credential-WRITING siblings carry — which reads as the conservative choice and
 * is in fact unholdable: `PLATFORM_ONLY_PERMISSIONS` excludes every organization
 * role, so an ordinary user testing their LOCAL Ollama server was refused, while
 * `detectOllama` (PUBLIC) and `pullModel` (`org:manage`) kept working beside it.
 */
describe('aiConfig:test — gating must not swallow the local probe', () => {
  it('the chosen authority is one an organization role can actually hold', () => {
    const permission = testDef().permission as EnterprisePermission;
    expect(
      isPlatformOnlyPermission(permission),
      `${permission} is platform-only: no org role can hold it, so gating here ` +
        'would refuse ordinary users the localhost Ollama probe',
    ).toBe(false);
  });

  it('an ordinary org manager — NOT a platform operator — can run the local probe', async () => {
    const def = testDef();
    const res = (await runSecureHandler(def, { provider: 'ollama' }, AS_MANAGER)) as {
      ok: boolean;
    };
    expect(res.ok).toBe(true);
    // And it stayed local: nothing went to a cloud provider.
    expect(
      outbound.every((u) => !u.includes('api.openai.com') && !u.includes('api.anthropic.com')),
    ).toBe(true);
  });

  it('the local probe reads no credential at all', async () => {
    const def = testDef();
    // A vault that would THROW if consulted proves the ollama branch never
    // touches it, rather than asserting on an absence of side effects.
    const spy = vi.spyOn(credentialStore, 'getSecret').mockRejectedValue(new Error('vault touched'));
    try {
      const res = (await runSecureHandler(def, { provider: 'ollama' }, AS_MANAGER)) as {
        ok: boolean;
      };
      expect(res.ok).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('aiConfig:test — the legitimate Settings workflow still works', () => {
  it('an AUTHORIZED caller can test the STORED key (the Settings path with no typed key)', async () => {
    const def = testDef();
    const res = (await runSecureHandler(def, { provider: 'openai' }, AS_MANAGER)) as {
      ok: boolean;
      detail: string;
    };
    expect(res.ok).toBe(true);
    // It really used the vault fallback — one request, to the real endpoint.
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toContain('api.openai.com');
  });

  it('an AUTHORIZED caller can test a JUST-TYPED key', async () => {
    const def = testDef();
    const res = (await runSecureHandler(
      def,
      { provider: 'openai', secret: 'sk-typed-key-abcdef123456' },
      AS_MANAGER,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(outbound).toHaveLength(1);
  });

  it('never returns, and never has to be given, the stored key', async () => {
    const def = testDef();
    const res = (await runSecureHandler(def, { provider: 'openai' }, AS_MANAGER)) as {
      ok: boolean;
      detail: string;
    };
    expect(JSON.stringify(res)).not.toContain(STORED_KEY);
  });
});
