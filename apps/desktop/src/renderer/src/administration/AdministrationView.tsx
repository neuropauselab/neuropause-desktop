/**
 * Enterprise Administration Platform v1.0 — the Enterprise Administration control center.
 *
 * The unified, READ-ONLY administrative lens: Organization, Identity & Access, Roles & Permissions, Security,
 * Compliance & Audit, AI Administration, Connectors, Licensing & Billing, and Enterprise Configuration. It is
 * a PRESENTATION LAYER — it composes EXISTING IPC (enterprise org/governance/audit, cloud identity SSO/SCIM/
 * MFA, devices, developer keys, connectors, workforce, memory, license/commercial) plus the renderer-static
 * capability registry. It creates no runtime, identity platform, RBAC system, governance engine, or store,
 * duplicates no admin system, and mutates nothing — every admin action is a deep-link to the EXISTING editor
 * (Organization, Enterprise → Customize, Cloud, Settings, Developer, Connectors, Commercial). Administrative
 * capabilities the platform lacks in-app are shown honestly, never fabricated.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  ApiKey,
  CloudMembership,
  CloudRegion,
  CommercialLicensing,
  CommercialMetering,
  ComplianceFinding,
  ComplianceReport,
  ConnectorDto,
  ConnectorStats,
  Device,
  EnterpriseAuditEntry,
  GovernanceConfig,
  IdentitySummary,
  MfaPolicy,
  Organization,
  OrgRole,
  OrgUnit,
  OrgUser,
  ReleaseDiagnostics,
  WorkerSummary,
} from '@neuropause/shared';
import type { SectionId } from '@renderer/shell/sections';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import {
  ADMIN_GAPS,
  adminGapKindMeta,
  deviceTrustTone,
  signingLabel,
  stateTone,
  summarizeCompliance,
  summarizeGovernance,
  summarizeRoles,
  summarizeUnits,
  unitKindLabelPlural,
  type AdminGapKind,
} from './adminModel';

type Tab =
  | 'overview' | 'organization' | 'identity' | 'roles' | 'security'
  | 'compliance' | 'ai' | 'connectors' | 'licensing' | 'config';

interface Data {
  org: { organization: Organization; units: OrgUnit[]; roles: OrgRole[]; users: OrgUser[] } | null;
  governance: GovernanceConfig | null;
  compliance: ComplianceFinding[];
  audit: EnterpriseAuditEntry[];
  members: CloudMembership[];
  identity: IdentitySummary | null;
  mfa: MfaPolicy | null;
  frameworks: ComplianceReport | null;
  regions: CloudRegion[];
  devices: Device[];
  apiKeys: ApiKey[];
  workers: WorkerSummary[];
  connectors: ConnectorStats | null;
  connectorList: ConnectorDto[];
  licensing: CommercialLicensing | null;
  metering: CommercialMetering | null;
  diag: ReleaseDiagnostics | null;
}

const EMPTY: Data = {
  org: null, governance: null, compliance: [], audit: [], members: [], identity: null, mfa: null,
  frameworks: null, regions: [], devices: [], apiKeys: [], workers: [], connectors: null, connectorList: [],
  licensing: null, metering: null, diag: null,
};

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function AdministrationView(): JSX.Element {
  const { setSection, openEnterprise } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Data>(EMPTY);

  const refresh = useCallback(async () => {
    // Resolve the cloud org id first (devices are org-scoped); everything else is org-resolved server-side.
    const orgs = await settled(ipc.org.list(), []);
    const orgId = orgs[0]?.orgId ?? null;

    const [
      org, governance, compliance, audit, members, identity, mfa, frameworks, regions, devices,
      apiKeys, workers, connectors, connectorList, licensing, metering, diag,
    ] = await Promise.all([
      settled(ipc.enterprise.org(), null),
      settled(ipc.enterprise.governanceConfig(), null),
      settled(ipc.enterprise.compliance(), [] as ComplianceFinding[]),
      settled(ipc.enterprise.audit(50), [] as EnterpriseAuditEntry[]),
      orgId ? settled(ipc.org.members(orgId), [] as CloudMembership[]) : Promise.resolve([] as CloudMembership[]),
      settled(ipc.cloud.identitySummary(), null),
      settled(ipc.cloud.mfa(), null),
      settled(ipc.cloud.adminCompliance(), null),
      settled(ipc.cloud.regions(), [] as CloudRegion[]),
      orgId ? settled(ipc.devices.list(orgId), [] as Device[]) : Promise.resolve([] as Device[]),
      settled(ipc.ecosystem.keys(), [] as ApiKey[]),
      settled(ipc.workforce.workers(), [] as WorkerSummary[]),
      settled(ipc.connectors.stats(), null),
      settled(ipc.connectors.list(), [] as ConnectorDto[]),
      settled(ipc.commercial.licensing(), null),
      settled(ipc.commercial.metering(), null),
      settled(ipc.releaseOps.diagnostics(), null),
    ]);
    setD({ org, governance, compliance, audit, members, identity, mfa, frameworks, regions, devices, apiKeys, workers, connectors, connectorList, licensing, metering, diag });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.commercial.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const go = { setSection, openEnterprise };

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'organization', label: 'Organization', icon: 'command' },
    { id: 'identity', label: 'Identity & Access', icon: 'user' },
    { id: 'roles', label: 'Roles & Permissions', icon: 'shield' },
    { id: 'security', label: 'Security', icon: 'lock' },
    { id: 'compliance', label: 'Compliance & Audit', icon: 'clipboard' },
    { id: 'ai', label: 'AI Administration', icon: 'sparkles' },
    { id: 'connectors', label: 'Connectors', icon: 'connectors' },
    { id: 'licensing', label: 'Licensing', icon: 'store' },
    { id: 'config', label: 'Configuration', icon: 'settings' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Enterprise Administration</h1>
            <p className="mt-0.5 text-sm text-faint">
              The unified admin control center — organization, identity, security, compliance, AI, connectors & licensing.
            </p>
          </div>
          {d.org && (
            <div className="text-right text-xs text-faint">
              <div className="font-medium text-muted">{d.org.organization.name}</div>
              <div>{d.org.users.length} people · {d.org.roles.length} roles</div>
            </div>
          )}
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'text-ink [border-bottom:2px_solid_var(--accent)]' : 'text-muted hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
        {!ready ? (
          <LoadingBlock label="Loading enterprise administration…" />
        ) : (
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'organization' && <OrganizationTab d={d} go={go} />}
            {tab === 'identity' && <IdentityTab d={d} go={go} />}
            {tab === 'roles' && <RolesTab d={d} go={go} />}
            {tab === 'security' && <SecurityTab d={d} go={go} />}
            {tab === 'compliance' && <ComplianceTab d={d} go={go} />}
            {tab === 'ai' && <AiTab d={d} go={go} />}
            {tab === 'connectors' && <ConnectorsTab d={d} go={go} />}
            {tab === 'licensing' && <LicensingTab d={d} go={go} />}
            {tab === 'config' && <ConfigTab d={d} go={go} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

interface Go {
  setSection: (id: SectionId) => void;
  openEnterprise: (tab?: string) => void;
}

function DeepLink({ label, onClick, icon = 'arrow-right' }: { label: string; onClick: () => void; icon?: IconName }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
    >
      {label}
      <Icon name={icon} size={13} />
    </button>
  );
}

function GapsPanel({ filter }: { filter?: (area: string) => boolean }): JSX.Element {
  const gaps = filter ? ADMIN_GAPS.filter((g) => filter(g.area)) : ADMIN_GAPS;
  if (gaps.length === 0) return <></>;
  return (
    <OpsPanel title="Administrative gaps (recorded honestly)" subtitle="Capabilities not surfaced as in-app admin — never fabricated">
      <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
        {gaps.map((g) => {
          const meta = adminGapKindMeta(g.kind as AdminGapKind);
          return (
            <div key={`${g.area}-${g.capability}`} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 shrink-0"><Icon name={meta.icon} size={14} className="text-faint" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{g.capability}</span>
                  <span className="text-2xs text-faint">· {g.area}</span>
                </div>
                <div className="mt-0.5 text-xs text-faint">{g.reason}</div>
              </div>
              <StatusBadge tone={meta.tone} label={meta.label} />
            </div>
          );
        })}
      </div>
    </OpsPanel>
  );
}

function ManagedRow({ label, value, source }: { label: string; value: string; source: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{label}</span>
          <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-faint">Managed</span>
        </div>
        <div className="mt-0.5 text-xs text-faint">{source}</div>
      </div>
      <span className="shrink-0 text-right text-sm text-muted">{value}</span>
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function OverviewTab({ d }: { d: Data }): JSX.Element {
  const units = summarizeUnits(d.org?.units ?? []);
  const roles = summarizeRoles(d.org?.roles ?? []);
  const compliance = summarizeCompliance(d.compliance);
  return (
    <>
      <OpsPanel title="Administration at a glance">
        <Grid cols={4}>
          <Stat icon="command" label="Organization" value={d.org?.organization.name ?? '—'} hint={`${units.total} org units`} />
          <Stat icon="user" label="People" value={d.org?.users.length ?? '—'} hint={`${d.members.length} cloud members`} />
          <Stat icon="shield" label="Roles" value={roles.total || '—'} hint={`${roles.builtIn} built-in · ${roles.custom} custom`} />
          <Stat icon="clipboard" label="Compliance" tone={compliance.tone} value={compliance.total ? `${compliance.pass}/${compliance.total}` : '—'} hint="checks passing" />
        </Grid>
        <div className="mt-3">
          <Grid cols={4}>
            <Stat icon="lock" label="SSO connections" value={d.identity?.connections ?? 0} hint={d.identity?.mfaRequired ? 'MFA required' : 'MFA optional'} />
            <Stat icon="connectors" label="Connectors" value={d.connectors?.total ?? '—'} hint={`${d.connectors?.connected ?? 0} connected`} />
            <Stat icon="sparkles" label="AI workers" value={d.workers.length || '—'} />
            <Stat icon="store" label="License" tone={stateTone(d.licensing?.licenseState)} value={d.licensing?.entitledPlan ?? '—'} hint={d.licensing ? `${d.licensing.seatsUsed}/${d.licensing.seatsTotal} seats` : undefined} />
          </Grid>
        </div>
      </OpsPanel>
      <GapsPanel />
    </>
  );
}

/* ── Organization ────────────────────────────────────────────────────────── */

function OrganizationTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const units = summarizeUnits(d.org?.units ?? []);
  const humans = d.org?.users.filter((u) => u.kind === 'human').length ?? 0;
  const aiUsers = (d.org?.users.length ?? 0) - humans;
  return (
    <>
      <OpsPanel
        title="Organization structure"
        subtitle="The Enterprise-OS org chart"
        actions={<DeepLink label="Edit in Enterprise" onClick={() => go.openEnterprise('customize')} />}
      >
        <Grid cols={4}>
          <Stat icon="layers" label={unitKindLabelPlural('business_unit')} value={units.businessUnits} />
          <Stat icon="grid" label={unitKindLabelPlural('department')} value={units.departments} />
          <Stat icon="user" label={unitKindLabelPlural('team')} value={units.teams} />
          <Stat icon="command" label="People" value={d.org?.users.length ?? 0} hint={`${humans} human · ${aiUsers} AI`} />
        </Grid>
      </OpsPanel>

      <OpsPanel title="Cloud members" subtitle="Multi-tenant membership" actions={<DeepLink label="Manage in Organization" onClick={() => go.setSection('organization')} />}>
        {d.members.length === 0 ? (
          <EmptyState icon="user" title="No cloud members" hint="Invite members from the Organization section." />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.members.slice(0, 8).map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.userEmail ?? m.invitedEmail ?? m.userId}</span>
                <span className="text-2xs text-faint">{m.role}</span>
                <StatusBadge tone={stateTone(m.status)} label={m.status} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </>
  );
}

