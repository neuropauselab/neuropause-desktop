/**
 * P13C H-FINDING-4 (Option A, Cohort 1) — a PARAMETERIZED governed-action adapter over the
 * EXISTING CST kernel, for high-consequence non-`mail.send` M365 IPC write actions.
 *
 * This is an ADDITIVE sibling of `governedSend` (`sendTransition.ts`, unchanged). It reuses the
 * frozen `@neuropause/cst` kernel verbatim — the kernel provides authorization, atomic
 * single-winner admission, idempotency/replay reconciliation, and denial-before-effect. This
 * adapter only TRANSLATES an M365 `WriteAction` + its authoritative context into the kernel's
 * `TransitionRequest`, folds the connector facts (ownership, granted scope, valid token) into the
 * single policy grant so the kernel is the ONE verdict, and runs `action.run` as the effect. It
 * adds NO authorization logic of its own and creates NO new authority/decision contract.
 *
 * Governance class for Cohort 1 (uniform, from effect semantics): every Cohort-1 action MUTATES
 * and is high-consequence + externally irreversible, so `consequence = C3` (approval-bound; the
 * human `confirmed` flag is the C3 approval) and `reversibility = IRREVERSIBLE`. Profile A: there
 * is NO authoritative remote observation of these Graph writes, so the post-state is UNOBSERVABLE
 * and `VERIFIED_SUCCESS` is structurally unreachable — an ack is ACKNOWLEDGED, never verified; a
 * lost response is UNKNOWN, never a failure, and is NEVER blindly retried.
 *
 * Consequential identity is DETERMINISTIC: the idempotency key is a sha256 over the CANONICAL JSON
 * of `{ tenantId, connectorId, accountId, actionId, params }` (`util/canonicalJson`, sorted keys,
 * fail-closed) — so reordered object keys yield the SAME identity, and any consequential difference
 * yields a DIFFERENT identity. Non-canonicalizable params ⇒ no deterministic identity ⇒ DENY (no
 * effect).
 *
 * Durability: the injected stores are process-lifetime (in-memory) — same as `governedSend`.
 * RESTART-DURABLE single-use is OUT OF SCOPE here (declared Node-20 / node:sqlite limit); NOT claimed.
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
  type IdempotencyStorePort,
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
import { canonicalize, CanonicalizationError } from '../util/canonicalJson';

/** How long a confirmation (the C3 approval) is valid after issue — mirrors governedSend. */
const APPROVAL_TTL_MS = 15 * 60_000;
/** The policy version recorded for the governed-action transition (adapter-internal identifier). */
const POLICY_VERSION = 'm365-action-policy-1';

/**
 * P13C H-FINDING-4 Cohort 1 — the high-consequence non-`mail.send` M365 write actions routed
 * through this adapter: external communication, destructive, and permission-changing operations.
 * `mail.send` is EXCLUDED (it keeps its certified `governedSend` path). Cohort membership is a
 * routing decision; the adapter itself is action-agnostic.
 */
export const GOVERNED_ACTION_COHORT1: ReadonlySet<string> = new Set<string>([
  // External communication (irreversible: cannot be unsent).
  'mail.reply',
  'mail.replyAll',
  'mail.forward',
  'calendar.invite',
  'calendar.respond',
  'teams.sendChannelMessage',
  'teams.replyChannelMessage',
  'teams.sendChatMessage',
  // Destructive.
  'mail.delete',
  'calendar.delete',
  'drive.delete',
  'contacts.delete',
  // Permission-changing / sharing.
  'drive.share',
]);

/**
 * P13C H-FINDING-4 Cohort 2A — the externally-VISIBLE / notification-capable remaining actions,
 * governed through the SAME `governedAction` adapter + durable store as Cohort 1, at the same
 * conservative C3 / IRREVERSIBLE tier (the adapter's uniform class is honest here: these can be
 * externally communicative, and `calendar.update`'s external consequence depends on non-param-
 * derivable server-side attendee state, so precise reversibility is NOT claimed). `calendar.create`
 * sends invitations when attendees are present; `calendar.update` may notify existing attendees;
 * `teams.createChannel` creates a team-visible channel. Cohort 2B (reversible internal mutations) is
 * intentionally NOT included here.
 */
export const GOVERNED_ACTION_COHORT2A: ReadonlySet<string> = new Set<string>([
  'calendar.create',
  'calendar.update',
  'teams.createChannel',
]);

export type ActionSemanticOutcome =
  | 'ACKNOWLEDGED'
  | 'UNKNOWN'
  | 'EXECUTION_FAILED'
  | 'VERIFIED_NOOP'
  | 'DENIED'
  | 'HOLD'
  | 'ESCALATE';

