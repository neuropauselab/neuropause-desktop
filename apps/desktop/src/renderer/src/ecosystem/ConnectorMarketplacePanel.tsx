/**
 * Connector Marketplace. Browse and install connector listings, grouped by
 * certification tier — community, enterprise, and certified. The tier is derived
 * from the listing's certification flag and pricing, and shown as a badge and a
 * filter.
 */
import { useState } from 'react';
import type { ConnectorTier, MarketplaceListing } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { useEcosystem } from './EcosystemProvider';
import { MarketplaceCard } from './MarketplaceCard';
import { connectorTierMeta, formatNum } from './lib';

function tierOf(l: MarketplaceListing): ConnectorTier {
  if (l.certified) return 'certified';
  if (l.pricing.model !== 'free') return 'enterprise';
  return 'community';
}

const TIERS: (ConnectorTier | 'all')[] = ['all', 'certified', 'enterprise', 'community'];

export function ConnectorMarketplacePanel(): JSX.Element {
  const { listings, installedFor, install, update, setEnabled, uninstall, installSummary } = useEcosystem();
  const connectors = listings.filter((l) => l.kind === 'connector');
  const [filter, setFilter] = useState<ConnectorTier | 'all'>('all');

  const shown = filter === 'all' ? connectors : connectors.filter((l) => tierOf(l) === filter);

  return (
    <div>
      <OpsPanel title="Connector Marketplace" subtitle="Connect your stack with community, enterprise, and certified connectors">
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="connectors" label="Connectors" value={connectors.length} tone="blue" />
          <Stat icon="verified" label="Certified" value={connectors.filter((l) => l.certified).length} tone="green" />
          <Stat icon="download" label="Installed" value={installSummary?.byKind['connector'] ?? 0} tone="accent" />
          <Stat icon="store" label="Total installs" value={formatNum(connectors.reduce((n, l) => n + l.installs, 0))} tone="purple" />
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {TIERS.map((t) => {
            const active = filter === t;
            const count = t === 'all' ? connectors.length : connectors.filter((l) => tierOf(l) === t).length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition', active ? 'bg-accent text-accent-fg' : 'surface text-muted hover:text-ink')}
              >
                {t === 'all' ? 'All' : connectorTierMeta(t).label}
                <span className={cn('rounded px-1 text-2xs', active ? 'bg-white/20' : '[background:var(--fill-2)]')}>{count}</span>
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <EmptyState icon="connectors" title="No connectors here" description="No connector listings match this tier yet." compact />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((l) => {
              const tm = connectorTierMeta(tierOf(l));
              return (
                <MarketplaceCard
                  key={l.id}
                  listing={l}
                  installed={installedFor(l.id)}
                  badge={<StatusBadge tone={tm.tone} label={tm.label} />}
                  onInstall={() => void install(l.id)}
                  onUpdate={() => { const ins = installedFor(l.id); if (ins) void update(ins.id); }}
                  onToggleEnabled={(enabled) => { const ins = installedFor(l.id); if (ins) void setEnabled(ins.id, enabled); }}
                  onUninstall={() => { const ins = installedFor(l.id); if (ins) void uninstall(ins.id); }}
                  onRate={(stars) => void ipc.ecosystem.rate(l.id, stars)}
                />
              );
            })}
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint"><Icon name="info" size={12} />Tier is derived from certification and pricing: certified listings are Certified, paid listings Enterprise, and free listings Community.</p>
      </OpsPanel>
    </div>
  );
}
