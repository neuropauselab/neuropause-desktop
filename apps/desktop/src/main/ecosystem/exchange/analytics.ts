/**
 * Ecosystem analytics — a pure rollup over the marketplace, installs, billing,
 * exchange, partners, and gateway usage into the ecosystem-wide picture:
 * marketplace growth, downloads, revenue, active developers/organizations,
 * usage, and a health score. No I/O.
 */
import type {
  EcosystemAnalytics,
  EcosystemHealth,
  EcosystemHealthSignal,
  ExchangePack,
  GrowthPoint,
  EcoHealthStatus,
  Installation,
  MarketplaceListing,
  MarketplacePurchase,
  Partner,
} from '@neuropause/shared';
import { PARTNER_TYPES } from '@neuropause/shared';

export interface EcosystemAnalyticsInput {
  listings: MarketplaceListing[];
  installs: Installation[];
  purchases: MarketplacePurchase[];
  packs: ExchangePack[];
  partners: Partner[];
  usage: { requests30d: number; computeUnits30d: number; p95LatencyMs: number };
  activeDevelopers: number;
  localOrgId: string;
  now: number;
}

const STATUS_SCORE: Record<EcoHealthStatus, number> = { good: 100, watch: 60, risk: 25 };

function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeEcosystemAnalytics(input: EcosystemAnalyticsInput): EcosystemAnalytics {
  const { listings, installs, purchases, packs, partners, usage, now } = input;

  const published = listings.filter((l) => l.status === 'published');
  const certified = listings.filter((l) => l.certified);
  const totalInstalls = listings.reduce((n, l) => n + l.installs, 0);

  const since30 = now - 30 * 86_400_000;
  const downloads30d = installs.filter((i) => Date.parse(i.installedAt) >= since30).length;

  // active organizations = local + distinct external pack publishers + distinct install orgs
  const orgIds = new Set<string>([input.localOrgId]);
  for (const p of packs) orgIds.add(p.publisherOrgId);
  for (const i of installs) orgIds.add(i.orgId);

  // revenue from purchases
  const gross = round2(purchases.reduce((n, p) => n + p.amount, 0));
  const platformFees = round2(purchases.reduce((n, p) => n + p.feeAmount, 0));

  // growth: last 6 months, cumulative listings + installs per month
  const growth: GrowthPoint[] = [];
  for (let m = 5; m >= 0; m -= 1) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - m);
    const key = d.toISOString().slice(0, 7);
    const listingsToDate = listings.filter((l) => l.createdAt.slice(0, 7) <= key).length;
    const installsInMonth = installs.filter((i) => i.installedAt.slice(0, 7) === key).length;
    growth.push({ period: key, listings: listingsToDate, installs: installsInMonth });
  }
  // ensure current month reflects at least the seeded baseline
  if (growth.length > 0 && growth[growth.length - 1].listings === 0) {
    growth[growth.length - 1] = { ...growth[growth.length - 1], listings: listings.length };
  }
  void monthKey;

  const byKind: Record<string, number> = {};
  for (const l of listings) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;

  const topListings = [...listings]
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 5)
    .map((l) => ({ name: l.name, installs: l.installs, kind: l.kind }));

  // health signals
  const total = listings.length || 1;
  const pubRatio = published.length / total;
  const certRatio = certified.length / total;
  const freshInstalls = installs.filter((i) => i.status !== 'update_available');
  const freshness = installs.length > 0 ? freshInstalls.length / installs.length : 1;
  const partnerTypesCovered = new Set(partners.map((p) => p.type)).size;

  const signal = (label: string, status: EcoHealthStatus, detail: string): EcosystemHealthSignal => ({ label, status, detail });
  const signals: EcosystemHealthSignal[] = [
    signal('Listing quality', pubRatio > 0.6 ? 'good' : pubRatio > 0.3 ? 'watch' : 'risk', `${published.length} of ${listings.length} listings published`),
    signal('Certification', certRatio > 0.4 ? 'good' : certRatio > 0.15 ? 'watch' : 'risk', `${certified.length} certified listings`),
    signal('Update adoption', freshness > 0.7 ? 'good' : freshness > 0.4 ? 'watch' : 'risk', installs.length > 0 ? `${freshInstalls.length} of ${installs.length} installs current` : 'No installs yet'),
    signal('Partner coverage', partnerTypesCovered >= 4 ? 'good' : partnerTypesCovered >= 2 ? 'watch' : 'risk', `${partnerTypesCovered} of ${PARTNER_TYPES.length} partner types`),
  ];
  const score = Math.round(signals.reduce((n, s) => n + STATUS_SCORE[s.status], 0) / signals.length);
  const label = score >= 80 ? 'Healthy' : score >= 55 ? 'Stable' : 'Needs attention';
  const health: EcosystemHealth = { score, label, signals };

  return {
    generatedAt: new Date(now).toISOString(),
    totalListings: listings.length,
    publishedListings: published.length,
    certifiedListings: certified.length,
    totalInstalls,
    activeDevelopers: input.activeDevelopers,
    activeOrganizations: orgIds.size,
    partners: partners.length,
    packs: packs.length,
    downloads30d,
    revenue: { gross, platformFees, net: round2(gross - platformFees), currency: 'USD' },
    usage,
    growth,
    byKind,
    topListings,
    health,
  };
}
