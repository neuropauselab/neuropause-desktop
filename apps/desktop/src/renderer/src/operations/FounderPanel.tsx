import { useEffect, useState } from 'react';
import type { FounderFinding, FounderResponse, FounderSuggestedQuestion } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { formatRelative } from '@renderer/lib/format';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { OpsPanel } from './primitives';
import { TINT_TONE } from './lib';
import { FounderWorkspaceRail } from './FounderWorkspaceRail';
import { FounderReasoningTimeline } from './FounderReasoningTimeline';

/** Fallback starter prompts, used when data-derived suggestions aren't available. */
const STARTERS = [
  'What should I work on today?',
  "What's blocking Release 1.0?",
  'What changed overnight?',
  'Which projects are unhealthy?',
  "What's the biggest business risk?",
  'Summarize yesterday.',
];

export function FounderPanel(): JSX.Element {
  const [text, setText] = useState('');
  const [response, setResponse] = useState<FounderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<FounderSuggestedQuestion[]>([]);
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);

  // Pull data-derived suggested questions once; fall back to the static starters.
  useEffect(() => {
    ipc.founderAI
      .suggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, []);

  const ask = async (q: string): Promise<void> => {
    const question = q.trim();
    if (!question) return;
    setText(question);
    setLoading(true);
    setExpandedFinding(null);
    try {
      setResponse(await ipc.founderAI.askV2(question));
    } finally {
      setLoading(false);
    }
  };

  // State discrimination for honest rendering.
  const isClarify = response?.needsClarification ?? false;
  const isNoEvidence =
    !!response &&
    !response.needsClarification &&
    response.keyFindings.length === 0 &&
    !response.grounded;
  const isModelOffline =
    !!response && !response.needsClarification && !isNoEvidence && response.aiOffline;
  const showBadge = !!response && !isClarify && !isNoEvidence;

  const chips: Array<{ text: string; reason: string | null }> =
    suggestions.length > 0 ? suggestions : STARTERS.map((text) => ({ text, reason: null }));

  return (
    <OpsPanel
      title="Founder AI"
      subtitle="Executive intelligence over your connected data — grounded in real evidence, never invented. Deterministic findings always; AI narrative when a model is available."
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2 focus-within:shadow-focus">
              <Icon name="sparkles" size={16} className="text-faint" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void ask(text);
                }}
                placeholder="Ask an executive question — release status, what's blocking, biggest risk…"
                className="flex-1 bg-transparent text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
              />
            </div>
            <Button
              variant="primary"
              icon="sparkles"
              onClick={() => void ask(text)}
              disabled={loading || !text.trim()}
            >
              {loading ? 'Thinking…' : 'Ask'}
            </Button>
          </div>

          <div className="mb-5 flex flex-wrap gap-1.5">
            {chips.map((q) => (
              <button
                key={q.text}
                type="button"
                onClick={() => void ask(q.text)}
                disabled={loading}
                title={q.reason ?? undefined}
                className="rounded-full border border-[var(--hairline)] px-3 py-1 text-xs text-muted transition hover:text-ink fill-hover disabled:opacity-50"
              >
                {q.text}
              </button>
            ))}
          </div>

          {!response && !loading && (
            <EmptyState
              icon="sparkles"
              title="Ask a question"
              description="Founder AI classifies your question, gathers only the relevant evidence from your unified data, knowledge graph, timeline, and Mission Brief, and answers as an executive briefing — or tells you when there isn't enough evidence."
              compact
            />
          )}

          {loading && !response && (
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--hairline)] p-4 text-sm text-muted">
              <Icon name="sparkles" size={14} className="text-faint" />
              Gathering evidence and composing your briefing…
            </div>
          )}

          {response && (
            <div className="space-y-4">
              {showBadge && (
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium [background:var(--fill-1)]',
                      response.grounded ? 'text-sysgreen' : 'text-sysorange',
                    )}
                  >
                    <Icon name={response.grounded ? 'sparkles' : 'info'} size={12} />
                    {response.grounded ? `AI · ${response.model}` : 'AI offline'}
                  </span>
                  <span className="text-2xs text-faint">
                    {response.intent} · {Math.round(response.intentConfidence * 100)}% intent match
                  </span>
                </div>
              )}

              {/* Clarification — the question was too ambiguous to answer responsibly. */}
              {isClarify && response.clarification && (
                <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
                  <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
                    <Icon name="info" size={13} /> Need a bit more
                  </div>
                  <p className="text-sm text-ink">{response.clarification}</p>
                </div>
              )}

              {/* Honest no-evidence answer. */}
              {isNoEvidence && (
                <div className="flex items-start gap-2 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
                  <Icon name="info" size={14} className="mt-0.5 shrink-0 text-sysorange" />
                  <p className="text-sm text-ink">{response.executiveSummary}</p>
                </div>
              )}

              {/* Model offline but data exists — deterministic findings still render below. */}
              {isModelOffline && (
                <div className="flex items-start gap-2 rounded-xl border border-dashed border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
                  <Icon name="info" size={14} className="mt-0.5 shrink-0 text-sysorange" />
                  <p className="text-2xs text-muted">
                    AI narrative is offline — showing deterministic findings only. Launch with{' '}
                    <code className="text-faint">NEUROPAUSE_LLM_PROVIDER=ollama</code> and Ollama
                    running to enable the executive narrative.
                  </p>
                </div>
              )}

              {!isClarify && !isNoEvidence && (
                <>
                  {/* Executive Summary — AI narrative over the findings. */}
                  {response.executiveSummary && (
                    <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
                      <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
                        <Icon name="clipboard" size={13} /> Executive summary
                      </div>
                      <p className="text-sm text-ink">{response.executiveSummary}</p>
                    </div>
                  )}

                  {/* Key Findings — deterministic, read from data, with evidence. */}
                  {response.keyFindings.length > 0 && (
                    <div className="rounded-2xl border border-[var(--hairline)] p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-lg',
                            TINT_TONE.green,
                          )}
                        >
                          <Icon name="check" size={13} />
                        </span>
                        <h3 className="text-sm font-semibold text-ink">Key findings</h3>
                        <span className="text-2xs text-faint">
                          read directly from your data — tap to inspect
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {response.keyFindings.map((f, i) => {
                          const open = expandedFinding === i;
                          return (
                            <li key={i}>
                              <button
                                type="button"
                                onClick={() => setExpandedFinding(open ? null : i)}
                                className="flex w-full items-start gap-2 rounded-lg px-1 py-1 text-left transition fill-hover"
                              >
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysgreen" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-2xs uppercase tracking-wide text-faint">
                                    {f.label}
                                  </div>
                                  <p className="text-sm text-ink">{f.text}</p>
                                  <p className="text-2xs text-faint">
                                    {f.evidence.length} evidence
                                    {f.connectorId ? ` · ${f.connectorId}` : ''}
                                  </p>
                                </div>
                                <Icon
                                  name={open ? 'chevron-down' : 'chevron-right'}
                                  size={13}
                                  className="mt-1 shrink-0 text-faint"
                                />
                              </button>
                              {open && <EvidenceDetail finding={f} />}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Business Impact — AI narrative. */}
                  {response.businessImpact && (
                    <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
                      <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
                        <Icon name="analytics" size={13} /> Business impact
                      </div>
                      <p className="text-sm text-ink">{response.businessImpact}</p>
                    </div>
                  )}

                  {/* Recommendations — advisory; actions require approval. */}
                  {response.recommendations.length > 0 && (
                    <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-lg',
                            TINT_TONE.orange,
                          )}
                        >
                          <Icon name="lightbulb" size={13} />
                        </span>
                        <h3 className="text-sm font-semibold text-ink">Recommendations</h3>
                        <span className="text-2xs text-faint">advisory — not actions</span>
                        {response.governance.requiresApproval && (
                          <span className="ml-auto rounded-full px-2 py-0.5 text-2xs font-medium text-sysorange [background:var(--fill-1)]">
                            Action requires approval
                          </span>
                        )}
                      </div>
                      <ul className="space-y-2">
                        {response.recommendations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysorange" />
                            <p className="flex-1 text-sm text-ink">{r}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {/* Governance — run before display (always shown for an answered question). */}
              {!isClarify && (
                <div className="rounded-2xl border border-[var(--hairline)] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-lg',
                        TINT_TONE.green,
                      )}
                    >
                      <Icon name="shield" size={13} />
                    </span>
                    <h3 className="text-sm font-semibold text-ink">Governance</h3>
                    <span className="text-2xs text-faint">checked before display</span>
                  </div>
                  <p className="mb-3 text-sm text-muted">{response.governance.reasoning}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Decision" value={response.governance.decision} />
                    <Stat label="Confidence" value={`${Math.round(response.confidence * 100)}%`} />
                    <Stat label="Evidence" value={`${response.evidence.length} cited`} />
                  </div>
                  {response.sourceSystems.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 text-2xs text-faint">Source systems</div>
                      <div className="flex flex-wrap gap-1.5">
                        {response.sourceSystems.map((s) => (
                          <span
                            key={s}
                            className="rounded-lg border border-[var(--hairline)] px-2 py-0.5 text-2xs text-muted"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isClarify && !isNoEvidence && <FounderReasoningTimeline response={response} />}

              <MemoryNote response={response} />
            </div>
          )}
        </div>
        <FounderWorkspaceRail />
      </div>
    </OpsPanel>
  );
}

function EvidenceDetail({ finding }: { finding: FounderFinding }): JSX.Element {
  const byKind = new Map<string, number>();
  for (const e of finding.evidence) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  return (
    <div className="mb-1 ml-5 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-2xs text-faint">
        {finding.connectorId && (
          <span className="rounded border border-[var(--hairline)] px-1.5 py-0.5">
            {finding.connectorId}
          </span>
        )}
        {finding.at && <span>{formatRelative(finding.at)}</span>}
        {!finding.connectorId && !finding.at && <span>Evidence breakdown</span>}
      </div>
      {byKind.size === 0 ? (
        <p className="text-2xs text-faint">No evidence references.</p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {[...byKind.entries()].map(([kind, n]) => (
            <span key={kind} className="text-2xs text-muted">
              {n} {kind}
              {n === 1 ? '' : 's'}
            </span>
          ))}
        </div>
      )}
    </div>
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

function scopeLabel(scope: string): string {
  switch (scope) {
    case 'today':
      return 'for today';
    case 'project':
      return 'with the project';
    case 'temporary':
      return 'for this session';
    default:
      return 'long-term';
  }
}

/** What conversation memory recalled to ground this answer, and what it kept afterward. */
function MemoryNote({ response }: { response: FounderResponse }): JSX.Element | null {
  const recalled = response.recalledMemories;
  const cap = response.memoryCapture;
  const showCapture = cap !== null && cap.outcome !== 'ignored';
  if (recalled.length === 0 && !showCapture) return null;

  return (
    <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE.purple)}
        >
          <Icon name="memory" size={13} />
        </span>
        <h3 className="text-sm font-semibold text-ink">Memory</h3>
        <span className="text-2xs text-faint">grounded in past conversations · never secrets</span>
      </div>

      {recalled.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-2xs text-faint">
            Drawing on {recalled.length} related memor{recalled.length === 1 ? 'y' : 'ies'}
          </div>
          <ul className="space-y-1">
            {recalled.slice(0, 4).map((m) => (
              <li key={m.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-syspurple" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{m.title}</p>
                  <p className="text-2xs text-faint">
                    {m.type}
                    {m.project ? ` · ${m.project}` : ''} · {formatRelative(m.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showCapture && cap.outcome === 'stored' && (
        <div className="flex items-center gap-2 text-2xs text-muted">
          <Icon name="check" size={12} className="text-sysgreen" />
          Remembered as a {cap.type}
          {cap.scope ? ` · kept ${scopeLabel(cap.scope)}` : ''}
        </div>
      )}
      {showCapture && cap.outcome === 'rejected' && (
        <div className="flex items-start gap-2 text-2xs text-muted">
          <Icon name="shield" size={12} className="mt-0.5 shrink-0 text-sysorange" />
          <span>
            Not stored — {cap.rejections.map((r) => r.category).join(', ')} detected and discarded.
          </span>
        </div>
      )}
    </div>
  );
}
