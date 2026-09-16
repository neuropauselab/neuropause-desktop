/**
 * NeuroPause OS — Wave 1 / Increment 3. The operator model turns the EXISTING durable governance evidence
 * (HoldRecord + DecisionRecord) into honest operator states + a reconstructable evidence timeline, and HoldsView
 * renders them. Pins: OUTCOME_UNKNOWN is never success/failure; the external effect is never VERIFIED; missing
 * facts are said (NOT OBSERVED / NOT VERIFIED / NOT AVAILABLE), not fabricated; hold resolution executes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { DecisionRecord, HoldCenterView, HoldRecord } from '@neuropause/shared';
import {
  attentionHolds,
  buildEvidenceTimeline,
  classifyHold,
} from '@renderer/understanding/operatorConsole';
import { HoldsView } from '@renderer/understanding/HoldsView';

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

function hold(over: Partial<HoldRecord> = {}): HoldRecord {
  return {
    reason: 'verification_unavailable',
    why: 'A Microsoft 365 action was transmitted but its outcome could not be confirmed.',
    known: ['Action: mail.send'],
    unknown: ['Whether the action took effect.'],
    resolution: 'Check the external state; do not blindly retry.',
    ifProceeding: '',
    tenantId: 'org-A',
    id: 'hold-1',
    at: '2026-01-02T00:00:00.000Z',
    actor: 'ada@example.com',
    title: 'Send email (Microsoft 365)',
    subject: 'm365-send:abc',
    decisionId: 'dec-1',
    status: 'open',
    resolvedAt: null,
    resolvedOutcome: null,
    resolvedNote: null,
    ...over,
  };
}

function record(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    tenantId: 'org-A',
    id: 'dec-1',
    at: '2026-01-02T00:00:00.000Z',
    actor: 'ada@example.com',
    requestedAction: 'Send email (Microsoft 365)',
    subject: 'm365-send:abc',
    assessment: { risk: 'insufficient_evidence', recommendation: 'Hold until more is known', evidence: [], alternative: null },
    outcome: 'cancelled',
    executed: 'Nothing confirmed — the outcome is unknown.',
    holdId: 'hold-1',
    ...over,
  };
}

// ── Pure model ───────────────────────────────────────────────────────────────
describe('classifyHold — honest operator state', () => {
  it('verification_unavailable → OUTCOME_UNKNOWN, reconciliation required, attention', () => {
    const v = classifyHold(hold({ reason: 'verification_unavailable' }));
    expect(v.state).toBe('OUTCOME_UNKNOWN');
    expect(v.reconciliationRequired).toBe(true);
    expect(v.needsAttention).toBe(true);
    expect(v.state).not.toBe('RESOLVED');
  });
  it('external_unavailable → HELD; approval_required → APPROVAL_REQUIRED; unknown reason → HELD', () => {
    expect(classifyHold(hold({ reason: 'external_unavailable' })).state).toBe('HELD');
    expect(classifyHold(hold({ reason: 'approval_required' })).state).toBe('APPROVAL_REQUIRED');
    expect(classifyHold(hold({ reason: 'insufficient_permission' })).state).toBe('HELD');
  });
  it('resolved hold → RESOLVED, no attention (never invents an ESCALATED state)', () => {
    const v = classifyHold(hold({ status: 'resolved', resolvedOutcome: 'cancelled' }));
    expect(v.state).toBe('RESOLVED');
    expect(v.needsAttention).toBe(false);
  });
});

describe('buildEvidenceTimeline — honest, ordered, no fabrication', () => {
  it('external effect is ALWAYS NOT_VERIFIED (acknowledgement ≠ verified)', () => {
    const steps = buildEvidenceTimeline(record(), hold());
    const effect = steps.find((s) => s.key === 'effect');
    expect(effect?.fact).toBe('NOT_VERIFIED');
    expect(steps.some((s) => s.value.toLowerCase().includes('verified success'))).toBe(false);
  });
  it('an open hold → reconciliation + disposition are NOT_OBSERVED (not yet reconciled)', () => {
    const steps = buildEvidenceTimeline(record(), hold({ status: 'open' }));
    expect(steps.find((s) => s.key === 'reconciliation')?.fact).toBe('NOT_OBSERVED');
    expect(steps.find((s) => s.key === 'disposition')?.fact).toBe('NOT_OBSERVED');
  });
  it('a resolved hold → reconciliation + disposition are OBSERVED', () => {
    const steps = buildEvidenceTimeline(record(), hold({ status: 'resolved', resolvedOutcome: 'cancelled', resolvedNote: 'No effect found.' }));
    expect(steps.find((s) => s.key === 'reconciliation')?.fact).toBe('OBSERVED');
    expect(steps.find((s) => s.key === 'disposition')?.value).toContain('cancelled');
  });
  it('a missing actor is said (NOT_AVAILABLE), never invented', () => {
    const steps = buildEvidenceTimeline(record({ actor: null }), null);
    expect(steps.find((s) => s.key === 'actor')?.fact).toBe('NOT_AVAILABLE');
  });
  it('steps are in lifecycle order: request → identity → governance → executed → effect', () => {
    const keys = buildEvidenceTimeline(record(), null).map((s) => s.key);
    expect(keys.indexOf('request')).toBeLessThan(keys.indexOf('governance'));
    expect(keys.indexOf('governance')).toBeLessThan(keys.indexOf('effect'));
  });
});

describe('attentionHolds', () => {
  it('empty in → empty out (honest empty state)', () => {
    expect(attentionHolds([])).toEqual([]);
  });
  it('only open holds, newest first', () => {
    const a = hold({ id: 'a', at: '2026-01-01T00:00:00.000Z' });
    const b = hold({ id: 'b', at: '2026-01-03T00:00:00.000Z' });
    const resolved = hold({ id: 'c', status: 'resolved' });
    const out = attentionHolds([a, b, resolved]);
    expect(out.map((h) => h.id)).toEqual(['b', 'a']);
  });
});

// ── Mounted HoldsView ────────────────────────────────────────────────────────
describe('HoldsView — renders the operator state + evidence timeline', () => {
  function routeData(view: HoldCenterView, records: DecisionRecord[]): void {
    route(IpcChannel.HoldList, () => view);
    route(IpcChannel.DecisionRecordList, () => records);
  }
  const centerView = (open: HoldRecord[]): HoldCenterView => ({ open, resolved: [], assessmentLive: true, relationshipsDeclared: 1 });

  it('an OUTCOME_UNKNOWN hold shows the plain-words state + reconciliation guidance (not "success"/"failed")', async () => {
    routeData(centerView([hold()]), []);
    render(<HoldsView />);
    const badge = await screen.findByText(/Outcome uncertain/);
    expect(badge.textContent?.toLowerCase()).toContain('do not blindly retry');
    expect(document.body.textContent?.toLowerCase()).not.toContain('verified success');
  });

  it('expanding a decision record shows the evidence timeline with the effect NOT VERIFIED', async () => {
    routeData(centerView([hold()]), [record()]);
    render(<HoldsView />);
    const row = await screen.findByRole('button', { name: /Send email \(Microsoft 365\)/ });
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText('Evidence timeline')).toBeTruthy());
    expect(screen.getAllByText('NOT VERIFIED').length).toBeGreaterThan(0);
  });

  it('resolving a hold calls ipc.holds.resolve and executes nothing else (non-executing)', async () => {
    const resolveSpy = vi.fn(() => hold({ status: 'resolved', resolvedOutcome: 'cancelled' }));
    routeData(centerView([hold()]), []);
    route(IpcChannel.HoldResolve, resolveSpy);
    render(<HoldsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel the request' }));
    await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
    // The only consequential channel exercised is HoldResolve (records disposition) — no executor/effect channel.
    expect(resolveSpy).toHaveBeenCalled();
  });
});
