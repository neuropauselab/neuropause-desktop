import { useState } from 'react';
import type { FounderResponse } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';

/**
 * Execution panel (Execute v1). The always-visible "do it" surface: the user
 * types a task and the AI actually runs it via founderAI.askV2, returning a
 * grounded FounderResponse (summary, findings, recommendations). Rendered fully
 * defensively so a malformed response can never crash the Command Center.
 */
export function ExecutePanel(): JSX.Element {
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FounderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = async (): Promise<void> => {
    const text = task.trim();
    if (!text || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await ipc.founderAI.askV2(text);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const findings = result?.keyFindings ?? [];
  const recommendations = result?.recommendations ?? [];

  return (
    <section className="mb-5 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10">
          <Icon name="bolt" size={14} />
        </span>
        <h3 className="text-sm font-semibold text-ink">Execute</h3>
        <span className="text-xs text-faint">Type a task and NeuroPause runs it on your data.</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void execute();
          }}
          placeholder="e.g. Summarize today's activity, draft the investor update, find open risks…"
          aria-label="Task to execute"
          disabled={running}
          className="min-w-0 flex-1 rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void execute()}
          disabled={running || task.trim().length === 0}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition',
            'bg-white text-black hover:opacity-90 disabled:opacity-40',
          )}
        >
          {running ? (
            <>
              <Icon name="refresh" size={14} className="animate-spin" /> Running…
            </>
          ) : (
            <>
              <Icon name="play" size={14} /> Execute
            </>
          )}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2.5 text-xs text-white/70">
          Couldn't run that: {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-3 rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] p-3.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint">
            <span>Result</span>
            {result.grounded && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                grounded in your data
              </span>
            )}
            {result.aiOffline && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                offline heuristic
              </span>
            )}
            {result.model && <span className="text-faint">· {result.model}</span>}
          </div>

          {result.needsClarification && result.clarification && (
            <p className="text-sm text-white/80">{result.clarification}</p>
          )}

          {result.executiveSummary && (
            <p className="text-sm leading-relaxed text-ink">{result.executiveSummary}</p>
          )}

          {findings.length > 0 && (
            <div className="space-y-1.5">
              {findings.map((f, i) => (
                <div key={i} className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                  <div className="text-xs font-medium text-ink">{f.label}</div>
                  {f.text && <div className="mt-0.5 text-xs text-white/60">{f.text}</div>}
                </div>
              ))}
            </div>
          )}

          {result.businessImpact && (
            <p className="text-xs text-white/60">
              <span className="text-faint">Impact: </span>
              {result.businessImpact}
            </p>
          )}

          {recommendations.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">
                Recommended next
              </div>
              <ul className="space-y-1">
                {recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-white/70">
                    <Icon name="arrow-right" size={12} className="mt-0.5 shrink-0 text-white/40" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
