/**
 * AI Home — "What do you want to accomplish?"
 *
 * A focused ask surface over the REAL assistant pipeline: the ask goes through
 * `ipc.assistant.ask` (the same turn pipeline as the Assistant section —
 * context, retrieval, reasoning, audit, one correlation id), and the response
 * renders with the processing badge derived from the envelope's execution
 * metadata. Suggestions are capability-aware: composed from the live routing
 * plan and the live record counts, so nothing is offered that cannot execute.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssistantAskResult,
  AssistantEnvelope,
  AiRoutingStatusView,
  ExperienceProfile,
} from '@neuropause/shared';
import { WORKSPACE_TYPE_LABELS } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import type { SectionId } from '@renderer/shell/sections';
import {
  attentionSummary,
  processingIndicatorText,
  suggestedActions,
  type AttentionItem,
  type CapabilitySnapshot,
} from './experienceModel';
import { ProcessingBadge } from './ProcessingBadge';
import { setWorkspaceType } from './workspaceTypeStore';

const log = createLogger('ai-home');

export function AiHomeView({ onNavigate }: { onNavigate: (section: SectionId) => void }): JSX.Element {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [envelope, setEnvelope] = useState<AssistantEnvelope | null>(null);
  const [routing, setRouting] = useState<AiRoutingStatusView | null>(null);
  const [profile, setProfile] = useState<ExperienceProfile | null>(null);
  const [populatedModules, setPopulatedModules] = useState(0);
  const [openHolds, setOpenHolds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const [attention, setAttention] = useState<AttentionItem[] | null>(null);

  useEffect(() => {
    ipc.aiConfig
      .routingStatus()
      .then(setRouting)
      .catch(() => setRouting(null));
    ipc.firstRun
      .get()
      .then(setProfile)
      .catch(() => setProfile(null));
    ipc.data
      .exportable()
      .then((mods) => setPopulatedModules(mods.filter((m) => m.recordCount > 0).length))
      .catch(() => setPopulatedModules(0));
    // Open holds are real work already waiting on this person. An RBAC refusal
    // leaves the count at 0 and simply omits the prompt — never a fabricated one.
    ipc.holds
      .list(200)
      .then((view) => setOpenHolds(view.open.length))
      .catch(() => setOpenHolds(0));
  }, []);

  // Business attention — REAL counts from real queries, each tile appearing
  // only when its query succeeded (an RBAC refusal or absent module simply
  // omits the tile; nothing is fabricated to fill space).
  useEffect(() => {
    if (!profile || profile.workspaceType === 'personal') return;
    let mounted = true;
    const tiles: AttentionItem[] = [];
    const settle = (): void => {
      if (mounted) setAttention([...tiles]);
    };
    void Promise.allSettled([
      ipc.enterpriseModules
        .records('executive-decisions', { status: 'active', limit: 500 })
        .then((rows) =>
          tiles.push({
            id: 'decisions',
            label: 'Decisions awaiting review',
            count: rows.length,
            section: 'enterprise',
          }),
        ),
      ipc.enterpriseModules
        .records('helpdesk-tickets', { status: 'active', limit: 500 })
        .then((rows) =>
          tiles.push({ id: 'tickets', label: 'Open tickets', count: rows.length, section: 'business' }),
        ),
      ipc.medicalDevice.lots
        .list({ view: 'quarantined', limit: 1 })
        .then((page) =>
          tiles.push({
            id: 'quarantined',
            label: 'Batches in quarantine',
            count: page.counts.quarantined,
            section: 'medical-devices',
          }),
        ),
    ]).then(settle);
    return () => {
      mounted = false;
    };
  }, [profile]);

  const snapshot: CapabilitySnapshot = useMemo(
    () => ({
      workspaceType: profile?.workspaceType ?? null,
      populatedModules,
      canImport: true, // the Data Command Center ships in every build
      aiAvailable: Boolean(routing?.plan.ok),
      // Only CONFIRMED attributes reach a suggestion — `suggestedActions`
      // filters, but passing the whole set keeps that rule in one place.
      understanding: profile?.attributes ?? [],
      openHolds,
    }),
    [profile, populatedModules, routing, openHolds],
  );

  const suggestions = useMemo(() => suggestedActions(snapshot), [snapshot]);

  const ask = useCallback(
    async (prompt?: string): Promise<void> => {
      const q = (prompt ?? text).trim();
      if (!q || asking) return;
      setAsking(true);
      setError(null);
      setEnvelope(null);
      try {
        const result: AssistantAskResult = await ipc.assistant.ask({ text: q });
        const message = result.conversation.messages.find((m) => m.id === result.messageId);
        setEnvelope(message?.envelope ?? null);
      } catch (err) {
        log.warn('Ask failed', { message: err instanceof Error ? err.message : String(err) });
        setError(err instanceof Error ? err.message : 'That did not work.');
      } finally {
        setAsking(false);
      }
    },
    [text, asking],
  );

  const firstLocation = routing?.plan.ok ? (routing.plan.attempts[0]?.location ?? null) : null;

  return (
    <ViewScroll max={860}>
      <ViewHeader
        title="What do you want to accomplish?"
        subtitle="Ask in your own words. Every answer shows where the AI actually ran — locally, on your private infrastructure, or through a provider you enabled."
      />

      {profile && profile.workspaceType !== 'personal' && attention !== null && (
        <section aria-label="What needs your attention" className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted">What needs your attention:</span>
            {attention.filter((a) => a.count > 0).length === 0 ? (
              <span className="text-sm text-faint">{attentionSummary(attention)}</span>
            ) : (
              attention
                .filter((a) => a.count > 0)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="rounded-full border border-[var(--hairline)] px-3 py-1 text-sm hover:[background:var(--fill-1)] focus-visible:outline focus-visible:outline-2"
                    onClick={() => onNavigate(a.section)}
                  >
                    <span className="font-semibold tabular-nums">{a.count}</span>{' '}
                    <span className="text-muted">{a.label.toLowerCase()}</span>
                  </button>
                ))
            )}
          </div>
        </section>
      )}

      <Card variant="flat" className="p-4">
        <label htmlFor="ai-home-ask" className="sr-only">
          Ask NeuroPause
        </label>
        <textarea
          id="ai-home-ask"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
          rows={3}
          placeholder="Ask NeuroPause…"
          className="w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-faint"
          disabled={asking}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-faint" aria-live="polite">
            {asking
              ? processingIndicatorText(firstLocation)
              : routing?.plan.ok
                ? firstLocation === 'local'
                  ? 'Ready — a local route will be tried first.'
                  : firstLocation === 'private_infrastructure'
                    ? 'Ready — your private infrastructure will be tried first.'
                    : 'Ready — the provider you enabled will serve this.'
                : routing
                  ? 'No AI route is available — deterministic answers still work, and nothing is sent anywhere.'
                  : ''}
          </span>
          <Button variant="primary" size="sm" icon="sparkles" disabled={asking || !text.trim()} onClick={() => void ask()}>
            {asking ? 'Working…' : 'Ask'}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="mt-4">
          <NoticeBlock icon="info">{error}</NoticeBlock>
        </div>
      )}

      {envelope && (
        <Card variant="flat" className="mt-4 p-5">
          {/* ── Layer 1 — ANSWER ── */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-faint">Answer</h2>
            <ProcessingBadge meta={envelope.processing ?? null} align="right" />
          </div>
          {envelope.text ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{envelope.text}</p>
          ) : (
            <p className="text-sm text-muted">
              {envelope.clarification ??
                (envelope.findings.length > 0
                  ? 'No narrative was generated — the evidence below was computed deterministically.'
                  : 'Nothing came back for that. Try rephrasing, or open the Assistant for the full conversation view.')}
            </p>
          )}

          {/* ── Layer 2 — REASON ── */}
          {(envelope.reasoningSummary || envelope.recommendations.length > 0) && (
            <div className="mt-3 border-t border-[var(--hairline)] pt-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">Reason</h3>
              {envelope.reasoningSummary && (
                <p className="text-sm leading-relaxed text-muted">{envelope.reasoningSummary}</p>
              )}
              {envelope.recommendations.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {envelope.recommendations.slice(0, 5).map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted">
                      <Icon name="arrow-right" size={12} className="mt-1 shrink-0 text-faint" aria-hidden="true" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Layer 3 — EVIDENCE ── */}
          <div className="mt-3 border-t border-[var(--hairline)] pt-3">
            <button
              type="button"
              className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-faint hover:text-ink focus-visible:outline focus-visible:outline-2"
              aria-expanded={evidenceOpen}
              onClick={() => setEvidenceOpen((o) => !o)}
            >
              <Icon name="eye" size={12} aria-hidden="true" />
              {evidenceOpen ? 'Hide evidence' : 'View evidence'}
              {envelope.findings.length > 0 && (
                <span className="font-normal normal-case tracking-normal">
                  · {envelope.findings.length} item{envelope.findings.length === 1 ? '' : 's'}
                </span>
              )}
            </button>
            {evidenceOpen &&
              (envelope.findings.length === 0 && envelope.sources.length === 0 ? (
                <p className="text-sm text-faint">
                  No structured evidence backs this answer. That is a property of the answer, stated rather than
                  papered over.
                </p>
              ) : (
                <>
                  {envelope.findings.length > 0 && (
                    <ul className="space-y-1.5">
                      {envelope.findings.slice(0, 10).map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted">
                          <Icon name="dot" size={12} className="mt-1 shrink-0 text-faint" aria-hidden="true" />
                          <span>
                            <span className="font-medium text-ink">{f.label}:</span> {f.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {envelope.sources.length > 0 && (
                    <p className="mt-2 text-xs text-faint">
                      Sources: {envelope.sources.map((s) => `${s.label} (${s.count})`).join(' · ')}
                    </p>
                  )}
                </>
              ))}
          </div>

          <div className="mt-4 flex gap-2">
            {envelope.navigation && (
              <Button
                size="sm"
                variant="primary"
                icon="launch"
                onClick={() => onNavigate(envelope.navigation!.section as SectionId)}
              >
                Open the records
              </Button>
            )}
            <Button size="sm" icon="launch" onClick={() => onNavigate('assistant')}>
              Continue in Assistant
            </Button>
          </div>
        </Card>
      )}

      <section className="mt-8" aria-label="Suggested actions">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-faint">
          Try your first task
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="rounded-xl border border-[var(--hairline)] px-4 py-3 text-left text-sm hover:[background:var(--fill-1)] focus-visible:outline focus-visible:outline-2"
              onClick={() => {
                if (s.kind === 'ask' && s.prompt) {
                  setText(s.prompt);
                  inputRef.current?.focus();
                  void ask(s.prompt);
                } else if (s.section) {
                  onNavigate(s.section);
                }
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {profile?.workspaceType === 'personal' && (
        <Card variant="flat" className="mt-8 p-5">
          <h2 className="text-base font-semibold">Ready to use NeuroPause professionally?</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Your knowledge, documents, AI preferences, local data and workflows already are the foundation of a
            professional workspace — Personal and Professional are the same workspace with different surfaces
            showing. Switching reveals the business sections and changes nothing about your data. You can switch
            back at any time.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              void ipc.firstRun.set({ workspaceType: 'professional' }).then((p) => {
                setProfile(p);
                setWorkspaceType(p.workspaceType);
              });
            }}
          >
            Switch to {WORKSPACE_TYPE_LABELS.professional}
          </Button>
        </Card>
      )}
    </ViewScroll>
  );
}
