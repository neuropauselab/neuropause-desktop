/**
 * Release Diagnostics collector. Composes the authoritative component-health
 * DiagnosticsReport (event bus, timeline, runtime, registry, package service,
 * plugin host, backend/database, connectors) with build identity, code-signing
 * status, and self-update status into one operator report — and renders it as
 * plain text for the page's Export / Copy actions.
 *
 * Health probes (component/database/connector/workforce/enterprise) are owned
 * by the platform diagnostics service and injected here, so this module adds the
 * release-engineering layer without duplicating any health logic.
 */
import type {
  BuildIdentity,
  DiagnosticsReport,
  InstalledModule,
  ReleaseDiagnostics,
  SigningStatus,
  UpdateStatus,
} from '@neuropause/shared';
import { formatStartupLines, startupMetrics } from './startupMetrics';

export interface ReleaseDiagnosticsDeps {
  build: () => BuildIdentity;
  signing: () => Promise<SigningStatus>;
  update: () => UpdateStatus;
  health: () => Promise<DiagnosticsReport>;
  modules: () => Promise<InstalledModule[]>;
  connectors: () => Promise<{ id: string; name: string; status: string }[]>;
  now?: () => number;
}

export async function collectReleaseDiagnostics(deps: ReleaseDiagnosticsDeps): Promise<ReleaseDiagnostics> {
  const [signing, health, modules, connectors] = await Promise.all([
    deps.signing(),
    deps.health(),
    deps.modules(),
    deps.connectors(),
  ]);
  const now = deps.now ?? (() => Date.now());
  return {
    generatedAt: new Date(now()).toISOString(),
    build: deps.build(),
    signing,
    update: deps.update(),
    health,
    modules,
    connectors,
  };
}

function signingLine(s: SigningStatus): string {
  const labels: Record<SigningStatus['state'], string> = {
    'signed-notarized': 'Signed & notarized',
    signed: 'Signed (not notarized)',
    unsigned: 'Unsigned',
    unknown: 'Unknown',
    'not-applicable': 'Not applicable (development build)',
  };
  return labels[s.state];
}

/** Render the report as a human-readable text block (Export / Copy). */
export function formatDiagnosticsText(d: ReleaseDiagnostics): string {
  const b = d.build;
  const lines: string[] = [];
  lines.push('NeuroPause Desktop — Release Diagnostics');
  lines.push(`Generated: ${d.generatedAt}`);
  lines.push('');
  lines.push('## Build');
  lines.push(`Version:        ${b.version}`);
  lines.push(`Channel:        ${b.channel}`);
  lines.push(`Commit:         ${b.commit}`);
  lines.push(`Build date:     ${b.buildTime}`);
  lines.push(`Platform:       ${b.platform}/${b.arch}`);
  lines.push(`Packaged:       ${b.packaged ? 'yes' : 'no (development)'}`);
  lines.push(`Runtime:        Electron ${b.runtime.electron} · Node ${b.runtime.node} · Chrome ${b.runtime.chrome} · V8 ${b.runtime.v8}`);
  if (b.releaseNotes) {
    // Phase 8 (8.6): the generic update feed carries no notes — the build does.
    lines.push('');
    lines.push("## What's new in this build");
    lines.push(b.releaseNotes);
  }
  // Phase 8 (8.16): boot-phase timings — launch time, finally measured.
  const startup = formatStartupLines(startupMetrics.snapshot());
  if (startup.length > 0) {
    lines.push('');
    lines.push(...startup);
  }
  lines.push('');
  lines.push('## Signing');
  lines.push(`Status:         ${signingLine(d.signing)}`);
  lines.push(`Notarized:      ${d.signing.notarized === null ? 'unknown' : d.signing.notarized ? 'yes' : 'no'}`);
  if (d.signing.authority) lines.push(`Authority:      ${d.signing.authority}`);
  lines.push('');
  lines.push('## Update');
  lines.push(`Channel:        ${d.update.channel}`);
  lines.push(`Phase:          ${d.update.phase}`);
  lines.push(`Supported:      ${d.update.supported ? 'yes' : 'no'}`);
  if (d.update.currentVersion) lines.push(`Current:        ${d.update.currentVersion}`);
  lines.push('');
  lines.push(`## Health — overall: ${d.health.overall.toUpperCase()} (uptime ${Math.round(d.health.uptimeMs / 1000)}s)`);
  for (const c of d.health.checks) {
    lines.push(`[${c.status.toUpperCase().padEnd(8)}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
    if (c.recommendation) lines.push(`            ↳ ${c.recommendation}`);
  }
  lines.push('');
  lines.push(`## Installed modules (${d.modules.length})`);
  for (const m of d.modules) {
    lines.push(`- [${m.kind}] ${m.name}${m.version ? ` v${m.version}` : ''} ${m.enabled ? '' : '(disabled)'}`.trimEnd());
  }
  lines.push('');
  lines.push(`## Connectors (${d.connectors.length})`);
  for (const c of d.connectors) lines.push(`- ${c.name}: ${c.status}`);
  lines.push('');
  return lines.join('\n');
}