/**
 * CST stores for the governed-action path. The CLAIM store is in-memory by design (atomic
 * single-winner is a within-process property; a fresh process holds no in-flight claims). The
 * IDEMPOTENCY store carries the durable single-use intent — inject a durable implementation
 * (`DurableIdempotencyStore`) for single-process restart durability, or leave the default in-memory
 * store for process-lifetime scope. H-FINDING-4 Option C.
 */
export interface GovernedActionPorts {
  readonly claims: ClaimStore;
  readonly idempotency: IdempotencyStorePort;
}

export function createGovernedActionPorts(
  idempotency: IdempotencyStorePort = new IdempotencyStore(),
): GovernedActionPorts {
  return { claims: new ClaimStore(), idempotency };
}

export interface GovernedActionArgs {
  /** The Cohort-1 WriteAction — its `run()` IS the effect. */
  readonly action: WriteAction;
  readonly connectorId: string;
  readonly accountId: string;
  readonly params: WriteParams;
  /** The explicit human confirmation — the C3 approval for this transition. */
  readonly confirmed: boolean;
  readonly tenantId: string;
  readonly actorId: string;
  // ── Connector-fact governance INPUTS (folded into ONE kernel verdict; not a 2nd authority) ──
  readonly ownsAccount: boolean;
  readonly grantedScopes: readonly string[];
  readonly getToken: () => Promise<string | null>;
  readonly makeHttp: (gateKey: string, getToken: () => Promise<string>, rate: RateGate) => HttpClient;
  readonly rate: RateGate;
  readonly now: () => string;
  readonly ports: GovernedActionPorts;
}

export interface GovernedActionResult {
  /** The CST envelope, or null when denied BEFORE the kernel (non-canonicalizable params). */
  readonly outcome: TransitionOutcome | null;
  readonly semanticOutcome: ActionSemanticOutcome;
  /** The external effect is attempted AT MOST ONCE. MUST be 0 or 1; never >1. */
  readonly effectCalls: number;
  readonly providerAck: boolean;
  readonly summary?: string;
}

/** A `.Read` requirement is satisfied by the matching `.ReadWrite` grant (mirrors the executor). */
function hasScope(granted: readonly string[], need: string): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith('.Read')) return granted.includes(`${need.slice(0, -'.Read'.length)}.ReadWrite`);
  return false;
}

/**
 * Run a Cohort-1 M365 write as a governed Consequential State Transition (Profile A). Connector
 * facts (ownership, granted scope, token availability) are folded into the single policy grant so
 * the kernel is the ONE authorization verdict. `confirmed` supplies the C3 approval.
 */
