import { useMemo, useState } from 'react';
import type { EnterpriseSearchResult, SearchSourceKind } from '@neuropause/shared';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel } from '@renderer/operations/primitives';
import { Bar } from '@renderer/operations/primitives';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { createLogger } from '@renderer/lib/logger';
import { useEnterprise } from './EnterpriseProvider';
import { titleCase, relativeTime, TINT_TONE, type OpsTone } from './lib';

const log = createLogger('enterprise-search');

const SOURCE_META: Record<SearchSourceKind, { label: string; icon: IconName; tone: OpsTone }> = {
  entity: { label: 'Records', icon: 'database', tone: 'blue' },
  graph: { label: 'Graph', icon: 'grid', tone: 'purple' },
  memory: { label: 'Memory', icon: 'memory', tone: 'accent' },
  timeline: { label: 'Timeline', icon: 'clock', tone: 'green' },
};

interface LocalHit {
  id: string;
  group: 'workers' | 'policies' | 'approvals' | 'people';
  title: string;
  subtitle: string;
  icon: IconName;
  tone: OpsTone;
}

const LOCAL_META: Record<LocalHit['group'], { label: string; icon: IconName; tone: OpsTone }> = {
  workers: { label: 'AI Workers', icon: 'cpu', tone: 'purple' },
  policies: { label: 'Policies & Rules', icon: 'shield', tone: 'blue' },
  approvals: { label: 'Approvals', icon: 'checklist', tone: 'orange' },
  people: { label: 'People & Customers', icon: 'user', tone: 'green' },
};

