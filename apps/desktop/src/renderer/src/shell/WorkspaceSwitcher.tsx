/**
 * Phase 6 Stage 1 — the workspace switcher (Sidebar header).
 *
 * A compact control showing the active workspace, opening a popover with the
 * recents-ordered list (switch on click), inline rename, a two-step delete
 * guard, and a create form seeded from the template catalog. All state flows
 * through WorkspaceContextProvider; this component is presentation only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import { useWorkspaceContexts } from '@renderer/state/WorkspaceContextProvider';
import {
  suggestedWorkspaceName,
  switcherShortcutHint,
  workspaceTemplates,
  type WorkspaceTemplateId,
} from '@renderer/state/workspaceContextModel';

/**
 * P13C ROUND 39 — GATE 26 (the split-brain switcher). This control fronts TWO
 * systems that used to be indistinguishable here: the ORGANIZATION workspaces
 * (the tenant boundary — membership-gated, audited, switched over
 * `enterprise:workspace.switch`) and the local VIEWS (per-user tab-set
 * contexts over `workspace-ctx:*`, a USER_PREFERENCE store that scopes no
 * data). The popover used to present only the views under the heading
 * "Workspaces", so the one visible switcher in the shell never touched the
 * tenant while the real switch hid in Settings. Now the organization
 * workspaces lead the popover and switch through the real gated channel with
 * refusals shown verbatim; the tab-set list is labeled what it is (Views);
 * and the ⌘1–9 hints — advertised since Stage 1 with no handler behind them —
 * actually switch views.
 */
