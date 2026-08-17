/**
 * Live capability discovery — composes the runtime's authoritative state into the AI-facing capability catalog.
 *
 * Slice 1 built the pure `capabilityCatalog` model (what a capability IS, read/mutate, consequential, approval,
 * tenant, availability). This service is the smallest adapter that feeds it REAL runtime state and projects the
 * result into the narrow, safe shape the assistant/AI may see. It holds no state of its own — accounts, actions and
 * the active workspace are read on each call from the authoritative stores (injected, so this stays pure and
 * testable; the Electron/store coupling lives only in the wiring module).
 *
 * What the AI receives, and does NOT:
 *   - It receives DESCRIPTIONS: capability id, connector, account label, read/mutate, consequential, approval,
 *     availability, and an honest execution-assurance tag. These are a menu — "here is what could be done".
 *   - It NEVER receives a token, a credential, a callable, an executor handle, a decision claim, or authority.
 *     `AssistantCapability` has no such field; selection returns a description, never an effect.
 *
 * Honest execution-assurance (§10/§11 of the integration brief): not every connector's mutation is governed to the
 * same standard. M365 mutations run the certified governedSend/governedAction + Boundary-B + durable-admission path
 * (29/29) — `governed-certified`. Any other mutation is `governance-not-proven` and is deliberately NOT AI-selectable:
 * it stays DISCOVERABLE (the AI knows it exists) but is surfaced as not-yet-executable with an honest reason, rather
 * than silently offered for automated action. Reads are `not-applicable` (no external mutation to govern).
 *
 * `aiSelectable` means the AI may PROPOSE this capability into the existing governed pipeline — it does NOT mean the
 * AI executes it. Every real effect still flows through proposal → governance → approval → admission → executor,
 * unchanged. This service performs no effect and grants no authority.
 */
import type { ConnectedAccount, ExecutorKind } from '@neuropause/shared';
import {
  capabilitiesForWorkspace,
  discoverCapabilities,
  type CapabilityAvailability,
  type CapabilityOperation,
  type ConnectorActionSource,
  type DiscoveredCapability,
} from './capabilityCatalog';

/** How well a mutation's execution path is governed. Derived from authoritative certification facts, not invented. */
export type CapabilityAssurance = 'governed-certified' | 'governance-not-proven';

/** Execution assurance as seen per capability — reads have no external effect to govern. */
export type CapabilityExecutionAssurance = CapabilityAssurance | 'not-applicable';

/**
 * The narrow, safe projection the assistant/AI may see. Description only — no token, no credential, no callable, no
 * claim, no executor object. `connectorId`/`accountId` are routing identity (safe), never secrets.
 */
export interface AssistantCapability {
  readonly capabilityId: string;
  /** Human-readable label from the connector's own catalog (e.g. "Send email"). Display text, never a secret. */
  readonly title: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly accountLabel: string;
  /** Which existing executor would run it (routing identity, e.g. 'm365'). Discovery only — never a callable. */
  readonly executor: ExecutorKind;
  readonly operation: CapabilityOperation;
  readonly consequential: boolean;
  readonly approvalRequired: boolean;
  readonly availability: CapabilityAvailability;
  readonly executionAssurance: CapabilityExecutionAssurance;
  /** The AI may PROPOSE this into the governed pipeline (never execute it directly). */
  readonly aiSelectable: boolean;
  /** Honest reason when not selectable (needs reconnect / unavailable / governance not proven). */
  readonly unavailableReason: string | null;
  readonly requiredScopes: readonly string[];
}

/** The tenant-scoped catalog the assistant sees. Empty (and `workspaceId: null`) when no workspace is resolved. */
export interface CapabilityCatalogView {
  readonly workspaceId: string | null;
  readonly capabilities: readonly AssistantCapability[];
}

/**
 * What the AI/planner PROPOSES — untrusted. The model may name a capability and (optionally) an account and its
 * purpose; it may NOT name the jurisdiction. Tenant/workspace is bound authoritatively by the service, never supplied
 * here, so the AI can never reach across the tenant boundary by asking.
 */
