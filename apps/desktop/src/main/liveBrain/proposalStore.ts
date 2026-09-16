/**
 * S5.4 Phase 0 · a main-side store of certified L6 proposals + the execution gate the (frozen) execute
 * handler consults before `governedSend`.
 *
 * The store is keyed by a DETERMINISTIC, RE-DERIVABLE fingerprint of the execute request's identity
 * (tenant + capability + account + params) — so the execute path can find the stashed `Proposal`
 * WITHOUT threading a `proposalId` through the frozen `M365ActionExecuteRequest` (no frozen touch).
 * The gate logic is non-frozen; only the one-line CALL to it inside `connectors/index.ts` is a frozen
 * touch (its own FG gate). If no proposal is stashed, the gate is `skip` — the existing (assistant)
 * flow proceeds exactly as today (backward-compatible).
 */
import type { Proposal } from './proposal';
import { admitForExecution, type ExecutionDeps } from './proposalExecutionBoundary';

const store = new Map<string, Proposal>();

function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function proposalKey(tenantId: string, capabilityId: string, account: string, params: Readonly<Record<string, unknown>>): string {
  return `${tenantId}::${capabilityId}::${account}::${canon(params)}`;
}

export function stashProposal(p: Proposal): void {
  store.set(proposalKey(p.tenantId, p.proposedAction.capabilityId, p.target.account, p.proposedAction.params), p);
}

/** Single-use — a proposal is consumed at execute (at-most-once for the gate). */
export function takeProposal(key: string): Proposal | null {
  const p = store.get(key) ?? null;
  if (p !== null) store.delete(key);
  return p;
}

export function clearProposals(): void {
  store.clear();
}

export interface L6ExecuteRequestLike {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly account: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type L6Gate =
  | { readonly gate: 'skip' } // no L6 proposal — the existing (assistant) flow proceeds unchanged
  | { readonly gate: 'admit'; readonly capabilityId: string } // an L6 proposal admitted for ASK
  | { readonly gate: 'refuse'; readonly reason: string }; // fails execution-time re-derivation

/**
 * The gate the execute handler consults before `governedSend`. Looks up the stashed proposal by the
 * re-derived key and runs `admitForExecution` (execution-time re-derivation — the proposal's own words
 * are never re-trusted). Deny-by-default on any re-derivation mismatch.
 */
export function gateL6Execution(request: L6ExecuteRequestLike, deps: ExecutionDeps): L6Gate {
  const proposal = takeProposal(proposalKey(request.tenantId, request.capabilityId, request.account, request.params));
  if (proposal === null) return { gate: 'skip' };
  const outcome = admitForExecution(proposal, deps);
  return outcome.status === 'ADMIT_FOR_ASK'
    ? { gate: 'admit', capabilityId: outcome.projection.capabilityId }
    : { gate: 'refuse', reason: outcome.reason };
}