interface OrgWorkspaceRow {
  id: string;
  name: string;
  orgName: string;
  active: boolean;
}

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }): JSX.Element {
  const { workspaces, activeId, switchWorkspace, createWorkspace, renameWorkspace, deleteWorkspace } =
    useWorkspaceContexts();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState<WorkspaceTemplateId>('blank');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { setSection } = useShell();

  // The ORGANIZATION workspace list — the tenant truth, loaded when the
  // popover opens. `null` while loading; a failure keeps its message.
  const [orgWorkspaces, setOrgWorkspaces] = useState<OrgWorkspaceRow[] | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  /**
   * D-7 — the VIEW-ACTION channel. `orgError` reports a failed organization
   * LOAD and renders under the organization heading; a failed create / rename /
   * delete / switch is a different event in a different section, so it gets its
   * own channel rendered where the action was taken.
   */
  const [viewError, setViewError] = useState<string | null>(null);

  const loadOrgWorkspaces = useCallback(async (): Promise<void> => {
    try {
      const rows = (await ipc.enterprise.workspaces()) as OrgWorkspaceRow[];
      setOrgWorkspaces(rows);
      setOrgError(null);
    } catch (err) {
      // A refusal (signed out, membership revoked, org suspended) is an
      // answer about the tenant, not a rendering accident — show it verbatim
      // rather than pretending the section does not exist.
      setOrgWorkspaces(null);
      setOrgError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (open) void loadOrgWorkspaces();
  }, [open, loadOrgWorkspaces]);

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const templates = workspaceTemplates();

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset transient sub-states whenever the popover closes.
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setRenamingId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  // ⌘1–⌘9 switch views — the handler the rendered hints always promised.
  // Bound while the switcher is mounted (not only while the popover is open),
  // because a shortcut that works only inside the menu that displays it is
  // still a lie about the shell.
  useEffect(() => {
    const onShortcut = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const idx = '123456789'.indexOf(e.key);
      if (idx === -1) return;
      const target = workspaces[idx];
      if (!target || target.id === activeId) return;
      e.preventDefault();
      void switchWorkspace(target.id);
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [workspaces, activeId, switchWorkspace]);

  // If there are no workspaces (bootstrap degraded), render nothing.
  if (!active) return <></>;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setViewError(null);
    try {
      await fn();
    } catch (err) {
      // Rendered VERBATIM: `secureBridge` already scrubs internal detail before a
      // message leaves main, and re-wording it here would mean classifying the
      // failure by regex on English prose -- which is what D-6 exists to stop.
      setViewError(err instanceof Error && err.message ? err.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  };

  const startCreate = (): void => {
    setNewName(suggestedWorkspaceName(workspaces.map((w) => w.name)));
    setNewTemplate('blank');
    setCreating(true);
  };

  const submitCreate = (): void => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      await createWorkspace(name, newTemplate);
      setOpen(false);
    });
  };

  const submitRename = (id: string): void => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    void run(() => renameWorkspace(id, name));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? `View: ${active.name}` : undefined}
        aria-label={`View: ${active.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex h-10 w-full items-center rounded-xl outline-none transition-colors focus-visible:shadow-focus',
          'border border-[var(--hairline)] fill-hover',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-3',
        )}
      >
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: active.color }}
        />
        {!collapsed && (
          <>
            <span className="text-ink min-w-0 flex-1 truncate text-left text-sm font-semibold">
              {active.name}
            </span>
            <span aria-hidden="true" className="text-faint shrink-0 text-[10px] leading-none">▾</span>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces and views"
          className="sidebar-material absolute left-0 right-0 top-11 z-40 min-w-[220px] rounded-xl border border-[var(--hairline)] p-1.5 shadow-lg"
        >
          <div className="text-faint px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide">
            Organization workspace
          </div>
          {orgError !== null ? (
            <div role="alert" className="text-muted px-2 pb-1 text-xs">
              {orgError}
            </div>
          ) : orgWorkspaces === null ? (
            <div className="text-faint px-2 pb-1 text-xs">Loading…</div>
          ) : (
            orgWorkspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                role="menuitem"
                disabled={busy || w.active}
                onClick={() =>
                  void run(async () => {
                    try {
                      await ipc.enterprise.switchWorkspace(w.id);
                      setOpen(false);
                    } catch (err) {
                      // The membership gate's refusal, verbatim — a denied
                      // switch is a tenant decision, not a silent no-op.
                      setOrgError(err instanceof Error ? err.message : String(err));
                    }
                  })
                }
                className={cn(
                  'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left outline-none transition-colors focus-visible:shadow-focus',
                  w.active ? 'text-accent bg-accent/12' : 'text-muted hover:text-ink fill-hover',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{w.name}</span>
                <span className="text-faint shrink-0 truncate text-[10px]">{w.orgName}</span>
              </button>
            ))
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setSection('settings');
              setOpen(false);
            }}
            className="text-faint hover:text-ink fill-hover flex h-7 w-full items-center rounded-lg px-2 text-xs outline-none focus-visible:shadow-focus"
          >
            Manage members and workspaces in Settings…
          </button>

          <div className="mx-1 my-1.5 border-t border-[var(--hairline)]" />

          <div className="text-faint px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide">
            Views on this device
          </div>
          {viewError !== null && (
            <div role="alert" className="text-danger px-2 pb-1 text-xs">
              {viewError}
            </div>
          )}
          {workspaces.map((w, idx) => (
            <div key={w.id} className="group flex items-center gap-1">
              {renamingId === w.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename(w.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => submitRename(w.id)}
                  aria-label={`Rename ${w.name}`}
                  className="text-ink m-0.5 h-8 min-w-0 flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-2 text-sm outline-none focus-visible:shadow-focus"
                />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await switchWorkspace(w.id);
                    setOpen(false);
                  })}
                  className={cn(
                    'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none transition-colors focus-visible:shadow-focus',
                    w.id === activeId ? 'text-accent bg-accent/12' : 'text-muted hover:text-ink fill-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: w.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{w.name}</span>
                  {switcherShortcutHint(idx) && (
                    <span className="text-faint shrink-0 text-[10px]">{switcherShortcutHint(idx)}</span>
                  )}
                </button>
              )}
              <button
                type="button"
                aria-label={`Rename ${w.name}`}
                onClick={() => {
                  setRenamingId(w.id);
                  setRenameValue(w.name);
                  setConfirmDeleteId(null);
                }}
                className="text-faint hover:text-ink hidden h-8 shrink-0 rounded-lg px-1.5 text-[11px] group-hover:block"
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={confirmDeleteId === w.id ? `Confirm delete ${w.name}` : `Delete ${w.name}`}
                disabled={busy}
                onClick={() => {
                  if (confirmDeleteId === w.id) {
                    setConfirmDeleteId(null);
                    void run(() => deleteWorkspace(w.id));
                  } else {
                    setConfirmDeleteId(w.id);
                  }
                }}
                className={cn(
                  'h-8 shrink-0 rounded-lg px-1.5 text-[11px]',
                  confirmDeleteId === w.id
                    ? 'block text-red-400'
                    : 'text-faint hover:text-ink hidden group-hover:block',
                )}
              >
                {confirmDeleteId === w.id ? 'Delete?' : 'Delete'}
              </button>
            </div>
          ))}

          <div className="mx-1 my-1.5 border-t border-[var(--hairline)]" />

          {creating ? (
            <div className="flex flex-col gap-1.5 p-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate();
                }}
                placeholder="View name"
                aria-label="New view name"
                className="text-ink h-8 rounded-lg border border-[var(--hairline)] bg-transparent px-2 text-sm outline-none focus-visible:shadow-focus"
              />
              <select
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value as WorkspaceTemplateId)}
                aria-label="View template"
                className="text-ink h-8 rounded-lg border border-[var(--hairline)] bg-transparent px-1.5 text-sm outline-none"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} — {t.description}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || newName.trim().length === 0}
                onClick={submitCreate}
                className="text-accent bg-accent/12 h-8 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Create view
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={startCreate}
              className="text-muted hover:text-ink fill-hover flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm outline-none focus-visible:shadow-focus"
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              New view…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
