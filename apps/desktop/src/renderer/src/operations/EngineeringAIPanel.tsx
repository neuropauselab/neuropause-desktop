import { useCallback, useEffect, useState } from 'react';
import type { EngineeringAnalysis } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { OpsPanel } from './primitives';
import { TINT_TONE } from './lib';

/** The four AI synthesis fields, rendered only when a model produced them. */
function synthesisFields(a: EngineeringAnalysis): Array<{ label: string; icon: IconName; value: string | null }> {
  return [
    { label: 'Root cause', icon: 'search', value: a.rootCause },
    { label: 'Engineering risk', icon: 'activity', value: a.engineeringRisk },
    { label: 'Recommended action', icon: 'bolt', value: a.recommendedAction },
    { label: 'Business impact', icon: 'analytics', value: a.businessImpact },
  ];
}

export function EngineeringAIPanel(): JSX.Element {
  const [analysis, setAnalysis] = useState<EngineeringAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setAnalysis(await ipc.engineering.analyze());
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run once when the tab first opens; the button re-runs on demand.
  useEffect(() => {
    void run();
  }, [run]);

  return (
    <OpsPanel
      title="Engineering AI"
      subtitle="Root-cause analysis over your connected engineering signals — deterministic facts always, AI synthesis when a model is available. Recommendations are advisory; actions require approval."
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {analysis && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium [background:var(--fill-1)]',
                analysis.grounded ? 'text-sysgreen' : 'text-sysorange',
              )}
            >
              <Icon name={analysis.grounded ? 'sparkles' : 'info'} size={12} />
              {analysis.grounded ? `AI · ${analysis.model}` : 'AI offline'}
            </span>
          )}
        </div>
        <Button variant="primary" icon="sparkles" onClick={() => void run()} disabled={loading}>
          {loading ? 'Analyzing…' : 'Re-run'}
        </Button>
      </div>

      {loading && !analysis && (
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--hairline)] p-4 text-sm text-muted">
          <Icon name="sparkles" size={14} className="text-faint" />
          Analyzing your engineering signals…
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          {analysis.aiOffline && (
            <div className="flex items-start gap-2 rounded-xl border border-dashed border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
              <Icon name="info" size={14} className="mt-0.5 shrink-0 text-sysorange" />
              <p className="text-2xs text-muted">
                AI synthesis is offline — showing deterministic facts only. Launch with{' '}
                <code className="text-faint">NEUROPAUSE_LLM_PROVIDER=ollama</code> and Ollama running to enable AI analysis.
              </p>
            </div>
          )}

          {analysis.grounded && (
            <div className="grid gap-3">
              {synthesisFields(analysis).map(({ label, icon, value }) =>
                value ? (
                  <div key={label} className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
                    <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
                      <Icon name={icon} size={13} /> {label}
                    </div>
                    <p className="text-sm text-ink">{value}</p>
                  </div>
                ) : null,
              )}
            </div>
          )}

          {/* Governance — run before display */}
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE.green)}>
                <Icon name="shield" size={13} />
              </span>
              <h3 className="text-sm font-semibold text-ink">Governance</h3>
              <span className="text-2xs text-faint">checked before display</span>
              {analysis.governance.requiresApproval && (
                <span className="ml-auto rounded-full px-2 py-0.5 text-2xs font-medium text-sysorange [background:var(--fill-1)]">
                  Action requires approval
                </span>
              )}
            </div>
            <p className="mb-3 text-sm text-muted">{analysis.governance.reasoning}</p>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Decision" value={analysis.governance.decision} />
              <Stat label="Confidence" value={`${Math.round(analysis.confidence * 100)}%`} />
              <Stat label="Evidence" value={`${analysis.evidence.length} cited`} />
            </div>
            {analysis.contextSources.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-2xs text-faint">Source systems</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.contextSources.map((s) => (
                    <span key={s} className="rounded-lg border border-[var(--hairline)] px-2 py-0.5 text-2xs text-muted">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Deterministic facts — always present */}
          {analysis.facts.length > 0 ? (
            <div className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE.green)}>
                  <Icon name="check" size={13} />
                </span>
                <h3 className="text-sm font-semibold text-ink">Facts</h3>
                <span className="text-2xs text-faint">read directly from your data</span>
              </div>
              <ul className="space-y-2">
                {analysis.facts.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysgreen" />
                    <div className="min-w-0 flex-1">
                      <div className="text-2xs uppercase tracking-wide text-faint">{f.label}</div>
                      <p className="text-sm text-ink">{f.text}</p>
                      <p className="text-2xs text-faint">{f.evidence.length} evidence</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">No engineering signals found in your connected data yet.</p>
          )}
        </div>
      )}
    </OpsPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-2xs text-faint">{label}</div>
      <div className="text-2xs text-ink">{value}</div>
    </div>
  );
}
