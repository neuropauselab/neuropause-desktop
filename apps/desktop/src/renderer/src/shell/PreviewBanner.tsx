/**
 * PreviewBanner (RC Phase 1 · P4) — an in-view honesty banner for sections the
 * registry marks `preview: true`. The Sidebar already shows a "Preview" chip, but
 * a deep-link or command-palette jump lands directly in the view and bypasses that
 * context. Rendered at the shell content level (driven by the section registry), it
 * makes the preview status visible however the user arrived — so a preview surface
 * is never mistaken for live production enterprise state.
 */
import { Icon } from '@renderer/components/ui/Icon';

export function PreviewBanner({ label, phase }: { label: string; phase?: number }): JSX.Element {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] bg-sysorange/10 px-4 py-1.5 text-xs"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-sysorange">
        <Icon name="info" size={14} />
        Preview
      </span>
      <span className="min-w-0 truncate text-muted">
        {label} runs on real code with in-memory or seeded data — not live production enterprise
        state{typeof phase === 'number' ? ` · full functionality lands in Phase ${phase}` : ''}.
      </span>
    </div>
  );
}
