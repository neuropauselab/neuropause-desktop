import type { FounderResponse } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { TINT_TONE, type OpsTone } from './lib';

/**
 * Shows how an executive answer was produced — the deterministic pipeline behind
 * it. Every value is read straight off the response (intent, sources, model,
 * governance); nothing extra is fetched or inferred.
 */
interface Step {
  label: string;
  detail: string;
  icon: IconName;
  tone: OpsTone;
}

export function FounderReasoningTimeline({ response }: { response: FounderResponse }): JSX.Element {
  const sources = response.sourceSystems;
  const steps: Step[] = [
    {
      label: 'Intent detected',
      detail: `${response.intent} · ${Math.round(response.intentConfidence * 100)}% match`,
      icon: 'search',
      tone: 'blue',
    },
    {
      label: 'Context gathered',
      detail:
        sources.length > 0
          ? `${sources.length} source ${sources.length === 1 ? 'system' : 'systems'} · ${response.evidence.length} evidence`
          : 'no context retrieved',
      icon: 'layers',
      tone: 'purple',
    },
    {
      label: response.grounded ? 'Model reasoned' : 'Model offline',
      detail: response.grounded ? response.model : 'deterministic findings only',
      icon: 'sparkles',
      tone: response.grounded ? 'green' : 'orange',
    },
    {
      label: 'Governance checked',
      detail: response.governance.requiresApproval
        ? `${response.governance.decision} · action requires approval`
        : response.governance.decision,
      icon: 'shield',
      tone: response.governance.requiresApproval ? 'orange' : 'green',
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="pulse" size={13} className="text-faint" />
        <h3 className="text-sm font-semibold text-ink">Reasoning</h3>
        <span className="text-2xs text-faint">how this answer was produced</span>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-lg',
                  TINT_TONE[s.tone],
                )}
              >
                <Icon name={s.icon} size={12} />
              </span>
              {i < steps.length - 1 && <span className="my-0.5 w-px flex-1 bg-[var(--hairline)]" />}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <p className="text-xs font-medium text-ink">{s.label}</p>
              <p className="text-2xs text-muted">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
