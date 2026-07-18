import { motion } from 'framer-motion';
import { ViewScroll } from '@renderer/components/ui/Page';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import type { AppTone } from '@renderer/data/types';

const TINT: Record<AppTone, string> = {
  accent: 'bg-accent/15 text-accent',
  blue: 'bg-sysblue/15 text-sysblue',
  green: 'bg-sysgreen/15 text-sysgreen',
  orange: 'bg-sysorange/15 text-sysorange',
  purple: 'bg-syspurple/15 text-syspurple',
  teal: 'bg-systeal/15 text-systeal',
  pink: 'bg-syspink/15 text-syspink',
};

export interface ModuleFeature {
  icon: IconName;
  title: string;
  body: string;
}

/**
 * A polished introduction for a module that becomes functional in a later
 * phase. Honest about timing, but a real, designed screen — not a greybox.
 */
export function ModulePreview({
  icon,
  tone,
  title,
  phase,
  tagline,
  features,
}: {
  icon: IconName;
  tone: AppTone;
  title: string;
  phase: number;
  tagline: string;
  features: ModuleFeature[];
}): JSX.Element {
  return (
    <ViewScroll max={920}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex flex-col items-center pt-6 text-center"
      >
        <span className={`flex h-16 w-16 items-center justify-center rounded-3xl ${TINT[tone]}`}>
          <Icon name={icon} size={30} />
        </span>
        <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
          <Icon name="sparkles" size={13} /> Arrives in Phase {phase}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-[520px] text-md text-muted">{tagline}</p>
      </motion.div>

      <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08 + i * 0.05 }}
            className="surface-raised rounded-2xl p-5 shadow-card"
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${TINT[tone]}`}>
              <Icon name={f.icon} size={18} />
            </span>
            <h3 className="mt-3.5 text-base font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm leading-snug text-muted">{f.body}</p>
          </motion.div>
        ))}
      </div>
    </ViewScroll>
  );
}
