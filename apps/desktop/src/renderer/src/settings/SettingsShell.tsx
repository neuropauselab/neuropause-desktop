/**
 * Constitutional Settings v1.0 — the two-pane Settings shell (the constitutional control layer).
 *
 * Settings owns NO business logic. Every control here reads/writes a REAL existing production system (its
 * mutator already propagates + audits) or a real local preference; read-but-not-settable values are shown as
 * Managed (read-only, with source); capabilities with no real backing are hidden and listed only in the
 * Capabilities inventory. A left domain rail + global natural-language search route to real production pages.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@neuropause/shared';
import type { SectionId } from '@renderer/shell/sections';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { Avatar, Toggle } from '@renderer/components/ui/controls';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { AiSettingsPanel } from './AiSettingsPanel';
import { AiRoutingPanel } from './AiRoutingPanel';
import { initials } from '@renderer/lib/format';
import { useTheme } from '@renderer/providers/ThemeProvider';
import { useScale } from '@renderer/state/ScaleProvider';
import { useAuth } from '@renderer/providers/AuthProvider';
import { useIsLocalMode } from '@renderer/shell/useIsLocalMode';
import type { ThemeSource } from '@neuropause/shared';
import { SubscriptionCenter } from '@renderer/subscription/SubscriptionCenter';
import { TrustedDevices } from '@renderer/devices/TrustedDevices';
import { CompanionSettings } from '@renderer/settings/CompanionSettings';
import { EnterpriseOverview } from '@renderer/enterprise/EnterpriseOverview';
import { FeatureFlagsCenter } from '@renderer/settings/FeatureFlagsCenter';
import { ReleaseChannelCard } from '@renderer/settings/ReleaseChannelCard';
import { StartupExperienceCard } from '@renderer/settings/StartupExperienceCard';
import { TenantMembershipPanel } from '@renderer/settings/TenantMembershipPanel';
import {
  CAPABILITY_INVENTORY,
  computeReadiness,
  searchSettings,
  SETTINGS_DOMAINS,
  type SettingsDomainId,
} from '@renderer/settings/settingsCatalog';
import { computeMaturity, CAPABILITY_REGISTRY } from '@renderer/capability/capabilityRegistry';

const THEME_OPTIONS: SegmentedTabItem<ThemeSource>[] = [
  { id: 'system', label: 'Auto', icon: 'auto' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

/* ── primitives ── */

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mb-7">
      <div className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-faint">
        {title}
      </div>
      {children}
    </section>
  );
}

function StateBadge(): JSX.Element {
  return (
    <span
      className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-faint"
      title="Managed elsewhere — read-only here"
    >
      Managed
    </span>
  );
}

