/**
 * A7 — the one part of the IPC push contract the compiler cannot reach.
 *
 * `IpcBroadcastMap` now types both ends of a broadcast: the main process's `broadcast`
 * will not send a payload the map does not describe, and the renderer's `subscribe`
 * will not accept a listener that disagrees with it. Neither of those checks knows
 * anything about `ALL_SUBSCRIBABLE_CHANNELS`, which is the list the preload actually
 * consults at runtime — an ordinary array, with no type-level relation to the map.
 *
 * So the two can drift, silently, in either direction:
 *
 *   described but not allowlisted — `broadcast` compiles, `subscribe` compiles, lint
 *     passes, and the preload throws `Channel "…" is not subscribable` the first time
 *     the page mounts. This has already happened once: `connectorSyncSubscribe.test.ts`
 *     is the single-channel guard left behind by that incident, and its comment states
 *     the failure mode verbatim. This file generalises it to every channel.
 *
 *   allowlisted but not described — quieter, and therefore worse to find later: the
 *     channel is reachable through the preload but has no payload type, so no renderer
 *     can name it in a `subscribe` call and the main process cannot send on it. Dead
 *     surface that looks live from the allowlist.
 *
 * `BROADCAST_CHANNELS` exists so this comparison can be made at all — the map itself is
 * erased at build time. It is pinned to the map by a `Record<keyof IpcBroadcastMap, true>`
 * witness, so it cannot be the thing that is wrong here; a mismatch below is a real
 * mismatch between the contract and the allowlist.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SUBSCRIBABLE_CHANNELS, BROADCAST_CHANNELS } from '@neuropause/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(HERE, '..', '..', 'preload', 'index.ts');

describe('IPC broadcast contract matches the preload subscribe allowlist', () => {
  it('every channel the broadcast map describes is on the allowlist', () => {
    const missing = BROADCAST_CHANNELS.filter((c) => !ALL_SUBSCRIBABLE_CHANNELS.includes(c));
    // Named rather than counted: the failure output should be the channel to fix.
    expect(missing).toEqual([]);
  });

  it('every allowlisted channel has a payload type in the broadcast map', () => {
    const undescribed = ALL_SUBSCRIBABLE_CHANNELS.filter(
      (c) => !BROADCAST_CHANNELS.includes(c as (typeof BROADCAST_CHANNELS)[number]),
    );
    expect(undescribed).toEqual([]);
  });

  it('the allowlist lists each channel once', () => {
    // A duplicate would not break the preload's `includes` check, but it would make the
    // two set comparisons above disagree with a plain length comparison, and it usually
    // means a channel was added to both SUBSCRIBABLE_CHANNELS and RUNTIME_BROADCAST_CHANNELS.
    const seen = new Set(ALL_SUBSCRIBABLE_CHANNELS);
    expect(ALL_SUBSCRIBABLE_CHANNELS).toHaveLength(seen.size);
  });

  it('the broadcast map lists each channel once', () => {
    const seen = new Set(BROADCAST_CHANNELS);
    expect(BROADCAST_CHANNELS).toHaveLength(seen.size);
  });

  it('the preload still gates subscribe on ALL_SUBSCRIBABLE_CHANNELS', () => {
    // The assertions above are only meaningful while the allowlist is the list the
    // preload consults. If `subscribe` is ever rewritten to guard on something else,
    // this file is testing a constant nothing reads — so pin the assumption itself.
    const preload = readFileSync(PRELOAD, 'utf8');
    expect(preload).toMatch(/subscribe\s*\([\s\S]*?ALL_SUBSCRIBABLE_CHANNELS\.includes\(channel\)/);
  });
});