export interface CapabilitySelectionRequest {
  readonly capabilityId: string;
  readonly accountId?: string;
  readonly purpose?: string;
}

export type CapabilitySelectionStatus =
  | 'SELECTED'
  | 'NO_INTENT'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_ACCOUNT'
  | 'UNAVAILABLE'
  | 'GOVERNANCE_NOT_PROVEN';

/**
 * The result of NeuroPause VALIDATING an AI-proposed capability against the authoritative, tenant-scoped catalog.
 * `SELECTED` means the capability is real, in-jurisdiction, available, and governed to a proven standard — it is the
 * validated INPUT the governed pipeline may consume, NOT authorization to execute (governance, approval and admission
 * still run downstream). Every other status is an honest refusal. All flags come from the AUTHORITATIVE catalog match,
 * never from the (untrusted) request — a request cannot lower an approval requirement or promote a capability.
 */
export interface CapabilitySelectionOutcome {
  readonly status: CapabilitySelectionStatus;
  /** Present only when SELECTED. */
  readonly capability: AssistantCapability | null;
  /** Authoritative; false unless SELECTED and the capability actually requires approval. */
  readonly requiresApproval: boolean;
  readonly governanceStatus: CapabilityExecutionAssurance | null;
  /** The user's stated purpose (mandate), echoed honestly and neutralized — never authority. */
  readonly purpose: string | null;
  readonly reason: string;
}

/**
 * The authoritative live state the service reads. Injected so the service stays pure/testable; the wiring module
 * binds these to the real stores. `accounts()` is expected to be already tenant-scoped (the connector store is), but
 * the service re-scopes defensively regardless.
 */
export interface CapabilitySources {
  /** The active workspace id, or null when unresolved (fail-closed: null ⇒ empty catalog). */
  activeWorkspaceId(): string | null;
  /** Connected accounts (already active-workspace-scoped by the connector store). */
  accounts(): readonly ConnectedAccount[];
  /** The connectors' self-describing action catalogs (e.g. sanitized M365 actions). */
  actionSources(): readonly ConnectorActionSource[];
  /** Authoritative assurance for a connector's MUTATIONS. Declared by the wiring from certification facts. */
  mutationAssurance(connectorId: string): CapabilityAssurance;
}

function classifySelectability(
  cap: DiscoveredCapability,
  executionAssurance: CapabilityExecutionAssurance,
): { aiSelectable: boolean; unavailableReason: string | null } {
  if (cap.availability !== 'available') {
    return {
      aiSelectable: false,
      unavailableReason:
        cap.availability === 'reauth_required'
          ? 'The connected account needs to be reconnected.'
          : 'This connector is currently unavailable.',
    };
  }
  if (cap.operation === 'read') return { aiSelectable: true, unavailableReason: null };
  // A mutation is selectable only when its execution path is actually governed to the certified standard.
  if (executionAssurance === 'governed-certified') return { aiSelectable: true, unavailableReason: null };
  return { aiSelectable: false, unavailableReason: 'This action is not yet governed for automated execution.' };
}

export class CapabilityDiscoveryService {
  private readonly sources: CapabilitySources;

  constructor(sources: CapabilitySources) {
    this.sources = sources;
  }

  /**
   * The tenant-scoped capability catalog for the active workspace. Fail-closed: no resolved workspace ⇒ empty.
   * Accounts and actions are read fresh from the authoritative sources on every call — the service caches nothing.
   */
  catalog(): CapabilityCatalogView {
    const workspaceId = this.sources.activeWorkspaceId();
    if (workspaceId === null) return { workspaceId: null, capabilities: [] };

    const discovered = discoverCapabilities({
      accounts: this.sources.accounts(),
      sources: this.sources.actionSources(),
    });
    // Defensive re-scope: even if a source ever returned over-broad accounts, never cross the tenant boundary.
    const scoped = capabilitiesForWorkspace(discovered, workspaceId);
    return { workspaceId, capabilities: scoped.map((c) => this.project(c)) };
  }

  /** The subset the AI may PROPOSE now (available reads, and governed-certified mutations). Never executes. */
  aiSelectable(): readonly AssistantCapability[] {
    return this.catalog().capabilities.filter((c) => c.aiSelectable);
  }

