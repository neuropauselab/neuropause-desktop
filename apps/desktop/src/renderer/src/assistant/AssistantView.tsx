/**
 * AssistantView (Phase 6 Stage 4) — the Workspace Assistant experience:
 * conversation panel, mode chips (one pipeline, five configurations), plan
 * viewer with in-conversation approval cards (what / why / impact / honest
 * rollback), tool activity, drafts (review-only), the mandatory explainability
 * strip, and the Session Inspector with its three role-appropriate levels.
 * Presentational: every action arrives via props from AssistantHost.
 */
import { useEffect, useRef, useState } from 'react';
import type {
  AssistantConversation,
  AssistantConversationSummary,
  AssistantEnvelope,
  AssistantMessage,
  AssistantMode,
  AssistantPlanStep,
  AssistantTraceLevel,
} from '@neuropause/shared';
import { ASSISTANT_MODES, ASSISTANT_MODE_META, ASSISTANT_TRACE_LEVELS, ASSISTANT_TRACE_LEVEL_DETAIL } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ProcessingBadge } from '@renderer/firstRun/ProcessingBadge';
import { Button } from '@renderer/components/ui/Button';
import { Spinner } from '@renderer/components/Spinner';
import { approvalCard, explanationSummary, inspectorSections, STEP_STATE_META, stepsAwaitingApproval } from './assistantViewModel';

const EXAMPLES = [
  "Summarize today's work",
  'Find every invoice overdue by 30 days',
  'Show connector problems',
  'Launch the onboarding automation',
  'Draft a customer response',
  "Prepare tomorrow's meeting",
];

export interface AssistantViewProps {
  conversation: AssistantConversation | null;
  summaries: AssistantConversationSummary[];
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  busy: boolean;
  liveNote: string | null;
  onSubmit: (text: string) => void;
  onDecide: (messageId: string, stepId: string, decision: 'approve' | 'reject') => void;
  onCancel: () => void;
  onBranch: (messageId: string) => void;
  onPick: (conversationId: string) => void;
  onNew: () => void;
  onTogglePin: (conversationId: string, pinned: boolean) => void;
  onDelete: (conversationId: string) => void;
  onOpenNavigation: (
    section: string,
    query: string | null,
    mailIntent?: { to: string[]; subject: string; body: string } | null,
  ) => void;
}

