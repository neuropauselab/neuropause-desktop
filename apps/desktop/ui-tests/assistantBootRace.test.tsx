/**
 * P13C ROUND 39 — GATE 26. THE ASSISTANT'S BOOT-WINDOW RACE, UN-STUCK.
 *
 * Live evidence: with Assistant as the restored section, a real relaunch
 * mounted this host before the secure runtime channels registered, so
 * `assistant:conversations` failed with "No handler registered" — honestly
 * surfaced (Gate 15), but permanently: nothing ever retried, and the user's
 * history stayed "gone" for the session. Pinned here: the failure is recorded
 * as boot-raced, and the runtime-ready broadcast (Gate 1's seam, served by
 * the base router that cannot race) re-runs the exact load — history back,
 * note cleared. A ready broadcast after a SUCCESSFUL load does not refetch.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes, emitBroadcast } from './setup';
import { IpcChannel } from '@neuropause/shared';

import { AssistantHost } from '@renderer/assistant/AssistantHost';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const summary = (id: string, title: string): Record<string, unknown> => ({
  id,
  title,
  mode: 'ask',
  updatedAt: '2026-08-15T09:00:00.000Z',
  messageCount: 2,
  archived: false,
  pinned: false,
});

describe('AssistantHost boot race (round 39 — Gate 26)', () => {
  it('a boot-window list failure retries on the runtime-ready broadcast', async () => {
    let registered = false;
    route(IpcChannel.AssistantConversations, () => {
      if (!registered) {
        throw new Error("No handler registered for 'assistant:conversations'");
      }
      return { conversations: [summary('c1', 'Quarterly imports')] };
    });

    render(<AssistantHost />);
    await waitFor(() => {
      expect(
        screen.getByText(/Your conversations could not be loaded — .*No handler registered/),
      ).toBeTruthy();
    });

    // Composition finishes; the ready broadcast fires (base router, no race).
    registered = true;
    emitBroadcast(IpcChannel.RuntimeStateChanged, { state: 'ready' });

    await waitFor(() => {
      expect(screen.getByText('Quarterly imports')).toBeTruthy();
    });
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('a ready broadcast after a successful load does not refetch', async () => {
    let calls = 0;
    route(IpcChannel.AssistantConversations, () => {
      calls += 1;
      return { conversations: [summary('c1', 'Quarterly imports')] };
    });

    render(<AssistantHost />);
    await waitFor(() => expect(screen.getByText('Quarterly imports')).toBeTruthy());
    const before = calls;

    emitBroadcast(IpcChannel.RuntimeStateChanged, { state: 'ready' });
    // Nothing raced — the broadcast must not trigger a redundant reload.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(before);
  });
});
