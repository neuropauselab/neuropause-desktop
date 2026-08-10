/**
 * Organization & workspace membership (P13C Part 3, Phase 23).
 *
 * The minimum production surface the program asks for: CURRENT ORGANIZATION,
 * CURRENT WORKSPACE, AVAILABLE WORKSPACES, ROLE — plus switching between the
 * organizations this account belongs to.
 *
 * Deliberately NOT a redesign of Business Home, and deliberately not folded
 * into the existing `WorkspaceSwitcher`: that control drives
 * `workspaceContexts`, a renderer-local notion of tabs and snapshots that
 * happens to share the word "workspace". Merging a tenancy boundary into a UI
 * grouping would make the two indistinguishable on screen, which is precisely
 * the confusion this panel exists to remove.
 *
 * Every list here arrives already scoped by the main process. The component
 * renders what it is given and re-fetches after a switch — it does not filter,
 * because a renderer-side filter would imply the payload could contain another
 * tenant's rows.
 */
import { useCallback, useEffect, useState } from 'react';
import type { OrganizationSummary, WorkspaceSummary } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { buildMembershipView } from './tenantMembershipModel';

export function TenantMembershipPanel(): JSX.Element {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [orgs, wss] = await Promise.all([
        ipc.enterprise.organizations() as Promise<OrganizationSummary[]>,
        ipc.enterprise.workspaces() as Promise<WorkspaceSummary[]>,
      ]);
      setOrganizations(orgs);
      setWorkspaces(wss);
      setError(null);
    } catch (err) {
      /**
       * A refusal is shown, not swallowed.
       *
       * The reachable causes are all real states — signed out, tenant
       * suspended, membership revoked — and each one leaves the app with no
       * tenant. Rendering an empty panel instead would look like "you belong to
       * nothing", which is a different and more alarming claim than "this could
       * not be loaded".
       */
      setError(err instanceof Error ? err.message : 'Could not load your membership.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const view = buildMembershipView(organizations, workspaces);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="tenant-membership-heading"
      className="rounded-xl border border-[var(--hairline)] p-4"
    >
      <h3 id="tenant-membership-heading" className="text-ink text-sm font-semibold">
        Organization &amp; workspace
      </h3>
      <p className="text-muted mt-1 text-xs">
        Everything you see in NeuroPause belongs to one organization at a time.
      </p>

      {error !== null && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {error}
        </p>
      )}

      {view.empty ? (
        <p className="text-muted mt-3 text-sm">
          You are not currently signed in to an organization.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-faint">Organization</dt>
            <dd className="text-ink font-medium">{view.organizationName}</dd>
            <dt className="text-faint">Your role</dt>
            <dd className="text-ink">{view.roleLabel}</dd>
            <dt className="text-faint">Workspace</dt>
            <dd className="text-ink font-medium">{view.workspaceName}</dd>
          </dl>

          <div className="mt-4">
            <div className="text-faint text-[10px] font-medium uppercase tracking-wide">
              Workspaces you can open
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {view.workspaces.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    disabled={busy || w.active}
                    onClick={() => void run(() => ipc.enterprise.switchWorkspace(w.id))}
                    aria-current={w.active ? 'true' : undefined}
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-colors focus-visible:shadow-focus',
                      w.active
                        ? 'text-accent bg-accent/12'
                        : 'text-muted hover:text-ink fill-hover',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    {w.active && <span className="text-faint shrink-0 text-[10px]">Current</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {view.otherOrganizations.length > 0 && (
            <div className="mt-4">
              <div className="text-faint text-[10px] font-medium uppercase tracking-wide">
                Your other organizations
              </div>
              <ul className="mt-1.5 flex flex-col gap-1">
                {view.otherOrganizations.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => ipc.enterprise.switchOrganization(o.id))}
                      className="text-muted hover:text-ink fill-hover flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none focus-visible:shadow-focus"
                    >
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      <span className="text-faint shrink-0 text-[10px]">
                        {o.roles.length > 0 ? o.roles.join(', ') : 'No role'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-faint mt-1.5 text-[11px]">
                Switching organizations reloads your records, search, memory and notifications.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
