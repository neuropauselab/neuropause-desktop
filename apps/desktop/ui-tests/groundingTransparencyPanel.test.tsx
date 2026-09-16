/**
 * S134 — the Grounding Transparency panel drives the EXISTING governed AI-grounding read
 * (`ipc.platform.evidenceContext` → `platform:command.dispatch`, `QueryEvidenceContext`) with
 * `includePosture:true`. Proves the real UI→bridge path, the transparency badges (posture included /
 * relevance-ranked / item count), posture + evidence rendering with provenance, honest empty state, that
 * the operator lens reaches the payload as `relevanceQuery`, that it makes NO correctness/health claim,
 * and that no secret/token/payload is rendered.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { GroundingTransparencyPanel } from '@renderer/operationsPlatform/GroundingTransparencyPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: { tenantId: 'tenant-A', query: '', relevanceRanked: false, postureIncluded: false, itemCount: 0, groundingOnly: true, context: [], ...over },
  requestId: 'r', correlationId: 'c', operation: 'QueryEvidenceContext',
});

describe('GroundingTransparencyPanel', () => {
  it('requests the grounding read with includePosture and shows the transparency badges', async () => {
    let sawOp = '';
    let sawIncludePosture: unknown;
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      const p = payload as { operation: string; payload?: { includePosture?: boolean } };
      sawOp = p.operation;
      sawIncludePosture = p.payload?.includePosture;
      return resp({
        postureIncluded: true,
        relevanceRanked: false,
        itemCount: 2,
        context: [
          { source: 'timeline', text: 'Operational posture — 10 governed command(s): 8 delivered (80%), 2 retrying (20% delivery-failure), 0 pending, 0 in-flight; 3 took more than one attempt.', evidence: [{ kind: 'operational-posture', id: 'reliability' }] },
          { source: 'timeline', text: 'Operational evidence — CreateSalesOrder · status DELIVERED · at 2026-09-06T00:00:00.000Z.', evidence: [{ kind: 'command-journal', id: 'tx_1' }] },
        ],
      });
    });
    render(<GroundingTransparencyPanel />);
    await waitFor(() => expect(screen.getByText('Operational posture: included')).toBeTruthy());
    expect(sawOp).toBe('QueryEvidenceContext');
    expect(sawIncludePosture).toBe(true);
    expect(screen.getByText('Grounding items: 2')).toBeTruthy();
    expect(screen.getByText('Relevance-ranked: no')).toBeTruthy();
    expect(screen.getByText(/8 delivered \(80%\)/)).toBeTruthy();
    expect(screen.getByText(/provenance: operational-posture:reliability/)).toBeTruthy();
    expect(screen.getByText(/provenance: command-journal:tx_1/)).toBeTruthy();
  });

  it('honest empty state when no grounding is available', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({ itemCount: 0, context: [], postureIncluded: false }));
    render(<GroundingTransparencyPanel />);
    await waitFor(() => expect(screen.getByText('No grounding available')).toBeTruthy());
    expect(screen.getByText('Operational posture: not included')).toBeTruthy();
  });

  it('the operator lens reaches the payload as relevanceQuery', async () => {
    let sawRelevance: unknown;
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawRelevance = (payload as { payload?: { relevanceQuery?: string } }).payload?.relevanceQuery;
      return resp({});
    });
    render(<GroundingTransparencyPanel />);
    await waitFor(() => expect(screen.getByText('No grounding available')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Preview grounding for a question'), { target: { value: 'sales order health' } });
    await waitFor(() => expect(sawRelevance).toBe('sales order health'));
  });

  it('makes NO correctness/health/SLO claim and renders no secret material', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({
      postureIncluded: true, itemCount: 1,
      context: [{ source: 'timeline', text: 'Operational posture — 3 governed command(s): 3 delivered (100%), 0 retrying (0% delivery-failure), 0 pending, 0 in-flight; 0 took more than one attempt.', evidence: [{ kind: 'operational-posture', id: 'reliability' }] }],
    }));
    const { container } = render(<GroundingTransparencyPanel />);
    await waitFor(() => expect(screen.getByText('Operational posture: included')).toBeTruthy());
    const blob = container.textContent!.toLowerCase();
    // No INVENTED metric: the panel never fabricates a confidence/trust/correctness SCORE. (The honest
    // disclaimer legitimately uses "correct"/"health"/"SLO" inside a NEGATION, so we assert the absence of
    // scoring artifacts rather than the mere words.)
    expect(blob).not.toContain('confidence');
    expect(blob).not.toContain('trust score');
    expect(blob).not.toContain('correctness');
    expect(blob).not.toContain('% confident');
    // no secrets / raw payload material
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'bearer']) {
      expect(blob).not.toContain(forbidden);
    }
    // it DOES carry the honest disclaimer (transparency, not a verdict)
    expect(screen.getByText(/not a claim that any AI answer is correct/i)).toBeTruthy();
    // factual badge, not a verdict
    expect(screen.getByText('Operational posture: included')).toBeTruthy();
  });

  it('shows unavailable state when the governed read fails closed', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'not permitted' }, requestId: 'r', correlationId: 'c', operation: 'QueryEvidenceContext' }));
    render(<GroundingTransparencyPanel />);
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
  });
});
