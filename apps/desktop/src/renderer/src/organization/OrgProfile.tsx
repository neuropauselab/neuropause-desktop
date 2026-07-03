import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CloudOrganization } from '@neuropause/shared';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { Spinner } from '@renderer/components/Spinner';
import { ipc } from '@renderer/lib/ipc';
import { ROLE_LABEL, useCloudOrg } from './CloudOrgProvider';

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-3 last:border-0">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <div className="min-w-0 text-right text-base text-ink">{children}</div>
    </div>
  );
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Organization profile: view details and (for owners/admins) rename. */
export function OrgProfile(): JSX.Element {
  const { activeOrg, updateOrg, busy } = useCloudOrg();
  const orgId = activeOrg?.orgId ?? null;

  const [org, setOrg] = useState<CloudOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      setOrg(await ipc.org.get(orgId));
    } catch (e) {
      setError((e as Error).message || 'Could not load the organization profile.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeOrg) return <></>;
  const canManage = activeOrg.role === 'owner' || activeOrg.role === 'admin';

  const startEdit = (): void => {
    setName(org?.name ?? activeOrg.name);
    setSaveError(null);
    setEditing(true);
  };
  const save = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaveError(null);
    try {
      await updateOrg(name);
      await load();
      setEditing(false);
    } catch (e) {
      setSaveError((e as Error).message || 'Could not rename the organization.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner size={18} />
        <span className="text-sm">Loading profile…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Card className="border border-syspink/30 text-sm text-syspink">{error}</Card>}

      <Card>
        <CardHeader
          icon={<Icon name="shield" size={16} />}
          title="Organization profile"
          tint="accent"
          action={
            canManage && !editing ? (
              <Button size="sm" onClick={startEdit}>
                Rename
              </Button>
            ) : undefined
          }
        />

        <dl className="mt-3">
          <Field label="Name">
            {editing ? (
              <div className="flex items-center justify-end gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  className="h-8 w-[220px] rounded-lg px-2.5 text-base surface-raised shadow-card outline-none focus-visible:shadow-focus"
                />
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  disabled={!name.trim() || busy}
                  onClick={() => void save()}
                >
                  {busy ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <span className="font-medium">{org?.name ?? activeOrg.name}</span>
            )}
          </Field>
          {saveError && <div className="pb-2 text-right text-sm text-syspink">{saveError}</div>}
          <Field label="Slug">
            <code className="rounded-md bg-white/5 px-1.5 py-0.5 text-sm">
              {org?.slug ?? activeOrg.slug}
            </code>
          </Field>
          <Field label="Created">{formatDate(org?.createdAt)}</Field>
          <Field label="Your role">{ROLE_LABEL[activeOrg.role]}</Field>
        </dl>
      </Card>

      {!canManage && (
        <p className="text-sm text-muted">Only owners and admins can rename the organization.</p>
      )}
    </div>
  );
}
