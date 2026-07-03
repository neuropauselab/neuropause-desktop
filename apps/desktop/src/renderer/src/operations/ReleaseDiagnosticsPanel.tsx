import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { formatRelative } from '@renderer/lib/format';
import { OpsPanel, StatusBadge, StatusDot, Stat, OpsTable } from './primitives';
import { TINT_TONE, formatUptime, type OpsTone } from './lib';
import type {
  CrashStatus,
  DiagnosticStatus,
  ReleaseDiagnostics,
  SigningState,
} from '@neuropause/shared';

function diagTone(s: DiagnosticStatus): OpsTone {
  return s === 'ok' ? 'green' : s === 'degraded' ? 'orange' : s === 'down' ? 'red' : 'gray';
}
function diagLabel(s: DiagnosticStatus): string {
  return s === 'ok' ? 'Operational' : s === 'degraded' ? 'Degraded' : s === 'down' ? 'Down' : 'Unknown';
}

const SIGNING_META: Record<SigningState, { tone: OpsTone; label: string }> = {
  'signed-notarized': { tone: 'green', label: 'Signed & notarized' },
  signed: { tone: 'blue', label: 'Signed' },
  unsigned: { tone: 'red', label: 'Unsigned' },
  unknown: { tone: 'gray', label: 'Unknown' },
  'not-applicable': { tone: 'gray', label: 'Development build' },
};

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Release Diagnostics — the comprehensive release-engineering surface. Composes
 * the live component/database/connector health report with build identity,
 * code-signing / notarization status, and self-update status. Everything is a
 * real snapshot from the main process; supports exporting the report, copying
 * it, and generating a redacted support bundle.
 */
