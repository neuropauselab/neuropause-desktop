import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel } from './primitives';

/** Honest placeholder for the management panels arriving in Operations Part B-2. */
export function SoonPanel({
  icon,
  title,
  description,
}: {
  icon: IconName;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <OpsPanel title={title} subtitle="Operations command center">
      <div className="surface-raised flex flex-col items-center rounded-2xl px-6 py-14 text-center shadow-card">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Icon name={icon} size={24} />
        </span>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-accent">
          <Icon name="sparkles" size={12} /> Arrives in Part B-2
        </span>
        <h3 className="mt-3 text-lg font-semibold">{title}</h3>
        <p className="mt-1 max-w-[420px] text-sm text-muted">{description}</p>
      </div>
    </OpsPanel>
  );
}
