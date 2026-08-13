/**
 * P13C F-7 — what the founder actually sees, tested at the surface he saw.
 *
 * The mounted-component trap is recorded in the certification (§2): a test that
 * renders `FirstRunExperience` directly proved onboarding "worked" while the
 * application could not reach it. So this file does NOT assert that a notice
 * component renders in isolation — it renders it in the state the founder's
 * machine was in and asserts the words on screen, including the words that must
 * NOT be there.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockState = vi.hoisted(() => ({
  calls: [] as boolean[],
  reject: false,
  next: { reachable: false, checkedAt: '2026-08-13T06:00:00.000Z', lastError: 'timeout' } as {
    reachable: boolean;
    checkedAt: string | null;
    lastError: 'timeout' | 'dns' | 'refused' | 'http_error' | null;
  },
}));

vi.mock('@renderer/lib/ipc', () => ({
  ipc: {
    system: {
      backendReachability: (refresh = false) => {
        mockState.calls.push(refresh);
        if (mockState.reject) return Promise.reject(new Error('channel unavailable'));
        return Promise.resolve(mockState.next);
      },
    },
  },
}));

import { BackendReachabilityNotice } from '@renderer/screens/BackendReachabilityNotice';

beforeEach(() => {
  mockState.calls = [];
  mockState.next = {
    reachable: false,
    checkedAt: '2026-08-13T06:00:00.000Z',
    lastError: 'timeout',
  };
});

afterEach(() => cleanup());

describe('F-7 · the unreachable notice', () => {
  it('names the situation in the product’s own terms', async () => {
    render(<BackendReachabilityNotice />);
    await screen.findByText('NeuroPause cannot reach its AI service right now.');
  });

  it('explains the failure class without exposing where the service is', async () => {
    render(<BackendReachabilityNotice />);
    await screen.findByText('The service did not respond in time.');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('neuropause033');
    expect(body).not.toContain('127.0.0.1');
    expect(body).not.toContain('4000');
    expect(body).not.toContain('http');
  });

  /**
   * The brief's explicit prohibition, kept as an assertion rather than a review
   * note. A founder who installed an installer cannot start a backend, and copy
   * that tells him to makes an outage read like his own mistake.
   */
  it('never tells the reader to run a backend, a terminal, or a command', async () => {
    render(<BackendReachabilityNotice />);
    await screen.findByText('NeuroPause cannot reach its AI service right now.');
    const body = (document.body.textContent ?? '').toLowerCase();
    for (const forbidden of ['is it running', 'npm', 'node', 'vite', 'terminal', 'localhost', 'server']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('says the machine is not at fault', async () => {
    render(<BackendReachabilityNotice />);
    await screen.findByText(/Nothing is wrong with this computer/);
  });

  it('Retry re-probes rather than reading the cache', async () => {
    render(<BackendReachabilityNotice />);
    await screen.findByText('NeuroPause cannot reach its AI service right now.');
    expect(mockState.calls).toEqual([false]);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockState.calls).toContain(true));
  });

  it('clears itself when the service comes back', async () => {
    render(<BackendReachabilityNotice />);
    await screen.findByText('NeuroPause cannot reach its AI service right now.');

    mockState.next = { reachable: true, checkedAt: '2026-08-13T06:00:15.000Z', lastError: null };
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByText('NeuroPause cannot reach its AI service right now.')).toBeNull(),
    );
  });

  it('stays silent on a healthy launch — a banner every time trains people to ignore it', async () => {
    mockState.next = { reachable: true, checkedAt: '2026-08-13T06:00:00.000Z', lastError: null };
    const { container } = render(<BackendReachabilityNotice />);
    await waitFor(() => expect(mockState.calls.length).toBeGreaterThan(0));
    expect(container.textContent).toBe('');
  });

  /**
   * The channel itself failing is NOT evidence the service is down — main could
   * be mid-boot, or the handler could have thrown. Claiming an outage from it
   * would be a status assigned from a proxy, which is the §2 failure pattern.
   * The component stays silent instead.
   */
  it('says nothing when the channel itself fails, rather than inventing a cause', async () => {
    mockState.reject = true;
    const { container } = render(<BackendReachabilityNotice />);
    await waitFor(() => expect(mockState.calls.length).toBeGreaterThan(0));
    expect(container.textContent).toBe('');
    mockState.reject = false;
  });
});

/**
 * Regression: the pre-probe state is NOT an outage.
 *
 * Found by running the real Electron app with the backend down and reading the
 * screenshot: the notice printed the unclassified fallback because the renderer
 * received `{reachable:false, checkedAt:null, lastError:null}` — the untouched
 * initial state — before any probe had completed. On a HEALTHY machine that is a
 * false outage banner at every launch.
 *
 * The tests above all passed while this was broken, because every one of them
 * supplied a `checkedAt`. They asserted the field and not the meaning.
 */
describe('F-7 · "not asked yet" is not "unreachable"', () => {
  it('stays silent when no probe has completed (checkedAt null)', async () => {
    mockState.next = { reachable: false, checkedAt: null, lastError: null };
    const { container } = render(<BackendReachabilityNotice />);
    await waitFor(() => expect(mockState.calls.length).toBeGreaterThan(0));
    expect(container.textContent).toBe('');
  });

  it('speaks only once a probe has actually answered', async () => {
    mockState.next = { reachable: false, checkedAt: '2026-08-13T07:51:00.000Z', lastError: 'refused' };
    render(<BackendReachabilityNotice />);
    await screen.findByText('The service refused the connection.');
  });
});
