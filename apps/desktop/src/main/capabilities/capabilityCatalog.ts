/**
 * Capability discovery — the normalized, tenant-scoped capability catalog.
 *
 * NeuroPause OS lets a user connect an account once and then say what they want in plain language. For that to work
 * WITHOUT the user hand-wiring a workflow per connector, something must answer, from authoritative state alone:
 * "given the accounts this user has actually connected, what can be done, by which account, in which tenant, is it a
 * read or a consequential mutation, who would execute it, and does it need approval?"
 *
 * The connectors already describe themselves — M365 exposes a self-describing action catalog
 * (`ConnectorWriteActionInfo`: id, label, domain, scopes, mutates). What was missing is the COMPOSITION: joining those
 * self-describing actions to the user's actually-connected, tenant-scoped accounts into one honest catalog. That is
 * all this module is.
 *
 * Three hard boundaries make this safe to exist:
 *   1. DISCOVERY METADATA ONLY. A `DiscoveredCapability` carries no token, no credential, and no callable handle.
 *      Selecting one returns a description — it NEVER executes anything and NEVER waives governance. Every real effect
 *      still flows through the canonical proposal → governance → approval → admission → executor path unchanged.
 *   2. AUTHORITY IS NOT WEAKENABLE. `consequential` and `approvalRequired` are DERIVED from `mutates`, not accepted
 *      from any input. There is no field, and no caller, that can mark a mutation non-consequential or approval-free.
 *      The catalog is conservative: a mutation is always consequential and always approval-required here; the
 *      governance engine remains the authority that makes the actual decision at proposal time.
 *   3. HONEST ABOUT EFFECT. Verification is never "verified" — an acknowledged mutation is `provider-ack-only`,
 *      because there is no postcondition oracle. The catalog cannot claim an external effect it cannot prove.
 *
 * The catalog is a pure function of (connected accounts, self-describing action sources). It is closed over those
 * authoritative inputs: a capability that is not in a source cannot appear, so neither the AI nor any string of
 * untrusted content can invent one — `selectCapability` answers NOT_FOUND. Cross-tenant selection is refused.
 */
import type {
  ConnectedAccount,
  ConnectorId,
  ConnectorStatus,
  ConnectorWriteActionInfo,
  ExecutorKind,
} from '@neuropause/shared';

/** A read observes; a mutate changes external state and is therefore consequential. */
export type CapabilityOperation = 'read' | 'mutate';

/**
 * What can actually be known about an effect. `provider-ack-only` = the provider acknowledged the request but there
 * is no independent postcondition check (acknowledged ≠ verified). `none` = a read, which has no external effect to
 * verify. There is deliberately no `verified` value — this catalog never claims proof it does not have.
 */
export type CapabilityVerification = 'provider-ack-only' | 'none';

/** Whether the owning account can currently exercise the capability. Mirrors the authoritative connection status. */
export type CapabilityAvailability = 'available' | 'reauth_required' | 'unavailable';

/**
 * One thing a specific connected account can do, in a specific tenant — normalized across connectors. Pure metadata:
 * no token, no credential, no callable. `consequential`/`approvalRequired` are derived, never supplied.
 */
export interface DiscoveredCapability {
  readonly connectorId: ConnectorId;
  readonly accountId: string;
  readonly accountLabel: string;
  /** The tenant (workspace) that owns the account. `null` = an unclaimed account; never returned for a tenant. */
  readonly workspaceId: string | null;
  /** The authoritative action id from the connector's own catalog (e.g. `mail.send`). Never invented here. */
  readonly capabilityId: string;
  readonly title: string;
  readonly domain: string | null;
  readonly operation: CapabilityOperation;
  /** Derived: a mutation is always consequential. Not accepted from input. */
  readonly consequential: boolean;
  /** Derived: consequential ⇒ approval required. A conservative discovery hint — governance remains the authority. */
  readonly approvalRequired: boolean;
  /** Which existing executor would run it. Discovery only — NOT a handle the catalog can invoke. */
  readonly executor: ExecutorKind;
  readonly verification: CapabilityVerification;
  readonly availability: CapabilityAvailability;
  readonly requiredScopes: readonly string[];
}

/**
 * A connector's authoritative, self-describing action catalog paired with the executor that would run it — e.g. the
 * output of the M365 executor's `list()`. The catalog is composed only from sources like this; nothing else can add
 * a capability.
 */
export interface ConnectorActionSource {
  readonly connectorId: ConnectorId;
  readonly executor: ExecutorKind;
  readonly actions: readonly ConnectorWriteActionInfo[];
}

/**
 * Map an account's authoritative connection status to a capability availability, or `null` when the account is not in
 * a state that can exercise any capability (disconnected / mid-connect / errored). Only accounts that are actually
 * usable — or usable-after-reauth — contribute capabilities.
 */
