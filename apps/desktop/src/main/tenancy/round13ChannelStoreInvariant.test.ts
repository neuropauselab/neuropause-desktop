/**
 * P13C ROUND 13 — PHASE 3. THE INVARIANT THAT WOULD HAVE CAUGHT ROUND 12.
 *
 * Round 12's sweep found fourteen public channels carrying tenant data — nine of
 * them one defect — and every automated mechanism in the repository passed the
 * whole time. `assertAllChannelsClassified` asks *"is this channel classified?"*
 * and the answer was yes for all fourteen. Nothing asked whether the
 * classification MATCHED THE PAYLOAD.
 *
 * That is the third instance of one meta-shape in this program: a gate that
 * checks PRESENCE where it needed to check CORRESPONDENCE. Data → authority
 * (Round 10). Presence → attachment (Round 10). Classified → correctly
 * classified (here).
 *
 * THE TEST THAT MATTERS IS THE SYNTHETIC ONE. A suite that only asserts today's
 * fourteen channels is the named list Round 12 already shipped, and it cannot see
 * a fifteenth. So the cases below build a channel that DOES NOT EXIST in the
 * product, point it at a CUSTOMER_DERIVED store, and require the mechanism to
 * refuse it. That is what makes this a rule rather than an inventory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IpcChannelName } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import {
  declareChannelResource,
  channelResourceViolations,
  assertChannelResourceSafety,
  __resetChannelResourceRegistryForTests,
} from '../ipc/channelResource';
import type { StoreScopeDeclaration } from '../tenancy/storeScope';

/** A CUSTOMER_DERIVED tenant store, the shape of `unified-entities`. */
const CUSTOMER: StoreScopeDeclaration = {
  name: 'fixture-customer-store',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: 'per-tenant cap',
  reason: 'the tenant’s own records',
};

/** Install metadata, the shape of `local-app-registry`. */
const METADATA: StoreScopeDeclaration = {
  name: 'fixture-metadata-store',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  authority: 'PLATFORM_OPERATOR',
  classification: 'INSTALL_METADATA',
  retention: 'unbounded; rows describe the machine',
  reason: 'one shared runtime on one machine',
};

const STORES = [CUSTOMER, METADATA];

/** Stand-ins for channels; the rule never inspects the name. */
const CH = IpcChannel.RegistryList as IpcChannelName;
const OTHER = IpcChannel.RegistryGet as IpcChannelName;

beforeEach(() => __resetChannelResourceRegistryForTests());
afterEach(() => __resetChannelResourceRegistryForTests());

describe('a NEW public channel onto customer data is refused automatically', () => {
  it('PUBLIC + CUSTOMER_DERIVED is a violation', () => {
    declareChannelResource({
      channel: CH,
      store: CUSTOMER.name,
      effect: 'read',
      reason: 'fixture: a projection over tenant records',
    });
    const v = channelResourceViolations(new Set([CH]), STORES);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe('PUBLIC_CUSTOMER_DERIVED');
  });

  it('and the composition assertion THROWS on it', () => {
    declareChannelResource({
      channel: CH,
      store: CUSTOMER.name,
      effect: 'read',
      reason: 'fixture',
    });
    expect(() => assertChannelResourceSafety(new Set([CH]), STORES)).toThrow(
      /PUBLIC_CUSTOMER_DERIVED/,
    );
  });

  it('the SAME channel gated is clean — the rule is about public, not about the data', () => {
    declareChannelResource({
      channel: CH,
      store: CUSTOMER.name,
      effect: 'read',
      reason: 'fixture',
    });
    // Not in the public set = gated somewhere. No violation.
    expect(channelResourceViolations(new Set<IpcChannelName>(), STORES)).toEqual([]);
    expect(() => assertChannelResourceSafety(new Set<IpcChannelName>(), STORES)).not.toThrow();
  });

  it('PUBLIC + install metadata READ stays legal', () => {
    // The `plugins:list` / `registry:list` standard. A rule that banned this
    // would push stores into declaring scopes they do not have, which is worse.
    declareChannelResource({
      channel: CH,
      store: METADATA.name,
      effect: 'read',
      reason: 'fixture: what this machine has installed',
    });
    expect(channelResourceViolations(new Set([CH]), STORES)).toEqual([]);
  });
});

describe('public mutations are refused by scope', () => {
  it('PUBLIC + mutate + INSTALL_GLOBAL is a violation (the updater / nps / pilot class)', () => {
    declareChannelResource({
      channel: CH,
      store: METADATA.name,
      effect: 'mutate',
      reason: 'fixture: an install-wide write',
    });
    const v = channelResourceViolations(new Set([CH]), STORES);
    expect(v[0]?.rule).toBe('PUBLIC_GLOBAL_MUTATION');
  });

  it('PUBLIC + mutate + TENANT is a violation (the platform:emit class)', () => {
    declareChannelResource({
      channel: CH,
      store: CUSTOMER.name,
      effect: 'mutate',
      reason: 'fixture: authoring rows into a scoped store',
    });
    // Customer-derived is caught first and is the stronger statement.
    expect(channelResourceViolations(new Set([CH]), STORES)[0]?.rule).toBe(
      'PUBLIC_CUSTOMER_DERIVED',
    );
  });

  it('a scoped, non-customer store still refuses a public write', () => {
    const scopedMeta: StoreScopeDeclaration = {
      ...METADATA,
      name: 'fixture-scoped-meta',
      scope: 'WORKSPACE',
      authority: 'ORG_ROLE',
    };
    declareChannelResource({
      channel: CH,
      store: scopedMeta.name,
      effect: 'mutate',
      reason: 'fixture',
    });
    const v = channelResourceViolations(new Set([CH]), [...STORES, scopedMeta]);
    expect(v[0]?.rule).toBe('PUBLIC_SCOPED_MUTATION');
  });
});

describe('the mechanism fails closed on an unclassified store', () => {
  it('a public channel naming a store with no declaration is a violation', () => {
    // "I could not check this" must not read the same as "this is fine".
    declareChannelResource({
      channel: CH,
      store: 'a-store-that-declares-nothing',
      effect: 'read',
      reason: 'fixture',
    });
    expect(channelResourceViolations(new Set([CH]), STORES)[0]?.rule).toBe('UNKNOWN_STORE');
  });
});

describe('the declaration itself has to be honest', () => {
  it('a declaration must name a store', () => {
    expect(() =>
      declareChannelResource({ channel: CH, store: '  ', effect: 'read', reason: 'x' }),
    ).toThrow(/must name the store/);
  });

  it('a declaration must say why', () => {
    expect(() =>
      declareChannelResource({ channel: CH, store: CUSTOMER.name, effect: 'read', reason: ' ' }),
    ).toThrow(/must say WHY/);
  });
});

describe('several channels are evaluated independently', () => {
  it('the clean one passes while the violating one is reported', () => {
    declareChannelResource({
      channel: CH,
      store: METADATA.name,
      effect: 'read',
      reason: 'fixture: fine',
    });
    declareChannelResource({
      channel: OTHER,
      store: CUSTOMER.name,
      effect: 'read',
      reason: 'fixture: not fine',
    });
    const v = channelResourceViolations(new Set([CH, OTHER]), STORES);
    expect(v.map((x) => x.channel)).toEqual([OTHER]);
  });
});
