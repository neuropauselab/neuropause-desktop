/**
 * The processing badge — where an AI response ACTUALLY ran, with "Why?".
 *
 * Renders only from `AiRoutingMetadata` stamped by the execution. When a
 * response carries none (turns persisted before the field existed), it renders
 * NOTHING — absence of evidence is never displayed as "local".
 */
import { useId, useState } from 'react';
import type { AiRoutingMetadata } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { processingBadge } from './experienceModel';

const TONE_CLASS: Record<'good' | 'neutral' | 'warn', string> = {
  good: 'text-sysgreen border-sysgreen/25',
  neutral: 'text-muted border-[var(--hairline)]',
  warn: 'text-sysorange border-sysorange/25',
};

const LOCATION_ICON: Record<string, IconName> = {
  local: 'lock',
  private_infrastructure: 'shield',
  external: 'globe',
  none: 'cpu',
};

export function ProcessingBadge({
  meta,
  align = 'left',
}: {
  meta: AiRoutingMetadata | null | undefined;
  align?: 'left' | 'right';
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  const model = processingBadge(meta);
  if (!model) return null;

  return (
    <div className={cn('relative inline-flex flex-col', align === 'right' ? 'items-end' : 'items-start')}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
          TONE_CLASS[model.tone],
        )}
        title={model.description}
      >
        <Icon name={LOCATION_ICON[model.location] ?? 'cpu'} size={11} aria-hidden="true" />
        <span>{model.label}</span>
        {model.modelName && <span className="opacity-70">· {model.modelName}</span>}
        <button
          type="button"
          className="ml-0.5 rounded-full px-1 text-[10px] font-semibold uppercase tracking-wide text-faint hover:text-ink focus-visible:outline focus-visible:outline-2"
          aria-expanded={open}
          aria-controls={whyId}
          onClick={() => setOpen((o) => !o)}
        >
          Why?
        </button>
      </span>
      {open && (
        <div
          id={whyId}
          role="note"
          className="z-10 mt-1.5 max-w-[420px] rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3.5 py-2.5 text-xs leading-relaxed text-muted shadow-lg"
        >
          {model.why}
        </div>
      )}
    </div>
  );
}
