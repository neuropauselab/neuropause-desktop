/**
 * Platform Ecosystem — "Extension Platform" tab lens (Phase 5, Sub-Agent 1).
 *
 * A PURE, DESCRIPTIVE derivation over what the plugin runtime already reports:
 * installed plugins (state / runtime status / health / host-compatibility /
 * granted permissions) and the declarative extension contributions those plugins
 * have registered into the platform's EXISTING registries. It reports what is
 * genuinely installed and registered — nothing more.
 *
 * It adds NO new IPC channel, engine, store, or service — every value below is a
 * pure function of data returned by EXISTING `ipc.plugins.*` / `ipc.registry.*`
 * methods. Every capability the platform does NOT actually have (dependency
 * resolution, a hardened syscall sandbox, end-to-end consumption of every
 * extension kind) is surfaced as an honest, labeled `OpGap` ("Requires …")
 * rather than a fabricated value. When a real signal is simply empty (no plugins
 * installed, nothing registered), the honest empty state shows through — the tab
 * renders only its gaps + deep-links, never a placeholder number.
 *
 * Intended (reuse-only) wiring — the model is called with the results of EXISTING
 * channels; every field below is structurally compatible with those payloads:
 *   summarizeExtensions({
 *     plugins:    await ipc.plugins.list(),        // PluginDto[]
 *     extensions: await ipc.plugins.extensions(),  // PluginExtension[]
 *     registry:   await ipc.registry.stats(),      // RegistryStats
 *   })
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from '@renderer/aiOperations/aiOperationsModel';

/* ── Minimal structural inputs ───────────────────────────────────────────────
 * Every field is defensively optional so partial/empty payloads are safe. Field
 * names/types mirror the REAL sources (verified against lib/ipc.ts + @neuropause/
 * shared): a real `PluginDto` / `PluginExtension` / `PluginExtensionCounts` /
 * `RegistryStats` value is structurally assignable here. Nothing is invented.
 */

/** Subset of `PluginContribution` — a UI surface a plugin contributes. */
export interface ExtContribution {
  id?: string;
  /** `PluginSurfaceKind`: 'sidebar' | 'toolbar' | 'panel' | 'widget'. */
  surface?: string;
  title?: string;
}

/** Subset of `PluginDto` — an installed plugin as the runtime reports it. */
export interface ExtPlugin {
  id?: string;
  name?: string;
  version?: string;
  /** `PluginKind`: 'background' | 'automation' | 'ai_agent' | 'mcp_server' | 'ui'. */
  kind?: string;
  /** `PluginState`: 'installed' | 'enabled' | 'disabled' | 'error'. */
  state?: string;
  /** `HealthStatus`: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'. */
  health?: string;
  /** `RuntimeStatus`: incl. 'running' | 'stopped' | 'crashed' | 'failed'. */
  runtimeStatus?: string;
  /** Whether the manifest engine range is satisfied by the current host. */
  compatible?: boolean;
  engineRange?: string;
  permissions?: readonly string[];
  grantedPermissions?: readonly string[];
  contributions?: readonly ExtContribution[];
  lastError?: string | null;
}

/** Subset of `PluginExtension` — one declarative extension a plugin registered. */
export interface ExtExtension {
  id?: string;
  pluginId?: string;
  pluginVersion?: string;
  /** `PluginExtensionKind`: one of 10 kinds (graph_node, executive_kpi, …). */
  kind?: string;
  label?: string;
}

/** Subset of `PluginExtensionCounts` — the pre-aggregated variant of the above. */
export interface ExtExtensionCounts {
  total?: number;
  byKind?: Record<string, number>;
  byPlugin?: Record<string, number>;
}

/** Subset of `RegistryStats` — the local application registry counts (reuse). */
export interface ExtRegistryStats {
  totalInstalled?: number;
  totalLaunches?: number;
  totalDiskBytes?: number;
  pinnedCount?: number;
  favoriteCount?: number;
  byType?: Record<string, number>;
}

