/**
 * Partner Platform. A directory of ecosystem partners — technology partners,
 * consulting partners, system integrators, and managed service providers —
 * grouped by type, with tier and certification, specializations, regions, and
 * listing counts. Read-only (a seeded representative directory).
 */
import { PARTNER_TYPES, type Partner } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useEcosystem } from './EcosystemProvider';
import { partnerTierMeta, partnerTypeMeta, relativeTime, TEXT_TONE } from './lib';

export function PartnersPanel(): JSX.Element {
  const { partners, partnersStats } = useEcosystem();

  return (
    <div>
      <OpsPanel title="Partner Platform" subtitle="Technology partners, consulting partners, system integrators, and managed service providers">
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="verified" label="Partners" value={partnersStats?.total ?? partners.length} tone="accent" />
          <Stat icon="star-fill" label="Premier" value={partnersStats?.premier ?? 0} tone="purple" />
          <Stat icon="shield" label="Certified" value={partnersStats?.certified ?? 0} tone="green" />
          <Stat icon="globe" label="Partner types" value={Object.keys(partnersStats?.byType ?? {}).length} tone="blue" />
        </div>

        {partners.length === 0 ? (
          <EmptyState icon="verified" title="No partners yet" compact />
        ) : (
          <div className="space-y-6">
            {PARTNER_TYPES.map((type) => {
              const group = partners.filter((p) => p.type === type);
              if (group.length === 0) return null;
              const tm = partnerTypeMeta(type);
              return (
                <div key={type}>
                  <div className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                    <Icon name={tm.icon} size={12} />
                    {tm.label}
                    <span className="rounded [background:var(--fill-2)] px-1">{group.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {group.map((p) => <PartnerCard key={p.id} partner={p} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

function PartnerCard({ partner }: { partner: Partner }): JSX.Element {
  const tm = partnerTypeMeta(partner.type);
  const tier = partnerTierMeta(partner.tier);
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [background:var(--fill-2)]', TEXT_TONE[tm.tone])}><Icon name={tm.icon} size={18} /></span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold tracking-tight">{partner.name}</h3>
              {partner.certified && <Icon name="verified" size={13} className="text-sysblue" />}
            </div>
            <div className="text-2xs text-faint">Joined {relativeTime(partner.joinedAt)} · {partner.listings} listing{partner.listings === 1 ? '' : 's'}</div>
          </div>
        </div>
        <StatusBadge tone={tier.tone} label={tier.label} />
      </div>

      <p className="mt-2 text-sm text-muted">{partner.description}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {partner.specializations.map((s) => (
          <span key={s} className="rounded-md [background:var(--fill-1)] px-1.5 py-0.5 text-2xs font-medium text-muted">{s}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--hairline)] pt-2.5 text-2xs text-faint">
        <span className="inline-flex items-center gap-1"><Icon name="globe" size={12} />{partner.regions.join(' · ')}</span>
        <span className="inline-flex items-center gap-1 text-muted"><Icon name="external" size={12} />{partner.website.replace(/^https?:\/\//, '')}</span>
      </div>
    </div>
  );
}
