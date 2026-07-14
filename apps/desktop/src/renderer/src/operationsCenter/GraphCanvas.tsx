import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import {
  layoutGraph,
  riskScoreTone,
  shortLabel,
  type GraphElements,
  type GraphNode,
  type Positioned,
  type Tone,
} from './opsModel';

const W = 1000;
const PAD = 90;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/** Tone → CSS var, mirroring the ScoreRing palette so the graph matches the app. */
const TONE_VAR: Record<Tone, string> = {
  green: 'var(--sysgreen)',
  orange: 'var(--sysorange)',
  red: 'var(--syspink)',
  blue: 'var(--sysblue)',
  purple: 'var(--syspurple)',
  accent: 'var(--accent)',
  gray: 'var(--fill-3)',
};

function nodeTone(n: GraphNode): Tone {
  if (n.role === 'spof') return n.risk != null ? riskScoreTone(n.risk) : 'red';
  if (n.role === 'bottleneck') return 'orange';
  if (n.role === 'cycle') return 'purple';
  return 'blue';
}

function nodeRadius(n: GraphNode): number {
  return 7 + Math.min(17, Math.sqrt(Math.max(1, n.weight)) * 4);
}

const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Uniform scale the browser applies mapping the 1000×h viewBox into the element (xMidYMid meet). */
function fitScale(rect: DOMRect, h: number): number {
  return Math.min(rect.width / W, rect.height / h);
}

/** Map a screen point to viewBox coords, correcting for the letterbox offset of `meet`. */
function screenToViewBox(clientX: number, clientY: number, rect: DOMRect, h: number): { x: number; y: number } {
  const scale = fitScale(rect, h);
  const offX = (rect.width - W * scale) / 2;
  const offY = (rect.height - h * scale) / 2;
  return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale };
}

interface Transform {
  zoom: number;
  tx: number;
  ty: number;
}

/**
 * An interactive node-link canvas for the dependency structure the P7 engine found.
 * Pointer-drag to pan, wheel to zoom (toward the cursor), buttons to zoom/fit.
 * Nodes are domain-clustered (deterministic layout), sized by structural weight and
 * toned by role/risk. Selecting a node bubbles up so the panel can deep-dive it.
 */
export function GraphCanvas({
  elements,
  height = 520,
  selectedId,
  onSelectNode,
}: {
  elements: GraphElements;
  height?: number;
  selectedId?: string | null;
  onSelectNode?: (node: GraphNode) => void;
}): JSX.Element {
  const H = height;
  const [t, setT] = useState<Transform>({ zoom: 1, tx: 0, ty: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Deterministic layout, then fit the actual bounds into the viewport so any
  // filtered/clustered subset always fills the frame nicely.
  const positioned = useMemo<Positioned[]>(() => {
    const laid = layoutGraph(elements);
    if (!laid.length) return laid;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of laid) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const spanX = Math.max(0.001, maxX - minX);
    const spanY = Math.max(0.001, maxY - minY);
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    return laid.map((n) => ({ ...n, x: offX + (n.x - minX) * scale, y: offY + (n.y - minY) * scale }));
  }, [elements, H]);

  const posById = useMemo(() => {
    const m = new Map<string, Positioned>();
    for (const p of positioned) m.set(p.id, p);
    return m;
  }, [positioned]);

  // Live transform for the native wheel handler (a passive React onWheel can't preventDefault).
  const tRef = useRef(t);
  tRef.current = t;

  // React 18 attaches root wheel listeners passively, so `preventDefault()` inside an
  // onWheel prop is ignored and the page scrolls while zooming. Bind a NON-passive
  // native listener instead so wheel-zoom stays contained to the canvas.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const { x: px, y: py } = screenToViewBox(e.clientX, e.clientY, rect, H);
      const prev = tRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const zoom = clampZoom(prev.zoom * factor);
      const k = zoom / prev.zoom;
      setT({ zoom, tx: px - (px - prev.tx) * k, ty: py - (py - prev.ty) * k });
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [H]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    const svg = svgRef.current;
    if (!svg) return;
    const scale = fitScale(svg.getBoundingClientRect(), H);
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    setT((prev) => ({ ...prev, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  const zoomBy = (factor: number): void =>
    setT((prev) => {
      const zoom = clampZoom(prev.zoom * factor);
      const k = zoom / prev.zoom;
      return { zoom, tx: W / 2 - (W / 2 - prev.tx) * k, ty: H / 2 - (H / 2 - prev.ty) * k };
    });
  const reset = (): void => setT({ zoom: 1, tx: 0, ty: 0 });

  if (!positioned.length) return <></>;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Enterprise dependency graph"
        className="block touch-none select-none"
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${t.tx} ${t.ty}) scale(${t.zoom})`}>
          {/* Edges under nodes. */}
          {elements.edges.map((e) => {
            const a = posById.get(e.from);
            const b = posById.get(e.to);
            if (!a || !b) return null;
            const active = hoverId === e.from || hoverId === e.to || selectedId === e.from || selectedId === e.to;
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={e.kind === 'cycle' ? 'var(--syspurple)' : 'var(--fill-3)'}
                strokeWidth={active ? 2 : 1.1}
                strokeOpacity={active ? 0.9 : e.kind === 'cycle' ? 0.55 : 0.35}
                strokeDasharray={e.kind === 'cycle' ? '5 4' : undefined}
              />
            );
          })}
          {/* Nodes. */}
          {positioned.map((n) => {
            const r = nodeRadius(n);
            const tone = nodeTone(n);
            const isSel = selectedId === n.id;
            const isHover = hoverId === n.id;
            const showLabel = isSel || isHover || r >= 15 || t.zoom >= 1.8;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                className="cursor-pointer"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => onSelectNode?.(n)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
              >
                {(isSel || isHover) && (
                  <circle r={r + 5} fill="none" stroke={TONE_VAR[tone]} strokeWidth={1.5} strokeOpacity={0.6} />
                )}
                <circle
                  r={r}
                  fill={TONE_VAR[tone]}
                  fillOpacity={isSel ? 0.95 : 0.82}
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
                {showLabel && (
                  <text
                    x={0}
                    y={r + 12}
                    textAnchor="middle"
                    className="pointer-events-none fill-[var(--text-2)] text-[11px] font-medium"
                    style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3 }}
                  >
                    {n.label || shortLabel(n.id)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom controls. */}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-white/10 [background:var(--fill-1)]">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)} className="flex h-7 w-7 items-center justify-center text-muted transition hover:text-ink">
          <Icon name="plus" size={15} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)} className="flex h-7 w-7 items-center justify-center border-t border-white/10 text-muted transition hover:text-ink">
          <Icon name="close" size={13} />
        </button>
        <button type="button" aria-label="Reset view" onClick={reset} className="flex h-7 w-7 items-center justify-center border-t border-white/10 text-muted transition hover:text-ink">
          <Icon name="refresh" size={13} />
        </button>
      </div>

      {/* Legend. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg [background:var(--fill-1)] px-2.5 py-1.5 text-2xs text-faint">
        <LegendDot tone="red" label="SPOF" />
        <LegendDot tone="orange" label="Bottleneck" />
        <LegendDot tone="blue" label="Chain" />
        <LegendDot tone="purple" label="Cycle" />
      </div>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: Tone; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: TONE_VAR[tone] }} />
      <span className={cn('font-medium')}>{label}</span>
    </span>
  );
}
