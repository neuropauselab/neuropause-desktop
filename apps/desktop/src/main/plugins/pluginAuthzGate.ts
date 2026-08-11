/**
 * A CHANNEL THAT MUTATES A PLATFORM STORE MAY NOT CARRY AN ORGANIZATION
 * PERMISSION — checked at composition, not in review. P13C ROUND 10 — NEW-H7.
 *
 * WHAT WAS MISSING, AND WHY THE PREVIOUS FIX DID NOT HOLD
 *
 * `plugins/pluginManager.ts` declares its store `PLATFORM_GLOBAL` with
 * `authority: 'PLATFORM_OPERATOR'`, and its own `reason` names the exposure:
 * "it was marketplace:manage, an organization role, so tenant A's admin could
 * enable code running while tenant B's data was in memory". Round 8 moved
 * install/enable/disable/reload/update/remove to `cloud:operate` and left
 * `plugins:grant` and `plugins:revoke` on `marketplace:manage` — an ORGANIZATION
 * role, in the Owner wildcard and in ADMIN. Anyone may create an organization
 * and become its Owner, so those two rows were a self-service grant of
 * filesystem, network and host capabilities to install-wide executable code that
 * runs in-process for every tenant. `plugins:list` is public and returns every
 * plugin id with its current grants, so nothing had to be discovered first.
 *
 * The declaration was right and nothing checked it. NOTHING IN THE CODEBASE
 * BOUND A STORE'S DECLARED `authority` TO THE PERMISSION ITS CHANNELS REQUIRE,
 * so `PLATFORM_OPERATOR` on that declaration was documentation. Fixing the two
 * rows without fixing that leaves the next row free to drift back.
 *
 * THE SHAPE, AND WHY IT IS NOT A SECOND FRAMEWORK
 *
 * `workforce/authzGate.ts` is the house pattern: a channel→permission map that
 * THROWS at composition when a channel of its family ships unclassified. This
 * adds the missing predicate to that pattern and nothing else. It introduces no
 * new permission, no new enforcement path and no new annotator — the enforcement
 * is still the secure bridge reading `RUNTIME_CHANNEL_PERMISSIONS`. What is new
 * is a function that reads the store's OWN declaration out of the scope registry
 * and refuses the combination:
 *
 *     store declares PLATFORM_GLOBAL / PLATFORM_OPERATOR
 *     + a channel that MUTATES it
 *     + a permission an organization role can hold
 *     ⇒ throw at composition.
 *
 * `assertPlatformStoreChannelAuthority` takes the store name, the mutating
 * channels and the family: it is generic by construction, so the next family
 * with a platform store imports it rather than writing a second copy.
 *
 * WHERE IT RUNS: `pluginManager.ts` calls `assertPluginChannelAuthority()` at
 * module scope, immediately after its `declareStoreScope`. Every composition
 * imports the plugin manager, so a bad row means the application does not start
 * — the same failure mode as `withWorkforceAuthz`'s throw.
 */
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS, isPlatformOnlyPermission } from '@neuropause/shared';
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';
import { storeScopeDeclarations, type StoreScopeDeclaration } from '../tenancy/storeScope';

/** The scope declaration this gate reads. See tenancy/storeScope.ts. */
export const PLUGIN_STORE_NAME = 'plugin-install-registry';

/**
 * Every `plugins:*` channel that MUTATES the plugin registry or a plugin root.
 *
 * `plugins:grant` and `plugins:revoke` are here because a capability grant is a
 * write to `record.grantedPermissions` in `userData/plugins.json` — the same
 * file, the same store, the same blast radius as an install.
 */
export const PLUGIN_MUTATION_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.PluginsInstall,
  IpcChannel.PluginsEnable,
  IpcChannel.PluginsDisable,
  IpcChannel.PluginsReload,
  IpcChannel.PluginsUpdate,
  IpcChannel.PluginsRemove,
  IpcChannel.PluginsGrant,
  IpcChannel.PluginsRevoke,
];

/** Every invokable channel in the plugin family — reads included. */
export const PLUGIN_FAMILY_CHANNELS: readonly IpcChannelName[] = RUNTIME_INVOKABLE_CHANNELS.filter(
  (c) => c.startsWith('plugins:'),
);

