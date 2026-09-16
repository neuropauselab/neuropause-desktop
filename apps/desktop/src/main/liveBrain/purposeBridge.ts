/**
 * L6 · S4.1 · THE L5 OPERATIONAL BRIDGE — a stated purpose (L5) evaluated against the REAL L4 graph +
 * tenant/scope → a `PurposeBridge` the proposal engine consumes. Built WITH S4 (the package's own
 * recommendation), behind the S4 gate.
 *
 * NOTHING is inferred merely because an action is technically possible: the bridge maps ONLY the
 * capability the PURPOSE resolved to (L5's own proposal at CONSENT_READY), and ONLY if that capability
 * is a real governed route in the L4 graph. A purpose that is not consent-ready, or whose resolved
 * capability is not a governed route, yields NO mappable capability → NOT_READY.
 *
 * Deterministic, data-only, zero-runtime-import — TYPES only.
 */
import type { PurposeEvaluation, PurposeState } from '../purposeEngine/purposeEngine';
import type { CapabilityGraphSnapshot } from '../capabilityGraph/capabilityGraph';
import type { EvidenceRef } from './proposal';

export interface PurposeBridge {
  readonly purposeId: string;
  readonly purposeState: PurposeState;
  readonly consentState: 'CONSENT_READY' | 'not-ready';
  readonly scope: string;
  readonly tenantId: string;
  readonly evidence: readonly EvidenceRef[];
  /** ONLY the purpose's resolved capability, if it is a governed route — never every routable one. */
  readonly capabilities: readonly string[];
  readonly constraints: readonly string[];
}

export interface BridgeDeps {
  readonly evaluation: PurposeEvaluation; // L5
  readonly graph: CapabilityGraphSnapshot; // L4
  readonly tenantId: string;
  readonly scope: string;
  readonly evidence: readonly EvidenceRef[];
}

export type BridgeResult =
  | { readonly status: 'BRIDGED'; readonly bridge: PurposeBridge }
  | { readonly status: 'NOT_READY'; readonly reason: string };

export function bridgePurpose(deps: BridgeDeps): BridgeResult {
  const ev = deps.evaluation;
  const consentReady = ev.state === 'CONSENT_READY' && ev.proposal !== null;

  // Ground to the purpose's OWN governed route, not global route membership (S4.2 fix): the L4 route
  // whose `purpose` matches this purpose (exactly one), AND require the L5 proposal's capability to
  // MATCH it. An untrusted `propose()` that names a different capability is rejected — nothing is
  // inferred merely because a capability is technically routable elsewhere in the graph.
  const resolvedCap = ev.proposal?.capability ?? null;
  const routesForPurpose = deps.graph.scopeResolved ? deps.graph.routes.filter((r) => r.purpose === (ev.purpose ?? '')) : [];
  const routedCap = routesForPurpose.length === 1 ? routesForPurpose[0].capability : null;
  const grounded = consentReady && routedCap !== null && resolvedCap === routedCap;
  const capabilities = grounded && routedCap !== null ? [routedCap] : [];

  const constraints: string[] = [];
  if (!consentReady) constraints.push(`purpose not consent-ready (at ${ev.state})`);
  if (routedCap === null) constraints.push('no single governed route resolves for this purpose');
  else if (resolvedCap !== routedCap) constraints.push(`resolved capability ${resolvedCap ?? '(none)'} does not match the purpose's governed route ${routedCap}`);

  if (capabilities.length === 0) {
    return { status: 'NOT_READY', reason: constraints.join('; ') || 'no capability resolved for this purpose' };
  }

  const bridge: PurposeBridge = {
    purposeId: `purpose:${ev.purpose ?? '(none)'}`,
    purposeState: ev.state,
    consentState: 'CONSENT_READY',
    scope: deps.scope,
    tenantId: deps.tenantId,
    evidence: deps.evidence,
    capabilities,
    constraints,
  };
  return { status: 'BRIDGED', bridge };
}
