/**
 * Enterprise API Platform. The API gateway deployed as a cloud service across
 * regions with HA replicas; rate-limit policies; webhook endpoints (create,
 * pause, test, delete); and the public API registry. Monitoring request volume
 * comes from the real gateway metrics.
 */
import { useState } from 'react';
import type { ApiDeployment, WebhookEndpoint } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge, Bar } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { Modal, Field, Input } from '@renderer/developer/primitives';
import { cn } from '@renderer/lib/cn';
import { useCloud } from './CloudProvider';
import { deploymentStatusMeta, webhookStatusMeta, visibilityTone, formatNum, formatMs, relativeTime } from './lib';

export function ApiPlatformPanel(): JSX.Element {
  const { deployments, apiSummary, policies, webhooks, publicApis, setPolicyEnabled, createWebhook, setWebhookStatus, deleteWebhook, testWebhook } = useCloud();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <OpsPanel title="API gateway" subtitle="Deployed as a cloud service across regions with high-availability replicas">
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="server" label="Deployments" value={apiSummary?.deployments ?? deployments.length} tone="accent" />
          <Stat icon="check" label="Healthy" value={`${apiSummary?.healthy ?? 0}/${apiSummary?.deployments ?? 0}`} tone="green" />
          <Stat icon="pulse" label="Uptime" value={`${apiSummary?.uptimePct ?? 0}%`} tone="blue" hint="healthy replicas" />
          <Stat icon="analytics" label="Requests 30d" value={formatNum(apiSummary?.requests30d ?? 0)} tone="purple" />
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Replicas</th>
                <th className="px-4 py-2.5 text-right">p95</th>
                <th className="px-4 py-2.5 text-right">Uptime</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => <DeploymentRow key={d.id} dep={d} />)}
            </tbody>
          </table>
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Rate limiting" subtitle="Throughput ceilings by scope">
          <div className="space-y-2">
            {policies.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <StatusBadge tone={p.scope === 'global' ? 'purple' : p.scope === 'tenant' ? 'blue' : 'gray'} label={p.scope} />
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">{formatNum(p.limit)} req / {p.windowSec}s · burst {formatNum(p.burst)}</div>
                </div>
                <button onClick={() => void setPolicyEnabled(p.id, !p.enabled)} className={cn('rounded-lg px-2.5 py-1 text-2xs transition-colors', p.enabled ? 'bg-sysgreen/15 text-sysgreen' : '[background:var(--fill-2)] text-faint')}>{p.enabled ? 'Enabled' : 'Disabled'}</button>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Public APIs" subtitle="Versioned, scoped surfaces">
          <div className="space-y-2">
            {publicApis.map((a) => (
              <div key={a.id} className="rounded-xl [background:var(--fill-1)] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    <StatusBadge tone={visibilityTone(a.visibility)} label={a.visibility} />
                  </div>
                  <span className="text-2xs text-faint">{a.rps} rps</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-2xs text-faint">
                  <code className="[background:var(--fill-2)] rounded px-1.5 py-0.5">{a.basePath}</code>
                  <span>{a.version}</span>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </div>

      <OpsPanel
        title="Webhooks"
        subtitle="Outbound event delivery to your endpoints"
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setCreating(true)}>Add webhook</Button>}
      >
        {webhooks.length === 0 ? (
          <div className="rounded-xl [background:var(--fill-1)] px-3 py-6 text-center text-2xs text-faint">No webhooks configured.</div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((w) => <WebhookCard key={w.id} hook={w} onTest={() => void testWebhook(w.id)} onToggle={() => void setWebhookStatus(w.id, w.status === 'paused' ? 'active' : 'paused')} onDelete={() => void deleteWebhook(w.id)} />)}
          </div>
        )}
      </OpsPanel>

      {creating && <CreateWebhookModal onClose={() => setCreating(false)} onCreate={async (input) => { await createWebhook(input); setCreating(false); }} />}
    </div>
  );
}

function DeploymentRow({ dep }: { dep: ApiDeployment }): JSX.Element {
  const meta = deploymentStatusMeta(dep.status);
  const ratio = dep.replicas > 0 ? dep.healthyReplicas / dep.replicas : 0;
  return (
    <tr className="border-t border-[var(--hairline)]">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2"><Icon name="server" size={14} className="text-faint" /><span className="font-medium">{dep.regionId}</span></div>
        <div className="text-2xs text-faint">{dep.service} · {dep.version}</div>
      </td>
      <td className="px-4 py-2.5"><StatusBadge tone={meta.tone} label={meta.label} pulse={dep.status === 'degraded'} /></td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-2xs text-faint">{dep.healthyReplicas}/{dep.replicas}</span>
          <div className="w-16"><Bar value={ratio} tone={meta.tone} /></div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{formatMs(dep.p95LatencyMs)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-faint">{dep.uptimePct}%</td>
    </tr>
  );
}

function WebhookCard({ hook, onTest, onToggle, onDelete }: { hook: WebhookEndpoint; onTest: () => void; onToggle: () => void; onDelete: () => void }): JSX.Element {
  const meta = webhookStatusMeta(hook.status);
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="bolt" size={15} className={TEXT_TONE[meta.tone]} />
            <code className="truncate text-sm font-medium">{hook.url}</code>
            <StatusBadge tone={meta.tone} label={meta.label} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {hook.events.map((e) => <span key={e} className="rounded [background:var(--fill-2)] px-1.5 py-0.5 text-3xs text-faint">{e}</span>)}
          </div>
          <div className="mt-1.5 text-2xs text-faint">{formatNum(hook.deliveries)} deliveries · {hook.failures} failed{hook.lastDeliveryAt ? ` · last ${relativeTime(hook.lastDeliveryAt)}` : ''}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" icon="play" onClick={onTest}>Test</Button>
          <Button variant="ghost" size="sm" onClick={onToggle}>{hook.status === 'paused' ? 'Resume' : 'Pause'}</Button>
          <button onClick={onDelete} className="rounded-lg p-1.5 text-faint hover:text-sysred" title="Delete"><Icon name="trash" size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function CreateWebhookModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { url: string; events: string[] }) => void }): JSX.Element {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('listing.published, sync.completed');
  return (
    <Modal
      open
      title="Add webhook"
      subtitle="Deliver platform events to an HTTPS endpoint"
      onClose={onClose}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" icon="plus" disabled={!url.trim()} onClick={() => onCreate({ url: url.trim(), events: events.split(',').map((e) => e.trim()).filter(Boolean) })}>Add</Button></>}
    >
      <div className="space-y-3">
        <Field label="Endpoint URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.example.com/inbound" /></Field>
        <Field label="Events" hint="Comma-separated event names"><Input value={events} onChange={(e) => setEvents(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