/** The (defensively optional) input to the Extension-Platform derivation. */
export interface ExtensionsInput {
  /** From `ipc.plugins.list()` → `PluginDto[]`. */
  plugins?: readonly ExtPlugin[] | null;
  /** From `ipc.plugins.extensions()` → `PluginExtension[]` (or pre-aggregated counts). */
  extensions?: readonly ExtExtension[] | ExtExtensionCounts | null;
  /** From `ipc.registry.stats()` → `RegistryStats` (reuse if present). */
  registry?: ExtRegistryStats | null;
}

/* ── small pure helpers ── */

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function arr<T>(v: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: string | null | undefined, fallback = '—'): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Title-case an unknown snake_case kind for display (fallback humanizer). */
function titleCase(raw: string): string {
  const words = raw.replace(/_/g, ' ').trim();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : raw;
}

/* ── extension-kind knowledge (real, from @neuropause/shared pluginExtension.ts) ──
 * Registration is implemented for all 10 kinds; end-to-end CONSUMPTION exists for
 * only three today. This is an honest architectural fact, surfaced both as a
 * per-row caveat and as an `OpGap` — never hidden and never over-claimed.
 */
const KIND_LABEL: Record<string, string> = {
  erp_module: 'ERP module',
  executive_kpi: 'Executive KPI',
  timeline_provider: 'Timeline provider',
  graph_node: 'Graph node',
  graph_relationship: 'Graph relationship',
  memory_projector: 'Memory projector',
  automation_trigger: 'Automation trigger',
  automation_action: 'Automation action',
  search_provider: 'Search provider',
  context_provider: 'Context provider',
};

/** The kinds with genuine downstream consumers wired today (3 of 10). */
const CONSUMED_KINDS: ReadonlySet<string> = new Set([
  'graph_node',
  'graph_relationship',
  'executive_kpi',
]);

function humanizeKind(kind: string): string {
  return KIND_LABEL[kind] ?? titleCase(kind);
}

function healthLabel(health: string | undefined): string {
  switch (health) {
    case 'healthy':
      return 'healthy';
    case 'degraded':
      return 'degraded';
    case 'unhealthy':
      return 'unhealthy';
    default:
      return 'unknown';
  }
}

/** A plugin's effective status label + tone (runtime crash/error dominates state). */
function pluginStatus(p: ExtPlugin): { label: string; tone: OpsTone } {
  if (p.runtimeStatus === 'crashed') return { label: 'Crashed', tone: 'red' };
  if (p.state === 'error' || p.runtimeStatus === 'failed') return { label: 'Error', tone: 'red' };
  if (p.state === 'disabled') return { label: 'Disabled', tone: 'gray' };
  if (p.state === 'enabled') {
    if (p.health === 'unhealthy' || p.health === 'degraded') return { label: 'Enabled', tone: 'orange' };
    return { label: 'Enabled', tone: 'green' };
  }
  return { label: 'Installed', tone: 'blue' };
}

/** Severity rank so problematic plugins surface first (stable within a rank). */
function severity(p: ExtPlugin): number {
  if (p.runtimeStatus === 'crashed') return 0;
  if (p.state === 'error' || p.runtimeStatus === 'failed') return 1;
  if (p.compatible === false) return 2;
  if (p.state === 'disabled') return 3;
  if (p.state === 'enabled') return 4;
  return 5;
}

/**
 * Normalize the `extensions` signal — which may arrive as a raw `PluginExtension[]`
 * (from `ipc.plugins.extensions()`) or as a pre-aggregated `PluginExtensionCounts`
 * object — into a single { total, byKind } shape. Empty/absent → zeroes.
 */
