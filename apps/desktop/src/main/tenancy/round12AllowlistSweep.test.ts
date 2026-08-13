/**
 * P13C ROUND 12 — PHASE 5. THE FINAL PUBLIC-ALLOWLIST SWEEP.
 *
 * Round 11 closed four MEDIUM findings that all lived in `PUBLIC_CHANNELS` and
 * ended with the observation that the bucket was "smaller but not empty. The
 * next finding is likely still in it." It was, fourteen times.
 *
 * NINE OF THE FOURTEEN ARE ONE DEFECT: a generator or projection over the
 * tenant corpus admitted as "read-only", while the STORED form of the identical
 * data is gated `intelligence:read`. "Read-only" answers MUTABILITY; the
 * allowlist rule is about the PAYLOAD, and the two were being conflated.
 *
 * WHY A STRUCTURAL TEST CANNOT YET CATCH THIS CLASS, stated rather than
 * claimed away. `assertAllChannelsClassified` checks that every channel IS
 * classified; nothing checks that a classification MATCHES ITS PAYLOAD. The
 * invariant that would catch the whole class — "no channel reaching a
 * CUSTOMER_DERIVED store may appear in PUBLIC_CHANNELS" — needs a channel→store
 * map that does not exist in this codebase, because handlers reach stores
 * through closures the source cannot follow. That map is the honest next piece
 * of work, and until it exists this suite is a NAMED LIST, which is weaker: it
 * pins the fourteen that were found and cannot see a fifteenth.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel } from '@neuropause/shared';
import type { IpcChannelName } from '@neuropause/shared';
import {
  PUBLIC_CHANNELS,
  RUNTIME_CHANNEL_PERMISSIONS,
  channelsBothPublicAndGated,
  withRuntimeAuthz,
} from '../ipc/runtimeAuthz';

/** The sweep, as a table: channel → the authority its payload requires. */
const SWEPT = [
  // ── The corpus-projection class ──────────────────────────────────────────
  // Each reads TENANT + CUSTOMER_DERIVED rows and returns titles, body
  // excerpts, actor labels or synthesised summaries of them.
  [IpcChannel.EnterpriseTimelineExport, 'intelligence:read'],
  [IpcChannel.EnterpriseTimelineReplay, 'intelligence:read'],
  [IpcChannel.EnterpriseTimelineStats, 'intelligence:read'],
  [IpcChannel.BriefingGenerate, 'intelligence:read'],
  [IpcChannel.KnowledgeRelated, 'intelligence:read'],
  [IpcChannel.KnowledgeTopics, 'intelligence:read'],
  [IpcChannel.KnowledgeHealth, 'intelligence:read'],
  [IpcChannel.RecommendationsGenerate, 'intelligence:read'],
  [IpcChannel.VoiceTurn, 'intelligence:read'],
  // ── Per-user surfaces whose OWNER is resolved server-side ────────────────
  [IpcChannel.NotificationsList, 'dashboard:read'],
  [IpcChannel.NotificationsMarkRead, 'dashboard:read'],
  [IpcChannel.PlatformEmit, 'dashboard:read'],
  // ── Install-wide fault archive / install-global mutation ─────────────────
  [IpcChannel.CrashRecommendations, 'operations:read'],
  [IpcChannel.PilotSetEnabled, 'org:manage'],
] as const satisfies ReadonlyArray<readonly [IpcChannelName, string]>;

describe('every swept channel is gated, and off the allowlist', () => {
  it.each(SWEPT)('%s carries %s', (channel, permission) => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[channel]).toBe(permission);
  });

  it.each(SWEPT)('%s is NOT public', (channel) => {
    expect(PUBLIC_CHANNELS.has(channel)).toBe(false);
  });

  it('none is both public and gated', () => {
    const gated = Object.keys(RUNTIME_CHANNEL_PERMISSIONS).map((c) => ({ channel: c }));
    expect(channelsBothPublicAndGated(gated as never, PUBLIC_CHANNELS)).toEqual([]);
  });

  it('the annotator actually stamps them — a table row is a claim, not a gate', () => {
    const defs = SWEPT.map(([channel]) => ({ channel, schema: {}, handler: () => null }));
    const gated = withRuntimeAuthz(defs);
    for (const [i, [channel, permission]] of SWEPT.entries()) {
      expect(gated[i]).toMatchObject({ channel, requireAuth: true, permission });
    }
  });
});

describe('the timeline family agrees with itself', () => {
  /**
   * The finding in one assertion: `query` was gated and `export` — the strictly
   * WIDER door onto the same private `collect()` — was public. Three doors, one
   * payload, and only one of them locked.
   */
  it('export, replay and stats carry the same lock as query', () => {
    const query = RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseTimelineQuery];
    expect(query).toBe('intelligence:read');
    for (const c of [
      IpcChannel.EnterpriseTimelineExport,
      IpcChannel.EnterpriseTimelineReplay,
      IpcChannel.EnterpriseTimelineStats,
    ]) {
      expect(RUNTIME_CHANNEL_PERMISSIONS[c]).toBe(query);
    }
  });

  /**
   * `memory:recall` and `memory:semanticRecall` are two retrieval strategies
   * over `ai-memory-store`; `knowledge:*` is a third. The rule this file already
   * states — "the gate belongs to the data, not to the retrieval strategy" —
   * asserted rather than left as a comment.
   */
  it('knowledge carries the same lock as the other memory retrieval strategies', () => {
    const recall = RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.MemoryRecall];
    expect(recall).toBe('intelligence:read');
    for (const c of [IpcChannel.KnowledgeRelated, IpcChannel.KnowledgeTopics, IpcChannel.KnowledgeHealth]) {
      expect(RUNTIME_CHANNEL_PERMISSIONS[c]).toBe(recall);
    }
  });

  it('all three crash-archive doors now agree', () => {
    for (const c of [IpcChannel.CrashExport, IpcChannel.CrashGetStatus, IpcChannel.CrashRecommendations]) {
      expect(RUNTIME_CHANNEL_PERMISSIONS[c]).toBe('operations:read');
    }
  });
});

describe('what deliberately stays public', () => {
  /**
   * The sweep is not "gate everything". Each of these was checked against the
   * same test and passes it: the payload is install metadata or the caller's
   * own machine preference, and several must work before an organization
   * resolves.
   */
  it('notification PREFERENCES stay public — the rows did not', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.NotificationsPrefsGet)).toBe(true);
    expect(PUBLIC_CHANNELS.has(IpcChannel.NotificationsPrefsSet)).toBe(true);
  });

  it('self-reporting and opt-in stay public', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.CrashReport)).toBe(true);
    expect(PUBLIC_CHANNELS.has(IpcChannel.CrashSetOptIn)).toBe(true);
  });

  it('install metadata reads stay public', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.RegistryList)).toBe(true);
    expect(PUBLIC_CHANNELS.has(IpcChannel.PermsList)).toBe(true);
  });

  it('the pilot STATUS read stays public — only the mutation moved', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.PilotStatus)).toBe(true);
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.PilotSetEnabled]).toBe('org:manage');
  });
});