function Row({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-base font-medium">{label}</div>
        {description && <div className="mt-0.5 text-sm text-faint">{description}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ManagedRow({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium">{label}</span>
          <StateBadge />
        </div>
        <div className="mt-0.5 text-sm text-faint">{source}</div>
      </div>
      <div className="shrink-0 text-right text-sm text-muted">{value}</div>
    </div>
  );
}

function OpenRow({
  label,
  description,
  onOpen,
}: {
  label: string;
  description: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-base font-medium">{label}</div>
        <div className="mt-0.5 text-sm text-faint">{description}</div>
      </div>
      <Button size="sm" variant="ghost" icon="arrow-right" onClick={onOpen}>
        Open
      </Button>
    </div>
  );
}

function Divider(): JSX.Element {
  return <div className="h-px [background:var(--hairline)]" />;
}

/** Crash-report consent — a REAL opt-in toggle over the existing release-ops IPC. (Phase 8: relabeled — there is no usage telemetry in this product; this toggle governs crash records only.) */
function CrashConsentRow(): JSX.Element {
  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void ipc.releaseOps
      .crashStatus()
      .then((s) => {
        if (active) setOptedIn(Boolean(s.optedIn));
      })
      .catch(() => {
        if (active) setOptedIn(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setOptedIn(next);
    try {
      const s = await ipc.releaseOps.setCrashOptIn(next);
      setOptedIn(Boolean(s.optedIn));
    } catch {
      setOptedIn(!next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="Share crash reports & diagnostics"
      description="Send redacted crash and diagnostic data to help improve NeuroPause. Personal content is never included."
      control={
        <Toggle
          checked={optedIn ?? false}
          onChange={(v) => void toggle(v)}
          disabled={optedIn === null || busy}
          label="Share crash reports"
        />
      }
    />
  );
}

/* ── the shell ── */

export function SettingsShell({
  session,
  onOpenSection,
}: {
  session: Session;
  onOpenSection?: (id: SectionId) => void;
}): JSX.Element {
  const [domain, setDomain] = useState<SettingsDomainId>('identity');
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSettings(query), [query]);
  const go = (id?: SectionId): void => {
    if (id) onOpenSection?.(id);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left domain rail */}
      <nav className="w-[232px] shrink-0 overflow-y-auto border-r border-[var(--hairline)] p-3">
        <div className="relative mb-3">
          <Icon
            name="command"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="w-full rounded-xl border border-[var(--hairline)] bg-white/[0.03] py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
          />
          {query && results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--bg,#0a0a0f)] shadow-pop">
              {results.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => {
                    setDomain(r.domain);
                    setQuery('');
                    if (r.targetSection) go(r.targetSection);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.05]"
                >
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="text-2xs text-faint">
                    {SETTINGS_DOMAINS.find((d) => d.id === r.domain)?.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          {query && results.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-xl border border-[var(--hairline)] bg-[var(--bg,#0a0a0f)] px-3 py-2 text-sm text-faint shadow-pop">
              No settings match “{query}”.
            </div>
          )}
        </div>
        {SETTINGS_DOMAINS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDomain(d.id)}
            className={cn(
              'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
              domain === d.id ? 'bg-white/[0.08] text-ink' : 'text-muted hover:bg-white/[0.03]',
            )}
          >
            <Icon name={d.icon} size={15} />
            <span className="truncate">{d.label}</span>
          </button>
        ))}
      </nav>

      {/* Content pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto px-8 py-8" style={{ maxWidth: 760 }}>
          <DomainContent domain={domain} session={session} go={go} />
        </div>
      </div>
    </div>
  );
}

function DomainHeader({ id }: { id: SettingsDomainId }): JSX.Element {
  const d = SETTINGS_DOMAINS.find((x) => x.id === id)!;
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{d.label}</h1>
      <p className="mt-0.5 text-sm text-faint">{d.summary}</p>
    </div>
  );
}

function DomainContent({
  domain,
  session,
  go,
}: {
  domain: SettingsDomainId;
  session: Session;
  go: (id?: SectionId) => void;
}): JSX.Element {
  const { source, setSource } = useTheme();
  const { scale, setScale, reset, min, max } = useScale();
  const { logout } = useAuth();
  const localMode = useIsLocalMode();
  const { user } = session;
  const name = user.displayName ?? user.email.split('@')[0];

  switch (domain) {
    case 'identity':
      return (
        <>
          <DomainHeader id="identity" />
          <Group title="Account">
            <Card>
              <div className="flex items-center gap-3.5">
                <Avatar text={initials(name)} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold">{name}</div>
                  <div className="truncate text-sm text-muted">{user.email}</div>
                </div>
                <StateBadge />
              </div>
              <p className="mt-3 text-xs text-faint">
                {localMode
                  ? // NP-008 census F-N8-6: a device-local principal has NO identity provider —
                    // the old copy claimed one. State the S17 truth instead.
                    'This is a device-local identity — it exists only on this device, and no identity provider manages it. Connect an account to sync.'
                  : 'Your name and email come from your authenticated account and are managed at your identity provider.'}
              </p>
            </Card>
          </Group>
          <Group title="Access">
            <Card className="py-1.5">
              <OpenRow
                label="Organizations & membership"
                description="Organizations you belong to, members, and invitations."
                onOpen={() => go('organization')}
              />
              <Divider />
              <OpenRow
                label="Roles & permissions"
                description="Define roles and permissions (RBAC) for your organization."
                onOpen={() => go('enterprise')}
              />
              <Divider />
              <OpenRow
                label="Connected accounts"
                description="Link Google, Microsoft, GitHub, Slack and more via OAuth."
                onOpen={() => go('connectors')}
              />
            </Card>
          </Group>
        </>
      );

    case 'security':
      return (
        <>
          <DomainHeader id="security" />
          <Group title="Authentication">
            <Card className="py-1.5">
              <ManagedRow
                label="Two-factor (MFA) policy"
                value="Organization policy"
                source="Set organization-wide by your admin, not per-person."
              />
              <Divider />
              <OpenRow
                label="Recovery & safe mode"
                description="Repair the app, restore a backup, or enter safe mode."
                onOpen={() => go('operations')}
              />
            </Card>
          </Group>
          <Group title="Trusted devices">
            <TrustedDevices />
          </Group>
          <Group title="Session">
            <Card className="py-1.5">
              <Row
                label="Sign out"
                description="Sign out of NeuroPause on this device."
                control={
                  <Button variant="danger" icon="logout" onClick={() => void logout()}>
                    Sign out
                  </Button>
                }
              />
            </Card>
          </Group>
        </>
      );

    case 'governance':
      return (
        <>
          <DomainHeader id="governance" />
          <Group title="Policy">
            <Card className="py-1.5">
              <OpenRow
                label="Approval policies"
                description="Enable or disable approval chains and compliance rules."
                onOpen={() => go('enterprise')}
              />
              <Divider />
              <OpenRow
                label="Federation policies"
                description="Cross-organization governance policies and delegated approvals."
                onOpen={() => go('federation')}
              />
              <Divider />
              <ManagedRow
                label="Compliance & audit"
                value="Read-only"
                source="Computed compliance scorecard and append-only audit trail."
              />
            </Card>
          </Group>
          <Group title="Feature flags">
            <FeatureFlagsCenter />
          </Group>
        </>
      );

    case 'privacy':
      return (
        <>
          <DomainHeader id="privacy" />
          <Group title="Crash reports">
            <Card className="py-1.5">
              <CrashConsentRow />
            </Card>
          </Group>
          <Group title="Your data">
            <Card className="py-1.5">
              <OpenRow
                label="Memory data"
                description="Review and forget what NeuroPause remembers."
                onOpen={() => go('memory')}
              />
              <Divider />
              <OpenRow
                label="Data sharing"
                description="Cross-organization resource sharing policies."
                onOpen={() => go('federation')}
              />
              <Divider />
              <ManagedRow
                label="Data residency"
                value="Set at provisioning"
                source="Region and residency are fixed when your tenant is created."
              />
            </Card>
          </Group>
        </>
      );

    case 'ai':
      return (
        <>
          <DomainHeader id="ai" />
          <Group title="Private First routing">
            <Card className="py-2.5">
              <AiRoutingPanel />
            </Card>
          </Group>
          <Group title="Model & provider">
            <Card className="py-1.5">
              <AiSettingsPanel />
              <Divider />
              <ManagedRow
                label="Automatic execution"
                value="Governance-controlled"
                source="Auto-execution is derived from governance approval policies."
              />
            </Card>
          </Group>
          <Group title="Execution policy">
            <Card className="py-1.5">
              <OpenRow
                label="Autonomous operations"
                description="Review the execution and approval policy that governs AI actions."
                onOpen={() => go('auto-ops-center')}
              />
            </Card>
          </Group>
        </>
      );

    case 'workspace':
      return (
        <>
          <DomainHeader id="workspace" />
          <Group title="Appearance">
            <Card className="py-1.5">
              <Row
                label="Theme"
                description="Auto follows your system appearance."
                control={
                  <SegmentedTabs
                    items={THEME_OPTIONS}
                    activeId={source === 'light' ? 'system' : source}
                    onChange={(v) => void setSource(v)}
                    ariaLabel="Theme"
                  />
                }
              />
              <Divider />
              <Row
                label="Interface scale"
                description="Scales the whole interface (also ⌘+ / ⌘− / ⌘0)."
                control={
                  <div className="flex items-center gap-3">
                    {scale !== 100 && (
                      <Button size="sm" variant="ghost" onClick={reset}>
                        Reset
                      </Button>
                    )}
                    <div className="flex w-[200px] items-center gap-3">
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={5}
                        value={scale}
                        onChange={(e) => setScale(Number(e.target.value))}
                        aria-label="Interface scale"
                        className="h-1.5 flex-1 cursor-pointer"
                        style={{ accentColor: 'rgb(var(--accent-ch))' }}
                      />
                      <span className="tabular w-10 text-right text-sm font-medium">{scale}%</span>
                    </div>
                  </div>
                }
              />
            </Card>
          </Group>
          <Group title="Startup experience">
            <StartupExperienceCard />
          </Group>
        </>
      );

    case 'organization':
      return (
        <>
          <DomainHeader id="organization" />
          {/* P13C Part 3 — the tenancy boundary, stated first. Which
              organization you are in decides what every other row on this page
              is describing, so it belongs above them rather than after. */}
          <Group title="Membership">
            <TenantMembershipPanel />
          </Group>
          <Group title="Structure">
            <Card className="py-1.5">
              <OpenRow
                label="Departments, teams & people"
                description="Manage your organization structure and members."
                onOpen={() => go('enterprise')}
              />
              <Divider />
              <ManagedRow
                label="Digital workers"
                value="Read-only roster"
                source="The AI worker registry; manage lifecycle in the Workforce center."
              />
              <Divider />
              <OpenRow
                label="Digital workforce"
                description="Install, enable, and govern AI workers."
                onOpen={() => go('workforce')}
              />
            </Card>
          </Group>
          <Group title="Overview">
            <EnterpriseOverview />
          </Group>
        </>
      );

    case 'integrations':
      return (
        <>
          <DomainHeader id="integrations" />
          <Group title="Connectors">
            <Card className="py-1.5">
              <OpenRow
                label="Connectors"
                description="Connect and sync GitHub, Slack, Notion, Google, Microsoft, Salesforce and more."
                onOpen={() => go('connectors')}
              />
              <Divider />
              <OpenRow
                label="Webhooks"
                description="Outbound event webhooks and delivery status."
                onOpen={() => go('developer')}
              />
            </Card>
          </Group>
        </>
      );

    case 'developer':
      return (
        <>
          <DomainHeader id="developer" />
          <Group title="Developer platform">
            <Card className="py-1.5">
              <OpenRow
                label="API keys & OAuth apps"
                description="Create and revoke API keys and OAuth applications."
                onOpen={() => go('developer')}
              />
              <Divider />
              <OpenRow
                label="Plugins & extensions"
                description="Install, enable, and manage plugins."
                onOpen={() => go('developer')}
              />
              <Divider />
              <OpenRow
                label="Sandbox"
                description="Test and validate in an isolated sandbox."
                onOpen={() => go('sandbox')}
              />
            </Card>
          </Group>
        </>
      );

    case 'billing':
      return (
        <>
          <DomainHeader id="billing" />
          <Group title="Subscription">
            <SubscriptionCenter />
          </Group>
          <Group title="Usage">
            <Card className="py-1.5">
              <OpenRow
                label="Usage & invoices"
                description="Metering, usage, and invoices."
                onOpen={() => go('commercial-center')}
              />
            </Card>
          </Group>
        </>
      );

    case 'system':
      return (
        <>
          <DomainHeader id="system" />
          <Group title="Updates">
            <ReleaseChannelCard />
          </Group>
          <Group title="Reliability">
            <Card className="py-1.5">
              <OpenRow
                label="Backup & recovery"
                description="Create backups, restore, and enter safe mode."
                onOpen={() => go('operations')}
              />
              <Divider />
              <ManagedRow
                label="Runtime health"
                value="Read-only"
                source="Live runtime health and diagnostics telemetry."
              />
              <Divider />
              <OpenRow
                label="Diagnostics & health"
                description="Runtime health, diagnostics, and sync status."
                onOpen={() => go('opscenter')}
              />
            </Card>
          </Group>
          <Group title="Devices">
            <TrustedDevices />
          </Group>
        </>
      );

    case 'business':
      return <BusinessSettings go={go} />;

    case 'companion':
      return (
        <>
          <DomainHeader id="companion" />
          <CompanionSettings />
        </>
      );

    case 'capabilities':
      return <CapabilitiesInventory />;

    default:
      return <DomainHeader id={domain} />;
  }
}

/** Business domain — the honest inventory of business areas: live areas (read-only here) + planned areas. */
function BusinessSettings({ go }: { go: (id?: SectionId) => void }): JSX.Element {
  const rows = CAPABILITY_REGISTRY.filter((c) => c.domain === 'business');
  const live = rows.filter((c) => c.state === 'production-complete');
  const planned = rows.filter((c) => c.state !== 'production-complete');
  return (
    <>
      <DomainHeader id="business" />
      <Group title="Business workspace">
        <Card className="py-1.5">
          <OpenRow
            label="Open Business workspace"
            description="Finance, sales, CRM, procurement, inventory and operations — grouped by area."
            onOpen={() => go('business')}
          />
        </Card>
      </Group>
      <Group title={`Live areas (${live.length})`}>
        <Card className="py-1.5">
          {live.map((c, i) => (
            <div key={c.id}>
              {i > 0 && <Divider />}
              <div className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="text-base font-medium">{c.label}</div>
                  <div className="mt-0.5 text-sm text-faint">
                    Real records on the enterprise module framework — RBAC-gated ({c.permission}),
                    audited, searchable.
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-faint"
                  title="Production-complete"
                >
                  Production
                </span>
              </div>
            </div>
          ))}
        </Card>
      </Group>
      {planned.length > 0 && (
        <Group title="Planned areas (not yet built)">
          <Card className="py-1.5">
            {planned.map((c, i) => (
              <div key={c.id}>
                {i > 0 && <Divider />}
                <div className="py-3">
                  <div className="flex items-center gap-2">
                    <Icon name="lock" size={13} className="text-faint" />
                    <span className="text-base font-medium">{c.label}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-faint">{c.note}</div>
                </div>
              </div>
            ))}
          </Card>
        </Group>
      )}
    </>
  );
}

/** The honesty ledger — what is available, managed, or not yet built. */
function CapabilitiesInventory(): JSX.Element {
  const readiness = computeReadiness();
  const maturity = computeMaturity();
  const managed = CAPABILITY_INVENTORY.filter((c) => c.state === 'managed');
  const unavailable = CAPABILITY_INVENTORY.filter((c) => c.state === 'unavailable');
  const domainLabel = (id: SettingsDomainId): string =>
    SETTINGS_DOMAINS.find((d) => d.id === id)?.label ?? id;

  return (
    <>
      <DomainHeader id="capabilities" />
      <Card className="mb-7">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-3xl font-semibold tracking-tight text-accent">
              {readiness.realPct}%
            </div>
            <div className="text-sm text-faint">
              of surveyed capabilities are real (editable or managed)
            </div>
          </div>
          <div className="text-right text-sm text-muted">
            <div>{readiness.editable} editable</div>
            <div>{readiness.managed} managed</div>
            <div>{readiness.unavailable} not yet built</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hairline)] pt-3 text-2xs text-faint">
          <span>
            Capability registry: <span className="font-medium text-muted">{maturity.total}</span>{' '}
            capabilities
          </span>
          <span className="text-[color:var(--good,#22c55e)]">
            {maturity.productionComplete} production-complete
          </span>
          <span className="text-[color:var(--accent,#6366f1)]">{maturity.managed} managed</span>
          <span>{maturity.hidden} not yet surfaced</span>
          <span className="ml-auto">
            Platform maturity{' '}
            <span className="font-medium text-muted">{maturity.maturityPct}%</span>
          </span>
        </div>
        <p className="mt-3 text-xs text-faint">
          NeuroPause hides what it cannot really do. This page is the honest ledger, derived from
          the single-source-of-truth capability registry — nothing here is a fake control.
        </p>
      </Card>

      <Group title="Managed elsewhere (real, read-only here)">
        <Card className="py-1.5">
          {managed.map((c, i) => (
            <div key={c.capability}>
              {i > 0 && <Divider />}
              <div className="py-3">
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium">{c.capability}</span>
                  <span className="text-2xs text-faint">· {domainLabel(c.domain)}</span>
                </div>
                <div className="mt-0.5 text-sm text-faint">{c.reason}</div>
              </div>
            </div>
          ))}
        </Card>
      </Group>

      <Group title="Not yet built (hidden, listed honestly)">
        <Card className="py-1.5">
          {unavailable.map((c, i) => (
            <div key={c.capability}>
              {i > 0 && <Divider />}
              <div className="py-3">
                <div className="flex items-center gap-2">
                  <Icon name="lock" size={13} className="text-faint" />
                  <span className="text-base font-medium">{c.capability}</span>
                  <span className="text-2xs text-faint">· {domainLabel(c.domain)}</span>
                </div>
                <div className="mt-0.5 text-sm text-faint">{c.reason}</div>
              </div>
            </div>
          ))}
        </Card>
      </Group>
    </>
  );
}