function extensionCounts(
  extensions: readonly ExtExtension[] | ExtExtensionCounts | null | undefined,
): { total: number; byKind: Array<{ kind: string; n: number }> } {
  if (Array.isArray(extensions)) {
    const map = new Map<string, number>();
    for (const e of extensions) {
      const kind = typeof e?.kind === 'string' && e.kind.length > 0 ? e.kind : 'unknown';
      map.set(kind, (map.get(kind) ?? 0) + 1);
    }
    const byKind = [...map.entries()].map(([kind, n]) => ({ kind, n }));
    return { total: extensions.length, byKind };
  }
  if (isRecord(extensions)) {
    const rec = extensions as ExtExtensionCounts;
    const byKindRec = isRecord(rec.byKind) ? rec.byKind : {};
    const byKind = Object.entries(byKindRec)
      .map(([kind, n]) => ({ kind, n: num(n as number) }))
      .filter((e) => e.n > 0);
    const summed = byKind.reduce((s, e) => s + e.n, 0);
    const total = isFiniteNumber(rec.total) ? num(rec.total) : summed;
    return { total, byKind };
  }
  return { total: 0, byKind: [] };
}

/**
 * The three genuine architectural absences of this tab. They are constant — the
 * platform lacks these regardless of how many plugins are installed — so they
 * render in every state, populated or empty. This is what keeps the tab honestly
 * DESCRIPTIVE rather than pretending to be a fully-hardened extension platform.
 */
function extensionGaps(): OpGap[] {
  return [
    {
      capability: 'Dependency validation',
      requires:
        'a dependency resolver — manifest dependencies[] are declared but never resolved or validated',
    },
    {
      capability: 'Hardened sandbox jail',
      requires:
        'resource/syscall limits — isolation is process-level (fork) + permission-gated, not a seccomp jail',
    },
    {
      capability: 'Active extension kinds',
      requires:
        'consumers for 7 of 10 kinds — only graph_node, graph_relationship, executive_kpi are consumed today; the rest register but do not yet take effect',
      note: 'Honest limitation: registration is implemented for all 10 kinds; end-to-end consumption exists for 3.',
    },
  ];
}

/** Deep-links to the canonical existing surfaces (reuse, not duplicate). */
function extensionLinks(): OpLink[] {
  return [
    { label: 'Developer', section: 'developer', icon: 'code' },
    { label: 'Enterprise Marketplace', section: 'marketplace', icon: 'store' },
  ];
}

/**
 * Derive the Extension-Platform lens. Pure: same input → same output; no IPC, no
 * clock, no DOM. Only real, present signals produce stats/rows; absent signals
 * fall through to the honest empty state (gaps + links only).
 */