/* ── Identity & Access ───────────────────────────────────────────────────── */

function IdentityTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const id = d.identity;
  return (
    <>
      <OpsPanel title="Identity providers (SSO / SCIM / MFA)" subtitle="Cloud identity posture" actions={<DeepLink label="Manage in Cloud" onClick={() => go.setSection('cloud')} />}>
        <Grid cols={4}>
          <Stat icon="lock" label="SSO connections" tone={id && id.active > 0 ? 'green' : 'gray'} value={id?.connections ?? 0} hint={`${id?.active ?? 0} active`} />
          <Stat icon="refresh" label="SCIM provisioning" tone={id?.scimEnabled ? 'green' : 'gray'} value={id?.scimEnabled ? 'On' : 'Off'} hint={id ? `${id.provisionedUsers} provisioned` : undefined} />
          <Stat icon="shield" label="MFA policy" tone={id?.mfaRequired ? 'green' : 'orange'} value={id?.mfaRequired ? 'Required' : 'Optional'} hint={d.mfa ? `${d.mfa.methods.join(', ') || 'no methods'}` : undefined} />
          <Stat icon="verified" label="Enforced" tone={id?.enforced ? 'green' : 'gray'} value={id?.enforced ? 'Yes' : 'No'} />
        </Grid>
        <p className="mt-3 text-xs text-faint">SSO/SCIM are real config surfaces; identity assertion is modeled (deterministic checks), not a live IdP round-trip.</p>
      </OpsPanel>

      <OpsPanel title="Trusted devices" subtitle="Registered devices for this organization" actions={<DeepLink label="Manage in Settings" onClick={() => go.setSection('settings')} />}>
        {d.devices.length === 0 ? (
          <EmptyState icon="workspace" title="No registered devices" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.devices.slice(0, 8).map((dev) => (
              <div key={dev.deviceId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{dev.name}</div>
                  <div className="text-2xs text-faint">{dev.platform} · {dev.os} · v{dev.appVersion}</div>
                </div>
                <StatusBadge tone={deviceTrustTone(dev.trustStatus)} label={dev.trustStatus} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <GapsPanel filter={(a) => a === 'Identity'} />
    </>
  );
}

/* ── Roles & Permissions ─────────────────────────────────────────────────── */

function RolesTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const roles = d.org?.roles ?? [];
  const summary = summarizeRoles(roles);
  const gov = summarizeGovernance(d.governance);
  return (
    <>
      <OpsPanel title="Roles" subtitle="Built-in roles are immutable; custom roles are editable" actions={<DeepLink label="Edit roles" onClick={() => go.openEnterprise('customize')} />}>
        <Grid cols={3}>
          <Stat icon="shield" label="Total roles" value={summary.total} />
          <Stat icon="lock" label="Built-in" value={summary.builtIn} hint="immutable permissions" />
          <Stat icon="plus" label="Custom" value={summary.custom} />
        </Grid>
        {roles.length > 0 && (
          <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{r.name}</div>
                  <div className="text-2xs text-faint">{r.permissions.length} permission scopes</div>
                </div>
                {r.builtIn && <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-faint">Built-in</span>}
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Governance policies" subtitle="Approval chains + compliance rules (enable/disable)" actions={<DeepLink label="Edit policies" onClick={() => go.openEnterprise('customize')} />}>
        <Grid cols={2}>
          <Stat icon="checklist" label="Approval chains" value={`${gov.chainsEnabled}/${gov.chains}`} hint="enabled" />
          <Stat icon="clipboard" label="Compliance rules" value={`${gov.rulesEnabled}/${gov.rules}`} hint="enabled" />
        </Grid>
      </OpsPanel>
    </>
  );
}

/* ── Security ────────────────────────────────────────────────────────────── */

function SecurityTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const activeKeys = d.apiKeys.filter((k) => !k.revokedAt).length;
  return (
    <>
      <OpsPanel title="API keys" subtitle="Developer platform keys (hashed, scoped, revocable)" actions={<DeepLink label="Manage in Developer" onClick={() => go.setSection('developer')} />}>
        <Grid cols={3}>
          <Stat icon="code" label="Active keys" value={activeKeys} hint={`${d.apiKeys.length} total`} />
          <Stat icon="shield" label="Code signing" tone={stateTone(d.diag?.signing.state)} value={d.diag ? signingLabel(d.diag.signing.state) : '—'} />
          <Stat icon="lock" label="Secrets" tone="gray" value="Vaulted" hint="internal, never exposed to IPC" />
        </Grid>
        {activeKeys > 0 && (
          <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.apiKeys.filter((k) => !k.revokedAt).slice(0, 6).map((k) => (
              <div key={k.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{k.name}</div>
                  <div className="text-2xs text-faint">{k.prefix}…{k.last4} · {k.scopes.length} scopes</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
      <GapsPanel filter={(a) => a === 'Security'} />
    </>
  );
}

/* ── Compliance & Audit ──────────────────────────────────────────────────── */

function ComplianceTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const compliance = summarizeCompliance(d.compliance);
  return (
    <>
      {d.frameworks && (
        <OpsPanel title="Compliance frameworks" subtitle="SOC 2 / GDPR / ISO — computed scorecard" actions={<DeepLink label="Cloud admin" onClick={() => go.setSection('cloud')} />}>
          <div className="mb-3">
            <Meter value={Math.max(0, Math.min(100, d.frameworks.score)) / 100} tone="accent" label="Compliance score" trailing={`${Math.round(d.frameworks.score)}%`} />
          </div>
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.frameworks.controls.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{c.control}</div>
                  <div className="text-2xs text-faint">{c.framework}</div>
                </div>
                <StatusBadge tone={stateTone(c.status)} label={c.status} />
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      <OpsPanel title="Internal compliance findings" subtitle="Deterministic checks over live org + workforce state" actions={<DeepLink label="Enterprise" onClick={() => go.setSection('enterprise')} />}>
        <Grid cols={4}>
          <Stat icon="clipboard" label="Checks" value={compliance.total || '—'} tone={compliance.tone} />
          <Stat icon="check" label="Pass" tone="green" value={compliance.pass} />
          <Stat icon="info" label="Warn" tone={compliance.warn > 0 ? 'orange' : 'gray'} value={compliance.warn} />
          <Stat icon="info" label="Fail" tone={compliance.fail > 0 ? 'red' : 'gray'} value={compliance.fail} />
        </Grid>
      </OpsPanel>

      <OpsPanel title={`Audit trail (${d.audit.length} recent)`} subtitle="Append-only governance audit (newest first)">
        {d.audit.length === 0 ? (
          <EmptyState icon="clipboard" title="No audit entries yet" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.audit.slice(0, 10).map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{a.summary}</div>
                  <div className="text-2xs text-faint">{a.actor} · {a.action}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <GapsPanel filter={(a) => a === 'Compliance'} />
    </>
  );
}

/* ── AI Administration ───────────────────────────────────────────────────── */

function AiTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const healthy = d.workers.filter((w) => stateTone(w.healthState) === 'green').length;
  return (
    <>
      <OpsPanel title="AI workforce" subtitle="The managed digital-worker roster" actions={<DeepLink label="AI Workforce" onClick={() => go.setSection('workforce')} />}>
        <Grid cols={3}>
          <Stat icon="sparkles" label="Workers" value={d.workers.length || '—'} hint={`${d.workers.filter((w) => w.builtIn).length} built-in`} />
          <Stat icon="pulse" label="Healthy" tone={d.workers.length === 0 ? 'gray' : healthy === d.workers.length ? 'green' : 'orange'} value={healthy} />
          <Stat icon="memory" label="Memory" value="Managed" hint="review / forget" />
        </Grid>
      </OpsPanel>
      <OpsPanel title="AI governance & providers">
        <div className="surface-raised rounded-2xl px-4 shadow-card">
          <ManagedRow label="AI provider & model" value="Deployment-managed" source="Provider, model routing and token limits are set by the environment/platform runtime." />
          <div className="h-px [background:var(--hairline)]" />
          <ManagedRow label="Automatic execution" value="Governance-controlled" source="Auto-execution is derived from governance approval policies (edit in Enterprise)." />
          <div className="h-px [background:var(--hairline)]" />
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-muted">Approvals & policies</span>
            <DeepLink label="Edit governance" onClick={() => go.openEnterprise('customize')} />
          </div>
        </div>
      </OpsPanel>
      <GapsPanel filter={(a) => a === 'AI'} />
    </>
  );
}

/* ── Connectors ──────────────────────────────────────────────────────────── */

function ConnectorsTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const production = d.connectorList.filter((c) => c.lifecycle === 'production').length;
  const preview = d.connectorList.filter((c) => c.lifecycle === 'preview').length;
  return (
    <OpsPanel title="Connector administration" subtitle="The connector registry — OAuth, health & sync" actions={<DeepLink label="Manage connectors" onClick={() => go.setSection('connectors')} />}>
      <Grid cols={4}>
        <Stat icon="connectors" label="Connectors" value={d.connectors?.total ?? d.connectorList.length ?? '—'} />
        <Stat icon="check" label="Production" tone="green" value={production} hint="real adapters" />
        <Stat icon="info" label="Preview" tone="orange" value={preview} hint="no data adapter" />
        <Stat icon="refresh" label="Connected" value={d.connectors?.connected ?? 0} hint={d.connectors ? `${d.connectors.accounts} accounts` : undefined} />
      </Grid>
      <p className="mt-3 text-xs text-faint">Connector client credentials are environment-provisioned; OAuth tokens are vaulted (never exposed to the renderer).</p>
    </OpsPanel>
  );
}

/* ── Licensing & Billing ─────────────────────────────────────────────────── */

function LicensingTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const l = d.licensing;
  return (
    <>
      <OpsPanel title="Licensing & seats" subtitle="Entitlements + seat utilization" actions={<DeepLink label="Commercial Center" onClick={() => go.setSection('commercial-center')} />}>
        {l ? (
          <Grid cols={4}>
            <Stat icon="store" label="Plan" tone={stateTone(l.licenseState)} value={l.entitledPlan} hint={l.licenseState} />
            <Stat icon="user" label="Seats used" value={`${l.seatsUsed}/${l.seatsTotal}`} hint={`${l.seatsAvailable} available`} />
            <Stat icon="gauge" label="Utilization" value={`${Math.round(l.seatUtilizationPct)}%`} />
            <Stat icon="verified" label="Active licenses" value={l.activeLicenses} />
          </Grid>
        ) : (
          <EmptyState icon="store" title="Licensing data unavailable" />
        )}
      </OpsPanel>
      <OpsPanel title="Usage" subtitle="Metering (zero by default until real traffic)">
        <Grid cols={2}>
          <Stat icon="pulse" label="Requests (30d)" value={d.metering?.requests30d ?? 0} />
          <Stat icon="sparkles" label="AI cost (USD)" value={d.metering ? `$${(d.metering.aiCostUsd ?? 0).toFixed(2)}` : '$0.00'} />
        </Grid>
      </OpsPanel>
      <GapsPanel filter={(a) => a === 'Licensing'} />
    </>
  );
}

/* ── Configuration ───────────────────────────────────────────────────────── */

function ConfigTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  return (
    <>
      <OpsPanel title="Enterprise configuration" subtitle="Domains, regions & deployment" actions={<DeepLink label="Cloud" onClick={() => go.setSection('cloud')} />}>
        <Grid cols={3}>
          <Stat icon="globe" label="Regions" value={d.regions.length || '—'} hint={`${d.regions.filter((r) => r.available).length} available`} />
          <Stat icon="lock" label="SSO domains" value={d.identity?.connections ?? 0} hint="via SSO connections" />
          <Stat icon="gauge" label="Deployment" value="Cloud + Desktop" hint="see Release Ops" />
        </Grid>
        <div className="mt-3">
          <DeepLink label="Deployment in Release Ops" onClick={() => go.setSection('product-ops')} />
        </div>
      </OpsPanel>
      <GapsPanel filter={(a) => a === 'Configuration'} />
    </>
  );
}