export function AssistantView(props: AssistantViewProps): JSX.Element {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [props.conversation?.messages.length, props.busy]);

  const submit = (): void => {
    if (!text.trim() || props.busy) return;
    props.onSubmit(text);
    setText('');
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl gap-4 p-6">
      {/* ── Main conversation column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-3 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--hairline)]">
            <Icon name="sparkles" size={17} className="text-ink" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-ink">Assistant</h1>
            <p className="truncate text-xs text-faint">
              Retrieves first, reasons second, acts only after your approval — every answer explains itself.
            </p>
          </div>
          <Button variant="secondary" onClick={props.onNew}>
            New conversation
          </Button>
        </header>

        {/* Mode chips — one pipeline, five deterministic configurations. */}
        <div role="tablist" aria-label="Assistant mode" className="mb-4 flex flex-wrap gap-1.5">
          {ASSISTANT_MODES.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={props.mode === m}
              title={ASSISTANT_MODE_META[m].hint}
              onClick={() => props.onModeChange(m)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition',
                props.mode === m
                  ? 'border-transparent bg-accent/20 font-medium text-ink'
                  : 'border-[var(--hairline)] text-muted fill-hover hover:text-ink',
              )}
            >
              {ASSISTANT_MODE_META[m].label}
            </button>
          ))}
          <span className="ml-1 self-center text-2xs text-faint">{ASSISTANT_MODE_META[props.mode].hint}</span>
        </div>

        {/* Thread */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3 pr-1">
          {!props.conversation && !props.busy && (
            <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center">
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--hairline)]">
                <Icon name="sparkles" size={18} className="text-faint" />
              </span>
              <p className="text-sm text-ink">Ask anything about your workspace — or ask it to do the work.</p>
              <p className="mx-auto mt-1 max-w-md text-2xs text-faint">
                Answers are grounded in your connected data. Side-effecting steps always stop for your approval, and
                every response shows its sources, tool calls, and confidence.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => props.onSubmit(ex)}
                    className="rounded-full border border-[var(--hairline)] px-3 py-1 text-xs text-muted transition fill-hover hover:text-ink"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {props.conversation?.messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent/15 px-3.5 py-2 text-sm text-ink">
                  {msg.text}
                  {msg.redactions.length > 0 && (
                    <p className="mt-1 text-2xs text-sysorange">
                      Sensitive content was refused and not stored ({msg.redactions.map((r) => r.category).join(', ')}).
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <AssistantReply key={msg.id} message={msg} onDecide={props.onDecide} onBranch={props.onBranch} onOpenNavigation={props.onOpenNavigation} />
            ),
          )}

          {props.busy && (
            <div className="flex items-center gap-2 text-sm text-faint">
              <Spinner size={14} /> {props.liveNote ?? 'Working…'}
              <button type="button" onClick={props.onCancel} className="ml-2 rounded-lg border border-[var(--hairline)] px-2 py-0.5 text-2xs text-muted fill-hover hover:text-ink">
                Stop
              </button>
            </div>
          )}
          {!props.busy && props.liveNote && <p className="text-2xs text-sysorange">{props.liveNote}</p>}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2 focus-within:shadow-focus">
            <Icon name="sparkles" size={15} className="text-faint" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={
                props.mode === 'execute'
                  ? 'Tell the assistant what to do — actions will wait for your approval…'
                  : props.mode === 'monitor'
                    ? 'Ask for the operational picture…'
                    : 'Ask about your workspace…'
              }
              className="flex-1 bg-transparent text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
            />
          </div>
          <Button variant="primary" icon="arrow-right" onClick={submit} disabled={props.busy || !text.trim()}>
            Send
          </Button>
        </div>
      </div>

      {/* ── History rail ── */}
      <aside className="hidden w-64 shrink-0 flex-col gap-2 lg:flex">
        <h2 className="text-2xs uppercase tracking-wide text-faint">Conversations</h2>
        {props.summaries.length === 0 && <p className="text-xs text-faint">No conversations yet.</p>}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {props.summaries.map((s) => (
            <div
              key={s.id}
              className={cn(
                'group rounded-xl border px-3 py-2',
                props.conversation?.id === s.id ? 'border-transparent [background:var(--fill-1)]' : 'border-[var(--hairline)]',
              )}
            >
              <button type="button" onClick={() => props.onPick(s.id)} className="block w-full text-left">
                <span className="block truncate text-xs text-ink">{s.title}</span>
                <span className="block text-2xs text-faint">
                  {s.messageCount} message{s.messageCount === 1 ? '' : 's'}
                  {s.lastIntent ? ` · ${s.lastIntent}` : ''}
                </span>
              </button>
              <div className="mt-1 flex gap-2 opacity-0 transition group-hover:opacity-100">
                <button type="button" onClick={() => props.onTogglePin(s.id, !s.pinned)} className={cn('text-2xs', s.pinned ? 'text-ink' : 'text-faint hover:text-ink')}>
                  <Icon name="pin" size={11} className="mr-0.5 inline" />
                  {s.pinned ? 'Pinned' : 'Pin'}
                </button>
                <button type="button" onClick={() => props.onDelete(s.id)} className="text-2xs text-faint hover:text-sysred">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

/* ── One assistant reply card ──────────────────────────────────────────────── */

function AssistantReply({
  message,
  onDecide,
  onBranch,
  onOpenNavigation,
}: {
  message: AssistantMessage;
  onDecide: AssistantViewProps['onDecide'];
  onBranch: AssistantViewProps['onBranch'];
  onOpenNavigation: AssistantViewProps['onOpenNavigation'];
}): JSX.Element {
  const env = message.envelope;
  const [inspecting, setInspecting] = useState(false);
  if (!env) return <div className="text-sm text-faint">{message.text}</div>;

  return (
    <div className="space-y-2">
      {/* Narrative / clarification */}
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
            <Icon name="sparkles" size={12} /> {env.intent.intent} · {env.mode}
            {env.aiOffline && <span className="text-sysorange">AI offline — deterministic</span>}
          </span>
          {/* Where this turn's AI processing actually ran (execution-stamped). */}
          <ProcessingBadge meta={env.processing ?? null} align="right" />
        </div>
        <p className="whitespace-pre-wrap text-sm text-ink">{env.clarification ?? env.text ?? message.text}</p>
        {env.recommendations.length > 0 && (
          <ul className="mt-2 space-y-1">
            {env.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysorange" />
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Phase 6 Stage 5 — structured deterministic report (brief / meeting
          prep / work summary). Sections are computed evidence; the honest empty
          state renders when nothing was found. */}
      {env.structured && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
            <Icon name={env.structured.kind === 'meeting-brief' ? 'clock' : env.structured.kind === 'intelligence' ? 'sparkles' : 'doc'} size={12} />
            {env.structured.kind === 'brief'
              ? 'Brief'
              : env.structured.kind === 'meeting-brief'
                ? 'Meeting prep'
                : env.structured.kind === 'intelligence'
                  ? 'Enterprise intelligence'
                  : 'Work summary'}
            <span>computed from your data</span>
          </div>
          <div className="text-sm font-medium text-ink">{env.structured.title}</div>
          {env.structured.sections.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              Nothing to report — no evidence was found for this request.
            </p>
          ) : (
            <div className="mt-2 space-y-2.5">
              {env.structured.sections.map((s) => (
                <div key={s.title}>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-faint">{s.title}</div>
                  <ul className="mt-1 space-y-1">
                    {s.lines.map((l, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysblue" />
                        <span className="min-w-0 flex-1">{l}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Deterministic findings */}
      {env.findings.length > 0 && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
            <Icon name="check" size={12} /> Verified findings <span>read directly from your data</span>
          </div>
          <ul className="space-y-1.5">
            {env.findings.slice(0, 8).map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysgreen" />
                <span className="min-w-0 flex-1">
                  <span className="mr-1 text-2xs uppercase tracking-wide text-faint">{f.label}</span>
                  {f.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Draft — review-only */}
      {env.draft && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wide text-faint">Draft {env.draft.kind}</span>
            <Button variant="secondary" icon="clipboard" onClick={() => void navigator.clipboard.writeText(env.draft!.text)}>
              Copy
            </Button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{env.draft.text}</pre>
          <p className="mt-2 text-2xs text-faint">{env.draft.note}</p>
        </div>
      )}

      {/* Plan viewer + approval cards */}
      {env.plan && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
            <Icon name="checklist" size={12} /> Plan · {env.plan.state}
          </div>
          <ol className="space-y-2">
            {env.plan.steps.map((step) => (
              <PlanStepRow key={step.id} step={step} messageId={message.id} onDecide={onDecide} />
            ))}
          </ol>
          {stepsAwaitingApproval(env).length === 0 && env.plan.state === 'waiting' && (
            <p className="mt-2 text-2xs text-faint">Waiting on decisions above.</p>
          )}
        </div>
      )}

      {/* Navigation resolution */}
      {env.navigation && (
        <Button variant="secondary" icon="arrow-right" onClick={() => onOpenNavigation(env.navigation!.section, env.navigation!.query, env.mailIntent ?? null)}>
          Open {env.navigation.section}
          {env.navigation.query ? ` — “${env.navigation.query.length > 40 ? `${env.navigation.query.slice(0, 37)}…` : env.navigation.query}”` : ''}
        </Button>
      )}

      {/* Honesty notes */}
      {(env.unavailable.length > 0 || env.assumptions.length > 0) && (
        <div className="space-y-0.5">
          {env.unavailable.map((u, i) => (
            <p key={`u${i}`} className="text-2xs text-sysorange">
              Unavailable — {u.system}: {u.reason}
            </p>
          ))}
          {env.assumptions.map((a, i) => (
            <p key={`a${i}`} className="text-2xs text-faint">
              Assumption: {a}
            </p>
          ))}
        </div>
      )}

      {/* Explainability strip + Session Inspector + branch */}
      <div className="flex items-center gap-3 text-2xs text-faint">
        <span>{explanationSummary(env)}</span>
        <button type="button" onClick={() => setInspecting((v) => !v)} className="text-muted underline-offset-2 hover:text-ink hover:underline">
          {inspecting ? 'Hide inspector' : 'Inspect'}
        </button>
        <button type="button" onClick={() => onBranch(message.id)} className="text-muted underline-offset-2 hover:text-ink hover:underline">
          Branch from here
        </button>
      </div>
      {inspecting && <SessionInspector envelope={env} />}
    </div>
  );
}

function PlanStepRow({
  step,
  messageId,
  onDecide,
}: {
  step: AssistantPlanStep;
  messageId: string;
  onDecide: AssistantViewProps['onDecide'];
}): JSX.Element {
  const meta = STEP_STATE_META[step.state];
  const toneClass =
    meta.tone === 'green'
      ? 'text-sysgreen'
      : meta.tone === 'orange'
        ? 'text-sysorange'
        : meta.tone === 'red'
          ? 'text-sysred'
          : meta.tone === 'ink'
            ? 'text-ink'
            : 'text-faint';
  const card = approvalCard(step);
  return (
    <li className="rounded-xl border border-[var(--hairline)] p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{step.label}</span>
        <span className={cn('text-2xs font-medium', toneClass)}>{meta.label}</span>
      </div>
      {step.state === 'waiting' && step.needsApproval && (
        <div className="mt-2 rounded-lg border border-dashed border-[var(--hairline)] p-3">
          <p className="text-xs text-ink">
            <span className="text-faint">What: </span>
            {card.what}
          </p>
          <p className="mt-0.5 text-xs text-ink">
            <span className="text-faint">Why: </span>
            {card.why}
          </p>
          <p className="mt-0.5 text-xs text-ink">
            <span className="text-faint">Impact: </span>
            {card.impact} <span className="text-sysorange">Risk: {card.risk}.</span>
          </p>
          <p className="mt-0.5 text-xs text-sysorange">{card.rollback}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => onDecide(messageId, step.id, 'approve')}>
              Approve &amp; run
            </Button>
            <Button variant="secondary" onClick={() => onDecide(messageId, step.id, 'reject')}>
              Reject
            </Button>
          </div>
        </div>
      )}
      {step.resultSummary && <p className="mt-1 text-2xs text-muted">{step.resultSummary}</p>}
      {step.verification && <p className="mt-0.5 text-2xs text-sysgreen">Verified: {step.verification}</p>}
      {step.error && <p className="mt-0.5 text-2xs text-sysred">{step.error}</p>}
      {step.note && <p className="mt-0.5 text-2xs text-faint">{step.note}</p>}
    </li>
  );
}

function SessionInspector({ envelope }: { envelope: AssistantEnvelope }): JSX.Element {
  const [level, setLevel] = useState<AssistantTraceLevel>('user');
  const sections = inspectorSections(envelope.trace, level);
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="mb-3 flex items-center gap-1.5" role="tablist" aria-label="Inspector detail level">
        {ASSISTANT_TRACE_LEVELS.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={level === l}
            title={ASSISTANT_TRACE_LEVEL_DETAIL[l].audience}
            onClick={() => setLevel(l)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-2xs transition',
              level === l ? 'border-transparent bg-accent/20 font-medium text-ink' : 'border-[var(--hairline)] text-muted fill-hover hover:text-ink',
            )}
          >
            {ASSISTANT_TRACE_LEVEL_DETAIL[l].label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.id}>
            <h3 className="mb-1 text-2xs uppercase tracking-wide text-faint">{section.title}</h3>
            {section.rows.length === 0 ? (
              <p className="text-2xs text-faint">—</p>
            ) : (
              <dl className="space-y-0.5">
                {section.rows.map((row, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <dt className="w-44 shrink-0 text-faint">{row.label}</dt>
                    <dd className="min-w-0 flex-1 break-words text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
