import { useEffect, useMemo, useState } from 'react';
import type { OrgGraphNeighbors, OrgUnit } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel } from '@renderer/operations/primitives';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { useEnterprise } from './EnterpriseProvider';
import { nodeKindMeta, unitKindLabel, TEXT_TONE, TINT_TONE, DOT_BG } from './lib';

type Mode = 'chart' | 'graph';

export function OrganizationExplorerPanel(): JSX.Element {
  const { org, graph } = useEnterprise();
  const [mode, setMode] = useState<Mode>('chart');
  const orgNodeId = org.organization ? `org:${org.organization.id}` : null;
  const [focus, setFocus] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<OrgGraphNeighbors | null>(null);

  const activeFocus = focus ?? orgNodeId;

  useEffect(() => {
    if (!activeFocus) return;
    let alive = true;
    void ipc.enterprise.graphNeighbors(activeFocus).then((n) => { if (alive) setNeighbors(n); });
    return () => { alive = false; };
  }, [activeFocus]);

  const counts = graph?.counts.byNodeKind ?? {};
  const roots = useMemo(() => org.units.filter((u) => u.parentId === null), [org.units]);

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Count icon="user" label="People" value={counts.user ?? 0} tone="green" />
        <Count icon="cpu" label="AI Workers" value={counts.worker ?? 0} tone="purple" />
        <Count icon="layers" label="Units" value={counts.unit ?? 0} tone="blue" />
        <Count icon="checklist" label="Projects" value={counts.project ?? 0} tone="orange" />
        <Count icon="heart" label="Customers" value={counts.customer ?? 0} tone="accent" />
        <Count icon="doc" label="Documents" value={counts.document ?? 0} tone="gray" />
        <Count icon="connectors" label="Connectors" value={counts.connector ?? 0} tone="blue" />
      </div>

      <nav className="mb-5 inline-flex gap-1 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-1">
        {(['chart', 'graph'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition', mode === m ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            <Icon name={m === 'chart' ? 'layers' : 'grid'} size={15} /> {m === 'chart' ? 'Org Chart' : 'Relationship Graph'}
          </button>
        ))}
      </nav>

      {mode === 'chart' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <OpsPanel title={org.organization?.name ?? 'Organization'} subtitle={org.organization?.description ?? undefined}>
              <div className="space-y-1.5">
                {roots.map((u) => (
                  <UnitBranch key={u.id} unit={u} depth={0} focus={activeFocus} onFocus={setFocus} />
                ))}
              </div>
            </OpsPanel>
          </div>
          <div className="lg:col-span-2">
            <DetailPane neighbors={neighbors} onFocus={setFocus} />
          </div>
        </div>
      ) : (
        <RelationshipGraph neighbors={neighbors} onFocus={setFocus} />
      )}
    </div>
  );
}

