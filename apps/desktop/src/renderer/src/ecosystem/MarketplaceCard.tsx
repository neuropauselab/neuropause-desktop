/**
 * A marketplace listing card shared by the Worker, Connector, and Template
 * marketplaces. Shows the listing identity, pricing, installs, and rating, and
 * the install lifecycle: install/apply when not installed, an "update available"
 * affordance when the published version has moved ahead, and enable/uninstall
 * once installed. An optional badge slot carries the tier or category.
 */
import type { Installation, MarketplaceListing } from '@neuropause/shared';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { StatusBadge, IconAction } from '@renderer/operations/primitives';
import { cn } from '@renderer/lib/cn';
import { Stars } from '@renderer/developer/primitives';
import { formatNum, installStatusMeta, kindMeta, pricingLabel, TEXT_TONE } from './lib';

interface MarketplaceCardProps {
  listing: MarketplaceListing;
  installed?: Installation | undefined;
  badge?: React.ReactNode;
  installLabel?: string;
  onInstall: () => void;
  onUpdate: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUninstall: () => void;
  onRate: (stars: number) => void;
}

export function MarketplaceCard({ listing, installed, badge, installLabel = 'Install', onInstall, onUpdate, onToggleEnabled, onUninstall, onRate }: MarketplaceCardProps): JSX.Element {
  const km = kindMeta(listing.kind);
  const status = installed ? installStatusMeta(installed.status) : null;
  const isDisabled = installed?.status === 'disabled';

  return (
    <div className="surface-raised flex flex-col rounded-2xl p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [background:var(--fill-2)]', TEXT_TONE[km.tone])}><Icon name={km.icon} size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-semibold tracking-tight">{listing.name}</h3>
            {listing.certified && <Icon name="verified" size={13} className="shrink-0 text-sysblue" />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {badge}
            <span className="text-2xs text-faint">{pricingLabel(listing.pricing.model, listing.pricing.amount, listing.pricing.currency)}</span>
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{listing.summary || 'No description provided.'}</p>

      <div className="mt-2 flex items-center gap-3 text-2xs text-faint">
        <span className="inline-flex items-center gap-1"><Icon name="download" size={12} />{formatNum(listing.installs)}</span>
        {listing.ratingCount > 0 ? <Stars value={listing.ratingAvg} count={listing.ratingCount} /> : <span>Unrated</span>}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--hairline)] pt-3">
        {installed ? (
          <>
            <div className="flex items-center gap-1.5">
              {status && <StatusBadge tone={status.tone} label={status.label} pulse={installed.status === 'update_available'} />}
              <span className="font-mono text-2xs text-faint">v{installed.installedVersion}</span>
            </div>
            <div className="flex items-center gap-1">
              {installed.status === 'update_available' && <Button size="sm" variant="primary" icon="download" onClick={onUpdate}>Update</Button>}
              <IconAction icon={isDisabled ? 'play' : 'pause'} label={isDisabled ? 'Enable' : 'Disable'} onClick={() => onToggleEnabled(isDisabled)} />
              <IconAction icon="star" label="Rate" tone="orange" onClick={() => onRate(5)} />
              <IconAction icon="trash" label="Uninstall" tone="red" onClick={onUninstall} />
            </div>
          </>
        ) : (
          <>
            <span className="text-2xs text-faint">Not installed</span>
            <Button size="sm" variant="primary" icon="download" onClick={onInstall}>{installLabel}</Button>
          </>
        )}
      </div>
    </div>
  );
}
