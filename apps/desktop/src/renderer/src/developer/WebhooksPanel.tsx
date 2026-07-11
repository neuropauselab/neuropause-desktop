/**
 * Webhooks. Register endpoints that subscribe to platform event categories/types,
 * watch deliveries move through the outbox (signed, retried, dead-lettered), and
 * replay dead letters. This is a view onto the real webhook subsystem (Increment 4)
 * — deliveries here are the same signed POSTs an integrator's endpoint receives.
 */
import { useEffect, useState } from 'react';
import {
  PLATFORM_EVENT_CATEGORIES,
  WEBHOOK_SIGNATURE_HEADER,
  type PlatformEventCategory,
  type WebhookDelivery,
  type WebhookWithSecret,
} from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useDeveloper } from './DeveloperProvider';
import { Modal, Field, Input, InlineCode, CodeBlock } from './primitives';
import { deliveryStatusMeta, relativeTime, titleCase, TEXT_TONE } from './lib';
import { parseEventTypes, webhookSubscriptionSummary } from './portalModel';

export function WebhooksPanel(): JSX.Element {
  const { webhooks, webhookStats, createWebhook, setWebhookEnabled, deleteWebhook, loadDeliveries, loadDeadLetters, replayDelivery } = useDeveloper();

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [categories, setCategories] = useState<PlatformEventCategory[]>([]);
  const [typesText, setTypesText] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [secret, setSecret] = useState<WebhookWithSecret | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deadLetters, setDeadLetters] = useState<WebhookDelivery[]>([]);

  // Keep deliveries + dead-letters live: reload whenever the selection changes or the
  // dispatcher broadcasts new stats (webhookStats changes on every delivery attempt).
  useEffect(() => {
    let alive = true;
    void Promise.all([loadDeliveries(selected ?? undefined, 100), loadDeadLetters()]).then(([d, dl]) => {
      if (!alive) return;
      setDeliveries(d);
      setDeadLetters(dl);
    });
    return () => {
      alive = false;
    };
  }, [selected, webhookStats, loadDeliveries, loadDeadLetters]);

  const toggleCategory = (c: PlatformEventCategory): void =>
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const resetCreate = (): void => {
    setLabel('');
    setUrl('');
    setCategories([]);
    setTypesText('');
    setCreateError(null);
  };

  const submitCreate = async (): Promise<void> => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createWebhook({ label: label.trim(), url: url.trim(), categories, types: parseEventTypes(typesText) });
      setCreateOpen(false);
      resetCreate();
      setSecret(res);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the endpoint');
    } finally {
      setCreating(false);
    }
  };

  const stats = webhookStats;

  return (
    <div>
      <OpsPanel
        title="Webhook endpoints"
        subtitle="Deliver platform events to your services — signed, retried, dead-lettered"
        actions={<Button variant="primary" icon="plus" onClick={() => { resetCreate(); setCreateOpen(true); }}>Register endpoint</Button>}
      >
        {stats && (
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat icon="bolt" label="Deliveries" value={stats.total} tone="blue" />
            <Stat icon="check" label="Delivered" value={stats.delivered} tone="green" />
            <Stat icon="clock" label="Pending" value={stats.pending} tone={stats.pending > 0 ? 'orange' : 'gray'} />
            <Stat icon="refresh" label="Failed" value={stats.failed} tone={stats.failed > 0 ? 'orange' : 'gray'} />
            <Stat icon="close" label="Dead" value={stats.dead} tone={stats.dead > 0 ? 'red' : 'gray'} />
          </div>
        )}

        {webhooks.length === 0 ? (
          <EmptyState icon="bolt" title="No endpoints yet" description="Register an endpoint to start receiving signed event deliveries." compact />
        ) : (
          <div className="space-y-2">
            {webhooks.map((w) => {
              const active = selected === w.id;
              return (
                <div key={w.id} className={cn('rounded-xl border p-3 transition', active ? 'border-[var(--accent)] surface-raised' : 'border-[var(--hairline)] [background:var(--fill-1)]')}>
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => setSelected(active ? null : w.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{w.label}</span>
                        <StatusBadge tone={w.enabled ? 'green' : 'gray'} label={w.enabled ? 'Enabled' : 'Disabled'} />
                      </div>
                      <div className="mt-0.5 truncate font-mono text-2xs text-muted">{w.url}</div>
                      <div className="mt-0.5 text-2xs text-faint">{webhookSubscriptionSummary(w)} · secret ****{w.secretLast4} · {relativeTime(w.createdAt)}</div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" title={w.enabled ? 'Disable' : 'Enable'} aria-label={w.enabled ? 'Disable' : 'Enable'} onClick={() => void setWebhookEnabled(w.id, !w.enabled)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink">
                        <Icon name={w.enabled ? 'pause' : 'play'} size={14} />
                      </button>
                      <button type="button" title="Delete" aria-label="Delete" onClick={() => void deleteWebhook(w.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-sysred">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Deliveries" subtitle={selected ? 'Selected endpoint' : 'All endpoints, newest first'}>
        {deliveries.length === 0 ? (
          <EmptyState icon="clock" title="No deliveries yet" description="Deliveries appear as platform events match a subscribed endpoint." compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">Attempts</th>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Last error</th>
                <th className="px-4 py-2.5">Next / updated</th>
              </>
            }
          >
            {deliveries.map((d) => {
              const meta = deliveryStatusMeta(d.status);
              return (
                <tr key={d.id} className="border-t border-[var(--hairline)]">
                  <td className="px-4 py-2.5"><StatusBadge tone={meta.tone} label={meta.label} /></td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-muted">{d.eventType}</td>
                  <td className="px-4 py-2.5 text-muted">{d.attempts}</td>
                  <td className="px-4 py-2.5"><span className={cn('font-mono', d.lastStatusCode && d.lastStatusCode >= 400 ? TEXT_TONE.red : 'text-muted')}>{d.lastStatusCode ?? '—'}</span></td>
                  <td className="px-4 py-2.5 max-w-[220px] truncate text-2xs text-faint" title={d.lastError ?? ''}>{d.lastError ?? '—'}</td>
                  <td className="px-4 py-2.5 text-2xs text-faint">{relativeTime(d.nextAttemptAt ?? d.updatedAt)}</td>
                </tr>
              );
            })}
          </OpsTable>
        )}
      </OpsPanel>

      <OpsPanel title="Dead letters" subtitle="Deliveries that exhausted the retry schedule — replay to re-enqueue">
        {deadLetters.length === 0 ? (
          <EmptyState icon="check" title="No dead letters" description="Every delivery has succeeded or is still retrying." compact />
        ) : (
          <div className="space-y-2">
            {deadLetters.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2.5">
                <StatusBadge tone="red" label="Dead" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-2xs text-ink">{d.eventType}</span>
                  <span className="block truncate text-2xs text-faint">{d.attempts} attempts · last code {d.lastStatusCode ?? '—'} · {d.lastError ?? 'no error text'}</span>
                </span>
                <Button size="sm" icon="undo" onClick={() => void replayDelivery(d.id)}>Replay</Button>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <Modal
        open={createOpen}
        title="Register webhook endpoint"
        subtitle="POSTs a signed JSON payload on every matching platform event"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="plus" loading={creating} disabled={creating || !label.trim() || !url.trim()} onClick={() => void submitCreate()}>Create</Button>
          </>
        }
      >
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Billing service" /></Field>
        <Field label="Delivery URL" hint="HTTPS endpoint that will receive the POST"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/hooks/neuropause" /></Field>
        <Field label="Event categories" hint="Leave all unchecked to receive every event">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORM_EVENT_CATEGORIES.map((c) => {
              const on = categories.includes(c);
              return (
                <button key={c} type="button" onClick={() => toggleCategory(c)} className={cn('rounded-lg px-2 py-1 text-2xs font-medium transition', on ? 'surface-raised text-ink shadow-sm' : '[background:var(--fill-1)] text-muted hover:text-ink')}>
                  {titleCase(c)}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Specific event types (optional)" hint="Comma-separated, e.g. enterprise.record.created, automation.completed">
          <Input value={typesText} onChange={(e) => setTypesText(e.target.value)} placeholder="enterprise.record.created, connector.sync_completed" />
        </Field>
        {createError && <p className="flex items-center gap-1.5 text-xs text-sysred"><Icon name="info" size={13} /> {createError}</p>}
      </Modal>

      <Modal
        open={secret !== null}
        title="Signing secret"
        subtitle="Copy it now — it is shown only once"
        onClose={() => setSecret(null)}
        footer={<Button variant="primary" icon="check" onClick={() => setSecret(null)}>Done</Button>}
      >
        {secret && (
          <>
            <p className="mb-3 text-xs text-muted">Endpoint <span className="font-semibold text-ink">{secret.webhook.label}</span> is live. Verify deliveries with the <InlineCode>{WEBHOOK_SIGNATURE_HEADER}</InlineCode> header.</p>
            <CodeBlock label="Secret" value={secret.secret} />
            <p className="mt-3 text-2xs text-faint">
              Signature scheme: <InlineCode>t=&lt;unix_ms&gt;,v1=&lt;hex&gt;</InlineCode> — an HMAC-SHA256 over <InlineCode>{'`${t}.${body}`'}</InlineCode>. The official SDK helper <InlineCode>verifyWebhook</InlineCode> checks this for you.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}
