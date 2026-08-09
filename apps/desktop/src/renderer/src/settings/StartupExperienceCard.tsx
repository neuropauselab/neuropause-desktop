/**
 * Constitutional Settings v1.0 — Startup Experience control (the flagship net-new, fully backed).
 *
 * A real preference over the existing pref store + the real section registry. It never invents a destination
 * and never errors: the resolved-destination preview runs the SAME `resolveStartupSection` the shell uses at
 * launch, so the fallback chain (Intent Home → Organization → Workspace → Settings) is visible and honest.
 */
import { useState } from 'react';
import { Card } from '@renderer/components/ui/Card';
import { SECTIONS } from '@renderer/shell/sections';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { cn } from '@renderer/lib/cn';
import { resolveStartupSection, startupSectionChoices, type StartupMode } from '@renderer/shell/startupPolicy';

const MODE_LABEL: Record<StartupMode, { title: string; detail: string }> = {
  resume: { title: 'Resume where I left off', detail: 'Open the section you last used.' },
  section: { title: 'Open a specific section', detail: 'Always start on the section you choose below.' },
  smart: { title: 'Smart (recommended)', detail: 'Resume unfinished work, otherwise open Today’s Intent.' },
};

function sectionLabel(id: string): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}

export function StartupExperienceCard(): JSX.Element {
  const [mode, setMode] = useState<StartupMode>(() => prefs.read<StartupMode>(PrefKey.startupMode, 'resume'));
  const [section, setSection] = useState<string>(() => prefs.read<string>(PrefKey.startupSection, 'intent-home'));

  const choices = startupSectionChoices();
  const lastSection = prefs.read<string>(PrefKey.activeSection, 'intent-home');
  const hasUnfinishedWork = (prefs.read<unknown[]>(PrefKey.workspaceTabs, []) ?? []).length > 0;
  const resolved = resolveStartupSection({ mode, configuredSection: section, lastSection, hasUnfinishedWork });

  const chooseMode = (m: StartupMode): void => {
    setMode(m);
    prefs.write(PrefKey.startupMode, m);
  };
  const chooseSection = (id: string): void => {
    setSection(id);
    prefs.write(PrefKey.startupSection, id);
  };

  return (
    <Card>
      <div className="space-y-2">
        {(Object.keys(MODE_LABEL) as StartupMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => chooseMode(m)}
            className={cn(
              'flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-[background-color,color,border-color,box-shadow,transform,opacity] motion-reduce:transition-none',
              mode === m ? 'border-accent bg-accent/[0.06]' : 'border-[var(--hairline)] hover:bg-white/[0.03]',
            )}
          >
            <span className={cn('mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2', mode === m ? 'border-accent bg-accent' : 'border-[var(--hairline)]')} />
            <span className="min-w-0">
              <span className="block text-base font-medium">{MODE_LABEL[m].title}</span>
              <span className="block text-sm text-faint">{MODE_LABEL[m].detail}</span>
            </span>
          </button>
        ))}
      </div>

      {mode === 'section' && (
        <div className="mt-4">
          <label className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-faint">Startup section</label>
          <select
            value={section}
            onChange={(e) => chooseSection(e.target.value)}
            className="w-full rounded-xl border border-[var(--hairline)] bg-white/[0.03] px-3 py-2.5 text-base outline-none focus:border-accent"
          >
            {choices.map((id) => (
              <option key={id} value={id}>{sectionLabel(id)}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--hairline)] bg-white/[0.02] px-3.5 py-2.5 text-sm">
        <span className="text-faint">On next launch, opens to</span>
        <span className="font-medium text-accent">{sectionLabel(resolved)}</span>
        {resolved !== (mode === 'section' ? section : mode === 'resume' ? lastSection : resolved) && (
          <span className="text-2xs text-faint">(auto-fallback — original destination unavailable)</span>
        )}
      </div>
      <p className="mt-2 text-xs text-faint">
        If a chosen destination is ever hidden, removed, or you lose access, NeuroPause redirects automatically
        — Intent Home, then Organization, then Workspace — and never shows an error.
      </p>
    </Card>
  );
}
