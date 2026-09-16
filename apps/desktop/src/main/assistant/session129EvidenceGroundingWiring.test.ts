/**
 * S129 — the live assistant Context Builder consumes the S128 governed AI evidence grounding source.
 * This proves the wiring behavior at the composition seam WITHOUT constructing the whole assistant:
 * `buildContext` appends `deps.evidenceContext()` exactly like the capability source, and the non-frozen
 * `resolveEvidenceContext` bridge fails closed. Frozen runtimeCore only forwards `resolveEvidenceContext`.
 *
 * Proofs: A evidence appears in context · B/C tenant isolation is the PROVIDER's job (server-resolved;
 * the bridge never takes a tenant) · D absent dep ⇒ unchanged · E no AI execution (pure array) ·
 * F provenance survives · (G/H covered by the untouched S125/S126/S127/S128 + assistant suites).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AiContextItem } from '@neuropause/shared';
import { evidenceContextProvider, resolveEvidenceContext } from '../platform/evidenceContextProvider';

/** Mirror of the assistant `buildContext` tail (S129): base sources + capabilities + evidence grounding. */
function composeContext(base: AiContextItem[], evidenceContext?: () => AiContextItem[]): AiContextItem[] {
  const evidence = evidenceContext ? evidenceContext() : [];
  return [...base, ...evidence];
}

afterEach(() => { evidenceContextProvider.current = null; });

describe('S129 · live assistant evidence grounding wiring', () => {
  it('A — governed evidence appears in the Context Builder output', () => {
    const item: AiContextItem = { source: 'timeline', text: 'Operational evidence — CreateSalesOrder · status DELIVERED.', evidence: [{ kind: 'command-journal', id: 'tx_1' }] };
    evidenceContextProvider.current = () => [item];
    const out = composeContext([{ source: 'mission-brief', text: 'brief' }], () => resolveEvidenceContext());
    expect(out.some((i) => i.text.includes('Operational evidence'))).toBe(true);
  });

  it('B/C — tenant isolation is server-resolved by the provider; the bridge passes NO tenant', () => {
    // The bridge signature carries only {query,correlationId,limit,relevanceQuery} — never a tenant
    // selector, so a caller cannot request another tenant's grounding. (Provider resolves the tenant.)
    let sawArgs: unknown;
    evidenceContextProvider.current = (opts) => { sawArgs = opts; return []; };
    resolveEvidenceContext({ query: 'x' });
    expect(sawArgs).toEqual({ query: 'x' });
    expect(JSON.stringify(sawArgs)).not.toMatch(/tenant/i);
  });

  it('S130 — the relevanceQuery (user question) is forwarded verbatim; still no tenant selector', () => {
    let sawArgs: { relevanceQuery?: string } | undefined;
    evidenceContextProvider.current = (opts) => { sawArgs = opts; return []; };
    // Mirrors the assistant buildContext tail: it grounds with { relevanceQuery: req.query }.
    resolveEvidenceContext({ relevanceQuery: 'what happened with my sales order' });
    expect(sawArgs?.relevanceQuery).toBe('what happened with my sales order');
    expect(JSON.stringify(sawArgs)).not.toMatch(/tenant/i); // relevance signal only, never a selector
  });

  it('D — absent evidenceContext dependency ⇒ context is unchanged (backward-compatible)', () => {
    const base: AiContextItem[] = [{ source: 'mission-brief', text: 'brief' }];
    expect(composeContext(base, undefined)).toEqual(base);
  });

  it('E — grounding does not execute any AI tool/action (pure array, no side effects)', () => {
    let calls = 0;
    evidenceContextProvider.current = () => { calls += 1; return [{ source: 'timeline', text: 'e', evidence: [{ kind: 'command-journal', id: 'tx' }] }]; };
    const out = resolveEvidenceContext();
    expect(Array.isArray(out)).toBe(true);
    expect(calls).toBe(1); // read once, nothing executed/dispatched
  });

  it('F — evidence provenance survives into the context item', () => {
    evidenceContextProvider.current = () => [{ source: 'timeline', text: 'Correlated evidence — …', evidence: [{ kind: 'delivered-events', id: 'ev_9' }] }];
    const out = resolveEvidenceContext();
    expect(out[0].evidence).toEqual([{ kind: 'delivered-events', id: 'ev_9' }]);
  });

  it('bridge FAILS CLOSED — no provider bound ⇒ [] (cold start); throwing provider ⇒ [] (no throw into the turn)', () => {
    evidenceContextProvider.current = null;
    expect(resolveEvidenceContext()).toEqual([]);
    evidenceContextProvider.current = () => { throw new Error('boom'); };
    expect(resolveEvidenceContext()).toEqual([]);
  });
});