export function ReleaseDiagnosticsPanel(): JSX.Element {
  const [report, setReport] = useState<ReleaseDiagnostics | null>(null);
  const [crash, setCrash] = useState<CrashStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([ipc.releaseOps.diagnostics(), ipc.releaseOps.crashStatus()]);
      setReport(r);
      setCrash(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportReport = useCallback(async () => {
    const { text } = await ipc.releaseOps.exportDiagnostics();
    downloadText(`neuropause-diagnostics-${Date.now()}.txt`, text);
  }, []);

  const copyReport = useCallback(async () => {
    const { text } = await ipc.releaseOps.exportDiagnostics();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, []);

  const generateBundle = useCallback(async () => {
    setBusy(true);
    try {
      const info = await ipc.releaseOps.generateSupportBundle();
      setBundlePath(info.path);
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleCrashOptIn = useCallback(async () => {
    if (!crash) return;
    setCrash(await ipc.releaseOps.setCrashOptIn(!crash.optedIn));
  }, [crash]);

  if (error) {
    return (
      <div className="rounded-2xl border border-syspink/30 bg-syspink/10 p-4 text-sm text-syspink">
        Could not load diagnostics: {error}
      </div>
    );
  }
  if (!report) {
    return <div className="py-12 text-center text-sm text-faint">Collecting diagnostics…</div>;
  }

  const b = report.build;
  const signing = SIGNING_META[report.signing.state];
  const health = report.health;

  return (
    <div>
      <OpsPanel
        title="Release Diagnostics"
        subtitle="Build identity, signing, updates, and component health — a real snapshot from the main process."
        actions={
          <>
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => void load()}>
              Refresh
            </Button>
            <Button size="sm" variant="secondary" icon={copied ? 'check' : 'clipboard'} onClick={() => void copyReport()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="secondary" icon="doc" onClick={() => void exportReport()}>
              Export
            </Button>
            <Button size="sm" variant="primary" icon="package" onClick={() => void generateBundle()} disabled={busy}>
              {busy ? 'Generating…' : 'Support bundle'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon="package" label="Version" value={b.version} tone="accent" hint={b.channel} />
          <Stat icon="code" label="Commit" value={<span className="font-mono text-lg">{b.commit.slice(0, 10)}</span>} tone="blue" />
          <Stat icon="clock" label="Built" value={<span className="text-base">{formatRelative(b.buildTime)}</span>} tone="gray" />
          <Stat
            icon="gauge"
            label="Uptime"
            value={<span className="text-base">{formatUptime(health.uptimeMs)}</span>}
            tone={diagTone(health.overall)}
            hint={diagLabel(health.overall)}
          />
        </div>

        {bundlePath && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-sysgreen/30 bg-sysgreen/10 p-3 text-xs text-sysgreen">
            <Icon name="check" size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Support bundle generated</div>
              <div className="mt-0.5 break-all font-mono text-faint">{bundlePath}</div>
              <div className="mt-1 text-faint">Secrets, tokens, and emails are redacted; connector credentials are never included.</div>
            </div>
          </div>
        )}
      </OpsPanel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Signing & notarization */}
        <OpsPanel title="Signing & Notarization">
          <div className="surface-raised space-y-3 rounded-2xl p-4 shadow-card">
            <Row label="Status"><StatusBadge tone={signing.tone} label={signing.label} /></Row>
            <Row label="Signed">{report.signing.signed ? 'Yes' : 'No'}</Row>
            <Row label="Notarized">
              {report.signing.notarized === null ? '—' : report.signing.notarized ? 'Yes' : 'No'}
            </Row>
            {report.signing.authority && <Row label="Authority"><span className="text-right">{report.signing.authority}</span></Row>}
            {report.signing.detail && <p className="pt-1 text-xs text-faint">{report.signing.detail}</p>}
          </div>
        </OpsPanel>

        {/* Update status */}
        <OpsPanel title="Updates">
          <div className="surface-raised space-y-3 rounded-2xl p-4 shadow-card">
            <Row label="Channel"><span className="capitalize">{report.update.channel}</span></Row>
            <Row label="Phase"><span className="capitalize">{report.update.phase}</span></Row>
            <Row label="Current version">{report.update.currentVersion}</Row>
            <Row label="Self-update">
              <StatusBadge tone={report.update.supported ? 'green' : 'gray'} label={report.update.supported ? 'Operational' : 'Unavailable'} />
            </Row>
            {report.update.available && <Row label="Available">{report.update.available.version}</Row>}
          </div>
        </OpsPanel>
      </div>

      {/* Platform & runtime */}
      <OpsPanel title="Platform & Runtime">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat label="Platform" value={b.platform} />
          <MiniStat label="Arch" value={b.arch} />
          <MiniStat label="Electron" value={b.runtime.electron} />
          <MiniStat label="Node" value={b.runtime.node} />
          <MiniStat label="Chrome" value={b.runtime.chrome} />
          <MiniStat label="V8" value={b.runtime.v8} />
        </div>
      </OpsPanel>

      {/* Component health summary */}
      <OpsPanel title="Component Health" subtitle="Database, connectors, runtime, and platform services. The Diagnostics tab has the granular view.">
        <div className="space-y-2">
          {health.checks.map((c) => (
            <div key={c.id} className="surface-raised flex items-center gap-3 rounded-xl p-3 shadow-card">
              <StatusDot tone={diagTone(c.status)} pulse={c.status === 'down'} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.label}</div>
                {c.detail && <div className="truncate text-xs text-faint">{c.detail}</div>}
              </div>
              <StatusBadge tone={diagTone(c.status)} label={diagLabel(c.status)} />
            </div>
          ))}
        </div>
      </OpsPanel>

      {/* Installed modules */}
      <OpsPanel title="Installed Modules" subtitle={`${report.modules.length} apps and plugins`}>
        <OpsTable head={<><Th>Name</Th><Th>Type</Th><Th>Version</Th><Th>State</Th></>}>
          {report.modules.map((m, i) => (
            <tr key={`${m.kind}-${m.name}-${i}`} className="border-t border-[var(--hairline)]">
              <Td><span className="font-medium">{m.name}</span></Td>
              <Td><span className="capitalize text-faint">{m.kind}</span></Td>
              <Td>{m.version ?? '—'}</Td>
              <Td><StatusBadge tone={m.enabled ? 'green' : 'gray'} label={m.enabled ? 'Enabled' : 'Disabled'} /></Td>
            </tr>
          ))}
          {report.modules.length === 0 && (
            <tr><Td colSpan={4}><span className="text-faint">No modules installed.</span></Td></tr>
          )}
        </OpsTable>
      </OpsPanel>

      {/* Connectors */}
      <OpsPanel title="Connectors" subtitle={`${report.connectors.length} configured`}>
        <div className="flex flex-wrap gap-2">
          {report.connectors.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 py-1 text-xs">
              <span className="font-medium">{c.name}</span>
              <span className="text-faint">·</span>
              <span className="capitalize text-faint">{c.status}</span>
            </span>
          ))}
          {report.connectors.length === 0 && <span className="text-xs text-faint">No connectors configured.</span>}
        </div>
      </OpsPanel>

      {/* Crash reporting */}
      {crash && (
        <OpsPanel
          title="Crash Reporting"
          subtitle="Local, on-device crash capture. Opt-in and never uploaded."
          actions={
            <Button size="sm" variant={crash.optedIn ? 'secondary' : 'primary'} icon={crash.optedIn ? 'check' : 'shield'} onClick={() => void toggleCrashOptIn()}>
              {crash.optedIn ? 'Native capture on' : 'Enable native capture'}
            </Button>
          }
        >
          <div className="mb-3 grid grid-cols-3 gap-3">
            <Stat icon="shield" label="Native capture" value={<span className="text-base">{crash.nativeActive ? 'Active' : 'Off'}</span>} tone={crash.nativeActive ? 'green' : 'gray'} />
            <Stat icon="activity" label="Opt-in" value={<span className="text-base">{crash.optedIn ? 'Yes' : 'No'}</span>} tone={crash.optedIn ? 'green' : 'gray'} />
            <Stat icon="list" label="Captured" value={crash.total} tone={crash.total > 0 ? 'orange' : 'gray'} />
          </div>
          {crash.recent.length === 0 ? (
            <div className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-4 text-center text-xs text-faint">
              No crashes recorded. 🎉
            </div>
          ) : (
            <div className="space-y-1.5">
              {crash.recent.map((r, i) => (
                <div key={i} className="surface-raised flex items-center gap-3 rounded-xl p-3 shadow-card">
                  <span className={cn('rounded-md px-2 py-0.5 text-2xs font-semibold capitalize', TINT_TONE.orange)}>{r.category}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{r.message}</div>
                    <div className="text-2xs text-faint">{r.kind} · {formatRelative(r.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-faint">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
      <div className="text-2xs uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-medium">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }): JSX.Element {
  return <th className="px-3 py-2">{children}</th>;
}
function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }): JSX.Element {
  return <td className="px-3 py-2" colSpan={colSpan}>{children}</td>;
}