export interface PlatformStoreChannelGateInput {
  /** The `declareStoreScope` name of the store these channels reach. */
  storeName: string;
  /** Every invokable channel in the family: each must be classified or public. */
  family: readonly IpcChannelName[];
  /** The subset that MUTATES the store. Each must carry a permission. */
  mutations: readonly IpcChannelName[];
  /** The channel→permission table. Defaults to the central runtime table. */
  permissionOf?: (channel: IpcChannelName) => EnterprisePermission | undefined;
  /** The vetted public allowlist. Defaults to the central one. */
  isPublic?: (channel: IpcChannelName) => boolean;
  /** The live scope registry. Injectable so the invariant is testable. */
  declarations?: () => StoreScopeDeclaration[];
}

/**
 * THE INVARIANT. Throws when a channel's authority contradicts the authority the
 * store it mutates declared for itself.
 *
 * Three refusals, in order:
 *   1. the store has no declaration at all — the gate cannot check what nobody
 *      stated, and silence is the condition this program keeps finding;
 *   2. a family channel is neither classified nor on the public allowlist — the
 *      house `withXAuthz` throw, applied to the family rather than to one def;
 *   3. a MUTATING channel over a platform store carries a permission an
 *      organization role can hold. This is the one that was missing.
 */
export function assertPlatformStoreChannelAuthority(input: PlatformStoreChannelGateInput): void {
  const permissionOf =
    input.permissionOf ?? ((c: IpcChannelName) => RUNTIME_CHANNEL_PERMISSIONS[c]);
  const isPublic = input.isPublic ?? ((c: IpcChannelName) => PUBLIC_CHANNELS.has(c));
  const declarations = (input.declarations ?? storeScopeDeclarations)();
  const store = declarations.find((d) => d.name === input.storeName);
  if (!store) {
    throw new Error(
      `Channel-authority gate: store "${input.storeName}" has no scope declaration, so the ` +
        'authority its channels must carry is unknown. Declare it with declareStoreScope() ' +
        'before the gate runs.',
    );
  }

  const unclassified = input.family.filter((c) => !permissionOf(c) && !isPublic(c));
  if (unclassified.length > 0) {
    throw new Error(
      `Channel-authority gate: ${unclassified.join(', ')} reach the "${input.storeName}" store ` +
        'with no permission classification and no place on the public allowlist. Classify in ' +
        'RUNTIME_CHANNEL_PERMISSIONS (ipc/runtimeAuthz.ts) or allowlist deliberately.',
    );
  }

  /**
   * A store is on the PLATFORM axis when either half of its declaration says so.
   * Both are checked because they answer different questions — scope is "whose
   * data", authority is "who may change it" — and either one alone is enough to
   * make an organization permission the wrong axis for a mutation.
   */
  const isPlatformStore = store.scope === 'PLATFORM_GLOBAL' || store.authority === 'PLATFORM_OPERATOR';
  if (!isPlatformStore) return;

  const offenders: string[] = [];
  for (const channel of input.mutations) {
    const permission = permissionOf(channel);
    if (!permission) {
      offenders.push(`${channel} (no permission — a mutation may never be public)`);
      continue;
    }
    if (!isPlatformOnlyPermission(permission)) {
      offenders.push(`${channel} → ${permission}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Channel-authority gate: the "${input.storeName}" store declares ${store.scope} / ` +
        `${store.authority}, but these channels mutate it on an ORGANIZATION permission: ` +
        `${offenders.join(', ')}. Anyone may create an organization and own it, so an ` +
        'organization role over an install-wide resource is a self-service grant across every ' +
        'tenant. Use a permission in PLATFORM_ONLY_PERMISSIONS (cloud:operate), or re-declare ' +
        'the store with an honest scope and authority.',
    );
  }
}

/**
 * The plugin family's binding of the invariant, called at composition from
 * `pluginManager.ts` once its store has declared itself.
 */
export function assertPluginChannelAuthority(): void {
  assertPlatformStoreChannelAuthority({
    storeName: PLUGIN_STORE_NAME,
    family: PLUGIN_FAMILY_CHANNELS,
    mutations: PLUGIN_MUTATION_CHANNELS,
  });
}
