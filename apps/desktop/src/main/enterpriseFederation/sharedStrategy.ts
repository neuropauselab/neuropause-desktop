/**
 * Phase 6 Stage 11 — shared strategy: the Stage 10 composition. Joint
 * initiatives = Stage 10 initiatives whose capability keys intersect the
 * capabilities that partner shares evidence (via the registry share-kind →
 * capability map). The capability-federation view threads shares and
 * artifacts through the twelve business capabilities BESIDE each
 * capability's Stage 10 condition. Nothing here creates initiatives or
 * shares — it reports the recorded intersection. Pure; reads injected.
 */
import type { BusinessCapabilityKey, EfedCapabilityFederation, EfedGap, EfedSharedStrategy, EfedUnavailable } from '@neuropause/shared';
import { BUSINESS_CAPABILITIES } from '@neuropause/shared';
import { EXCHANGE_KIND_MAP, SHARE_KIND_CAPABILITIES } from './federationRegistry';

export interface SharedStrategyInput {
  initiatives: { id: string; label: string; state: string; capabilityKeys: string[] }[] | null;
  capabilities: { key: string; label: string; condition: string }[] | null;
  shares: { kind: string; name: string; peerOrgName: string; direction: string }[] | null;
  artifacts: { kind: string }[] | null;
  failures: Record<string, string>;
}

export function buildSharedStrategy(input: SharedStrategyInput): EfedSharedStrategy {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const gaps: EfedGap[] = [];
  // String-keyed on purpose: the injected slices carry plain-string kinds.
  const capsByShareKind = new Map<string, readonly BusinessCapabilityKey[]>(
    SHARE_KIND_CAPABILITIES.map((s) => [s.kind, s.capabilityKeys]),
  );
  const capsByExchangeKind = new Map<string, readonly BusinessCapabilityKey[]>(
    EXCHANGE_KIND_MAP.map((d) => [d.kind, d.capabilityKeys]),
  );

  const jointInitiatives = (input.initiatives ?? [])
    .map((i) => {
      const partnerShares = (input.shares ?? []).filter((s) =>
        (capsByShareKind.get(s.kind) ?? []).some((c) => i.capabilityKeys.includes(c)),
      );
      if (partnerShares.length === 0) return null;
      return {
        initiativeId: i.id,
        label: i.label,
        state: i.state as EfedSharedStrategy['jointInitiatives'][number]['state'],
        capabilityKeys: i.capabilityKeys as EfedSharedStrategy['jointInitiatives'][number]['capabilityKeys'],
        partnerShares: partnerShares.map((s) => ({
          peerOrgName: s.peerOrgName,
          kind: s.kind as EfedSharedStrategy['jointInitiatives'][number]['partnerShares'][number]['kind'],
          name: s.name,
          direction: s.direction,
        })),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (input.initiatives !== null && input.shares !== null && jointInitiatives.length === 0) {
    gaps.push({ kind: 'linkage', subject: 'initiatives', detail: 'no recorded partner share intersects any initiative capability' });
  }

  const capabilities: EfedCapabilityFederation[] = BUSINESS_CAPABILITIES.map((key) => {
    const local = input.capabilities?.find((c) => c.key === key) ?? null;
    const shareKinds = SHARE_KIND_CAPABILITIES.filter((s) => s.capabilityKeys.includes(key)).map((s) => s.kind);
    const exchangeKinds = EXCHANGE_KIND_MAP.filter((d) => d.capabilityKeys.includes(key)).map((d) => d.kind);
    const shares = (input.shares ?? []).filter((s) => (capsByShareKind.get(s.kind) ?? []).includes(key));
    return {
      key,
      label: local?.label ?? key,
      condition: (local?.condition ?? 'unknown') as EfedCapabilityFederation['condition'],
      shareKinds,
      exchangeKinds,
      artifacts: (input.artifacts ?? []).filter((a) => (capsByExchangeKind.get(a.kind) ?? []).includes(key)).length,
      sharesOut: shares.filter((s) => s.direction === 'outbound').length,
      sharesIn: shares.filter((s) => s.direction === 'inbound').length,
      initiatives: (input.initiatives ?? []).filter((i) => i.capabilityKeys.includes(key)).length,
    };
  });
  if (input.capabilities === null) {
    gaps.push({ kind: 'mapping', subject: 'capabilities', detail: 'the Stage 10 capability map was unreadable — conditions degrade to unknown' });
  }

  return { jointInitiatives, capabilities, gaps, unavailable };
}