export async function governedAction(args: GovernedActionArgs): Promise<GovernedActionResult> {
  const {
    action, connectorId, accountId, params, confirmed, tenantId, actorId,
    ownsAccount, grantedScopes, getToken, makeHttp, rate, now, ports,
  } = args;

  // Deterministic consequential identity — CANONICAL JSON (fail-closed). Non-canonicalizable
  // consequential params have no deterministic identity ⇒ DENY, no effect.
  let canonical: string;
  try {
    canonical = canonicalize({ tenantId, connectorId, accountId, actionId: action.id, params });
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return { outcome: null, semanticOutcome: 'DENIED', effectCalls: 0, providerAck: false };
    }
    throw err;
  }
  const idem = brandIdempotencyKey(createHash('sha256').update(canonical).digest('hex'));

  const resourceType = `m365-write:${action.domain}`;
  const policyAction = `connectors.m365.${action.id}`;
  const actor: Actor = { id: actorId, type: 'HUMAN', tenantId };
  const target = { tenantId, resourceType, resourceId: `${connectorId}/${accountId}/${idem}`, version: 1 };

  // Connector-fact governance INPUTS → ONE verdict. A missing authoritative actor, an unowned
  // account, a missing scope, or no valid token each withholds the grant, so the kernel DENIES and
  // the effect never runs. Identity is an authorization INPUT — never inferred, never a fallback.
  const hasActor = actorId.trim() !== '';
  const scopesOk = action.scopes.every((s) => hasScope(grantedScopes, s));
  const token = hasActor && ownsAccount && scopesOk ? await getToken() : null;
  const authorized = hasActor && ownsAccount && scopesOk && token !== null;

  const consequence: Consequence = 'C3'; // Cohort-1 mutates → always approval-bound
  // NON-VACUOUS postcondition. Profile A can NEVER satisfy it (no authoritative read-back), so the
  // kernel never reaches VERIFIED — VERIFIED_SUCCESS is structurally unreachable, by construction.
  const expectedPostState = { actionResolved: true };

  const time = new SystemTime();
  const purpose = `Execute "${action.label}" via ${connectorId}/${accountId}`;

  const approval: Approval | undefined = confirmed
    ? {
        approvalId: brandApprovalId(`appr:${idem}`),
        transitionId: brandTransitionId(`m365-action:${idem}`),
        approver: actor,
        action: policyAction,
        scope: { tenantId, resourceType, resourceId: target.resourceId },
        resourceVersion: target.version,
        purpose,
        policyVersion: POLICY_VERSION,
        issuedAt: time.now(),
        expiresAt: time.now() + APPROVAL_TTL_MS,
        consumed: false,
      }
    : undefined;

  const request: TransitionRequest = {
    transitionId: brandTransitionId(`m365-action:${idem}`),
    requestId: brandRequestId(`req:${idem}:${time.now()}`),
    actor,
    action: policyAction,
    target,
    purpose,
    intent: `perform a single reviewer-confirmed ${action.id} via the connector`,
    expectedPostState,
    consequence,
    reversibility: 'IRREVERSIBLE',
    policyVersion: POLICY_VERSION,
    idempotencyKey: idem,
    evidence: [],
    ...(approval ? { approval } : {}),
  };

  const policy = new PolicyStore(
    new Map([[actorId, authorized ? new Set([policyAction]) : new Set<string>()]]),
    POLICY_VERSION,
  );
  const evidence = new EvidenceStore();
  const resources = new ResourceStore();
  resources.put(target, { phase: 'pre' });

  // Profile A: no external reconciliation oracle → honest {known:false}. An interrupted replay
  // HOLDs for reconciliation rather than asserting an effect we cannot confirm.
  const reconcile = async (): Promise<{ known: false }> => ({ known: false });

  let effectCalls = 0;
  let signal: 'ack' | 'unknown' | 'failure' = 'failure';
  let providerAck = false;
  let summary: string | undefined;

  const kernel = new CstKernel({
    time, policy, claims: ports.claims, idempotency: ports.idempotency, resources, evidence, reconcile,
  });

  const effect = async (): Promise<{ accepted: boolean }> => {
    effectCalls += 1; // the external effect is attempted AT MOST ONCE — NEVER retried
    if (token === null) {
      signal = 'failure';
      resources.put(target, UNOBSERVABLE);
      return { accepted: false };
    }
    const authedToken = token;
    const http = makeHttp(rateGateKey(connectorId, accountId), async () => authedToken, rate);
    try {
      // THE PRESERVED EFFECT — the pure Graph write (typed transport errors propagate here and are
      // the ONLY classification input — never a string match).
      const res = await action.run({ connectorId, accountId, http, now: now() }, params);
      providerAck = res.ok;
      summary = res.summary;
      signal = res.ok ? 'ack' : 'failure'; // provider acceptance — ACKNOWLEDGED, never VERIFIED
    } catch (err) {
      if (err instanceof NetworkError) signal = 'unknown'; // transmitted, response lost → UNKNOWN
      else if (err instanceof HttpError) signal = 'failure'; // definite provider rejection
      else if (err instanceof AuthError) signal = 'failure';
      else if (err instanceof RateLimitError) signal = 'failure';
      else if (err instanceof ActionInputError) signal = 'failure'; // pre-send validation; nothing sent
      else signal = 'unknown'; // unclassifiable → conservative UNKNOWN
    }
    resources.put(target, UNOBSERVABLE); // Profile A: post-state UNOBSERVABLE → VERIFIED unreachable
    return { accepted: signal === 'ack' };
  };

  const outcome = await kernel.run(request, effect);
  return {
    outcome,
    semanticOutcome: classifyAction(outcome, signal),
    effectCalls,
    providerAck,
    ...(summary ? { summary } : {}),
  };
}

/** Map the kernel envelope + transport signal into the domain outcome. No branch returns VERIFIED. */
function classifyAction(
  outcome: TransitionOutcome,
  signal: 'ack' | 'unknown' | 'failure',
): ActionSemanticOutcome {
  if (!outcome.executed) {
    if (outcome.verdict === 'ALLOW') return 'VERIFIED_NOOP';
    if (outcome.verdict === 'DENY') return 'DENIED';
    if (outcome.verdict === 'HOLD') return 'HOLD';
    if (outcome.verdict === 'ESCALATE') return 'ESCALATE';
    return 'DENIED';
  }
  switch (signal) {
    case 'ack':
      return 'ACKNOWLEDGED';
    case 'unknown':
      return 'UNKNOWN';
    case 'failure':
      return 'EXECUTION_FAILED';
  }
}
