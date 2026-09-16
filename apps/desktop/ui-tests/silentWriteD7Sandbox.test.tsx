/**
 * D-7 — REFUSED SANDBOX WRITES SPEAK, AND THE BANNER IS ANNOUNCED.
 *
 * Three of the six remaining paths were in `SandboxProvider`: `generateReport`
 * (:271), `cancelExecution` (:280) and `setSchedule` (:289). Each caught a refused
 * IPC write into `log.error` and returned.
 *
 * `setSchedule` was the worst of them. `Toggle` is fully controlled off `summary`,
 * and `refreshLive()` sits AFTER the throwing call inside the same `try`, so
 * `summary` never updates and the switch simply renders in its old position. The
 * user sees a switch that did not move and no message anywhere — indistinguishable
 * from an unresponsive control.
 *
 * TWO THINGS ARE PINNED HERE, because the fix had two halves:
 *  1. the catches now set the provider's existing `error` — driven through the
 *     REAL `SandboxProvider`, not a stand-in;
 *  2. the banner that renders it is now `role="alert"`. It had no role at all, so
 *     nothing announced it — a message present on screen but silent to assistive
 *     technology is only half a fix.
 *
 * `cancelExecution` is deliberately NOT claimed as a closed user-facing path: a
 * census over 3,707 files found it has no caller anywhere in the product, so no
 * click can reach it. It was given the same shape for consistency, and that is
 * recorded rather than counted.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';

import { SandboxProvider, useSandbox } from '@renderer/sandbox/SandboxProvider';
import { SandboxRoot } from '@renderer/sandbox/SandboxView';

/**
 * A consumer of the REAL context, so the write paths run as production runs them.
 * It renders the error verbatim so the assertion reads the provider's own state.
 */
function Probe(): JSX.Element {
  const { error, generateReport, setSchedule } = useSandbox();
  return (
    <div>
      <div data-testid="provider-error">{error ?? ''}</div>
      <button type="button" onClick={() => void generateReport('exec_1')}>
        probe-generate
      </button>
      <button type="button" onClick={() => void setSchedule('pipeline_1', true)}>
        probe-schedule
      </button>
    </div>
  );
}

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('SandboxProvider — a refused write speaks (D-7)', () => {
  it('a refused "Generate report" sets a message on the provider', async () => {
    let calls = 0;
    route(IpcChannel.SandboxReportGenerate, () => {
      calls += 1;
      throw new Error('report generator unavailable');
    });
    render(
      <SandboxProvider>
        <Probe />
      </SandboxProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-generate' }));

    await waitFor(() =>
      expect(screen.getByTestId('provider-error').textContent).toMatch(
        /report could not be generated/i,
      ),
    );
    expect(calls).toBe(1);
  });

  it('a refused schedule toggle says the switch is UNCHANGED — which is the truth', async () => {
    route(IpcChannel.SandboxValidationScheduleSet, () => {
      throw new Error('schedule store unavailable');
    });
    render(
      <SandboxProvider>
        <Probe />
      </SandboxProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-schedule' }));

    await waitFor(() => {
      const text = screen.getByTestId('provider-error').textContent ?? '';
      expect(text).toMatch(/schedule could not be changed/i);
      // The claim about state is load-bearing: `Toggle` is controlled off
      // `summary`, which never updated, so the switch really is unchanged.
      expect(text).toMatch(/unchanged/i);
    });
  });

  it('a write that SUCCEEDS leaves no message (the control)', async () => {
    // THIS CONTROL EARNED ITS PLACE: the first draft of this suite routed
    // `IpcChannel.SandboxSetSchedule`, which does not exist. The route bound to
    // `undefined`, the real call went UNROUTED and threw, and the refusal test
    // passed for the wrong reason. Only the success case exposed it.
    route(IpcChannel.SandboxValidationScheduleSet, () => undefined);
    render(
      <SandboxProvider>
        <Probe />
      </SandboxProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'probe-schedule' }));

    // `refreshLive` runs after the write; give it the same window a failure gets.
    await waitFor(() => expect(screen.getByRole('button', { name: 'probe-schedule' })).toBeTruthy());
    expect(screen.getByTestId('provider-error').textContent).not.toMatch(
      /schedule could not be changed/i,
    );
  });
});

describe('SandboxView — the banner is announced, not merely present (D-7)', () => {
  it('renders the provider error as role="alert" through the real view', async () => {
    // `refreshAll` fails on mount (its channels are unrouted), and its catch sets
    // the SAME `error` field the write paths now set — so this drives the real
    // provider and the real view together to prove the surface is announced.
    render(<SandboxRoot />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not load the sandbox/i);
  });
});
