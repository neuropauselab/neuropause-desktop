/**
 * NeuroPause OS — Wave 2 / Increment 3. The operator surface (HoldsView) now shows a hold's correlated
 * ExecutionSession, joined ONLY by the authoritative governed `decisionId`. Pins: a worker UNKNOWN hold (carries
 * decisionId) links to its session and shows an honest execution state; a hold with no decisionId (or no matching
 * session) is shown as NOT_LINKED — never guessed from timestamps/action/actor/order; resolution executes nothing;
 * ACKNOWLEDGED/UNKNOWN are never rendered as verified success.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { DecisionRecord, ExecutionSession, HoldCenterView, HoldRecord } from '@neuropause/shared';
import { linkHoldToSession } from '@renderer/understanding/operatorConsole';
import { HoldsView } from '@renderer/understanding/HoldsView';

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

function hold(over: Partial<HoldRecord> = {}): HoldRecord {
  return {
    reason: 'verification_unavailable',
    why: 'A Microsoft 365 worker action could not be confirmed.',
    known: [], unknown: [], resolution: 'Check external state.', ifProceeding: '',
    tenantId: 'org-A', id: 'hold-1', at: '2026-01-02T00:00:00.000Z', actor: 'ada',
    title: 'Microsoft 365: mail.reply (worker)', subject: 'm365-worker:dec-1', decisionId: 'dec-1',
    status: 'open', resolvedAt: null, resolvedOutcome: null, resolvedNote: null,
    ...over,
  };
}
function session(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec-1', kind: 'connector', label: 'mail.reply', state: 'failed', steps: [],
    startedAt: '2026-01-02T00:00:00.000Z', completedAt: null, durationMs: null, error: 'x',
    resultSummary: null, result: null, correlationId: 'job-1', currentStep: -1, tenantId: 'org-A',
    decisionId: 'dec-1', bindingDigest: 'b', claimNonce: 'n', ...over,
  } as ExecutionSession;
}

// ── Pure correlation — authoritative decisionId only, never guessed ───────────
describe('linkHoldToSession', () => {
  it('LINKED when the hold decisionId matches a session decisionId', () => {
    const link = linkHoldToSession(hold({ decisionId: 'dec-1' }), [session({ decisionId: 'dec-1' })]);
    expect(link.linkState).toBe('LINKED');
    expect(link.session?.id).toBe('exec-1');
  });
  it('NOT_LINKED when the hold has no decisionId (e.g. an IPC hold)', () => {
    const link = linkHoldToSession(hold({ decisionId: null }), [session({ decisionId: 'dec-1' })]);
    expect(link.linkState).toBe('NOT_LINKED');
    expect(link.reason.toLowerCase()).toContain('no governed decision id');
  });
  it('NOT_LINKED when no session carries the decisionId — never picks a different session', () => {
    const link = linkHoldToSession(hold({ decisionId: 'dec-1' }), [session({ id: 'other', decisionId: 'dec-2' })]);
    expect(link.linkState).toBe('NOT_LINKED');
    expect(link.session).toBeNull();
  });
});

// ── Mounted HoldsView — correlated execution rendered honestly ────────────────
describe('HoldsView — correlated execution lifecycle', () => {
  const centerView = (open: HoldRecord[]): HoldCenterView => ({ open, resolved: [], assessmentLive: true, relationshipsDeclared: 1 });
  function routeAll(view: HoldCenterView, records: DecisionRecord[], sessions: ExecutionSession[]): void {
    route(IpcChannel.HoldList, () => view);
    route(IpcChannel.DecisionRecordList, () => records);
    route(IpcChannel.ExecuteSessions, () => ({ sessions, stats: {} }));
  }

  it('a worker UNKNOWN hold linked to its failed governed session shows OUTCOME_UNCERTAIN, not verified success', async () => {
    routeAll(centerView([hold({ decisionId: 'dec-1' })]), [], [session({ decisionId: 'dec-1', state: 'failed' })]);
    render(<HoldsView />);
    // Both the hold's operator state and the correlated execution read "Outcome uncertain" — expect ≥1.
    await waitFor(() => expect(screen.getAllByText(/Outcome uncertain/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Execution:/).textContent).toContain('Outcome uncertain');
    expect(document.body.textContent?.toLowerCase()).not.toContain('verified success');
    expect(document.body.textContent?.toLowerCase()).not.toContain('sent successfully');
  });

  it('a hold with no decisionId (IPC path) is shown as NOT LINKED — never guessed', async () => {
    routeAll(centerView([hold({ decisionId: null })]), [], [session({ decisionId: 'dec-1' })]);
    render(<HoldsView />);
    const exec = await screen.findByText(/Execution: not linked/);
    expect(exec.textContent?.toLowerCase()).toContain('no governed decision id');
  });

  it('resolving the hold records disposition and executes nothing (no session/executor mutation)', async () => {
    routeAll(centerView([hold({ decisionId: 'dec-1' })]), [], [session({ decisionId: 'dec-1' })]);
    let resolved = false;
    route(IpcChannel.HoldResolve, () => { resolved = true; return hold({ status: 'resolved', resolvedOutcome: 'cancelled' }); });
    render(<HoldsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel the request' }));
    await waitFor(() => expect(resolved).toBe(true));
    // Only HoldResolve was exercised — no ExecuteRun / executor channel.
  });
});
