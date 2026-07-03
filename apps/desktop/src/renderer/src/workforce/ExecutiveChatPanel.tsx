import { useState } from 'react';
import type { ActionEvidence, FounderAnswer } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { Spinner } from '@renderer/components/Spinner';
import { OpsPanel } from '@renderer/operations/primitives';
import { useWorkforce } from './WorkforceProvider';
import { EvidencePills, Pill } from './primitives';
import { riskMeta, TINT_TONE, titleCase } from './lib';

const EXAMPLES = [
  "Show today's priorities",
  'What projects are blocked?',
  'Which AI workers are idle?',
  'Show pending approvals',
  'Summarize today\'s work',
];

interface WorkforceLine {
  text: string;
  evidence: ActionEvidence[];
}

type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; kind: 'founder'; answer: FounderAnswer }
  | { id: number; role: 'assistant'; kind: 'workforce'; title: string; lines: WorkforceLine[]; empty?: string };

let mid = 0;

export function ExecutiveChatPanel(): JSX.Element {
  const { workers, jobs } = useWorkforce();
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const localAnswer = (q: string): Omit<Extract<Message, { kind: 'workforce' }>, 'id' | 'role' | 'kind'> | null => {
    const l = q.toLowerCase();
    if (/\bidle\b/.test(l) && /worker/.test(l)) {
      const idle = workers.filter((w) => w.lifecycle === 'idle');
      return {
        title: 'Idle AI workers',
        empty: idle.length ? undefined : 'No workers are idle right now — all are registered, running, or paused.',
        lines: idle.map((w) => ({
          text: `${w.name} (${w.role}) is idle · trust ${Math.round(w.trustScore * 100)}%`,
          evidence: [{ kind: 'worker', id: w.id }],
        })),
      };
    }
    if ((/pending|waiting|open/.test(l) && /approval/.test(l)) || /approvals?$/.test(l.trim())) {
      const lines: WorkforceLine[] = [];
      for (const j of jobs) {
        if (j.status !== 'awaiting_approval') continue;
        for (const p of j.proposals) {
          if (p.verdict.decision === 'require_approval' && !p.approval) {
            const worker = workers.find((w) => w.id === j.workerId);
            lines.push({
              text: `${worker?.name ?? j.workerId} proposes “${p.title}” (${riskMeta(p.risk).label} risk)`,
              evidence: [{ kind: 'job', id: j.id }, ...p.evidence],
            });
          }
        }
      }
      return {
        title: 'Pending approvals',
        empty: lines.length ? undefined : 'Nothing is waiting for approval. The Approval Center is clear.',
        lines,
      };
    }
    if (/running|in progress|active|doing now/.test(l) && /job|task|worker|now/.test(l)) {
      const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
      return {
        title: 'Active jobs',
        empty: running.length ? undefined : 'No jobs are running or queued at the moment.',
        lines: running.map((j) => {
          const worker = workers.find((w) => w.id === j.workerId);
          return {
            text: `${worker?.name ?? j.workerId} · ${titleCase(j.skillId)} · ${j.status}`,
            evidence: [{ kind: 'job', id: j.id }],
          };
        }),
      };
    }
    return null;
  };

  const ask = async (q: string): Promise<void> => {
    const question = q.trim();
    if (!question || loading) return;
    setText('');
    setMessages((m) => [{ id: mid++, role: 'user', text: question }, ...m]);
    setLoading(true);
    try {
      const local = localAnswer(question);
      if (local) {
        setMessages((m) => [{ id: mid++, role: 'assistant', kind: 'workforce', ...local }, ...m]);
      } else {
        const answer = await ipc.founderAI.ask(question);
        setMessages((m) => [{ id: mid++, role: 'assistant', kind: 'founder', answer }, ...m]);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <OpsPanel
      title="Executive Chat"
      subtitle="Your secure executive assistant. Business questions are answered by the Enterprise Intelligence Layer; workforce questions read live worker and job state. Every answer cites its evidence."
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2 focus-within:shadow-focus">
          <Icon name="sparkles" size={16} className="text-faint" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ask(text);
            }}
            placeholder="Ask about priorities, blockers, idle workers, pending approvals…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
        </div>
        <Button variant="primary" icon="arrow-right" onClick={() => void ask(text)} disabled={loading || !text.trim()}>
          Ask
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => void ask(ex)}
            className="rounded-full border border-[var(--hairline)] px-3 py-1 text-xs text-muted transition hover:text-ink fill-hover"
          >
            {ex}
          </button>
        ))}
      </div>

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-sm text-faint">
          <Spinner size={14} /> Thinking…
        </div>
      )}

      {messages.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-8 text-center">
          <span className={cn('mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl', TINT_TONE.accent)}>
            <Icon name="sparkles" size={18} />
          </span>
          <p className="text-sm text-ink">Ask anything about your organization or your AI workforce.</p>
          <p className="mt-1 text-2xs text-faint">Answers are grounded in your data and live worker state — never invented.</p>
        </div>
      )}

      <div className="space-y-3">
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent/15 px-3.5 py-2 text-sm text-ink">{msg.text}</div>
            </div>
          ) : msg.kind === 'founder' ? (
            <FounderReply key={msg.id} answer={msg.answer} />
          ) : (
            <WorkforceReply key={msg.id} title={msg.title} lines={msg.lines} empty={msg.empty} />
          ),
        )}
      </div>
    </OpsPanel>
  );
}

function WorkforceReply({ title, lines, empty }: { title: string; lines: WorkforceLine[]; empty?: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE.blue)}>
          <Icon name="cpu" size={13} />
        </span>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <Pill tone="gray">live workforce</Pill>
      </div>
      {empty ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((ln, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysblue" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{ln.text}</p>
                <div className="mt-1">
                  <EvidencePills evidence={ln.evidence} max={4} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FounderReply({ answer }: { answer: FounderAnswer }): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-faint">
          <Icon name="sparkles" size={13} /> {answer.intent} · {answer.evidenceCount} evidence ·{' '}
          {answer.grounded ? 'grounded' : 'no data'}
        </div>
        <p className="text-sm text-ink">{answer.summary}</p>
      </div>

      {answer.facts.length > 0 && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE.green)}>
              <Icon name="check" size={13} />
            </span>
            <h3 className="text-sm font-semibold text-ink">Facts</h3>
            <span className="text-2xs text-faint">read directly from your data</span>
          </div>
          <ul className="space-y-2">
            {answer.facts.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysgreen" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{f.text}</p>
                  <div className="mt-1">
                    <EvidencePills evidence={f.evidence} max={4} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.suggestions.length > 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', TINT_TONE.orange)}>
              <Icon name="lightbulb" size={13} />
            </span>
            <h3 className="text-sm font-semibold text-ink">Suggestions</h3>
            <span className="text-2xs text-faint">derived — not facts</span>
          </div>
          <ul className="space-y-2">
            {answer.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sysorange" />
                <p className="flex-1 text-sm text-ink">{s.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.references.length > 0 && (
        <div>
          <h3 className="mb-2 text-2xs uppercase tracking-wide text-faint">References</h3>
          <div className="flex flex-wrap gap-1.5">
            {answer.references.map((r) => (
              <span key={r.id} className="rounded-lg border border-[var(--hairline)] px-2 py-1 text-xs text-muted">
                <span className="text-faint">{r.kind}</span> · {r.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
