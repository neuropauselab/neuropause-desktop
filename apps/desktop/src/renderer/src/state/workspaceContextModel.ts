/**
 * Phase 6 Stage 1 — pure Workspace Context view-model (no React, no IPC).
 *
 * Owns the renderer-side derivations for the multi-workspace foundation:
 * templates (validated against the REAL section registry so a template can
 * never point at a retired destination), the legacy single-context snapshot
 * used for first-boot migration, and the small pure helpers the switcher UI
 * needs. The pref reader is injected so every function stays deterministic and
 * Node-testable (the live callers pass the real `prefs.read`).
 */
import { SECTIONS } from '@renderer/shell/sections';

export type WorkspaceTemplateId = 'blank' | 'operations' | 'enterprise' | 'research';

export interface WorkspaceTemplateDef {
  id: WorkspaceTemplateId;
  label: string;
  description: string;
  /** The section a new workspace of this template opens on. */
  section: string;
}

/**
 * The Stage 1 template catalog. Sections are validated by
 * `workspaceTemplates()` against the live registry; an entry whose section has
 * been hidden or removed falls back to intent-home rather than disappearing.
 */
const TEMPLATE_CATALOG: WorkspaceTemplateDef[] = [
  { id: 'blank', label: 'Blank', description: 'Start from Today’s Intent', section: 'intent-home' },
  { id: 'operations', label: 'Runtime', description: 'Open on Runtime', section: 'operations' },
  { id: 'enterprise', label: 'Enterprise', description: 'Open on the Enterprise suite', section: 'enterprise' },
  { id: 'research', label: 'Research', description: 'Open on Knowledge', section: 'knowledge' },
];

/** True when a section id exists in the registry and is visible. */
function sectionIsLive(id: string): boolean {
  return SECTIONS.some((s) => s.id === id && !s.hidden);
}

/** The template catalog with every section validated against the registry. */
export function workspaceTemplates(): WorkspaceTemplateDef[] {
  return TEMPLATE_CATALOG.map((t) => (sectionIsLive(t.section) ? t : { ...t, section: 'intent-home' }));
}

/** The reader shape `legacyShellSnapshot` needs (matches `prefs.read`). */
export type PrefReader = <T>(key: string, fallback: T) => T;

/**
 * The legacy (pre-Stage-1) single-context session, shaped for the store's
 * bootstrap migration. Returns null when there is nothing meaningful to
 * migrate (a genuinely fresh profile). The caller passes the real pref reader;
 * tests pass a fake.
 */
export function legacyShellSnapshot(read: PrefReader): {
  activeSection: string;
  tabs: unknown;
  activeTabId: unknown;
} | null {
  const activeSection = read<string>('activeSection', '');
  const tabs = read<unknown>('workspaceTabs', []);
  const activeTabId = read<unknown>('activeTabId', null);
  const hasTabs = Array.isArray(tabs) && tabs.length > 0;
  if (!hasTabs && !activeSection) return null;
  return { activeSection: activeSection || 'intent-home', tabs, activeTabId };
}

/** Suggested name for the Nth new workspace ("Workspace 2", "Workspace 3"…). */
export function suggestedWorkspaceName(existingNames: readonly string[]): string {
  for (let i = existingNames.length + 1; i < existingNames.length + 100; i++) {
    const candidate = `Workspace ${i}`;
    if (!existingNames.includes(candidate)) return candidate;
  }
  return 'Workspace';
}

/** Keyboard shortcut hint for the first nine workspaces in switcher order. */
export function switcherShortcutHint(index: number): string | null {
  return index >= 0 && index < 9 ? `⌘${index + 1}` : null;
}
