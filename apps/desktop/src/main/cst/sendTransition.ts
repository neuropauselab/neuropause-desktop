/**
 * P13C Phase H — the ONE CST boundary for the M365 SEND consequential action
 * (Profile A: acknowledgement-only). Frozen `@neuropause/cst 1.3.0` is the
 * authoritative kernel; this module is the single adapter between the existing
 * Microsoft Graph send and `CstKernel.run(request, effect)`.
 *
 * H9 (refined, Phase-H finding H-FINDING-1): the effect is the **pure Graph send**
 * (`WriteAction.run`), NOT `M365Executor.execute`. `execute()` swallows the
 * transport's typed error taxonomy (`NetworkError` vs `HttpError`) into a generic
 * `{ ok:false }`, which would collapse `UNKNOWN` (transmitted, response lost) into
 * `FAILURE`. By calling the send one layer down, the typed transport error reaches
 * the adapter intact and is the ONLY classification input — never a string match.
 * The executor file is UNMODIFIED; we reuse its identity/scope/token/transport
 * seams as governance INPUTS to the single kernel verdict, never as a second
 * authority.
 *
 * Profile A: there is NO authoritative remote observation of a send, so the post
 * state is UNOBSERVABLE and `VERIFIED_SUCCESS` is **structurally unreachable** —
 * there is no code path that returns it. A 202 is `ACKNOWLEDGED`, never verified.
 * A lost response is `UNKNOWN`, never a failure, and is NEVER blindly retried.
 *
 * Submodule imports (not the barrel) for the same reason as importTransition.ts —
 * see CST-1.3.0-DEFECTS-FOUND.md. Kernel unmodified; in-memory stores only
 * (declared Node-20 durability limit).
 */
import { createHash } from 'node:crypto';
import { CstKernel } from '@neuropause/cst/dist/src/kernel.js';
import {
  ClaimStore,
  EvidenceStore,
  IdempotencyStore,
  PolicyStore,
  ResourceStore,
  SystemTime,
} from '@neuropause/cst/dist/src/stores.js';
import {
  approvalId as brandApprovalId,
  idempotencyKey as brandIdempotencyKey,
  requestId as brandRequestId,
  transitionId as brandTransitionId,
  UNOBSERVABLE,
  type Actor,
  type Approval,
  type Consequence,
  type TransitionOutcome,
  type TransitionRequest,
} from '@neuropause/cst/dist/src/types.js';
import {
  AuthError,
  HttpError,
  NetworkError,
  RateLimitError,
  type HttpClient,
  type RateGate,
} from '../unified/sync/http';
import { rateGateKey } from '../unified/sync/rateLimiter';
import { ActionInputError, type WriteAction, type WriteParams } from '../connectors/m365/actionSdk';

/** How long a send confirmation (the C3 approval) is valid after issue. */
const APPROVAL_TTL_MS = 15 * 60_000;
const RESOURCE_TYPE = 'm365-send';
/** The single policy action this transition governs. */
const SEND_ACTION = 'connectors.m365.send';

/**
 * The domain outcome for a Profile-A send. Deliberately WITHOUT `VERIFIED_SUCCESS`:
 * Profile A has no authoritative remote observation, so a verified business outcome
 * is not establishable and must not be representable.
 *   • ACKNOWLEDGED     — provider returned 202 (accepted for delivery); NOT verified.
 *   • UNKNOWN          — request transmitted, response lost/timeout; may have sent.
 *   • EXECUTION_FAILED — provider DEFINITELY rejected the request; no send.
 *   • VERIFIED_NOOP    — idempotent replay of an already-executed key; no second send.
 *   • DENIED / HOLD    — governance refused; the effect never ran.
 *   • ESCALATE         — kernel escalation.
 */
export type SendSemanticOutcome =
  | 'ACKNOWLEDGED'
  | 'UNKNOWN'
  | 'EXECUTION_FAILED'
  | 'VERIFIED_NOOP'
  | 'DENIED'
  | 'HOLD'
  | 'ESCALATE';

/**
 * Process-lifetime CST stores shared across send calls, so a duplicate/replay of the
 * SAME message is suppressed within NeuroPause's governed boundary. This is
 * NeuroPause idempotency, NOT provider-enforced duplicate suppression, and NOT
 * crash-durable (in-memory; declared Node-20 limit).
 */
export interface GovernedSendPorts {
  readonly claims: ClaimStore;
  readonly idempotency: IdempotencyStore;
}

export function createGovernedSendPorts(): GovernedSendPorts {
  return { claims: new ClaimStore(), idempotency: new IdempotencyStore() };
}