function mapAvailability(status: ConnectorStatus): CapabilityAvailability | null {
  switch (status) {
    case 'connected':
      return 'available';
    case 'reauth_required':
      return 'reauth_required';
    case 'unavailable':
      return 'unavailable';
    case 'disconnected':
    case 'connecting':
    case 'error':
      return null;
    default: {
      // Exhaustiveness guard — a new ConnectorStatus must be classified explicitly, never defaulted to available.
      const _never: never = status;
      return _never;
    }
  }
}

/**
 * Compose the capability catalog from the user's connected accounts and the connectors' self-describing action
 * sources. Pure. Only usable accounts with a matching source contribute; each action becomes one capability whose
 * authority fields are derived, not supplied.
 */
export function discoverCapabilities(input: {
  readonly accounts: readonly ConnectedAccount[];
  readonly sources: readonly ConnectorActionSource[];
}): readonly DiscoveredCapability[] {
  const sourceByConnector = new Map<ConnectorId, ConnectorActionSource>();
  for (const source of input.sources) sourceByConnector.set(source.connectorId, source);

  const out: DiscoveredCapability[] = [];
  for (const account of input.accounts) {
    const availability = mapAvailability(account.status);
    if (availability === null) continue; // account not in a usable state — discover nothing for it
    const source = sourceByConnector.get(account.connectorId);
    if (!source) continue; // no operation-level catalog for this connector — nothing authoritative to discover

    for (const action of source.actions) {
      const operation: CapabilityOperation = action.mutates ? 'mutate' : 'read';
      const consequential = operation === 'mutate';
      out.push({
        connectorId: account.connectorId,
        accountId: account.id,
        accountLabel: account.label,
        workspaceId: account.workspaceId ?? null,
        capabilityId: action.id,
        title: action.label,
        domain: action.domain,
        operation,
        consequential,
        // Never weaker than `consequential`. There is no input that can lower this.
        approvalRequired: consequential,
        executor: source.executor,
        verification: consequential ? 'provider-ack-only' : 'none',
        availability,
        requiredScopes: action.scopes,
      });
    }
  }
  return out;
}

/**
 * The capabilities visible to one tenant. A capability is returned ONLY when its owning account belongs to exactly
 * this workspace — an unclaimed (`null`) or other-workspace capability is never leaked across the tenant boundary.
 */
export function capabilitiesForWorkspace(
  caps: readonly DiscoveredCapability[],
  workspaceId: string,
): readonly DiscoveredCapability[] {
  return caps.filter((c) => c.workspaceId === workspaceId);
}

/**
 * The subset an AI/planner may actually SELECT from — only currently-available capabilities. Anything requiring
 * reauth or unavailable is deliberately excluded so it is surfaced as NOT_AVAILABLE rather than silently chosen.
 */
export function selectableCapabilities(
  caps: readonly DiscoveredCapability[],
): readonly DiscoveredCapability[] {
  return caps.filter((c) => c.availability === 'available');
}

/** The outcome of asking the catalog for a specific capability. Never an execution — only a description or a refusal. */
export type CapabilitySelection =
  | { readonly ok: true; readonly capability: DiscoveredCapability }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'CROSS_TENANT' | 'NOT_AVAILABLE' };

/**
 * Resolve a requested (workspace, account, capability) against the catalog. This is the AI/planner entry point, and
 * it is deliberately narrow:
 *   - a capability id not present in any authoritative source → NOT_FOUND (the AI cannot invent capabilities);
 *   - present, but owned by a different tenant → CROSS_TENANT (never resolved across the boundary);
 *   - present and in-tenant, but not currently usable → NOT_AVAILABLE;
 *   - otherwise ok, returning DESCRIPTION ONLY. Selection is not authorization: the real action still goes through
 *     proposal → governance → approval → admission → executor. This never executes and never waives approval.
 */
export function selectCapability(
  caps: readonly DiscoveredCapability[],
  request: { readonly workspaceId: string; readonly accountId: string; readonly capabilityId: string },
): CapabilitySelection {
  const idMatch = (c: DiscoveredCapability): boolean =>
    c.accountId === request.accountId && c.capabilityId === request.capabilityId;

  const inTenant = caps.find((c) => c.workspaceId === request.workspaceId && idMatch(c));
  if (inTenant) {
    return inTenant.availability === 'available'
      ? { ok: true, capability: inTenant }
      : { ok: false, reason: 'NOT_AVAILABLE' };
  }
  // Not in this tenant. Distinguish "exists elsewhere" (a refused cross-tenant reach) from "does not exist at all".
  const elsewhere = caps.some(idMatch);
  return { ok: false, reason: elsewhere ? 'CROSS_TENANT' : 'NOT_FOUND' };
}
