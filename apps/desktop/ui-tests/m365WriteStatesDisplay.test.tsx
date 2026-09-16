/**
 * S19 (FG-7) — truthful-surface tests for the M365 write panel.
 * Every displayed number provably derives from `snap.writeStates` (the S34a
 * ActionRecord, via the snapshot join). The old disjoint "Writes/Last write"
 * counter is retired; absent writeStates shows honest absence, never a fake 0.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ConnectorSyncSnapshot } from '@neuropause/shared';

vi.mock('@renderer/lib/ipc', () => ({
  ipc: { connectors: { m365Draft: vi.fn(), m365Execute: vi.fn() } },
}));

import { M365WritePanel } from '@renderer/connectors/M365WritePanel';

const snap = (over: Partial<ConnectorSyncSnapshot>): ConnectorSyncSnapshot =>
  ({
    connectorId: 'microsoft-entra',
    accountId: 'acct-1',
    status: 'idle',
    lastSyncAt: null,
    lastDurationMs: null,
    nextSyncAt: null,
    entityCount: 0,
    lastError: null,
    consecutiveFailures: 0,
    rateLimitedUntil: null,
    queueSize: 0,
    ...over,
  }) as ConnectorSyncSnapshot;

afterEach(() => cleanup());

describe('S19 · M365 write panel — five truthful states', () => {
  it('displays each state EXACTLY as snap.writeStates (derived from the ActionRecord)', () => {
    const s = snap({ writeStates: { requested: 5, authorized: 4, executed: 3, providerAcknowledged: 2, externallyObserved: 1 } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={[s]} />);
    for (const [label, value] of [
      ['Requested', '5'], ['Authorized', '4'], ['Executed', '3'],
      ['Provider acknowledged', '2'], ['Externally observed', '1'],
    ] as const) {
      expect(screen.getByText(label).parentElement?.textContent).toContain(value);
    }
  });

  it('EXTERNALLY_OBSERVED shows its honest value (0 when unverified) — never padded', () => {
    const s = snap({ writeStates: { requested: 1, authorized: 1, executed: 1, providerAcknowledged: 1, externallyObserved: 0 } });
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={[s]} />);
    expect(screen.getByText('Externally observed').parentElement?.textContent).toContain('0');
    expect(screen.getByText('Provider acknowledged').parentElement?.textContent).toContain('1');
  });

  it('FALLBACK — absent writeStates shows honest absence, NOT the old counter, and never crashes', () => {
    const s = snap({}); // older snapshot: no writeStates
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={[s]} />);
    expect(screen.getByText(/no governed writes yet/i)).toBeTruthy();
    // The retired disjoint counter is GONE — not left beside the truth.
    expect(screen.queryByText('Writes')).toBeNull();
    expect(screen.queryByText('Last write')).toBeNull();
    expect(screen.queryByText('Requested')).toBeNull();
  });
});