export interface GovernedSendArgs {
  readonly connectorId: string;
  readonly accountId: string;
  /** The pure send action (e.g. `mail.send`). Its `run()` IS the effect. */
  readonly action: WriteAction;
  readonly params: WriteParams;
  /** The explicit human confirmation — the C3 approval for this transition. */
  readonly confirmed: boolean;
  readonly tenantId: string;
  readonly actorId: string;
  readonly policyVersion: string;
  // ── Connector-fact governance INPUTS (fold into ONE kernel verdict; not a 2nd authority) ──
  readonly ownsAccount: boolean;
  readonly grantedScopes: readonly string[];
  readonly getToken: () => Promise<string | null>;
  readonly makeHttp: (gateKey: string, getToken: () => Promise<string>, rate: RateGate) => HttpClient;
  readonly rate: RateGate;
  readonly now: () => string;
  readonly ports: GovernedSendPorts;
}

export interface GovernedSendResult {
  /** The full CST envelope — the transition's evidence of record. */
  readonly outcome: TransitionOutcome;
  readonly semanticOutcome: SendSemanticOutcome;
  /** The external effect is attempted AT MOST ONCE. MUST be 0 or 1; never >1. */
  readonly effectCalls: number;
  /** true ONLY when a provider 202 acknowledgement was received. Never implies verified. */
  readonly providerAck: boolean;
  readonly summary?: string;
}

/** A `.Read` requirement is satisfied by the matching `.ReadWrite` grant (mirrors the executor's rule). */
function hasScope(granted: readonly string[], need: string): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith('.Read')) return granted.includes(`${need.slice(0, -'.Read'.length)}.ReadWrite`);
  return false;
}

/**
 * Run an M365 send as a governed Consequential State Transition (Profile A).
 *
 * A send `mutates` ⇒ C3 by presence (never a low-risk send). The explicit human
 * `confirmed` flag is the C3 approval. Connector facts (ownership, granted scope,
 * token availability) are folded into the single policy grant so the kernel is the
 * ONE authorization verdict — not a second, disagreeing gate.
 */