export function EnterpriseSearchPanel({ initialQuery = '' }: { initialQuery?: string }): JSX.Element {
  const { workers, governance, jobs, org, graph } = useEnterprise();
  const [text, setText] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [result, setResult] = useState<EnterpriseSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(['entity', 'graph', 'memory', 'timeline', 'workers', 'policies', 'approvals', 'people']));

  const run = async (q: string): Promise<void> => {
    const query = q.trim();
    setSubmitted(query);
    if (!query) { setResult(null); return; }
    setLoading(true);
    try {
      setResult(await ipc.search.enterprise({ text: query, limit: 8 }));
    } catch (err) {
      log.error('Search failed', err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // run once for a deep-linked query
  useMemo(() => { if (initialQuery.trim()) void run(initialQuery); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const local = useMemo<LocalHit[]>(() => {
    const q = submitted.trim().toLowerCase();
    if (!q) return [];
    const out: LocalHit[] = [];
    for (const w of workers) if (w.name.toLowerCase().includes(q) || w.role.includes(q)) out.push({ id: `w-${w.id}`, group: 'workers', title: w.name, subtitle: `${titleCase(w.role)} AI · trust ${Math.round(w.trustScore * 100)}%`, icon: 'cpu', tone: 'purple' });
    if (governance) {
      for (const r of governance.complianceRules) if (r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) out.push({ id: `r-${r.id}`, group: 'policies', title: r.name, subtitle: `Compliance rule · ${r.category}`, icon: 'shield', tone: 'blue' });
      for (const c of governance.approvalChains) if (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) out.push({ id: `c-${c.id}`, group: 'policies', title: c.name, subtitle: `Approval chain · ${c.steps.length} step(s)`, icon: 'shield', tone: 'blue' });
    }
    for (const j of jobs) for (const p of j.proposals) if ((p.verdict.decision === 'require_approval' && !p.approval) && (p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q))) out.push({ id: `a-${p.id}`, group: 'approvals', title: p.title, subtitle: 'Pending approval', icon: 'checklist', tone: 'orange' });
    for (const u of org.users) if (u.name.toLowerCase().includes(q) || u.title.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)) out.push({ id: `u-${u.id}`, group: 'people', title: u.name, subtitle: u.title, icon: u.kind === 'ai_worker' ? 'cpu' : 'user', tone: 'green' });
    if (graph) for (const n of graph.nodes) if (n.kind === 'customer' && n.label.toLowerCase().includes(q)) out.push({ id: `cust-${n.id}`, group: 'people', title: n.label, subtitle: 'Customer', icon: 'heart', tone: 'green' });
    return out;
  }, [submitted, workers, governance, jobs, org, graph]);

  const groups = result?.groups.filter((g) => g.hits.length > 0 && enabled.has(g.source)) ?? [];
  const localGroups = (['workers', 'policies', 'approvals', 'people'] as const)
    .filter((g) => enabled.has(g))
    .map((g) => ({ group: g, hits: local.filter((h) => h.group === g) }))
    .filter((g) => g.hits.length > 0);

  const totalShown = groups.reduce((n, g) => n + g.hits.length, 0) + localGroups.reduce((n, g) => n + g.hits.length, 0);
  const toggle = (id: string): void => setEnabled((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[var(--hairline)] surface-raised px-3.5 py-3 shadow-card">
        <Icon name="search" size={18} className="text-faint" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(text); }}
          placeholder="Search projects, tasks, documents, conversations, calendar, people, customers, workers, policies, approvals…"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <button type="button" onClick={() => void run(text)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white">Search</button>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {(['entity', 'graph', 'memory', 'timeline'] as SearchSourceKind[]).map((s) => (
          <Chip key={s} active={enabled.has(s)} icon={SOURCE_META[s].icon} label={SOURCE_META[s].label} onClick={() => toggle(s)} />
        ))}
        <span className="mx-1 self-center text-faint">·</span>
        {(['workers', 'policies', 'approvals', 'people'] as const).map((g) => (
          <Chip key={g} active={enabled.has(g)} icon={LOCAL_META[g].icon} label={LOCAL_META[g].label} onClick={() => toggle(g)} />
        ))}
      </div>

      {!submitted.trim() ? (
        <Placeholder />
      ) : loading ? (
        <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-10 text-center text-sm text-faint">Searching the organization…</div>
      ) : totalShown === 0 ? (
        <div className="rounded-2xl border border-[var(--hairline)] p-10 text-center text-sm text-muted">
          No results for “{submitted}”. {result && result.total === 0 ? 'Connect tools and run AI workers to populate searchable records.' : 'Try a different term or enable more sources.'}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const meta = SOURCE_META[g.source];
            return (
              <OpsPanel key={g.source} title={meta.label} subtitle={`${g.total} match(es)`}>
                <ul className="space-y-1.5">
                  {g.hits.map((h) => (
                    <li key={`${g.source}-${h.id}`} className="flex items-start gap-3 rounded-xl border border-[var(--hairline)] p-3">
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[meta.tone])}><Icon name={meta.icon} size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-ink">{h.title}</span><span className="shrink-0 text-2xs text-faint">{titleCase(h.kind)}</span></div>
                        {h.snippet && <p className="truncate text-2xs text-faint">{h.snippet}</p>}
                        {h.timestamp && <p className="text-2xs text-faint">{relativeTime(h.timestamp)}</p>}
                      </div>
                      <div className="w-14 shrink-0 pt-1.5"><Bar value={h.score} tone={meta.tone} /></div>
                    </li>
                  ))}
                </ul>
              </OpsPanel>
            );
          })}

          {localGroups.map(({ group, hits }) => {
            const meta = LOCAL_META[group];
            return (
              <OpsPanel key={group} title={meta.label} subtitle={`${hits.length} match(es)`}>
                <ul className="space-y-1.5">
                  {hits.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] p-3">
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[h.tone])}><Icon name={h.icon} size={15} /></span>
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink">{h.title}</div><div className="truncate text-2xs text-faint">{h.subtitle}</div></div>
                    </li>
                  ))}
                </ul>
              </OpsPanel>
            );
          })}

          {result && <p className="text-center text-2xs text-faint">Federated across {result.backends.join(', ') || 'local'} retrievers, merged with organization data.</p>}
        </div>
      )}
    </div>
  );
}

function Chip({ active, icon, label, onClick }: { active: boolean; icon: IconName; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition', active ? 'border-transparent bg-accent/15 text-accent' : 'border-[var(--hairline)] text-faint')}>
      <Icon name={icon} size={12} /> {label}
    </button>
  );
}

function Placeholder(): JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-12 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent"><Icon name="search" size={22} /></span>
      <p className="text-sm font-medium text-ink">One search across the entire organization</p>
      <p className="mx-auto mt-1 max-w-md text-2xs text-faint">Records and documents from connected tools, the knowledge graph, AI memory, the activity timeline, plus your workers, policies, approvals, people, and customers — all from one box.</p>
    </div>
  );
}
