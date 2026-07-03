/**
 * API Gateway. The version registry, a live request tester that runs a call
 * through the real decision engine (auth → scope → rate → quota → version), the
 * aggregate metrics, and the audit trail. The tester meters into your usage just
 * like a real call would.
 */
import { useState } from 'react';
import { ALL_API_SCOPES, type ApiScope, type ApiVersion, type GatewayDecision } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { cn } from '@renderer/lib/cn';
import { useDeveloper } from './DeveloperProvider';
import { Field, Input, Select, InlineCode } from './primitives';
import { formatNum, relativeTime, statusHttpTone, TEXT_TONE, versionStatusTone } from './lib';

export function GatewayPanel(): JSX.Element {
  const { gatewayVersions, gatewayMetrics, gatewayAudit, runGatewayRequest } = useDeveloper();

  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/marketplace/listings');
  const [version, setVersion] = useState<ApiVersion>('v1');
  const [scope, setScope] = useState<ApiScope | ''>('marketplace:read');
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<GatewayDecision | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      setResult(await runGatewayRequest({ apiKey: apiKey.trim() || null, method, path, version, scope: scope || null }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <OpsPanel title="API versions" subtitle="Versioned surfaces fronted by the gateway">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {gatewayVersions.map((v) => (
            <div key={v.version} className="surface-raised rounded-2xl p-4 shadow-card">
              <div className="flex items-center justify-between">
                <span className="font-mono text-base font-semibold uppercase">{v.version}</span>
                <StatusBadge tone={versionStatusTone(v.status)} label={v.status} />
              </div>
              <p className="mt-1 text-xs text-muted">{v.notes}</p>
              <p className="mt-1 text-2xs text-faint">Since {v.since}{v.sunsetAt ? ` · sunsets ${v.sunsetAt}` : ''}</p>
            </div>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="Request tester" subtitle="Run a call through the gateway decision engine">
        <div className="surface-raised rounded-2xl p-4 shadow-card">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {['GET', 'POST', 'PUT', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Version">
              <Select value={version} onChange={(e) => setVersion(e.target.value as ApiVersion)}>
                {gatewayVersions.map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
              </Select>
            </Field>
            <div className="col-span-2">
              <Field label="Path"><Input value={path} onChange={(e) => setPath(e.target.value)} /></Field>
            </div>
            <div className="col-span-2">
              <Field label="Required scope">
                <Select value={scope} onChange={(e) => setScope(e.target.value as ApiScope | '')}>
                  <option value="">(none)</option>
                  {ALL_API_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="API key" hint="Paste a key secret to authenticate; leave blank for anonymous"><Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="npk_live_…" /></Field>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Button variant="primary" icon="bolt" disabled={busy} onClick={() => void send()}>Send request</Button>
          </div>

          {result && (
            <div className="mt-4 rounded-xl border border-[var(--hairline)] p-3">
              <div className="flex items-center gap-2">
                <span className={cn('font-mono text-lg font-bold', TEXT_TONE[statusHttpTone(result.status)])}>{result.status}</span>
                <StatusBadge tone={result.allowed ? 'green' : 'red'} label={result.allowed ? 'Allowed' : 'Denied'} />
                <span className="text-sm text-muted">{result.reason}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <Meter label="Rate remaining" value={`${result.rateRemaining}/${result.rateLimit}`} />
                <Meter label="Quota remaining" value={`${formatNum(result.quotaRemaining)}/${formatNum(result.quotaLimit)}`} />
                <Meter label="Developer" value={result.developerId ? 'resolved' : '—'} />
                <Meter label="Retry after" value={result.retryAfterMs ? `${result.retryAfterMs}ms` : '—'} />
              </dl>
            </div>
          )}
        </div>
      </OpsPanel>

      <OpsPanel title="Gateway metrics" subtitle="Last 7 days">
        {gatewayMetrics && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat icon="globe" label="Requests" value={formatNum(gatewayMetrics.requests)} tone="blue" />
            <Stat icon="check" label="Allowed" value={formatNum(gatewayMetrics.allowed)} tone="green" />
            <Stat icon="close" label="Denied" value={formatNum(gatewayMetrics.denied)} tone={gatewayMetrics.denied > 0 ? 'orange' : 'gray'} />
            <Stat icon="lock" label="Rate-limited" value={formatNum(gatewayMetrics.rateLimited)} tone={gatewayMetrics.rateLimited > 0 ? 'orange' : 'gray'} />
            <Stat icon="gauge" label="p95 latency" value={`${gatewayMetrics.p95LatencyMs}ms`} tone="purple" />
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Audit trail" subtitle="Every gateway decision, newest first">
        {gatewayAudit.length === 0 ? (
          <EmptyState icon="clipboard" title="No gateway traffic yet" description="Use the request tester above to generate audit entries." compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Method</th>
                <th className="px-4 py-2.5">Path</th>
                <th className="px-4 py-2.5">Version</th>
                <th className="px-4 py-2.5">Reason</th>
                <th className="px-4 py-2.5">Latency</th>
                <th className="px-4 py-2.5">When</th>
              </>
            }
          >
            {gatewayAudit.map((a) => (
              <tr key={a.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5"><span className={cn('font-mono font-semibold', TEXT_TONE[statusHttpTone(a.status)])}>{a.status}</span></td>
                <td className="px-4 py-2.5"><InlineCode>{a.method}</InlineCode></td>
                <td className="px-4 py-2.5 font-mono text-2xs text-muted">{a.path}</td>
                <td className="px-4 py-2.5 text-muted">{a.version}</td>
                <td className="px-4 py-2.5 text-2xs text-muted">{a.reason}</td>
                <td className="px-4 py-2.5 text-muted">{a.latencyMs}ms</td>
                <td className="px-4 py-2.5 text-2xs text-faint">{relativeTime(a.at)}</td>
              </tr>
            ))}
          </OpsTable>
        )}
      </OpsPanel>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-faint">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
