/**
 * Enterprise Collaboration Workspace v1.0 — the collaboration control surface.
 *
 * A REUSE-ONLY, mostly READ-ONLY lens: an Overview + four real tabs — Approvals (cross-org delegated
 * approvals + governance approval chains + the executive approvals snapshot), Workspaces & Teams (the
 * workspace directory + cloud teams), Activity (the system audit/activity feed), and My Items (the
 * per-user favorites / recents / saved views). It is a PRESENTATION LAYER — it composes EXISTING IPC
 * (federation, enterprise, cloud, personalization) and mutates nothing: approvals are shown read-only and
 * every action is a deep-link into the EXISTING editor (Federation, Enterprise, AI Workforce, Organization,
 * Cloud, Operations). This is NOT a messaging platform; the social-collaboration features it lacks are
 * shown honestly as gap rows (see COLLABORATION_GAPS) and never fabricated.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  CloudTeam,
  DelegatedApproval,
  EnterpriseAuditEntry,
  ExecutiveSnapshot,
  GovernanceConfig,
  PersonalizationState,
  WorkspaceSummary,
} from '@neuropause/shared';
import type { SectionId } from '@renderer/shell/sections';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import {
  COLLABORATION_GAPS,
  approvalStatusTone,
  collaborationGapKindMeta,
  collaborationStateTone,
  summarizeApprovals,
  summarizeMyItems,
  summarizeWorkspaces,
  timeAgo,
} from './collaborationModel';

type Tab = 'overview' | 'approvals' | 'workspaces' | 'activity' | 'items';

interface Data {
  approvals: DelegatedApproval[];
  governance: GovernanceConfig | null;
  dashboard: ExecutiveSnapshot | null;
  workspaces: WorkspaceSummary[];
  teams: CloudTeam[];
  audit: EnterpriseAuditEntry[];
  personalization: PersonalizationState | null;
}

const EMPTY: Data = {
  approvals: [], governance: null, dashboard: null, workspaces: [], teams: [], audit: [], personalization: null,
};

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function CollaborationView(): JSX.Element {
  const { setSection } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [d, setD] = useState<Data>(EMPTY);

  const refresh = useCallback(async () => {
    const [approvals, governance, dashboard, workspaces, teams, audit, personalization] = await Promise.all([
      settled(ipc.federation.approvals(), [] as DelegatedApproval[]),
      settled(ipc.enterprise.governanceConfig(), null),
      settled(ipc.enterprise.dashboard(), null),
      settled(ipc.enterprise.workspaces(), [] as WorkspaceSummary[]),
      settled(ipc.cloud.teams(), [] as CloudTeam[]),
      settled(ipc.enterprise.audit(50), [] as EnterpriseAuditEntry[]),
      settled(ipc.enterprise.personalization.get(), null),
    ]);
    setD({ approvals, governance, dashboard, workspaces, teams, audit, personalization });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const go: Go = { setSection };

  const dir = summarizeWorkspaces(d.workspaces, d.teams);

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'approvals', label: 'Approvals', icon: 'checklist' },
    { id: 'workspaces', label: 'Workspaces & Teams', icon: 'grid' },
    { id: 'activity', label: 'Activity', icon: 'activity' },
    { id: 'items', label: 'My Items', icon: 'star' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Enterprise Collaboration</h1>
            <p className="mt-0.5 text-sm text-faint">
              Approvals, workspaces & teams, the system activity feed, and your personal items — composed from existing services.
            </p>
          </div>
          <div className="text-right text-xs text-faint">
            <div className="font-medium text-muted">{dir.workspaces} workspaces · {dir.teams} teams</div>
            <div>{d.workspaces.length ? `${dir.activeWorkspaces} active` : 'directory'}</div>
          </div>
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
          <LoadingBlock label="Loading collaboration workspace…" />
        ) : (
          <div className="mx-auto" style={{ maxWidth: 1120 }}>
            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'approvals' && <ApprovalsTab d={d} go={go} />}
            {tab === 'workspaces' && <WorkspacesTab d={d} go={go} />}
            {tab === 'activity' && <ActivityTab d={d} go={go} />}
            {tab === 'items' && <MyItemsTab d={d} go={go} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

interface Go {
  setSection: (id: SectionId) => void;
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

function GapsPanel(): JSX.Element {
  return (
    <OpsPanel title="Collaboration gaps (recorded honestly)" subtitle="Social-collaboration capabilities the platform does not have in-app — never fabricated">
      <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
        {COLLABORATION_GAPS.map((g) => {
          const meta = collaborationGapKindMeta(g.kind);
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

/** The three real approval sources folded into one summary (delegated + governance + executive snapshot). */
function approvalSummaryOf(d: Data): ReturnType<typeof summarizeApprovals> {
  const delegatedPending = d.approvals.filter((a) => a.status === 'pending').length;
  const enabledChains = d.governance?.approvalChains.filter((c) => c.enabled).length ?? 0;
  const a = d.dashboard?.approvals;
  return summarizeApprovals({
    delegatedPending,
    enabledChains,
    jobPending: a?.pending ?? 0,
    approvedRecently: a?.approvedRecently ?? 0,
    rejectedRecently: a?.rejectedRecently ?? 0,
    oldestPendingAgeMs: a?.oldestPendingAgeMs ?? null,
  });
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function OverviewTab({ d }: { d: Data }): JSX.Element {
  const approvals = approvalSummaryOf(d);
  const dir = summarizeWorkspaces(d.workspaces, d.teams);
  const items = summarizeMyItems(d.personalization);
  return (
    <>
      <OpsPanel title="Collaboration at a glance">
        <Grid cols={4}>
          <Stat icon="checklist" label="Pending approvals" tone={approvals.tone} value={approvals.totalPending} hint={`${approvals.delegatedPending} delegated · ${approvals.jobPending} jobs`} />
          <Stat icon="grid" label="Workspaces" value={dir.workspaces || '—'} hint={`${dir.activeWorkspaces} active · ${dir.workspaceUsers} people`} />
          <Stat icon="user" label="Teams" value={dir.teams || '—'} hint={`${dir.teamMembers} members`} />
          <Stat icon="activity" label="Recent activity" value={d.audit.length || '—'} hint="audit events" />
        </Grid>
        <div className="mt-3">
          <Grid cols={4}>
            <Stat icon="shield" label="Approval chains" value={approvals.enabledChains} hint="enabled in governance" />
            <Stat icon="star" label="Favorites" value={items.favorites} />
            <Stat icon="clock" label="Recents" value={items.recents} />
            <Stat icon="eye" label="Saved views" value={items.savedViews} />
          </Grid>
        </div>
      </OpsPanel>
      <GapsPanel />
    </>
  );
}

/* ── Approvals ───────────────────────────────────────────────────────────── */

function ApprovalsTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const summary = approvalSummaryOf(d);
  const pending = d.approvals.filter((a) => a.status === 'pending');
  const clearedRatio = summary.approvedRecently + summary.totalPending > 0
    ? summary.approvedRecently / (summary.approvedRecently + summary.totalPending)
    : 0;
  return (
    <>
      <OpsPanel title="Approvals at a glance" subtitle="Read-only — resolve in the owning surface">
        <Grid cols={4}>
          <Stat icon="checklist" label="Pending" tone={summary.tone} value={summary.totalPending} hint={summary.oldestPendingLabel !== '—' ? `oldest ${summary.oldestPendingLabel}` : undefined} />
          <Stat icon="shield" label="Approval chains" value={summary.enabledChains} hint="enabled" />
          <Stat icon="check" label="Approved recently" tone="green" value={summary.approvedRecently} />
          <Stat icon="info" label="Rejected recently" tone={summary.rejectedRecently > 0 ? 'red' : 'gray'} value={summary.rejectedRecently} />
        </Grid>
        <div className="mt-3">
          <Meter value={clearedRatio} tone="accent" label="Recently cleared vs pending" trailing={`${summary.approvedRecently} cleared · ${summary.totalPending} pending`} />
        </div>
      </OpsPanel>

      <OpsPanel
        title={`Delegated approvals (${pending.length} pending)`}
        subtitle="Cross-org delegated approvals awaiting a decision"
        actions={<DeepLink label="Resolve in Federation" onClick={() => go.setSection('federation')} />}
      >
        {pending.length === 0 ? (
          <EmptyState icon="checklist" title="No pending delegated approvals" hint="Cross-org approval requests appear here when a peer org delegates a decision." />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {pending.slice(0, 10).map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{a.action}</div>
                  <div className="text-2xs text-faint">{a.fromOrgName} → {a.toOrgName} · {timeAgo(a.requestedAt, Date.now())}</div>
                </div>
                <StatusBadge tone={approvalStatusTone(a.status)} label={a.status} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Governance & job approvals" subtitle="Approval chains and the executive job-approval queue">
        <div className="surface-raised rounded-2xl px-4 shadow-card">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-muted">{summary.enabledChains} enabled approval chain{summary.enabledChains === 1 ? '' : 's'}</span>
            <DeepLink label="Edit chains in Enterprise" onClick={() => go.setSection('enterprise')} />
          </div>
          <div className="h-px [background:var(--hairline)]" />
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-muted">{summary.jobPending} job approval{summary.jobPending === 1 ? '' : 's'} pending</span>
            <DeepLink label="Review in AI Workforce" onClick={() => go.setSection('workforce')} />
          </div>
        </div>
      </OpsPanel>
    </>
  );
}

/* ── Workspaces & Teams ──────────────────────────────────────────────────── */

function WorkspacesTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const dir = summarizeWorkspaces(d.workspaces, d.teams);
  return (
    <>
      <OpsPanel title="Directory" subtitle="Workspaces and cloud teams">
        <Grid cols={4}>
          <Stat icon="grid" label="Workspaces" value={dir.workspaces || '—'} hint={`${dir.activeWorkspaces} active`} />
          <Stat icon="user" label="People" value={dir.workspaceUsers} hint="across workspaces" />
          <Stat icon="layers" label="Teams" value={dir.teams || '—'} />
          <Stat icon="user" label="Team members" value={dir.teamMembers} />
        </Grid>
      </OpsPanel>

      <OpsPanel title="Workspaces" subtitle="The enterprise workspace directory" actions={<DeepLink label="Manage in Organization" onClick={() => go.setSection('organization')} />}>
        {d.workspaces.length === 0 ? (
          <EmptyState icon="grid" title="No workspaces" />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.workspaces.slice(0, 10).map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{w.name}</div>
                  <div className="text-2xs text-faint">{w.orgName} · {w.userCount} people · {w.unitCount} units</div>
                </div>
                <StatusBadge tone={w.active ? 'green' : 'gray'} label={w.active ? 'active' : 'inactive'} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Cloud teams" subtitle="Multi-tenant teams" actions={<DeepLink label="Manage in Cloud" onClick={() => go.setSection('cloud')} />}>
        {d.teams.length === 0 ? (
          <EmptyState icon="user" title="No cloud teams" hint="Teams are empty by default — create them from the Cloud section." />
        ) : (
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {d.teams.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                <span className="text-2xs text-faint">{t.memberCount} member{t.memberCount === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </>
  );
}

/* ── Activity ────────────────────────────────────────────────────────────── */

function ActivityTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  return (
    <OpsPanel
      title={`Activity feed (${d.audit.length} recent)`}
      subtitle="The system audit / activity feed — real recorded events, newest first (not a social feed)"
      actions={<DeepLink label="Open the Activity Log" onClick={() => go.setSection('operations')} />}
    >
      {d.audit.length === 0 ? (
        <EmptyState icon="activity" title="No recent activity" hint="System and governance events are recorded here as they happen." />
      ) : (
        <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
          {d.audit.slice(0, 20).map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 shrink-0"><Icon name="dot" size={14} className={cn('text-faint', collaborationStateTone(a.action) === 'red' && 'text-ink')} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink">{a.summary}</div>
                <div className="text-2xs text-faint">{a.actor} · {a.action}{a.target ? ` · ${a.target}` : ''}</div>
              </div>
              <span className="shrink-0 text-2xs text-faint">{timeAgo(a.at, Date.now())}</span>
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── My Items ────────────────────────────────────────────────────────────── */

function MyItemsTab({ d, go }: { d: Data; go: Go }): JSX.Element {
  const items = summarizeMyItems(d.personalization);
  const p = d.personalization;
  const empty = items.total === 0;
  return (
    <>
      <OpsPanel title="My items" subtitle="Your personal favorites, recents & saved views" actions={<DeepLink label="Open in Enterprise" onClick={() => go.setSection('enterprise')} />}>
        <Grid cols={3}>
          <Stat icon="star" label="Favorites" value={items.favorites} />
          <Stat icon="clock" label="Recents" value={items.recents} />
          <Stat icon="eye" label="Saved views" value={items.savedViews} />
        </Grid>
      </OpsPanel>

      {empty ? (
        <EmptyState icon="star" title="No personal items yet" hint="Pin surfaces, save views, or revisit records and they will collect here." />
      ) : (
        <>
          {p && p.favorites.length > 0 && (
            <OpsPanel title="Favorites">
              <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {p.favorites.slice(0, 8).map((f) => (
                  <div key={f.id} className="flex items-center gap-3 py-2.5">
                    <span className="mt-0.5 shrink-0"><Icon name="star-fill" size={13} className="text-faint" /></span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.label}</span>
                    <span className="text-2xs text-faint">{f.tab}</span>
                  </div>
                ))}
              </div>
            </OpsPanel>
          )}
          {p && p.recents.length > 0 && (
            <OpsPanel title="Recently opened">
              <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {p.recents.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.label}</span>
                    <span className="text-2xs text-faint">{r.tab}</span>
                  </div>
                ))}
              </div>
            </OpsPanel>
          )}
          {p && p.savedViews.length > 0 && (
            <OpsPanel title="Saved views">
              <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                {p.savedViews.slice(0, 8).map((v) => (
                  <div key={v.id} className="flex items-center gap-3 py-2.5">
                    <span className="mt-0.5 shrink-0"><Icon name="eye" size={13} className="text-faint" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{v.label}</div>
                      {v.query ? <div className="text-2xs text-faint">“{v.query}” · {v.tab}</div> : <div className="text-2xs text-faint">{v.tab}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </OpsPanel>
          )}
        </>
      )}
    </>
  );
}
