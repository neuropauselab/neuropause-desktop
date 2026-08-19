/**
 * NP-008 census F-N8-3 — Release Ops must not convert refusals into zeros.
 *
 * Observed live on the launch profile: `backup:list` is refused in local mode
 * (`cloud:operate`), the per-source fallback swallowed it, and the overview
 * rendered "Data backups available: 0" — a confident zero whose truth was
 * "could not read" (the F-5 class, already fixed once for M365 writes in S19).
 *
 * The pin: when sources fail, the view renders the Administration-pattern
 * honest banner NAMING them, so every fallback below reads as fallback.
 * Unrouted channels in this harness reject (`UNROUTED_CHANNEL:*`) — routing
 * nothing exercises exactly the refusal path for all fifteen sources.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProductOpsView } from '@renderer/productOps/ProductOpsView';
import { clearRoutes } from './setup';

beforeEach(() => clearRoutes());
afterEach(() => cleanup());

describe('ProductOpsView load-failure honesty (F-N8-3)', () => {
  it('names every source that could not load instead of rendering silent fallbacks', async () => {
    render(<ProductOpsView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('15 of the operations panels could not load');
    // The live-observed refusal is named — the zero below it is now labeled fallback.
    expect(alert.textContent).toContain('Backups');
    expect(alert.textContent).toContain('a fallback, not verified state');
  });

  it('offers a retry, not a dead end', async () => {
    render(<ProductOpsView />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
