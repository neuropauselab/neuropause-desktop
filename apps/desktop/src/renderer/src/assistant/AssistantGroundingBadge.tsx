/**
 * S136 — Assistant Grounding Transparency (renderer-only, presentation-only). Surfaces, BESIDE the
 * assistant answer, the SAME governed grounding transparency proven in S134/S135 — so an operator can see
 * WHAT operational evidence/posture/connector-intelligence was available to the Brain, without secrets and
 * without granting the AI any authority.
 *
 * REUSE, NOT REBUILD: it calls the EXISTING governed read `ipc.platform.evidenceContext` →
 * `platform:command.dispatch` (`QueryEvidenceContext`, S128 + S130 relevance + S133 posture + S135 connector
 * intelligence), tenant resolved SERVER-SIDE, RBAC `operations:read`, bounded, credential-free. It adds NO
 * store/channel/AI-runtime/provenance framework and does NOT recompute grounding — it only displays the
 * fields the read already returns. LAZY: it fetches only when the operator expands it (no read per thread
 * render). Scoped to this turn via `correlationId`.
 *
 * TRANSPARENCY, NOT A VERDICT: it states availability + counts + provenance kinds only. It invents NO
 * correctness / confidence / SLO / health / trust score (S133/S134 discipline preserved).
 */
import { useCallback, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { StatusBadge } from '@renderer/operations/primitives';

interface GroundingItem { source: string; text: string; evidence?: Array<{ kind: string; id: string }> }
interface GroundingData {
  relevanceRanked?: boolean;
  postureIncluded?: boolean;
  connectorIntelIncluded?: boolean;
  itemCount?: number;
  context?: GroundingItem[];
}

export function AssistantGroundingBadge({ correlationId, question }: { correlationId?: string; question?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [data, setData] = useState<GroundingData | null>(null);

  // S137 — the exact preceding user question is the relevance lens for THIS turn's grounding, so the badge
  // reflects the same relevance the Brain used. A blank/absent question keeps the S136 no-query behavior
  // (never fabricated). It is a relevance signal only — never a tenant/context selector or an authorization.
  const lens = typeof question === 'string' && question.trim() !== '' ? question.trim() : '';

  const load = useCallback(async () => {
    setState('loading');
    try {
      // The SAME grounding the live assistant receives (S130 relevance + S133 posture + S135 connector
      // intelligence), scoped to this turn's correlation. Read-only; no AI turn, no execution, no mutation.
      const resp = await ipc.platform.evidenceContext({
        includePosture: true,
        includeConnectorIntel: true,
        ...(lens ? { relevanceQuery: lens } : {}),
        ...(correlationId ? { correlationId } : {}),
      });
      if (!resp.ok) { setState('error'); return; }
      setData((resp.data ?? null) as unknown as GroundingData | null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [correlationId, lens]);

  const onToggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && state === 'idle') void load();
  };

  const items = data?.context ?? [];
  const provenanceKinds = [...new Set(items.map((i) => i.evidence?.[0]?.kind).filter(Boolean) as string[])];
  const count = data?.itemCount ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Show AI grounding transparency"
        className="text-muted underline-offset-2 hover:text-ink hover:underline"
      >
        {open ? 'Hide grounding' : 'Grounding'}
      </button>
      {open && (
        <div className="mt-2 w-full rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
          {state === 'loading' ? (
            <div className="text-2xs text-faint">Loading grounding…</div>
          ) : state === 'error' ? (
            <div className="text-2xs text-faint">Grounding transparency is unavailable.</div>
          ) : count === 0 ? (
            <div className="text-2xs text-faint">No governed operational grounding was available for this response.</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="gray" label={`Grounded with ${count} operational item${count === 1 ? '' : 's'}`} />
                {data?.postureIncluded ? <StatusBadge tone="green" label="Posture included" /> : null}
                {data?.connectorIntelIncluded ? <StatusBadge tone="blue" label="Connector intelligence included" /> : null}
                {data?.relevanceRanked ? <StatusBadge tone="blue" label="Relevance ranked" /> : null}
                {lens && data?.relevanceRanked ? <StatusBadge tone="green" label="Grounding matched to this question" /> : null}
                {provenanceKinds.length > 0 ? <StatusBadge tone="gray" label={`Provenance: ${provenanceKinds.join(', ')}`} /> : null}
              </div>
              <div className="mt-2 text-2xs text-faint">
                This describes the grounding evidence available to the assistant — it is not a correctness, health, SLO, or confidence verdict.
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
