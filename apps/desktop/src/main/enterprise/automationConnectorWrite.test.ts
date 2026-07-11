/**
 * P2.5 — connector-write classification tests.
 *
 * The one invariant: an autonomously-firing automation must NEVER auto-execute a
 * connector write. These tests verify a write is always held for confirmation, that
 * a known Microsoft 365 action is described from the real registry (label + mutates),
 * and that an unknown/unspecified target still fails safe (held, treated as mutating).
 */
import { describe, expect, it } from 'vitest';
import type { AutomationAction } from '@neuropause/shared';
import { classifyConnectorWrite, type ConnectorWriteActionMeta } from './automationConnectorWrite';

const REGISTRY: ConnectorWriteActionMeta[] = [
  { id: 'mail.send', label: 'Send email', mutates: true },
  { id: 'contacts.search', label: 'Search contacts', mutates: false },
];

function action(over: Partial<AutomationAction> = {}): AutomationAction {
  return { id: 'a1', type: 'connector-write', label: 'Write', ...over };
}

describe('classifyConnectorWrite', () => {
  it('holds a known mutating Microsoft 365 write for confirmation (never auto-sends)', () => {
    const out = classifyConnectorWrite(
      action({ connectorId: 'microsoft-entra', config: { actionId: 'mail.send' } }),
      REGISTRY,
    );
    expect(out.ok).toBe(true); // the step is handled — queued, not a failure
    expect(out.resolved).toBe(true);
    expect(out.mutates).toBe(true);
    expect(out.message).toContain('Send email');
    expect(out.message).toContain('held for explicit confirmation');
    expect(out.message).toContain('never sends or modifies');
  });

  it('describes a known read helper accurately but still does not auto-execute it', () => {
    const out = classifyConnectorWrite(
      action({ connectorId: 'microsoft-entra', config: { actionId: 'contacts.search' } }),
      REGISTRY,
    );
    expect(out.resolved).toBe(true);
    expect(out.mutates).toBe(false);
    expect(out.message).toContain('read');
    expect(out.message).toContain('Search contacts');
  });

  it('fails safe for an unresolved target — held and treated as a mutating write', () => {
    const out = classifyConnectorWrite(action({ connectorId: 'notion' }), REGISTRY);
    expect(out.ok).toBe(true);
    expect(out.resolved).toBe(false);
    expect(out.mutates).toBe(true);
    expect(out.message).toContain('notion');
    expect(out.message).toContain('held for explicit confirmation');
  });
});
