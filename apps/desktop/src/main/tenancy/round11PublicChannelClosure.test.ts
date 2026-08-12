/**
 * P13C ROUND 11 — M-4 / M-5 / M-7 / M-10. FOUR FAMILIES OFF THE PUBLIC ALLOWLIST.
 *
 * Each of these was reachable from a renderer with NO PERMISSION AND NO
 * `requireAuth` — sender-frame trust only, which a signed-out session satisfies.
 * They are grouped in one suite because they are one finding class wearing four
 * subsystem names: a channel admitted long ago into the "local, per-user desktop
 * operation" bucket, whose own caveat reads *"revisit if any becomes
 * multi-tenant"*, and which then became multi-tenant without anyone revisiting.
 *
 *   M-5  `update:*`  — THE WORST. Four mutations of the APPLICATION BINARY.
 *        `update:installOnQuit` calls `autoUpdater.quitAndInstall()`: it
 *        terminates the process for every tenant and swaps the executable.
 *        `update:setChannel` repoints the install-wide feed, choosing which code
 *        runs next. Chained from an unauthenticated context, the machine reboots
 *        onto the internal pre-release feed. Round 8 moved PLUGIN install to
 *        `cloud:operate` because a plugin is "executable code that runs
 *        in-process for every tenant" — the application is strictly wider, and
 *        it was gated less.
 *
 *   M-4  `nps:pause|resume|cancel` — sat under a header reading "read-only
 *        operations". `cancel` aborts an install a PLATFORM OPERATOR authorized,
 *        deletes the partial file, and drops the `busy` lock. Public
 *        `nps:operations` enumerated the ids to aim it with.
 *
 *   M-7  `crash:export` / `crash:getStatus` — one install-wide `crashes.log`
 *        with no owner field on any row, returned whole: 200 records and 10
 *        records respectively, to anyone, signed in or not.
 *
 *   M-10 `registry:export` — serialises RAW entry rows, bypassing `toDto`, so it
 *        carries the per-app `launchCount` / `usage` counters that Round 9 (F20)
 *        removed from `registry:list`.
 *
 * WHAT THIS SUITE ASSERTS, AND WHY IT IS NOT JUST A TABLE READ. A permission in
 * `RUNTIME_CHANNEL_PERMISSIONS` gates nothing on its own — the composition root
 * only stamps defs it passes through `withRuntimeAuthz`. This program has
 * already shipped one authority model that was declared, documented and never
 * executed (`isPlatformOperator`, Round 10). So the third case below runs the
 * real annotator over real handler defs and asserts the stamp lands.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcChannel } from '@neuropause/shared';
import type { IpcChannelName } from '@neuropause/shared';
import {
  PUBLIC_CHANNELS,
  RUNTIME_CHANNEL_PERMISSIONS,
  channelsBothPublicAndGated,
  withRuntimeAuthz,
} from '../ipc/runtimeAuthz';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The reclassification, as a table: channel → the authority it must now carry. */
const CLOSED = [
  // M-5 — install-wide mutation of the application itself.
  [IpcChannel.UpdateCheckNow, 'cloud:operate'],
  [IpcChannel.UpdateDownload, 'cloud:operate'],
  [IpcChannel.UpdateInstallOnQuit, 'cloud:operate'],
  [IpcChannel.UpdateSetChannel, 'cloud:operate'],
  // M-5 — the read half stays available to an ordinary member.
  [IpcChannel.UpdateGetStatus, 'operations:read'],
  // M-4 — terminate an operation a platform operator authorized.
  [IpcChannel.NpsPause, 'cloud:operate'],
  [IpcChannel.NpsResume, 'cloud:operate'],
  [IpcChannel.NpsCancel, 'cloud:operate'],
  // M-7 — install-wide crash archive reads.
  [IpcChannel.CrashExport, 'operations:read'],
  [IpcChannel.CrashGetStatus, 'operations:read'],
  // M-10 — raw registry rows, counters included.
  [IpcChannel.RegistryExport, 'cloud:operate'],
] as const satisfies ReadonlyArray<readonly [IpcChannelName, string]>;

