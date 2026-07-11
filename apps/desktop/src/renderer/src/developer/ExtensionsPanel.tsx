/**
 * Extensions. Everything installed plugins have contributed through Plugin SDK v2
 * (Increment 6) — ERP modules, executive KPIs, timeline/graph/memory/search/context
 * providers, and automation triggers/actions — read live from the platform's
 * extension registry. Each contribution is permission-gated and versioned to the
 * plugin that registered it, and clears automatically when that plugin stops.
 */
import { PLUGIN_EXTENSION_KINDS } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { useDeveloper } from './DeveloperProvider';
import { InlineCode } from './primitives';
import { extensionKindMeta } from './lib';
import { distinctExtensionPlugins, groupExtensionsByKind } from './portalModel';

export function ExtensionsPanel(): JSX.Element {
  const { extensions } = useDeveloper();
  const groups = groupExtensionsByKind(extensions);

  return (
    <div>
      <OpsPanel title="Plugin extensions" subtitle="Contributions registered into the platform's own registries">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="puzzle" label="Extensions" value={extensions.length} tone="accent" />
          <Stat icon="package" label="Plugins" value={distinctExtensionPlugins(extensions)} tone="blue" />
          <Stat icon="layers" label="Kinds in use" value={groups.length} tone="purple" />
          <Stat icon="grid" label="Extension kinds" value={PLUGIN_EXTENSION_KINDS.length} tone="gray" />
        </div>
      </OpsPanel>

      {extensions.length === 0 ? (
        <OpsPanel title="No extensions registered">
          <EmptyState
            icon="puzzle"
            title="No plugin extensions yet"
            description="When a plugin registers ERP modules, KPIs, providers, or automation hooks through Plugin SDK v2, they appear here — versioned to the plugin and gated by its runtime permissions."
          />
        </OpsPanel>
      ) : (
        groups.map((g) => {
          const meta = extensionKindMeta(g.kind);
          return (
            <OpsPanel key={g.kind} title={meta.label} subtitle={`${g.items.length} registered`}>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {g.items.map((ext) => (
                  <div key={`${ext.pluginId}:${ext.id}`} className="surface-raised rounded-2xl p-4 shadow-card">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl [background:var(--fill-2)]"><Icon name={meta.icon} size={18} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-semibold tracking-tight">{ext.label}</h3>
                          <StatusBadge tone={meta.tone} label={meta.label} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-faint">
                          <Icon name="package" size={11} /> {ext.pluginId}
                          <span className="rounded [background:var(--fill-2)] px-1 py-0.5 font-mono text-2xs">v{ext.pluginVersion}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-2xs text-faint"><Icon name="tag" size={10} /> <InlineCode>{ext.id}</InlineCode></div>
                    {Object.keys(ext.spec).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(ext.spec).map(([k, v]) => (
                          <span key={k} className="rounded-lg [background:var(--fill-1)] px-2 py-0.5 text-2xs text-muted">
                            <span className="text-faint">{k}:</span> {v === null ? 'null' : String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </OpsPanel>
          );
        })
      )}
    </div>
  );
}
