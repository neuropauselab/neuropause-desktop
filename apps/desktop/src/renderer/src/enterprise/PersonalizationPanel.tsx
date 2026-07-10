/**
 * Enterprise → My Workspace (personalization). A real, persisted surface for the per-user productization
 * layer: Favorites, Recently-Opened, and Saved Views. Every action calls the RBAC-gated
 * `ipc.enterprise.personalization.*` channels (which mutate the caller's own server-side document) and
 * lifts the returned state back up via `onMutate`. Opening any item navigates through the enterprise
 * `onNavigate` bridge. No mock data, no fake state — the lists are exactly what the store holds.
 */
import { useState } from 'react';
import type { PersonalizationState } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsPanel, StatusBadge } from '../operations/primitives';
import { TINT_TONE, relativeTime, type EnterpriseTab } from './lib';

export function PersonalizationPanel({
  state,
  onNavigate,
  onMutate,
}: {
  state: PersonalizationState;
  onNavigate: (tab: EnterpriseTab, query?: string) => void;
  onMutate: (next: PersonalizationState) => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const run = async (key: string, op: () => Promise<PersonalizationState>): Promise<void> => {
    setBusy(key);
    try {
      onMutate(await op());
    } finally {
      setBusy(null);
    }
  };

  const open = (tab: string, query?: string): void => onNavigate(tab as EnterpriseTab, query || undefined);

  return (
    <div>
      {/* Favorites */}
      <OpsPanel title="Favorites" subtitle={`${state.favorites.length} pinned surface(s)`}>
        {state.favorites.length === 0 ? (
          <EmptyState icon="star" compact title="No favorites yet" description="Star any Enterprise surface (the ☆ in the header) to pin it here and to the command palette." />
        ) : (
          <div className="space-y-2">
            {state.favorites.map((f) => (
              <div key={f.id} className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2 shadow-card">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE.accent)}><Icon name="star-fill" size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.label}</div>
                  <div className="truncate text-2xs text-faint">{f.kind}{f.query ? ` · “${f.query}”` : ''}</div>
                </div>
                <Button variant="secondary" size="sm" icon="arrow-right" onClick={() => open(f.tab, f.query)}>Open</Button>
                <Button variant="ghost" size="sm" icon="close" loading={busy === `unfav:${f.id}`} onClick={() => run(`unfav:${f.id}`, () => ipc.enterprise.personalization.favorite({ id: f.id, kind: f.kind, label: f.label, tab: f.tab, query: f.query }))}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {/* Recently opened */}
      <OpsPanel
        title="Recently Opened"
        subtitle={`${state.recents.length} recent surface(s)`}
        actions={state.recents.length > 0 ? <Button variant="ghost" size="sm" icon="trash" loading={busy === 'clear'} onClick={() => run('clear', () => ipc.enterprise.personalization.clearRecents())}>Clear</Button> : undefined}
      >
        {state.recents.length === 0 ? (
          <EmptyState icon="clock" compact title="Nothing recent" description="Surfaces you open across the Enterprise experience appear here, most recent first." />
        ) : (
          <div className="space-y-2">
            {state.recents.map((r) => (
              <div key={r.id} className="surface-raised flex items-center gap-3 rounded-xl px-3.5 py-2 shadow-card">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE.blue)}><Icon name="clock" size={13} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.label}</div>
                  <div className="truncate text-2xs text-faint">{r.visitedAt ? relativeTime(r.visitedAt) : ''}{r.query ? ` · “${r.query}”` : ''}</div>
                </div>
                <Button variant="secondary" size="sm" icon="arrow-right" onClick={() => open(r.tab, r.query)}>Open</Button>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {/* Saved views */}
      <OpsPanel title="Saved Views" subtitle={`${state.savedViews.length} saved view(s)`}>
        {state.savedViews.length === 0 ? (
          <EmptyState icon="doc" compact title="No saved views" description="Use “Save view” in the Enterprise header to capture a surface + its search as a named view." />
        ) : (
          <div className="space-y-2">
            {state.savedViews.map((v) => (
              <div key={v.id} className="surface-raised rounded-xl px-3.5 py-2.5 shadow-card">
                <div className="flex items-center gap-3">
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE.green)}><Icon name="doc" size={13} /></span>
                  <div className="min-w-0 flex-1">
                    {renaming === v.id ? (
                      <input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} placeholder="View name…" className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-faint" />
                    ) : (
                      <div className="truncate text-sm font-medium">{v.label}</div>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-faint">
                      <StatusBadge tone="gray" label={v.tab} />{v.query ? `“${v.query}”` : 'no query'}
                    </div>
                  </div>
                  {renaming === v.id ? (
                    <>
                      <Button variant="primary" size="sm" loading={busy === `rename:${v.id}`} onClick={() => { const label = renameText.trim(); setRenaming(null); if (label) void run(`rename:${v.id}`, () => ipc.enterprise.personalization.renameView(v.id, label)); }}>Save</Button>
                      <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" size="sm" icon="arrow-right" onClick={() => open(v.tab, v.query)}>Open</Button>
                      <Button variant="ghost" size="sm" icon="settings" onClick={() => { setRenaming(v.id); setRenameText(v.label); }}>Rename</Button>
                      <Button variant="ghost" size="sm" icon="trash" loading={busy === `del:${v.id}`} onClick={() => void run(`del:${v.id}`, () => ipc.enterprise.personalization.deleteView(v.id))}>Delete</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}
