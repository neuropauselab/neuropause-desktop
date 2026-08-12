/**
 * Settings → AI — a refused write is VISIBLE. P13C ROUND 17h.
 *
 * `ai:config.setMode` is `cloud:operate`: platform-only, and refused on every
 * install with no platform operator. The panel caught that refusal into
 * `log.warn` and rendered nothing, and because the radios are controlled by
 * `routing.mode` — which `refresh()` never updates after a failure — React put
 * the selection straight back. The control un-clicked itself in silence.
 *
 * That is the same defect as the D-5 first-run HIGH, on a different screen, and
 * it is why one first-run session logged twenty-two refusals: nothing was
 * retrying, a person was clicking a control that appeared to ignore them.
 *
 * These tests mount the real panel and drive it with a real refusal, because
 * that is the only place the silence was observable. Every unit test in the
 * repo passed while it was there.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import type { AiRoutingStatusView, AiRoutingUsage } from '@neuropause/shared';
import { IpcChannel, emptyRoutingUsage } from '@neuropause/shared';
import { AiRoutingPanel } from '@renderer/settings/AiRoutingPanel';

/** The exact sentence `AuthorizationError` produces for a platform-only permission. */
const REFUSAL = 'Not authorized: missing permission "cloud:operate".';

/** A default install: Private First, consent off, one reachable local route. */
const status = (mode: AiRoutingStatusView['mode'] = 'private_first'): AiRoutingStatusView => ({
  mode,
  externalConsent: false,
  routes: [],
  plan: { ok: true, attempts: [], skipped: [], refusal: null, mode },
});

let setModeCalls: number;

beforeEach(() => {
  cleanup();
  clearRoutes();
  setModeCalls = 0;
  route(IpcChannel.AiRoutingStatus, () => status());
  route(IpcChannel.AiRoutingUsage, (): AiRoutingUsage => emptyRoutingUsage());
  route(IpcChannel.AiConfigSetMode, () => {
    setModeCalls += 1;
    // The real refusal, produced where production produces it: main throws, the
    // secure bridge replaces it with a clean message, the renderer gets a
    // rejection carrying only that string.
    throw new Error(REFUSAL);
  });
});

afterEach(cleanup);

describe('Settings → AI, when the platform refuses the write', () => {
  it('says so on screen instead of logging to a console nobody is attached to', async () => {
    const user = userEvent.setup();
    render(<AiRoutingPanel />);
    // The panel has loaded its real status before anything is clicked.
    const localOnly = await screen.findByRole('radio', { name: /Local Only/i });

    await user.click(localOnly);

    await waitFor(() => expect(setModeCalls).toBe(1));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('cloud:operate');
    expect(unroutedChannels()).toEqual([]);
  });

  it('does not pretend the mode changed — the control returns to the truth', async () => {
    const user = userEvent.setup();
    render(<AiRoutingPanel />);
    const localOnly = await screen.findByRole('radio', { name: /Local Only/i });
    const privateFirst = await screen.findByRole('radio', { name: /Private First/i });

    await user.click(localOnly);
    await screen.findByRole('alert');

    // The refused mode is NOT selected, and the real one still is. Snapping the
    // radio back is correct; doing it in silence was the defect.
    await waitFor(() => expect((localOnly as HTMLInputElement).checked).toBe(false));
    expect((privateFirst as HTMLInputElement).checked).toBe(true);
  });

  it('clears the refusal when the user tries again, rather than leaving it stale', async () => {
    const user = userEvent.setup();
    render(<AiRoutingPanel />);
    const localOnly = await screen.findByRole('radio', { name: /Local Only/i });
    await user.click(localOnly);
    await screen.findByRole('alert');

    // Second attempt succeeds — a platform operator was configured in between.
    route(IpcChannel.AiConfigSetMode, () => {
      setModeCalls += 1;
      return {};
    });
    route(IpcChannel.AiRoutingStatus, () => status('local_only'));

    await user.click(localOnly);
    await waitFor(() => expect(setModeCalls).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect((localOnly as HTMLInputElement).checked).toBe(true);
  });
});
