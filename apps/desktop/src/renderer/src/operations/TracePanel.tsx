import { useCallback, useEffect, useState } from 'react';
import type {
  GovernanceDecision,
  GovernanceTrace,
  GovernanceTraceList,
  RelationshipTrace,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { OpsPanel } from './primitives';
import { TINT_TONE } from './lib';

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function GovernanceSection(): JSX.Element {
  const [list, setList] = useState<GovernanceTraceList | null>(null);
  const [active, setActive] = useState<GovernanceTrace | null>(null);

  useEffect(() => {
    void ipc.governance.list().then(setList);
  }, []);

  const open = useCallback(async (d: GovernanceDecision) => {
    setActive(await ipc.governance.trace(d.id));
  }, []);

  return (
    <OpsPanel title="Governance Trace™" subtitle="Trace a decision to the evidence, actors, and timeline behind it.">
      {list && list.decisions.length === 0 && (
        <EmptyState
          icon="shield"
          title="No decisions recorded yet"
          description="Decisions captured in AI Memory (or projected from your tools) appear here, each traceable to its evidence."
          compact
        />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {list && list.decisions.length > 0 && (
          <div className="space-y-1.5">
            {list.decisions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => void open(d)}
                className={cn(
                  'w-full rounded-xl border border-[var(--hairline)] p-3 text-left transition fill-hover',
                  active?.decision.id === d.id && 'bg-[var(--fill-1)]',
                )}
              >
                <p className="truncate text-sm font-medium text-ink">{d.title}</p>
                <p className="text-2xs text-faint">
                  {d.origin} · {fmtTime(d.at)} · {d.actor.label ?? 'unknown actor'}
                </p>
              </button>
            ))}
          </div>
        )}

        {active && (
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            <h3 className="text-sm font-semibold text-ink">{active.decision.title}</h3>
            <p className="mt-1 text-xs text-muted">{active.decision.content}</p>

            <h4 className="mt-3 text-2xs uppercase tracking-wide text-faint">Evidence ({active.evidence.length})</h4>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {active.evidence.length === 0 && <span className="text-xs text-faint">No linked records.</span>}
              {active.evidence.map((e) => (
                <span key={e.id} className="rounded-lg border border-[var(--hairline)] px-2 py-1 text-xs text-muted">
                  <span className="text-faint">{e.kind}</span> · {e.title}
                </span>
              ))}
            </div>

            <h4 className="mt-3 text-2xs uppercase tracking-wide text-faint">Timeline ({active.timeline.length})</h4>
            <ul className="mt-1 space-y-1">
              {active.timeline.length === 0 && <li className="text-xs text-faint">No related events.</li>}
              {active.timeline.slice(0, 8).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs text-muted">
                  <span className="h-1 w-1 rounded-full bg-[var(--fill-2)]" />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto shrink-0 text-faint">{fmtTime(t.at)}</span>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-2xs text-faint">
              Approvals & policies: none — no approval source is connected yet.
            </p>
          </div>
        )}
      </div>
    </OpsPanel>
  );
}

function RelationshipSection(): JSX.Element {
  const [nodeId, setNodeId] = useState('');
  const [trace, setTrace] = useState<RelationshipTrace | null>(null);
  const [searched, setSearched] = useState(false);

  const run = async (): Promise<void> => {
    const id = nodeId.trim();
    if (!id) return;
    setSearched(true);
    setTrace(await ipc.relationship.trace(id));
  };

  return (
    <OpsPanel title="Relationship Trace™" subtitle="Explore the typed relationships around an entity in the knowledge graph.">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2 focus-within:shadow-focus">
          <Icon name="layers" size={16} className="text-faint" />
          <input
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
            placeholder="Entity / node id (e.g. a project or person id)…"
            className="flex-1 bg-transparent text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint"
          />
        </div>
        <Button variant="secondary" icon="search" onClick={() => void run()} disabled={!nodeId.trim()}>
          Trace
        </Button>
      </div>

      {searched && trace && !trace.root && trace.related.length === 0 && (
        <EmptyState icon="layers" title="No relationships found" description="That id isn't in the knowledge graph, or it has no edges yet." compact />
      )}

      {trace && (trace.root || trace.related.length > 0) && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          {trace.root && (
            <div className="mb-3 flex items-center gap-2">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE.blue)}>
                <Icon name="layers" size={15} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{trace.root.title}</p>
                <p className="text-2xs text-faint">{trace.root.kind}</p>
              </div>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {Object.entries(trace.byType).map(([rel, n]) => (
                  <span key={rel} className="rounded-full bg-[var(--fill-1)] px-2 py-0.5 text-2xs text-muted">
                    {rel.replace(/_/g, ' ')} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}
          <ul className="space-y-1.5">
            {trace.related.map((edge, i) => (
              <li key={`${edge.node.id}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="shrink-0 text-2xs text-faint">{edge.direction === 'out' ? '→' : '←'}</span>
                <span className="shrink-0 rounded bg-[var(--fill-1)] px-1.5 py-0.5 text-2xs text-muted">{edge.rel.replace(/_/g, ' ')}</span>
                <span className="truncate text-ink">{edge.node.title}</span>
                <span className="ml-auto shrink-0 text-2xs text-faint">{edge.node.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </OpsPanel>
  );
}

export function TracePanel(): JSX.Element {
  return (
    <div>
      <GovernanceSection />
      <RelationshipSection />
    </div>
  );
}
