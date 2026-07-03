/**
 * Enterprise Marketplace panel: the four visibility scopes (private, public,
 * partner, regional) and per-artifact control over visibility and distribution.
 * Changing an artifact's scope changes who across the federation can discover and
 * install it.
 */
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { Select } from '@renderer/developer/primitives';
import { useFederation } from './FederationProvider';
import { exchangeKindLabel, scopeMeta } from './lib';
import type { ExchangeScope } from '@neuropause/shared';

const SCOPE_ICON: Record<ExchangeScope, 'lock' | 'globe' | 'connectors' | 'database'> = {
  private: 'lock',
  public: 'globe',
  partner: 'connectors',
  regional: 'database',
};
const SCOPE_DESC: Record<ExchangeScope, string> = {
  private: 'Visible only inside the home organization.',
  public: 'Discoverable by every federated organization.',
  partner: 'Shared with partner-trust peers only.',
  regional: 'Restricted to a single data-residency region.',
};

export function MarketplacePanel(): JSX.Element {
  const { scopeSummary, artifacts, setScope } = useFederation();
  const scopes: ExchangeScope[] = ['private', 'public', 'partner', 'regional'];

  return (
    <div>
      <OpsPanel title="Marketplace scopes" subtitle="Control how broadly each artifact is distributed">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {scopes.map((scope) => {
            const s = scopeSummary.find((x) => x.scope === scope);
            const meta = scopeMeta(scope);
            return (
              <div key={scope} className="surface-raised rounded-2xl p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <Stat icon={SCOPE_ICON[scope]} label={`${meta.label} marketplace`} value={s?.artifacts ?? 0} tone={meta.tone} hint={`${s?.installs ?? 0} installs`} />
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-faint">{SCOPE_DESC[scope]}</p>
              </div>
            );
          })}
        </div>
      </OpsPanel>

      <OpsPanel title="Visibility & distribution" subtitle="Set the marketplace scope for each artifact">
        <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Artifact</th><th className="px-4 py-2.5 font-medium">Kind</th><th className="px-4 py-2.5 font-medium">Publisher</th><th className="px-4 py-2.5 font-medium">Current scope</th><th className="px-4 py-2.5 text-right font-medium">Set scope</th></tr>}>
          {artifacts.map((a) => {
            const meta = scopeMeta(a.scope);
            return (
              <tr key={a.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{exchangeKindLabel(a.kind)}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{a.publisherOrgName}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={meta.tone} label={meta.label} /></td>
                <td className="px-4 py-2.5 text-right">
                  <Select value={a.scope} onChange={(e) => void setScope(a.id, e.target.value as ExchangeScope)} className="!h-7 !py-0 ml-auto w-32 text-2xs">
                    {scopes.map((s) => <option key={s} value={s}>{scopeMeta(s).label}</option>)}
                  </Select>
                </td>
              </tr>
            );
          })}
        </OpsTable>
      </OpsPanel>
    </div>
  );
}
