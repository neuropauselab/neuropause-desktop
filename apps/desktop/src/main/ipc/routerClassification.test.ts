/**
 * P13C GATE 10 — the router (sender-trust-only) set is now INSIDE a classification
 * invariant.
 *
 * NeuroPause has two IPC registration paths:
 *   · the SECURE BRIDGE (`runtimeAuthz`), whose channels carry auth + permission
 *     and are checked by `assertAllChannelsClassified` over RUNTIME_INVOKABLE_CHANNELS;
 *   · the ROUTER (`ipc/router.ts`), whose channels carry sender-trust + Zod ONLY.
 *
 * The router set (`INVOKABLE_CHANNELS`) was OUTSIDE the classification invariant:
 * a channel added there was sender-trust-only by omission, with nothing asserting
 * that was a reviewed, deliberate choice — the exact gap Gate 10's row named
 * ("workspace-ctx:* unauthenticated by design but outside the classification
 * invariant"). This test closes the class: every router channel must be an
 * enumerated, justified member of the reviewed allowlist below, the two sets must
 * be disjoint, and a NEW router channel added without review fails CI.
 *
 * WHY SENDER-TRUST-ONLY IS ACCEPTABLE FOR EACH: none of these carries another
 * tenant's data. Auth channels run BEFORE any session exists; app/window/runtime
 * channels are local-desktop conveniences; and the `workspace-ctx:*` channels are
 * the PER-USER, DEVICE-LOCAL "views/tab-sets" store (a USER_PREFERENCE that scopes
 * no tenant data — the tenant workspace switch is the separate, gated
 * `enterprise:workspace.switch`). Sender-trust (only our own renderer origin) is
 * the right control for all of them.
 */
import { describe, expect, it } from 'vitest';
import {
  INVOKABLE_CHANNELS,
  RUNTIME_INVOKABLE_CHANNELS,
  IpcChannel,
  type IpcChannelName,
} from '@neuropause/shared';

/** The reviewed set of channels that are sender-trust-only BY DESIGN, with the
 *  category that justifies no auth/permission. Set equality with
 *  INVOKABLE_CHANNELS is asserted below, so this cannot silently drift. */
const ROUTER_SENDER_TRUST_ONLY: ReadonlySet<IpcChannelName> = new Set<IpcChannelName>([
  // Auth — must be answerable BEFORE a session exists.
  IpcChannel.AuthProviders,
  IpcChannel.AuthGetStatus,
  IpcChannel.AuthLoginOAuth,
  IpcChannel.AuthLoginEmail,
  IpcChannel.AuthRegisterEmail,
  IpcChannel.AuthLogout,
  // Local desktop app/window conveniences — no tenant data.
  IpcChannel.AppGetInfo,
  IpcChannel.AppSetThemeSource,
  IpcChannel.AppGetThemeSource,
  IpcChannel.WindowClose,
  IpcChannel.RuntimeGetLoginAtStartup,
  IpcChannel.RuntimeSetLoginAtStartup,
  // Boot-window runtime state — answerable before the window/handlers are up.
  IpcChannel.RuntimeState,
  // Per-user, device-local view/tab-set store (USER_PREFERENCE; scopes no tenant data).
  IpcChannel.WorkspaceCtxBootstrap,
  IpcChannel.WorkspaceCtxList,
  IpcChannel.WorkspaceCtxCreate,
  IpcChannel.WorkspaceCtxRename,
  IpcChannel.WorkspaceCtxDelete,
  IpcChannel.WorkspaceCtxSwitch,
  IpcChannel.WorkspaceCtxUpdateSnapshot,
]);

describe('router channels are an explicitly reviewed, sender-trust-only set', () => {
  it('every router channel is in the reviewed allowlist — a new one added by omission fails here', () => {
    const unreviewed = INVOKABLE_CHANNELS.filter((c) => !ROUTER_SENDER_TRUST_ONLY.has(c));
    expect(
      unreviewed,
      'These channels are registered on the sender-trust-only router but are NOT in the reviewed ' +
        'ROUTER_SENDER_TRUST_ONLY allowlist. Sender-trust-only must be a deliberate, justified ' +
        'choice — add the channel to the allowlist WITH its category, or register it on the secure ' +
        'bridge with a permission.',
    ).toEqual([]);
  });

  it('the allowlist does not name channels that are not actually on the router', () => {
    const stale = [...ROUTER_SENDER_TRUST_ONLY].filter((c) => !INVOKABLE_CHANNELS.includes(c));
    expect(stale, 'stale allowlist entries — remove them').toEqual([]);
  });

  it('the router set and the gated secure-bridge set are DISJOINT', () => {
    const gated = new Set<IpcChannelName>(RUNTIME_INVOKABLE_CHANNELS);
    const both = INVOKABLE_CHANNELS.filter((c) => gated.has(c));
    expect(
      both,
      'A channel is EITHER sender-trust-only (router) OR gated (secure bridge), never both — a ' +
        'channel in both is registered twice with conflicting authority.',
    ).toEqual([]);
  });

  it('the reviewed set exactly equals the registered router set (no drift either way)', () => {
    expect(new Set(INVOKABLE_CHANNELS)).toEqual(ROUTER_SENDER_TRUST_ONLY);
  });
});
