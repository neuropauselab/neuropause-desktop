/**
 * S134 — Grounding Transparency panel. A READ-ONLY operator view of WHAT operational evidence/posture was
 * available to the Brain for grounding — so an operator can understand the assistant's context without
 * exposing secrets and without granting the AI any authority.
 *
 * It reuses the EXISTING governed AI-grounding read (`ipc.platform.evidenceContext` →
 * `platform:command.dispatch`, `QueryEvidenceContext` → S128 projection + S130 relevance + S133 posture),
 * with `includePosture:true` so the operator sees the SAME grounding shape the live assistant receives
 * (tenant resolved SERVER-SIDE; credential-free; bounded). No new store, channel, or contract.
 *
 * TRANSPARENCY, NOT A VERDICT: it states facts the read already returns — grounding included / evidence
 * items / operational posture / definitional reliability summary / per-item provenance. It NEVER claims
 * the AI answer is correct, and invents NO confidence / SLO / health / trust score (S133 discipline).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface GroundingItem { source: string; text: string; evidence?: Array<{ kind: string; id: string }> }
interface GroundingData {
  tenantId: string;
  query: string;
  relevanceRanked: boolean;
  postureIncluded: boolean;
  itemCount: number;
  groundingOnly: boolean;
  context: GroundingItem[];
}

const isPosture = (i: GroundingItem): boolean => i.evidence?.[0]?.kind === 'operational-posture';

export function GroundingTransparencyPanel(): JSX.Element {
  const [lens, setLens] = useState<string>('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<GroundingData | null>(null);
  const [message, setMessage] = useState<string>('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (q: string) => {
    setState('loading');
    try {
      // Mirror the live-assistant grounding request: posture included; the operator's optional lens is the
      // relevance query. Read-only — this triggers no AI turn, no execution, no mutation.
      const resp = await ipc.platform.evidenceContext({ includePosture: true, ...(q.trim() ? { relevanceQuery: q.trim() } : {}) });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Grounding transparency is not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? null) as unknown as GroundingData | null);
      setState('ready');
    } catch {
      setMessage('Grounding transparency could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void run('');
  }, [run]);

  const onLens = (q: string): void => {
    setLens(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(q), 200);
  };

  const items = data?.context ?? [];
  const postureItems = items.filter(isPosture);
  const evidenceItems = items.filter((i) => !isPosture(i));

  return (
    <OpsPanel
      title="AI grounding transparency"
      subtitle="What operational evidence + posture was available to the assistant — read-only, tenant-scoped, credential-free"
      actions={
        <input
          type="search"
          value={lens}
          onChange={(e) => onLens(e.target.value)}
          placeholder="Preview a question's grounding…"
          aria-label="Preview grounding for a question"
          className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-2xs text-ink placeholder:text-faint focus:outline-none"
        />
      }
    >
      {state === 'loading' ? (
        <LoadingBlock label="Loading grounding…" />
      ) : state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusBadge tone={data?.postureIncluded ? 'green' : 'gray'} label={`Operational posture: ${data?.postureIncluded ? 'included' : 'not included'}`} />
            <StatusBadge tone={data?.relevanceRanked ? 'blue' : 'gray'} label={`Relevance-ranked: ${data?.relevanceRanked ? 'yes' : 'no'}`} />
            <StatusBadge tone="gray" label={`Grounding items: ${data?.itemCount ?? 0}`} />
          </div>

          {items.length === 0 ? (
            <EmptyState title="No grounding available" hint="No governed operational evidence is available for the assistant in this tenant yet." />
          ) : (
            <div className="space-y-3">
              {postureItems.length > 0 && (
                <div>
                  <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Definitional reliability posture</div>
                  <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                    {postureItems.map((i, idx) => (
                      <div key={`posture:${i.evidence?.[0]?.id ?? idx}`} className="py-2.5">
                        <div className="text-sm text-ink">{i.text}</div>
                        <div className="mt-0.5 text-2xs text-faint">provenance: {i.evidence?.[0] ? `${i.evidence[0].kind}:${i.evidence[0].id}` : '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {evidenceItems.length > 0 && (
                <div>
                  <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">Evidence available to the assistant</div>
                  <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                    {evidenceItems.map((i, idx) => (
                      <div key={`ev:${i.evidence?.[0]?.kind ?? 's'}:${i.evidence?.[0]?.id ?? idx}`} className="flex items-start gap-3 py-2.5">
                        <StatusBadge tone="purple" label={i.evidence?.[0]?.kind ?? i.source} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink">{i.text}</div>
                          <div className="mt-0.5 truncate text-2xs text-faint">provenance: {i.evidence?.[0] ? `${i.evidence[0].kind}:${i.evidence[0].id}` : '—'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 text-2xs text-faint">
            Shows the evidence and posture available to the assistant — not a claim that any AI answer is correct, and not a health or SLO verdict.
          </div>
        </>
      )}
    </OpsPanel>
  );
}
