import { useState } from 'react';
import type { CloudWorkspace } from '@neuropause/shared';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { useCloudOrg } from './CloudOrgProvider';

/** Workspace settings for the active organization: create, rename, delete. */
export function OrgWorkspaces(): JSX.Element {
  const {
    activeOrg,
    workspaces,
    membersLoading,
    busy,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useCloudOrg();

  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!activeOrg) return <></>;
  const canManage = activeOrg.role === 'owner' || activeOrg.role === 'admin';

  const doCreate = async (): Promise<void> => {
    if (!newName.trim()) return;
    setActionError(null);
    try {
      await createWorkspace(newName);
      setNewName('');
    } catch (e) {
      setActionError((e as Error).message || 'Could not create the workspace.');
    }
  };
  const startRename = (w: CloudWorkspace): void => {
    setConfirmingId(null);
    setRenameValue(w.name);
    setRenamingId(w.id);
    setActionError(null);
  };
  const doRename = async (id: string): Promise<void> => {
    if (!renameValue.trim()) return;
    setActionError(null);
    try {
      await renameWorkspace(id, renameValue);
      setRenamingId(null);
    } catch (e) {
      setActionError((e as Error).message || 'Could not rename the workspace.');
    }
  };
  const doDelete = async (id: string): Promise<void> => {
    setActionError(null);
    try {
      await deleteWorkspace(id);
      setConfirmingId(null);
    } catch (e) {
      setActionError((e as Error).message || 'Could not delete the workspace.');
    }
  };

  if (membersLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner size={18} />
        <span className="text-sm">Loading workspaces…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {actionError && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-syspink/30 px-3.5 py-2.5">
          <span className="text-sm text-syspink">{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-muted hover:text-ink"
            aria-label="Dismiss"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {canManage && (
        <Card>
          <CardHeader
            icon={<Icon name="plus" size={16} />}
            title="Create a workspace"
            tint="green"
          />
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doCreate();
              }}
              maxLength={120}
              placeholder="Workspace name"
              className="h-9 flex-1 rounded-xl px-3 text-base surface-raised shadow-card outline-none placeholder:text-faint focus-visible:shadow-focus"
            />
            <Button
              variant="primary"
              icon="plus"
              disabled={!newName.trim() || busy}
              onClick={() => void doCreate()}
            >
              Create
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<Icon name="workspace" size={16} />}
          title={`Workspaces (${workspaces.length})`}
          tint="purple"
        />
        <div className="mt-2">
          {workspaces.length === 0 ? (
            <EmptyState
              compact
              icon="workspace"
              title="No workspaces yet"
              description={
                canManage
                  ? 'Create one above to group work within this organization.'
                  : 'Workspaces group work within this organization.'
              }
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {workspaces.map((w) => (
                <li key={w.id} className="flex items-center gap-3 py-2.5">
                  <Icon name="workspace" size={16} className="shrink-0 text-accent" />
                  {renamingId === w.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void doRename(w.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        maxLength={120}
                        className="h-8 flex-1 rounded-lg px-2.5 text-base surface-raised shadow-card outline-none focus-visible:shadow-focus"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        icon="check"
                        disabled={!renameValue.trim() || busy}
                        onClick={() => void doRename(w.id)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-base text-ink">{w.name}</span>
                      {canManage && confirmingId !== w.id && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => startRename(w)}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="trash"
                            disabled={busy}
                            onClick={() => setConfirmingId(w.id)}
                          />
                        </>
                      )}
                      {canManage && confirmingId === w.id && (
                        <>
                          <span className="text-sm text-muted">Delete workspace?</span>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => void doDelete(w.id)}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setConfirmingId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {!canManage && (
        <p className="text-sm text-muted">Only owners and admins can manage workspaces.</p>
      )}
    </div>
  );
}