export async function governedSend(args: GovernedSendArgs): Promise<GovernedSendResult> {
  const {
    connectorId, accountId, action, params, confirmed, tenantId, actorId, policyVersion,
    ownsAccount, grantedScopes, getToken, makeHttp, rate, now, ports,
  } = args;

  const actor: Actor = { id: actorId, type: 'HUMAN', tenantId };

  // NeuroPause intent identity — EXPLICITLY NOT provider idempotency. It protects the
  // governed transition from uncontrolled duplicate execution within NeuroPause; it
  // does NOT make Graph /sendMail idempotent.
  const idem = brandIdempotencyKey(
    createHash('sha256')
      .update(`${tenantId}|${connectorId}|${accountId}|${action.id}|${JSON.stringify(params)}`)
      .digest('hex'),
  );
  const target = {
    tenantId,
    resourceType: RESOURCE_TYPE,
    resourceId: `${connectorId}/${accountId}/${idem}`,
    version: 1,
  };

  // Connector-fact governance INPUTS → ONE verdict. A missing authoritative actor
  // identity, an unowned account, a missing scope, or no valid token each withholds
  // the policy grant, so the kernel DENIES and the effect never runs. Identity is an
  // authorization INPUT here — never inferred, never defaulted to a fallback actor.
  const hasActor = actorId.trim() !== '';
  const scopesOk = action.scopes.every((s) => hasScope(grantedScopes, s));
  const token = hasActor && ownsAccount && scopesOk ? await getToken() : null;
  const authorized = hasActor && ownsAccount && scopesOk && token !== null;

  const consequence: Consequence = 'C3'; // a send mutates → always approval-bound
  // NON-VACUOUS postcondition. Profile A can NEVER satisfy it (no authoritative
  // read-back), so the kernel never reaches VERIFIED — VERIFIED_SUCCESS is structural-
  // ly unreachable, by construction, not by convention.
  const expectedPostState = { sendResolved: true };

  const time = new SystemTime();
  const purpose = `Send "${action.label}" via ${connectorId}/${accountId}`;

  const approval: Approval | undefined = confirmed
    ? {
        approvalId: brandApprovalId(`appr:${idem}`),
        transitionId: brandTransitionId(`m365-send:${idem}`),
        approver: actor,
        action: SEND_ACTION,
        scope: { tenantId, resourceType: RESOURCE_TYPE, resourceId: target.resourceId },
        resourceVersion: target.version,
        purpose,
        policyVersion,
        issuedAt: time.now(),
        expiresAt: time.now() + APPROVAL_TTL_MS,
        consumed: false,
      }
    : undefined;

  const request: TransitionRequest = {
    transitionId: brandTransitionId(`m365-send:${idem}`),
    requestId: brandRequestId(`req:${idem}:${time.now()}`),
    actor,
    action: SEND_ACTION,
    target,
    purpose,
    intent: 'send a single reviewer-confirmed message via the connector',
    expectedPostState,
    consequence,
    reversibility: 'IRREVERSIBLE', // a sent message cannot be unsent
    policyVersion,
    idempotencyKey: idem,
    evidence: [],
    ...(approval ? { approval } : {}),
  };

  // The policy grant reflects the SAME authorization the connector facts establish;
  // when unauthorized the action is simply not granted → the kernel DENIES. One
  // authority: the kernel.
  const policy = new PolicyStore(
    new Map([[actorId, authorized ? new Set([SEND_ACTION]) : new Set<string>()]]),
    policyVersion,
  );
  const evidence = new EvidenceStore();
  const resources = new ResourceStore();
  resources.put(target, { phase: 'pre' });

  // No external reconciliation oracle in Profile A: honest {known:false}. An
  // interrupted (IN_FLIGHT) replay therefore HOLDs for reconciliation rather than
  // asserting a send we cannot confirm — the kernel never fabricates an effect.
  const reconcile = async (): Promise<{ known: false }> => ({ known: false });

  let effectCalls = 0;
  let sendSignal: 'ack' | 'unknown' | 'failure' = 'failure';
  let providerAck = false;
  let summary: string | undefined;

  const kernel = new CstKernel({
    time,
    policy,
    claims: ports.claims,
    idempotency: ports.idempotency,
    resources,
    evidence,
    reconcile,
  });

  const effect = async (): Promise<{ accepted: boolean }> => {
    effectCalls += 1; // the external effect is attempted AT MOST ONCE — NEVER retried
    // `authorized` guaranteed the token is non-null; guard defensively (unreachable).
    if (token === null) {
      sendSignal = 'failure';
      resources.put(target, UNOBSERVABLE);
      return { accepted: false };
    }
    const authedToken = token;
    const http = makeHttp(rateGateKey(connectorId, accountId), async () => authedToken, rate);
    try {
      // THE PRESERVED EFFECT — the pure Graph send. Typed transport errors PROPAGATE
      // here (they are NOT swallowed by M365Executor.execute) and are the ONLY
      // classification input — never a string.
      const res = await action.run({ connectorId, accountId, http, now: now() }, params);
      providerAck = true;
      summary = res.summary;
      sendSignal = 'ack'; // 202 accepted — ACKNOWLEDGED, never VERIFIED
    } catch (err) {
      if (err instanceof NetworkError) sendSignal = 'unknown'; // transmitted, response lost → UNKNOWN
      else if (err instanceof HttpError) sendSignal = 'failure'; // definite provider rejection → no send
      else if (err instanceof AuthError) sendSignal = 'failure'; // definite auth rejection
      else if (err instanceof RateLimitError) sendSignal = 'failure'; // definite rate-limit rejection (no send)
      else if (err instanceof ActionInputError) sendSignal = 'failure'; // pre-send validation; nothing transmitted
      else sendSignal = 'unknown'; // unclassifiable → conservative UNKNOWN (never fabricate FAILURE/SUCCESS)
    }
    // Profile A: NO authoritative remote observation exists → UNOBSERVABLE. The kernel
    // therefore can NEVER reach VERIFIED, regardless of the ack.
    resources.put(target, UNOBSERVABLE);
    return { accepted: sendSignal === 'ack' };
  };

  const outcome = await kernel.run(request, effect);
  return {
    outcome,
    semanticOutcome: classifySend(outcome, sendSignal),
    effectCalls,
    providerAck,
    ...(summary ? { summary } : {}),
  };
}

/**
 * Map the kernel envelope + the pure-send transport signal into the domain outcome.
 * There is NO branch that returns `VERIFIED_SUCCESS` — Profile A cannot honestly
 * establish it. `UNKNOWN` is a first-class outcome and never triggers a retry (the
 * effect runs at most once; this function does not re-invoke it).
 */
function classifySend(outcome: TransitionOutcome, sendSignal: 'ack' | 'unknown' | 'failure'): SendSemanticOutcome {
  if (!outcome.executed) {
    // Governance refused, or an idempotent replay short-circuited (effect not re-run).
    if (outcome.verdict === 'ALLOW') return 'VERIFIED_NOOP';
    if (outcome.verdict === 'DENY') return 'DENIED';
    if (outcome.verdict === 'HOLD') return 'HOLD';
    if (outcome.verdict === 'ESCALATE') return 'ESCALATE';
    return 'DENIED';
  }
  // Executed exactly once. The domain outcome IS the transport signal.
  switch (sendSignal) {
    case 'ack':
      return 'ACKNOWLEDGED';
    case 'unknown':
      return 'UNKNOWN';
    case 'failure':
      return 'EXECUTION_FAILED';
  }
}
