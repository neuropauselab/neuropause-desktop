/**
 * Phase 6 Stage 11 — shared operations: the Stage 9 composition, scoped to
 * PARTNER-FACING exposure only. For each partner: the share kinds it holds,
 * mapped through the registry's DECLARED share-kind → Stage 9 service map, with
 * each service's live state and SLA status. Readiness totals and capacity
 * pressure ride along as the operational context. The exposure map is declared
 * registry data — the disclosure says so. Pure; reads injected.
 */
import type { EfedGap, EfedPartnerExposure, EfedSharedOperations, EfedUnavailable } from '@neuropause/shared';
import { EXPOSURE_BY_KIND } from './federationRegistry';

export const EXPOSURE_DISCLOSURE =
  'Partner-facing exposure follows the registry’s DECLARED share-kind → service map over live Stage 9 states — the platform records no per-partner service binding, so exposure is declared composition, not measured traffic.';

export interface SharedOperationsInput {
  shares: { kind: string; peerOrg: string; peerOrgName: string }[] | null;
  s9Services: { serviceId: string; state: string }[] | null;
  slaStatuses: { targetId: string; serviceId: string; status: string }[] | null;
  readiness: { state: string }[] | null;
  capacityPressure: string | null;
  failures: Record<string, string>;
}

export function buildSharedOperations(input: SharedOperationsInput): EfedSharedOperations {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const gaps: EfedGap[] = [];

  const byPeer = new Map<string, { peerOrgName: string; kinds: Set<string> }>();
  for (const s of input.shares ?? []) {
    const e = byPeer.get(s.peerOrg) ?? { peerOrgName: s.peerOrgName, kinds: new Set<string>() };
    e.kinds.add(s.kind);
    byPeer.set(s.peerOrg, e);
  }

  const partners: EfedPartnerExposure[] = [...byPeer.entries()].map(([peerOrg, e]) => {
    const serviceIds = [...new Set([...e.kinds].flatMap((k) => EXPOSURE_BY_KIND.get(k)?.serviceIds ?? []))];
    const services = serviceIds.map((serviceId) => {
      const svc = input.s9Services?.find((x) => x.serviceId === serviceId);
      const sla = input.slaStatuses?.find((x) => x.serviceId === serviceId);
      if (!svc) gaps.push({ kind: 'exposure', subject: `${peerOrg}/${serviceId}`, detail: 'mapped service unreadable in the Stage 9 catalog this pass' });
      return { serviceId, state: svc?.state ?? 'unknown', slaStatus: sla?.status ?? null };
    });
    return { peerOrg, peerOrgName: e.peerOrgName, shareKinds: [...e.kinds] as EfedPartnerExposure['shareKinds'], services };
  });

  return {
    partners,
    readiness:
      input.readiness === null
        ? null
        : {
            ready: input.readiness.filter((d) => d.state === 'ready').length,
            degraded: input.readiness.filter((d) => d.state === 'degraded').length,
            notReady: input.readiness.filter((d) => d.state === 'not-ready').length,
            unknown: input.readiness.filter((d) => d.state === 'unknown').length,
          },
    capacityPressure: input.capacityPressure,
    disclosure: EXPOSURE_DISCLOSURE,
    gaps,
    unavailable,
  };
}