function UnitBranch({ unit, depth, focus, onFocus }: { unit: OrgUnit; depth: number; focus: string | null; onFocus: (id: string) => void }): JSX.Element {
  const { org } = useEnterprise();
  const children = org.units.filter((u) => u.parentId === unit.id);
  const members = org.users.filter((u) => u.unitId === unit.id);
  const lead = unit.leadUserId ? org.users.find((u) => u.id === unit.leadUserId) : null;
  const nodeId = `unit:${unit.id}`;
  const active = focus === nodeId;
  return (
    <div>
      <button
        type="button"
        onClick={() => onFocus(nodeId)}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={cn('flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm transition', active ? 'bg-accent/12 text-accent' : 'fill-hover text-ink')}
      >
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', TINT_TONE.blue)}><Icon name="layers" size={13} /></span>
        <span className="font-medium">{unit.name}</span>
        <span className="text-2xs text-faint">{unitKindLabel(unit.kind)}</span>
        {lead && <span className="ml-auto truncate text-2xs text-faint">lead · {lead.name}</span>}
      </button>
      {members.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {members.map((m) => {
            const mid = `user:${m.id}`;
            const isActive = focus === mid;
            const km = nodeKindMeta(m.kind === 'ai_worker' ? 'worker' : 'user');
            return (
              <button key={m.id} type="button" onClick={() => onFocus(mid)} style={{ paddingLeft: 8 + (depth + 1) * 16 + 10 }} className={cn('flex w-full items-center gap-2 rounded-lg py-1 pr-2 text-left text-2xs transition', isActive ? 'bg-accent/12 text-accent' : 'fill-hover text-muted')}>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded', TINT_TONE[km.tone])}><Icon name={km.icon} size={11} /></span>
                <span className="truncate text-ink">{m.name}</span>
                <span className="truncate text-faint">{m.title}</span>
              </button>
            );
          })}
        </div>
      )}
      {children.length > 0 && (
        <div className="mt-0.5 space-y-1.5">
          {children.map((c) => (
            <UnitBranch key={c.id} unit={c} depth={depth + 1} focus={focus} onFocus={onFocus} />
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPane({ neighbors, onFocus }: { neighbors: OrgGraphNeighbors | null; onFocus: (id: string) => void }): JSX.Element {
  if (!neighbors) {
    return <OpsPanel title="Relationships"><Hint text="Select a unit or member to see how it connects." /></OpsPanel>;
  }
  const km = nodeKindMeta(neighbors.node.kind);
  return (
    <OpsPanel title="Relationships" subtitle={`${neighbors.neighbors.length} connection(s)`}>
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[var(--hairline)] p-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', TINT_TONE[km.tone])}><Icon name={km.icon} size={20} /></span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{neighbors.node.label}</div>
          <div className="text-2xs text-faint">{km.label}{neighbors.node.detail ? ` · ${neighbors.node.detail}` : ''}</div>
        </div>
      </div>
      {neighbors.neighbors.length === 0 ? (
        <Hint text="No connections recorded for this node yet." />
      ) : (
        <ul className="space-y-1.5">
          {neighbors.neighbors.map((nb, i) => {
            const m = nodeKindMeta(nb.node.kind);
            return (
              <li key={`${nb.edge.id}-${i}`}>
                <button type="button" onClick={() => onFocus(nb.node.id)} className="flex w-full items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-left transition fill-hover">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', TINT_TONE[m.tone])}><Icon name={m.icon} size={12} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{nb.node.label}</span>
                  <span className="shrink-0 rounded bg-[var(--fill-2)] px-1.5 py-0.5 text-2xs text-faint">{nb.edge.kind.replace('_', ' ')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </OpsPanel>
  );
}

/** A radial relationship visualization: the focus node centered, neighbors around it. */
function RelationshipGraph({ neighbors, onFocus }: { neighbors: OrgGraphNeighbors | null; onFocus: (id: string) => void }): JSX.Element {
  if (!neighbors) return <OpsPanel title="Relationship Graph"><Hint text="Building the graph…" /></OpsPanel>;

  const W = 760;
  const H = 460;
  const cx = W / 2;
  const cy = H / 2;
  const shown = neighbors.neighbors.slice(0, 14);
  const radius = 165;
  const center = nodeKindMeta(neighbors.node.kind);

  const positions = shown.map((nb, i) => {
    const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
    return { nb, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

  return (
    <OpsPanel title="Relationship Graph" subtitle={`${neighbors.node.label} · ${shown.length} connection(s)`}>
      <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
          {positions.map(({ x, y }, i) => (
            <line key={`l${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--hairline)" strokeWidth={1.5} />
          ))}
          {positions.map(({ nb, x, y }, i) => {
            const m = nodeKindMeta(nb.node.kind);
            const mid = { x: (cx + x) / 2, y: (cy + y) / 2 };
            return (
              <g key={`n${i}`} className="cursor-pointer" onClick={() => onFocus(nb.node.id)}>
                <rect x={mid.x - 26} y={mid.y - 8} width={52} height={16} rx={8} fill="var(--fill-2)" />
                <text x={mid.x} y={mid.y + 3} textAnchor="middle" className="fill-faint" style={{ fontSize: 8 }}>{nb.edge.kind.replace('_', ' ')}</text>
                <circle cx={x} cy={y} r={22} className={DOT_BG[m.tone]} opacity={0.16} />
                <circle cx={x} cy={y} r={16} className={DOT_BG[m.tone]} opacity={0.9} />
                <text x={x} y={y + 30} textAnchor="middle" className="fill-ink" style={{ fontSize: 10, fontWeight: 600 }}>
                  {nb.node.label.length > 16 ? `${nb.node.label.slice(0, 15)}…` : nb.node.label}
                </text>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={34} className={DOT_BG[center.tone]} opacity={0.18} />
          <circle cx={cx} cy={cy} r={26} className={DOT_BG[center.tone]} />
          <text x={cx} y={cy + 46} textAnchor="middle" className="fill-ink" style={{ fontSize: 12, fontWeight: 700 }}>
            {neighbors.node.label.length > 22 ? `${neighbors.node.label.slice(0, 21)}…` : neighbors.node.label}
          </text>
        </svg>
      </div>
      <p className="mt-2 text-center text-2xs text-faint">Click any node to re-center the graph on it.</p>
    </OpsPanel>
  );
}

function Count({ icon, label, value, tone }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: number; tone: 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'accent' | 'gray' }): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-3.5 shadow-card">
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE[tone])}><Icon name={icon} size={14} /></span>
      <div className={cn('mt-2 text-xl font-semibold tabular', TEXT_TONE[tone])}>{value}</div>
      <div className="text-2xs text-faint">{label}</div>
    </div>
  );
}

function Hint({ text }: { text: string }): JSX.Element {
  return <div className="rounded-xl border border-dashed border-[var(--hairline)] p-5 text-center text-sm text-faint">{text}</div>;
}
