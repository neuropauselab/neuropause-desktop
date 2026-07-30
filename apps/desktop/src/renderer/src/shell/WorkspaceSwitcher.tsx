/**
 * Phase 6 Stage 1 â the workspace switcher (Sidebar header).
 *
 * A compact control showing the active workspace, opening a popover with the
 * recents-ordered list (switch on click), inline rename, a two-step delete
 * guard, and a create form seeded from the template catalog. All state flows
 * through WorkspaceContextProvider; this component is presentation only.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { useWorkspaceContexts } from '@renderer/state/WorkspaceContextProvider';
import {
  suggestedWorkspaceName,
  switcherShortcutHint,
  workspaceTemplates,
  type WorkspaceTemplateId,
} from '@renderer/state/workspaceContextModel';

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

  // If there are no workspaces (bootstrap degraded), render nothing.
  if (!active) return <></>;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
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
        title={collapsed ? `Workspace: ${active.name}` : undefined}
        aria-label={`Workspace: ${active.name}`}
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
          aria-label="Workspaces"
          className="sidebar-material absolute left-0 right-0 top-11 z-40 min-w-[220px] rounded-xl border border-[var(--hairline)] p-1.5 shadow-lg"
        >
          <div className="text-faint px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide">
            Workspaces
          </div>
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
                placeholder="Workspace name"
                aria-label="New workspace name"
                className="text-ink h-8 rounded-lg border border-[var(--hairline)] bg-transparent px-2 text-sm outline-none focus-visible:shadow-focus"
              />
              <select
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value as WorkspaceTemplateId)}
                aria-label="Workspace template"
                className="text-ink h-8 rounded-lg border border-[var(--hairline)] bg-transparent px-1.5 text-sm outline-none"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} â {t.description}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || newName.trim().length === 0}
                onClick={submitCreate}
                className="text-accent bg-accent/12 h-8 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Create workspace
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
              New workspaceâ¦
            </button>
          )}
        </div>
      )}
    </div>
  );
}
