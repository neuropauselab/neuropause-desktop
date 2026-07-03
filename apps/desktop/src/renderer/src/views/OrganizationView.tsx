import { useState } from 'react';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { cn } from '@renderer/lib/cn';
import { CloudOrgProvider, useCloudOrg } from '@renderer/organization/CloudOrgProvider';
import { OrgSwitcher } from '@renderer/organization/OrgSwitcher';
import { OrgDashboard } from '@renderer/organization/OrgDashboard';
import { OrgMembers } from '@renderer/organization/OrgMembers';
import { OrgRoles } from '@renderer/organization/OrgRoles';
import { OrgProfile } from '@renderer/organization/OrgProfile';
import { OrgWorkspaces } from '@renderer/organization/OrgWorkspaces';

type OrgTab = 'overview' | 'members' | 'workspaces' | 'roles' | 'profile';
const TABS: { id: OrgTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'roles', label: 'Roles' },
  { id: 'profile', label: 'Profile' },
];

function CreatePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { createOrg, busy } = useCloudOrg();
  const [name, setName] = useState('');
  const submit = async (): Promise<void> => {
    if (!name.trim()) return;
    await createOrg(name);
    onClose();
  };
  return (
    <Card className="mb-5 space-y-3">
      <div>
        <h3 className="text-md font-semibold">New organization</h3>
        <p className="mt-0.5 text-sm text-muted">
          You’ll be the owner. You can invite teammates afterward.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="Organization name"
          className="h-9 flex-1 rounded-xl px-3 text-base surface-raised shadow-card outline-none placeholder:text-faint focus-visible:shadow-focus"
        />
        <Button
          variant="primary"
          icon="check"
          disabled={!name.trim() || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Creating…' : 'Create'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function OrgContent(): JSX.Element {
  const { activeOrg, loading, error, refresh } = useCloudOrg();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<OrgTab>('overview');

  return (
    <ViewScroll>
      <ViewHeader
        title="Organization"
        subtitle="Manage the organizations you belong to."
        right={<OrgSwitcher onCreate={() => setCreating(true)} />}
      />

      {error && (
        <Card className="mb-5 flex items-center justify-between gap-3 border border-syspink/30">
          <span className="text-sm text-syspink">{error}</span>
          <Button size="sm" icon="refresh" onClick={() => void refresh()}>
            Retry
          </Button>
        </Card>
      )}

      {creating && <CreatePanel onClose={() => setCreating(false)} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted">
          <Spinner size={18} />
          <span className="text-sm">Loading organizations…</span>
        </div>
      ) : activeOrg ? (
        <>
          <div className="mb-5 flex gap-1 border-b border-white/5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative px-3 py-2 text-base font-medium outline-none transition-colors',
                  tab === t.id ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
                )}
              </button>
            ))}
          </div>
          {tab === 'overview' && <OrgDashboard />}
          {tab === 'members' && <OrgMembers />}
          {tab === 'workspaces' && <OrgWorkspaces />}
          {tab === 'roles' && <OrgRoles />}
          {tab === 'profile' && <OrgProfile />}
        </>
      ) : (
        !creating && (
          <EmptyState
            icon="user"
            title="No organization yet"
            description="Create your first organization to invite teammates and manage workspaces."
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Create organization
              </Button>
            }
          />
        )
      )}
    </ViewScroll>
  );
}

/** The Organization experience: switcher + tabbed overview / member management. */
export function OrganizationView(): JSX.Element {
  return (
    <CloudOrgProvider>
      <OrgContent />
    </CloudOrgProvider>
  );
}