export function summarizeExtensions(input: ExtensionsInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  /* ── Installed plugins (PRIMARY): real runtime state ── */
  const plugins = arr(input.plugins);
  const total = plugins.length;
  const pluginsPresent = total > 0;

  if (pluginsPresent) {
    const enabled = plugins.filter((p) => p.state === 'enabled').length;
    const disabled = plugins.filter((p) => p.state === 'disabled').length;
    const crashed = plugins.filter((p) => p.runtimeStatus === 'crashed').length;
    const compatible = plugins.filter((p) => p.compatible === true).length;
    const incompatible = plugins.filter((p) => p.compatible === false).length;
    const compatibleRatio = total > 0 ? compatible / total : Number.NaN;

    stats.push({
      icon: 'package',
      label: 'Plugins installed',
      value: count(total),
      tone: 'blue',
      hint: `${count(enabled)} enabled`,
    });
    stats.push({
      icon: 'check',
      label: 'Enabled',
      value: count(enabled),
      tone: enabled > 0 ? 'green' : 'gray',
      hint: total > 0 ? `${pctText(enabled / total)} of installed` : undefined,
    });
    stats.push({
      icon: 'bolt',
      label: 'Crashed plugins',
      value: count(crashed),
      tone: riskTone(total > 0 ? crashed / total : 0),
      hint: crashed > 0 ? `${pctText(crashed / total)} of installed` : undefined,
    });

    // Compatible % — pushed after the extension-contributions stat below so the
    // headline order matches the spec (installed, enabled, crashed, contributions,
    // compatible %); we stash the values and push at the end of the stat block.
    const compatibleStat: OpStat = {
      icon: 'verified',
      label: 'Compatible',
      value: pctText(compatibleRatio),
      tone: healthTone(compatibleRatio),
      hint: `${count(compatible)}/${count(total)} host-compatible`,
    };

    /* Extension contributions headline (only when the signal is genuinely present). */
    const ext = extensionCounts(input.extensions);
    if (ext.total > 0) {
      stats.push({
        icon: 'layers',
        label: 'Extension contributions',
        value: count(ext.total),
        tone: 'blue',
        hint: `${count(ext.byKind.length)} of 10 kinds`,
      });
    }
    stats.push(compatibleStat);

    /* Group: Installed extensions — real per-plugin state / health / compatibility. */
    const CAP = 12;
    const ordered = [...plugins].sort((a, b) => severity(a) - severity(b));
    const rows: OpRow[] = ordered.slice(0, CAP).map((p) => {
      const st = pluginStatus(p);
      const subParts: string[] = [];
      if (typeof p.version === 'string' && p.version.length > 0) subParts.push(`v${p.version}`);
      subParts.push(healthLabel(p.health));
      if (p.compatible === false) {
        subParts.push(
          typeof p.engineRange === 'string' && p.engineRange.length > 0
            ? `incompatible (needs ${p.engineRange})`
            : 'incompatible',
        );
      }
      return {
        label: str(p.name ?? p.id),
        value: st.label,
        tone: st.tone,
        sub: subParts.join(' · '),
      };
    });
    const noteParts = [
      `${count(enabled)} enabled`,
      `${count(disabled)} disabled`,
      `${count(crashed)} crashed`,
      `${count(incompatible)} incompatible`,
    ];
    if (total > CAP) noteParts.push(`showing ${CAP} of ${count(total)}`);
    groups.push({
      title: 'Installed extensions',
      rows,
      note: noteParts.join(' · '),
    });
  }

  /* ── Extension contributions by kind (real registrations, honestly caveated) ── */
  const ext = extensionCounts(input.extensions);
  if (ext.total > 0 && ext.byKind.length > 0) {
    const rows: OpRow[] = [...ext.byKind]
      .sort((a, b) => b.n - a.n || humanizeKind(a.kind).localeCompare(humanizeKind(b.kind)))
      .map((e) => {
        const consumed = CONSUMED_KINDS.has(e.kind);
        return {
          label: humanizeKind(e.kind),
          value: count(e.n),
          tone: consumed ? 'green' : 'gray',
          sub: consumed ? 'consumed' : 'registers, not yet consumed',
        };
      });
    groups.push({
      title: 'Extension contributions by kind',
      rows,
      note: 'Only graph_node, graph_relationship, executive_kpi are consumed today; other kinds register but do not yet take effect.',
    });
  }

  /* ── Local application registry (reuse of ipc.registry.stats(), when present) ── */
  const reg = input.registry ?? null;
  if (reg) {
    const totalInstalled = num(reg.totalInstalled);
    const totalLaunches = num(reg.totalLaunches);
    const byType = isRecord(reg.byType) ? reg.byType : {};
    const byTypeEntries = Object.entries(byType)
      .map(([k, v]) => ({ k, n: num(v as number) }))
      .filter((e) => e.n > 0)
      .sort((a, b) => b.n - a.n);
    const hasRegistrySignal = totalInstalled > 0 || totalLaunches > 0 || byTypeEntries.length > 0;
    if (hasRegistrySignal) {
      const rows: OpRow[] = [
        { label: 'Installed apps', value: count(totalInstalled) },
        { label: 'Total launches', value: count(totalLaunches) },
        { label: 'Pinned', value: count(num(reg.pinnedCount)) },
        { label: 'Favorites', value: count(num(reg.favoriteCount)) },
      ];
      for (const t of byTypeEntries.slice(0, 6)) {
        rows.push({ label: `Type · ${t.k}`, value: count(t.n) });
      }
      groups.push({
        title: 'Local application registry (reuse)',
        rows,
        note: 'Reused from the local application registry (ipc.registry.stats()) — no new signal.',
      });
    }
  }

  return { stats, groups, gaps: extensionGaps(), links: extensionLinks() };
}
