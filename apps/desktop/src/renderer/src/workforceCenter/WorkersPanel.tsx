/**
 * P8.6 — Workers: a virtualized master list (search across name/role/capability) beside
 * a full Worker Details inspector (identity, publisher, signature, health, trust,
 * capabilities, permissions, execution bindings, connector usage, memory scope,
 * dependencies, skills, goals) + per-worker execution history. Read-only inspector;
 * running skills stays in the operational dashboard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, WorkerSummary } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { MetaDot, Pill, TrustMeter, WorkerGlyph } from '@renderer/workforce/primitives';
import { formatMs, healthMeta, jobStatusMeta, relativeTime, titleCase } from '@renderer/workforce/lib';
import { useWorkforce } from '@renderer/workforce/WorkforceProvider';
import { VirtualList } from './VirtualList';
import { assembleWorkerDetail, executionHistory, searchWorkforce, type WorkerDetailVM } from './workforceCenterModel';

export function WorkersPanel(): JSX.Element {
  const { workers, installs, jobs, loadWorker, loadInstallDetail } = useWorkforce();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkerDetailVM | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const filtered = useMemo(() => searchWorkforce(workers, installs, query), [workers, installs, query]);

  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    void (async () => {
      const worker = await loadWorker(selectedId);
      const install = worker && !worker.builtIn ? await loadInstallDetail(selectedId) : null;
      if (req !== reqRef.current) return;
      setDetail(worker ? assembleWorkerDetail(worker, install) : null);
      setLoading(false);
    })();
  }, [selectedId, loadWorker, loadInstallDetail]);

  const workerJobs = selectedId ? executionHistory(jobs, { workerId: selectedId }).slice(0, 8) : [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <OpsPanel title={`Workers · ${filtered.length}`} className="mb-0">
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <Icon name="search" size={15} className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workers, roles, capabilities…"
            className="flex-1 bg-transparent text-sm outline-none focus-visible:shadow-focus placeholder:text-faint"
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="search" title="No matches" hint="Try a different search term." />
        ) : (
          <VirtualList
            items={filtered}
            rowHeight={60}
            height={Math.min(600, Math.max(120, filtered.length * 60))}
            rowKey={(w) => w.id}
            renderRow={(w) => <WorkerListRow summary={w} active={w.id === selectedId} onSelect={() => setSelectedId(w.id)} />}
          />
        )}
      </OpsPanel>

      <div>
        {loading && !detail ? (
          <LoadingBlock label="Loading worker…" />
        ) : detail ? (
          <WorkerDetail vm={detail} jobs={workerJobs} />
        ) : (
          <EmptyState icon="cpu" title="Select a worker" hint="Inspect its identity, permissions, execution bindings, and history." />
        )}
      </div>
    </div>
  );
}

function WorkerListRow({ summary, active, onSelect }: { summary: WorkerSummary; active: boolean; onSelect: () => void }): JSX.Element {
  const hm = healthMeta(summary.healthState);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-[56px] w-full items-center gap-2.5 rounded-xl border px-2.5 text-left transition',
        active ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15',
      )}
    >
      <WorkerGlyph role={summary.role} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{summary.name}</div>
        <div className="flex items-center gap-1.5 text-2xs text-faint">
          <MetaDot meta={hm} />
          <span>v{summary.version}</span>
        </div>
      </div>
      <div className="w-14 shrink-0">
        <TrustMeter score={summary.trustScore} />
      </div>
    </button>
  );
}

function WorkerDetail({ vm, jobs }: { vm: WorkerDetailVM; jobs: Job[] }): JSX.Element {
  const hm = healthMeta(vm.healthState);
  return (
    <div>
      <div className="mb-4 flex items-start gap-3.5 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <WorkerGlyph role={vm.role} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight">{vm.name}</h3>
            <Pill tone={vm.builtIn ? 'gray' : 'blue'}>{vm.builtIn ? 'built-in' : 'installed'}</Pill>
          </div>
          <div className="mt-0.5 text-xs text-faint">{titleCase(vm.role)} · v{vm.version} · {vm.id}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-2xs text-muted">
              <Icon name={vm.signature.startsWith('Signed') ? 'verified' : 'lock'} size={13} />
              {vm.signature}
            </span>
            <MetaDot meta={hm} />
          </div>
        </div>
        <div className="w-24 shrink-0">
          <TrustMeter score={vm.trust} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Identity">
          <Field label="Publisher" value={vm.publisher} />
          <Field label="Version" value={vm.version} />
          <Field label="Signature" value={vm.signature} />
          <Field label="Memory scope" value={vm.memoryScope} />
        </Section>

        <Section title="Permissions">
          {vm.permissions.length === 0 ? (
            <p className="py-1 text-xs text-faint">No granted scopes.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 py-1">
              {vm.permissions.map((p) => (
                <Pill key={p} tone={p.startsWith('execute') ? 'orange' : p.startsWith('write') || p.startsWith('propose') ? 'blue' : 'gray'}>
                  {p}
                </Pill>
              ))}
            </div>
          )}
        </Section>

        <Section title="Execution bindings">
          {vm.executionBindings.length === 0 ? (
            <p className="py-1 text-xs text-faint">Advisory worker — no execution bindings.</p>
          ) : (
            <div className="flex flex-col gap-1.5 py-1">
              {vm.executionBindings.map((b) => (
                <div key={b.skillId} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
                  <Icon name={b.executor === 'm365' ? 'connectors' : 'server'} size={14} className="text-muted" />
                  <span className="text-xs font-medium">{b.skillId}</span>
                  <span className="ml-auto text-2xs text-faint tabular">{b.executor} · {b.target}{b.actionId ? ` · ${b.actionId}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Connectors & dependencies">
          <div className="py-1">
            <div className="mb-1 text-2xs uppercase tracking-wide text-faint">Connector usage</div>
            {vm.connectorUsage.length === 0 ? (
              <p className="text-xs text-faint">None.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {vm.connectorUsage.map((c) => (
                  <Pill key={c} tone="blue" icon="connectors">{c}</Pill>
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 py-1">
            <div className="mb-1 text-2xs uppercase tracking-wide text-faint">Dependencies</div>
            {vm.dependencies.length === 0 ? (
              <p className="text-xs text-faint">None.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {vm.dependencies.map((d) => (
                  <Pill key={d} tone="gray" icon="package">{d}</Pill>
                ))}
              </div>
            )}
          </div>
        </Section>

        {vm.capabilities.length > 0 && (
          <Section title="Capabilities">
            <div className="flex flex-wrap gap-1.5 py-1">
              {vm.capabilities.map((c) => (
                <Pill key={c} tone="purple">{c}</Pill>
              ))}
            </div>
          </Section>
        )}

        <Section title="Skills">
          <div className="flex flex-col gap-1.5 py-1">
            {vm.skills.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
                <Icon name={s.sideEffects ? 'bolt' : 'eye'} size={13} className="text-muted" />
                <span className="text-xs font-medium">{s.title}</span>
                <span className="ml-auto text-2xs text-faint">{s.sideEffects ? 'side-effecting' : 'read-only'}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="mt-4">
        <Section title="Recent execution">
          {jobs.length === 0 ? (
            <p className="py-1 text-xs text-faint">No jobs yet for this worker.</p>
          ) : (
            <div className="flex flex-col gap-1.5 py-1">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center gap-3 rounded-lg border border-white/5 px-2.5 py-2">
                  <span className="truncate text-xs font-medium">{j.skillId}</span>
                  <span className="text-2xs text-faint">{relativeTime(j.createdAt)}</span>
                  <span className="ml-auto text-2xs text-faint tabular">{formatMs(j.durationMs)}</span>
                  <StatusBadge tone={jobStatusMeta(j.status).tone} label={jobStatusMeta(j.status).label} pulse={j.status === 'running'} />
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-4">
      <div className="mb-1.5 text-xs font-semibold tracking-tight text-ink">{title}</div>
      {children}
    </div>
  );
}
