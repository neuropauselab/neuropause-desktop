/**
 * Enterprise Template Marketplace. Browse and apply enterprise + automation
 * templates — workflows, governance policies, approval chains, dashboards, and
 * industry templates — grouped by category. Applying records an installation;
 * deep-wiring a governance/template pack into the live enterprise layer is a
 * stated seam.
 */
import { useState } from 'react';
import { TEMPLATE_CATEGORIES, type MarketplaceListing, type TemplateCategory } from '@neuropause/shared';
import { OpsPanel, Stat } from '@renderer/operations/primitives';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useEcosystem } from './EcosystemProvider';
import { MarketplaceCard } from './MarketplaceCard';
import { formatNum, templateCategoryMeta, TEXT_TONE } from './lib';

function categoryOf(l: MarketplaceListing): TemplateCategory {
  if (l.kind === 'automation_template') return 'workflow';
  const hay = `${l.name} ${l.category} ${l.summary}`.toLowerCase();
  if (/govern|soc|compliance|policy|hipaa/.test(hay)) return 'governance_policy';
  if (/approval|chain|sign-?off/.test(hay)) return 'approval_chain';
  if (/dashboard|report|analytics/.test(hay)) return 'dashboard';
  if (/industry|healthcare|finance|retail|public sector/.test(hay)) return 'industry';
  return 'workflow';
}

export function TemplateMarketplacePanel(): JSX.Element {
  const { listings, installedFor, install, update, setEnabled, uninstall, installSummary } = useEcosystem();
  const templates = listings.filter((l) => l.kind === 'enterprise_template' || l.kind === 'automation_template');
  const [filter, setFilter] = useState<TemplateCategory | 'all'>('all');

  const shown = filter === 'all' ? templates : templates.filter((l) => categoryOf(l) === filter);
  const installedCount = (installSummary?.byKind['enterprise_template'] ?? 0) + (installSummary?.byKind['automation_template'] ?? 0);

  return (
    <div>
      <OpsPanel title="Enterprise Template Marketplace" subtitle="Apply ready-made workflows, governance policies, approval chains, dashboards, and industry templates">
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="grid" label="Templates" value={templates.length} tone="accent" />
          <Stat icon="download" label="Applied" value={installedCount} tone="green" />
          <Stat icon="store" label="Total installs" value={formatNum(templates.reduce((n, l) => n + l.installs, 0))} tone="blue" />
          <Stat icon="verified" label="Certified" value={templates.filter((l) => l.certified).length} tone="purple" />
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFilter('all')} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition', filter === 'all' ? 'bg-accent text-accent-fg' : 'surface text-muted hover:text-ink')}>
            All<span className={cn('rounded px-1 text-2xs', filter === 'all' ? 'bg-white/20' : '[background:var(--fill-2)]')}>{templates.length}</span>
          </button>
          {TEMPLATE_CATEGORIES.map((c) => {
            const meta = templateCategoryMeta(c);
            const active = filter === c;
            const count = templates.filter((l) => categoryOf(l) === c).length;
            return (
              <button key={c} type="button" onClick={() => setFilter(c)} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition', active ? 'bg-accent text-accent-fg' : 'surface text-muted hover:text-ink')}>
                <Icon name={meta.icon} size={13} />
                {meta.label}
                <span className={cn('rounded px-1 text-2xs', active ? 'bg-white/20' : '[background:var(--fill-2)]')}>{count}</span>
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <EmptyState icon="grid" title="No templates here" description="No template listings match this category yet." compact />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((l) => {
              const meta = templateCategoryMeta(categoryOf(l));
              return (
                <MarketplaceCard
                  key={l.id}
                  listing={l}
                  installed={installedFor(l.id)}
                  installLabel="Apply"
                  badge={<span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium [background:var(--fill-2)]', TEXT_TONE[meta.tone])}><Icon name={meta.icon} size={11} />{meta.label}</span>}
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
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint"><Icon name="info" size={12} />Applying a template records an installation. Wiring a governance or approval-chain pack into the live enterprise layer is a tracked seam.</p>
      </OpsPanel>
    </div>
  );
}