  /**
   * Validate an AI-proposed capability against the authoritative, active-workspace catalog. Jurisdiction is bound
   * here (the service's own active workspace), NOT taken from the request — the AI cannot ask across tenants. Pure,
   * side-effect-free: it selects and refuses, it never executes.
   */
  resolveSelection(request: CapabilitySelectionRequest): CapabilitySelectionOutcome {
    return resolveCapabilitySelection(this.catalog(), request);
  }

  private project(cap: DiscoveredCapability): AssistantCapability {
    const executionAssurance: CapabilityExecutionAssurance =
      cap.operation === 'mutate' ? this.sources.mutationAssurance(cap.connectorId) : 'not-applicable';
    const { aiSelectable, unavailableReason } = classifySelectability(cap, executionAssurance);
    return {
      capabilityId: cap.capabilityId,
      title: cap.title,
      connectorId: cap.connectorId,
      accountId: cap.accountId,
      accountLabel: cap.accountLabel,
      executor: cap.executor,
      operation: cap.operation,
      consequential: cap.consequential,
      approvalRequired: cap.approvalRequired,
      availability: cap.availability,
      executionAssurance,
      aiSelectable,
      unavailableReason,
      requiredScopes: cap.requiredScopes,
    };
  }
}

/** Neutralize a caller-supplied purpose so it is carried as plain data, never as instructions. */
function sanitizePurpose(purpose: string | undefined): string | null {
  if (typeof purpose !== 'string') return null;
  const cleaned = purpose.replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

function refuse(status: CapabilitySelectionStatus, reason: string, purpose: string | null): CapabilitySelectionOutcome {
  return { status, capability: null, requiresApproval: false, governanceStatus: null, purpose, reason };
}

/**
 * Validate an AI-proposed capability against an ALREADY tenant-scoped catalog view. Pure. The request is untrusted;
 * every authoritative fact (approval, governance) comes from the matched catalog entry, never from the request:
 *  - no capability id                    → NO_INTENT
 *  - id/account not in this tenant's view → NOT_FOUND (covers invented, cross-tenant, and wrong-account requests)
 *  - id matches >1 account, none named   → AMBIGUOUS_ACCOUNT (never guess an account)
 *  - matched but not currently usable    → UNAVAILABLE
 *  - matched mutation, not governed-certified → GOVERNANCE_NOT_PROVEN (discoverable ≠ executable; never promoted)
 *  - otherwise                           → SELECTED (validated input to the governed pipeline; NOT execution authority)
 */
export function resolveCapabilitySelection(
  view: CapabilityCatalogView,
  request: CapabilitySelectionRequest,
): CapabilitySelectionOutcome {
  const purpose = sanitizePurpose(request.purpose);

  if (typeof request.capabilityId !== 'string' || request.capabilityId.trim().length === 0) {
    return refuse('NO_INTENT', 'No capability was requested.', purpose);
  }

  let candidates = view.capabilities.filter((c) => c.capabilityId === request.capabilityId);
  if (typeof request.accountId === 'string' && request.accountId.length > 0) {
    candidates = candidates.filter((c) => c.accountId === request.accountId);
  }

  if (candidates.length === 0) {
    return refuse('NOT_FOUND', 'No such capability is available to this user.', purpose);
  }
  if (candidates.length > 1) {
    return refuse('AMBIGUOUS_ACCOUNT', 'More than one connected account can do this — specify which account.', purpose);
  }

  const match = candidates[0];
  if (match.availability !== 'available') {
    return refuse('UNAVAILABLE', match.unavailableReason ?? 'This capability is not currently available.', purpose);
  }
  if (match.operation === 'mutate' && match.executionAssurance !== 'governed-certified') {
    return refuse('GOVERNANCE_NOT_PROVEN', 'This action is discoverable but not yet governed for execution.', purpose);
  }

  return {
    status: 'SELECTED',
    capability: match,
    requiresApproval: match.approvalRequired,
    governanceStatus: match.executionAssurance,
    purpose,
    reason: 'Validated against the authorized capability catalog. Still subject to governance and approval before any effect.',
  };
}
