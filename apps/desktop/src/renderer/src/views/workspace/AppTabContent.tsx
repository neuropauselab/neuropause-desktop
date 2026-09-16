import { motion } from 'framer-motion';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Badge } from '@renderer/components/ui/controls';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { getAppOrFallback } from '@renderer/data/catalog';
import type { WorkspaceTab } from '@renderer/state/ShellProvider';

// UI-truth: these describe what THIS canvas will do once Connectors (Phase 4)
// lands — they are NOT present capabilities, so the copy is forward-looking to
// match the disclosure below. (Whole-product audit, 2026-08-31.)
const CAPABILITIES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'play', title: 'Live sessions', body: 'Will run the app in an embedded, signed-in session.' },
  { icon: 'activity', title: 'Activity sync', body: 'Your work here will flow into your timeline.' },
  { icon: 'memory', title: 'Recall', body: 'Will become searchable in AI Memory.' },
];

/**
 * The canvas shown when a Workspace tab is focused. It frames the app with its
 * identity and status. Embedded, signed-in sessions arrive with Connectors in
 * Phase 4 — so this surface is explicit about what is preview vs. live.
 */
export function AppTabContent({ tab }: { tab: WorkspaceTab }): JSX.Element {
  const app = getAppOrFallback(tab.appId);

  return (
    <div className="h-full overflow-y-auto">
      <motion.div
        key={tab.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        className="mx-auto max-w-[760px] px-8 py-12"
      >
        <div className="flex flex-col items-center text-center">
          <AppGlyph glyph={app.glyph} tone={app.tone} size={72} />
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">{app.name}</h2>
          <div className="mt-1 text-sm text-faint">
            {app.developer} · {app.category}
          </div>
          <div className="mt-3">
            {import.meta.env.DEV && app.connected ? (
              <Badge tone="green">
                <span className="h-1.5 w-1.5 rounded-full bg-sysgreen" /> Connected
              </Badge>
            ) : (
              <Badge tone="neutral">Not connected</Badge>
            )}
          </div>
          <p className="mt-4 max-w-[460px] text-md text-muted">{app.tagline}</p>
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Icon name="info" size={16} />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            This is your workspace canvas for {app.name}. Embedded, signed-in sessions and two-way
            activity sync arrive with <span className="font-medium text-ink">Connectors in Phase 4</span>.
            For now, the tab system, layout, and state management are fully functional.
          </p>
        </div>

        <div className="mt-6 text-xs font-medium uppercase tracking-wide text-faint">
          Planned for this canvas — arrives with Connectors (Phase 4)
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="surface-raised rounded-2xl p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted">
                <Icon name={c.icon} size={17} />
              </span>
              <div className="mt-3 text-base font-semibold">{c.title}</div>
              <p className="mt-1 text-sm leading-snug text-faint">{c.body}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