describe('the four families are gated, and no longer public', () => {
  it.each(CLOSED)('%s carries %s', (channel, permission) => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[channel]).toBe(permission);
  });

  it.each(CLOSED)('%s is NOT on the public allowlist', (channel) => {
    expect(PUBLIC_CHANNELS.has(channel)).toBe(false);
  });

  /**
   * NEW-M8's blindness: a channel that is BOTH satisfies
   * `assertAllChannelsClassified` through the allowlist regardless of whether
   * the gate applied, so a regression on it is undetectable.
   */
  it('none of them is both public and gated', () => {
    const gated = Object.keys(RUNTIME_CHANNEL_PERMISSIONS).map((c) => ({ channel: c }));
    expect(channelsBothPublicAndGated(gated as never, PUBLIC_CHANNELS)).toEqual([]);
  });
});

describe('the gate is applied, not merely declared', () => {
  /**
   * THE ROUND 10 LESSON, AS A TEST. `isPlatformOperator` was accepted as a dep,
   * documented, and never passed — so every `cloud:operate` channel refused
   * everyone for four rounds and nothing noticed, because it failed closed. A
   * table entry is a claim; this runs the annotator.
   */
  it('withRuntimeAuthz stamps requireAuth + the permission onto each def', () => {
    const defs = CLOSED.map(([channel]) => ({ channel, schema: {}, handler: () => null }));
    const gated = withRuntimeAuthz(defs);
    for (const [i, [channel, permission]] of CLOSED.entries()) {
      expect(gated[i], `${channel} must be gated`).toMatchObject({
        channel,
        requireAuth: true,
        permission,
      });
    }
  });

  /**
   * The composition root stamps by TABLE MEMBERSHIP over the whole `defs` array
   * — `defs.filter((d) => RUNTIME_CHANNEL_PERMISSIONS[d.channel] && !d.permission)`
   * — rather than by wrapping each subsystem's array. That is what makes a new
   * table row take effect for handlers defined in `updater/index.ts` and
   * `releaseOps/index.ts`, which are pushed into `defs` and never wrapped
   * individually. Pin the mechanism: if it is ever replaced by per-array
   * wrapping, these four families silently stop being gated.
   */
  it('runtimeCore stamps every table-classified def, and pushes these families in', () => {
    const src = readFileSync(join(MAIN, 'runtimeCore.ts'), 'utf8');
    expect(src).toContain('defs.push(...updater.handlers)');
    expect(src).toContain('defs.push(...releaseOps.handlers)');
    expect(src).toMatch(
      /withRuntimeAuthz\(\s*defs\.filter\(\(d\) => RUNTIME_CHANNEL_PERMISSIONS\[d\.channel\] && !d\.permission\)/,
    );
    // …and the stamp is written back over the original def.
    expect(src).toContain('if (gated) defs[i] = gated;');
  });
});

describe('what deliberately stays public — the fix is not "gate everything"', () => {
  /**
   * A rule that gated the whole bucket would be easier to write and wrong. Each
   * of these discloses nothing about another tenant, and two of them must work
   * before an organization resolves.
   */
  it('crash opt-in and self-reporting remain public', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.CrashSetOptIn)).toBe(true);
    expect(PUBLIC_CHANNELS.has(IpcChannel.CrashReport)).toBe(true);
  });

  it('the package-service reads remain public', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.NpsVerify)).toBe(true);
  });

  it('the registry inventory reads remain public', () => {
    // Knowing what this machine has installed is inventory a member needs, and
    // `toDto` withholds the cross-tenant counters. Only `export` bypassed it.
    expect(PUBLIC_CHANNELS.has(IpcChannel.RegistryList)).toBe(true);
    expect(PUBLIC_CHANNELS.has(IpcChannel.RegistryGet)).toBe(true);
  });
});
