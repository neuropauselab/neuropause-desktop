import { useMemo, type ReactNode } from 'react';
import type { CloudOrgRole } from '@neuropause/shared';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { ROLE_LABEL, useCloudOrg } from './CloudOrgProvider';

function StatCard({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
}): JSX.Element {
  return (
    <Card className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xl font-semibold tracking-tight">{value}</div>
        <div className="truncate text-sm text-muted">{label}</div>
      </div>
    </Card>
  );
}

const ROLE_ORDER: CloudOrgRole[] = ['owner', 'admin', 'member', 'viewer'];

/** Overview of the currently active organization. Reads shared provider state. */
export function OrgDashboard(): JSX.Element {
  const { activeOrg, members, workspaces, membersLoading } = useCloudOrg();

  const active = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const invited = useMemo(() => members.filter((m) => m.status === 'invited'), [members]);
  const byRole = useMemo(() => {
    const counts: Record<CloudOrgRole, number> = { owner: 0, admin: 0, member: 0, viewer: 0 };
    for (const m of active) counts[m.role] += 1;
    return counts;
  }, [active]);

  if (!activeOrg) return <></>;

  if (membersLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner size={18} />
        <span className="text-sm">Loading {activeOrg.name}…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="user" label="Active members" value={active.length} />
        <StatCard icon="clock" label="Pending invites" value={invited.length} />
        <StatCard icon="workspace" label="Workspaces" value={workspaces.length} />
        <StatCard icon="shield" label="Your role" value={ROLE_LABEL[activeOrg.role]} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Icon name="user" size={16} />} title="Members by role" tint="blue" />
          <div className="mt-3 space-y-2">
            {ROLE_ORDER.map((role) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-base text-ink">{ROLE_LABEL[role]}</span>
                <span className="text-base tabular-nums text-muted">{byRole[role]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<Icon name="clock" size={16} />}
            title="Pending invitations"
            tint="orange"
          />
          <div className="mt-3">
            {invited.length === 0 ? (
              <p className="text-sm text-muted">No pending invitations.</p>
            ) : (
              <ul className="space-y-2">
                {invited.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-base text-ink">{m.invitedEmail}</span>
                    <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-2xs uppercase tracking-wide text-faint">
                      {ROLE_LABEL[m.role]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Icon name="workspace" size={16} />} title="Workspaces" tint="purple" />
        <div className="mt-3">
          {workspaces.length === 0 ? (
            <EmptyState
              compact
              icon="workspace"
              title="No workspaces yet"
              description="Workspaces group work within this organization."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {workspaces.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 surface-raised shadow-card"
                >
                  <Icon name="workspace" size={16} className="text-accent" />
                  <span className="truncate text-base text-ink">{w.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
