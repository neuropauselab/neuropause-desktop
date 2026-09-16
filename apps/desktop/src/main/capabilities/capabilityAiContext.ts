/**
 * Capability → AI context projection. Turns the live, tenant-scoped capability catalog into a small, deterministic,
 * AI-safe description the existing AI engine can read as grounding — so the assistant knows what this user can
 * actually do, before it decides anything.
 *
 * This is the ONLY thing the AI receives about capabilities, and it is a DESCRIPTION, never authority:
 *   - no token, credential, callable, executor handle, IPC object, decision claim, or approval token — only text;
 *   - the authoritative flags (read/action, requires-approval, governed / not-yet-governed, availability) come from
 *     the catalog's structured fields, NOT from any connector-provided label, so a misleading label cannot change
 *     what the model is told;
 *   - connector-provided labels are neutralized (whitespace collapsed, length-capped) so they cannot inject prompt
 *     structure or instructions;
 *   - it is connector-agnostic — it renders whatever the catalog contains, hard-coding no connector.
 *
 * The AI is a CONSUMER of this description. It may reference and plan with capabilities; it cannot execute them.
 * Every real effect still flows through proposal → governance → approval → admission → executor, unchanged.
 *
 * The frozen `AiContextSource` union has no dedicated `capabilities` value, so the item reuses `mission-brief`
 * (NeuroPause-synthesized situational context) and titles the body explicitly. A dedicated source value would be a
 * frozen shared-contract change — deferred, not worked around.
 */
import type { AiContextItem } from '@neuropause/shared';
import type { CapabilityAvailability } from './capabilityCatalog';
import type { AssistantCapability, CapabilityCatalogView } from './capabilityDiscoveryService';

const CAPABILITY_SOURCE = 'mission-brief' as const;
const TITLE = 'AVAILABLE NEUROPAUSE CAPABILITIES';
const PREAMBLE =
  'These are the capabilities available to this user right now. You may reference and plan with them, but you ' +
  'cannot execute anything — consequential actions require governed approval.';

const AVAILABILITY_TEXT: Record<CapabilityAvailability, string> = {
  available: 'available',
  reauth_required: 'needs reconnection',
  unavailable: 'unavailable',
};

/** Neutralize a connector-provided string so it cannot inject prompt structure or instructions. */
function safeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function renderLine(cap: AssistantCapability, showAccount: boolean): string {
  const kind = cap.operation === 'mutate' ? 'action' : 'read';
  const approval = cap.approvalRequired ? ', requires approval' : '';
  const assurance =
    cap.operation === 'mutate'
      ? cap.executionAssurance === 'governed-certified'
        ? ' — governed'
        : ' — not yet available for automated execution'
      : '';
  const account = showAccount ? ` (account ${cap.accountId})` : '';
  return `- ${safeLabel(cap.title)} [${cap.capabilityId}]${account} — ${kind}${approval} — ${AVAILABILITY_TEXT[cap.availability]}${assurance}`;
}

/** Render the catalog as a deterministic, AI-safe text block. Order is independent of input order. */
export function renderCapabilityContext(view: CapabilityCatalogView): string {
  if (view.capabilities.length === 0) {
    return `${TITLE}\nNone are currently available for this user.`;
  }
  const caps = [...view.capabilities].sort(
    (a, b) =>
      a.connectorId.localeCompare(b.connectorId) ||
      a.accountId.localeCompare(b.accountId) ||
      a.capabilityId.localeCompare(b.capabilityId),
  );
  const byConnector = new Map<string, AssistantCapability[]>();
  for (const cap of caps) {
    const list = byConnector.get(cap.connectorId) ?? [];
    list.push(cap);
    byConnector.set(cap.connectorId, list);
  }
  const sections: string[] = [];
  for (const [connectorId, list] of byConnector) {
    const showAccount = new Set(list.map((c) => c.accountId)).size > 1;
    sections.push(`${connectorId}:\n${list.map((c) => renderLine(c, showAccount)).join('\n')}`);
  }
  return `${TITLE}\n${PREAMBLE}\n${sections.join('\n')}`;
}

/**
 * Project the catalog into AI context items for `AiEngineRequest.context`. Always returns exactly one item (which
 * honestly says "none available" for an empty catalog), so the AI can ground both the positive and the negative case.
 */
export function projectCapabilitiesForAI(view: CapabilityCatalogView): AiContextItem[] {
  return [{ source: CAPABILITY_SOURCE, text: renderCapabilityContext(view) }];
}
