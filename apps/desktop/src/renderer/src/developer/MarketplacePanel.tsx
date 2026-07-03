/**
 * Marketplace & Publishing. Browse listings, inspect a listing's versions with
 * their security scan and Ed25519 signature, and drive the full pipeline:
 * create a listing, add a version from a manifest, submit (scan → sign), review
 * (approve / reject / request changes), publish, and roll back. Also install and
 * rate. Every action is a governed IPC call.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  LISTING_KINDS,
  type ListingDetail,
  type ListingKind,
  type ListingVersion,
  type MarketplaceListing,
  type PricingModel,
} from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useDeveloper } from './DeveloperProvider';
import { Modal, Field, Input, Textarea, Select, InlineCode, Stars } from './primitives';
import { formatNum, kindMeta, listingStatusMeta, pricingLabel, relativeTime, reviewDecisionMeta, scanStatusMeta, severityMeta, TEXT_TONE } from './lib';

export function MarketplacePanel(): JSX.Element {
  const { listings, marketplaceStats, listingDetail, createListing, install } = useDeveloper();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const reloadDetail = useCallback(async (id: string) => {
    setDetail(await listingDetail(id));
  }, [listingDetail]);

  useEffect(() => {
    if (selectedId) void reloadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, reloadDetail, listings]);

  return (
    <div>
      <OpsPanel title="Marketplace" subtitle="Publish AI apps, workers, connectors, plugins, and templates" actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New listing</Button>}>
        {marketplaceStats && (
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat icon="store" label="Listings" value={marketplaceStats.totalListings} tone="accent" />
            <Stat icon="verified" label="Published" value={marketplaceStats.published} tone="green" />
            <Stat icon="clock" label="In review" value={marketplaceStats.inReview} tone={marketplaceStats.inReview > 0 ? 'orange' : 'gray'} />
            <Stat icon="doc" label="Draft" value={marketplaceStats.draft} tone="gray" />
            <Stat icon="download" label="Installs" value={formatNum(marketplaceStats.totalInstalls)} tone="blue" />
          </div>
        )}

        {listings.length === 0 ? (
          <EmptyState icon="store" title="No listings yet" description="Create your first marketplace listing to begin publishing." compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-4 py-2.5">Listing</th>
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Pricing</th>
                <th className="px-4 py-2.5">Installs</th>
                <th className="px-4 py-2.5">Rating</th>
                <th className="px-4 py-2.5" />
              </>
            }
          >
            {listings.map((l) => {
              const km = kindMeta(l.kind);
              const sm = listingStatusMeta(l.status);
              return (
                <tr key={l.id} className="cursor-pointer border-t border-[var(--hairline)] hover:[background:var(--fill-1)]" onClick={() => setSelectedId(l.id)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TEXT_TONE[km.tone])}><Icon name={km.icon} size={15} /></span>
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">{l.name}{l.certified && <Icon name="verified" size={13} className="text-sysblue" />}</div>
                        <div className="text-2xs text-faint">{l.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{km.label}</td>
                  <td className="px-4 py-2.5"><StatusBadge tone={sm.tone} label={sm.label} /></td>
                  <td className="px-4 py-2.5 text-muted">{pricingLabel(l.pricing.model, l.pricing.amount, l.pricing.currency)}</td>
                  <td className="px-4 py-2.5 text-muted">{formatNum(l.installs)}</td>
                  <td className="px-4 py-2.5">{l.ratingCount > 0 ? <Stars value={l.ratingAvg} count={l.ratingCount} /> : <span className="text-2xs text-faint">—</span>}</td>
                  <td className="px-4 py-2.5 text-right"><Icon name="chevron-right" size={15} className="text-faint" /></td>
                </tr>
              );
            })}
          </OpsTable>
        )}
      </OpsPanel>

      {detail && <ListingDetailModal detail={detail} onClose={() => setSelectedId(null)} reload={() => selectedId && reloadDetail(selectedId)} onInstall={install} />}
      {createOpen && <CreateListingModal onClose={() => setCreateOpen(false)} onCreate={createListing} onCreated={(id) => { setCreateOpen(false); setSelectedId(id); }} />}
    </div>
  );
}

function ListingDetailModal({ detail, onClose, reload, onInstall }: { detail: ListingDetail; onClose: () => void; reload: () => void; onInstall: (id: string) => Promise<void> }): JSX.Element {
  const { submit, review, publish, rollback, rate, createVersion } = useDeveloper();
  const { listing, versions } = detail;
  const km = kindMeta(listing.kind);
  const [addOpen, setAddOpen] = useState(false);

  const act = async (fn: Promise<unknown>): Promise<void> => { await fn; reload(); };

  return (
    <Modal
      open
      title={listing.name}
      subtitle={`${km.label} · ${listing.slug}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={() => void act(onInstall(listing.id))}>Install</Button>
          <Button variant="ghost" icon="star" onClick={() => void act(rate(listing.id, 5))}>Rate 5★</Button>
          {listing.currentVersionId && <Button variant="ghost" icon="undo" onClick={() => void act(rollback(listing.id))}>Rollback</Button>}
          <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>Add version</Button>
        </>
      }
    >
      <div className="mb-4 space-y-2 text-sm text-muted">
        <p>{listing.summary}</p>
        <div className="flex flex-wrap gap-3 text-xs text-faint">
          <span>{pricingLabel(listing.pricing.model, listing.pricing.amount, listing.pricing.currency)}</span>
          <span>· {formatNum(listing.installs)} installs</span>
          {listing.ratingCount > 0 && <span>· <Stars value={listing.ratingAvg} count={listing.ratingCount} /></span>}
          {listing.certified && <span className="text-sysblue">· Certified</span>}
        </div>
      </div>

      <div className="space-y-3">
        {versions.map((v) => (
          <VersionCard key={v.id} version={v} isCurrent={v.id === listing.currentVersionId} onSubmit={() => void act(submit(v.id))} onApprove={() => void act(review(v.id, 'approved'))} onReject={() => void act(review(v.id, 'rejected', 'Rejected by reviewer'))} onChanges={() => void act(review(v.id, 'changes_requested', 'Changes requested'))} onPublish={() => void act(publish(v.id))} />
        ))}
      </div>

      {addOpen && <AddVersionModal listing={listing} onClose={() => setAddOpen(false)} onCreate={createVersion} onDone={() => { setAddOpen(false); reload(); }} />}
    </Modal>
  );
}

function VersionCard({ version, isCurrent, onSubmit, onApprove, onReject, onChanges, onPublish }: { version: ListingVersion; isCurrent: boolean; onSubmit: () => void; onApprove: () => void; onReject: () => void; onChanges: () => void; onPublish: () => void }): JSX.Element {
  const sm = listingStatusMeta(version.status);
  return (
    <div className="rounded-xl border border-[var(--hairline)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">v{version.version}</span>
          <StatusBadge tone={sm.tone} label={sm.label} />
          {isCurrent && <StatusBadge tone="green" label="Live" pulse />}
        </div>
        <span className="text-2xs text-faint">{relativeTime(version.createdAt)}</span>
      </div>

      {version.changelog && <p className="mt-2 text-xs text-muted">{version.changelog}</p>}

      {/* scan */}
      {version.scan && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2 text-2xs font-medium uppercase tracking-wider text-faint">
            <Icon name="shield" size={12} /> Security scan
            <StatusBadge tone={scanStatusMeta(version.scan.status).tone} label={scanStatusMeta(version.scan.status).label} />
          </div>
          {version.scan.findings.length === 0 ? (
            <p className="text-2xs text-faint">No findings.</p>
          ) : (
            <ul className="space-y-0.5">
              {version.scan.findings.map((f) => (
                <li key={f.id} className="flex items-start gap-1.5 text-2xs">
                  <span className={cn('font-medium', TEXT_TONE[severityMeta(f.severity).tone])}>{severityMeta(f.severity).label}</span>
                  <span className="text-muted">{f.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* signature */}
      {version.signature && (
        <div className="mt-3 text-2xs text-faint">
          <span className="inline-flex items-center gap-1"><Icon name="lock" size={11} /> Signed</span> · {version.signature.algorithm} · key <InlineCode>{version.signature.keyId}</InlineCode>
          <div className="mt-0.5 break-all font-mono text-[10px] text-faint">sha256:{version.signature.digest.slice(0, 32)}…</div>
        </div>
      )}

      {/* review */}
      {version.review && (
        <div className="mt-2 text-2xs">
          <span className={cn('font-medium', TEXT_TONE[reviewDecisionMeta(version.review.decision).tone])}>{reviewDecisionMeta(version.review.decision).label}</span>
          <span className="text-faint"> by {version.review.reviewer}{version.review.notes ? ` — ${version.review.notes}` : ''}</span>
        </div>
      )}

      {/* actions by lifecycle */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(version.status === 'draft' || version.status === 'rejected' || version.status === 'rolled_back') && <Button size="sm" variant="primary" icon="upload" onClick={onSubmit}>Submit for review</Button>}
        {version.status === 'in_review' && (
          <>
            <Button size="sm" variant="primary" icon="check" onClick={onApprove}>Approve</Button>
            <Button size="sm" variant="ghost" icon="undo" onClick={onChanges}>Request changes</Button>
            <Button size="sm" variant="danger" icon="close" onClick={onReject}>Reject</Button>
          </>
        )}
        {version.status === 'approved' && <Button size="sm" variant="primary" icon="launch" onClick={onPublish}>Publish</Button>}
      </div>
    </div>
  );
}

const ENTRY_BY_KIND: Record<ListingKind, string> = {
  ai_app: 'app/main.js',
  ai_worker: 'worker/main.js',
  connector: 'connector/main.js',
  plugin: 'plugin/main.js',
  automation_template: 'automation/template.json',
  enterprise_template: 'enterprise/template.json',
};

function manifestTemplate(listing: MarketplaceListing): string {
  return JSON.stringify(
    {
      kind: listing.kind,
      name: listing.name,
      version: '1.0.0',
      entry: ENTRY_BY_KIND[listing.kind],
      permissions: [],
      capabilities: [],
      dependencies: [],
      network: [],
      metadata: { publisher: 'Your Organization' },
    },
    null,
    2,
  );
}

function AddVersionModal({ listing, onClose, onCreate, onDone }: { listing: MarketplaceListing; onClose: () => void; onCreate: (listingId: string, manifest: never, changelog: string) => Promise<unknown>; onDone: () => void }): JSX.Element {
  const [manifest, setManifest] = useState(() => manifestTemplate(listing));
  const [changelog, setChangelog] = useState('Initial release.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      setError('Manifest is not valid JSON.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(listing.id, parsed as never, changelog);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create version.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Add version"
      subtitle="Define the package manifest. It will be scanned and signed on submit."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>Create version</Button>
        </>
      }
    >
      <Field label="Manifest (JSON)"><Textarea rows={14} value={manifest} onChange={(e) => setManifest(e.target.value)} /></Field>
      <Field label="Changelog"><Input value={changelog} onChange={(e) => setChangelog(e.target.value)} /></Field>
      {error && <p className="text-xs text-syspink">{error}</p>}
    </Modal>
  );
}

function CreateListingModal({ onClose, onCreate, onCreated }: { onClose: () => void; onCreate: (input: { kind: ListingKind; slug: string; name: string; summary: string; category: string; pricing: { model: PricingModel; amount: number; currency: string }; certified?: boolean }) => Promise<MarketplaceListing>; onCreated: (id: string) => void }): JSX.Element {
  const [kind, setKind] = useState<ListingKind>('ai_worker');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState('General');
  const [model, setModel] = useState<PricingModel>('free');
  const [amount, setAmount] = useState('0');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const slugValue = (slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/(^-|-$)/g, '');
      const listing = await onCreate({
        kind,
        slug: slugValue,
        name: name.trim(),
        summary: summary.trim(),
        category: category.trim() || 'General',
        pricing: { model, amount: model === 'free' ? 0 : Number(amount) || 0, currency: 'USD' },
      });
      onCreated(listing.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="New marketplace listing"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>Create</Button>
        </>
      }
    >
      <Field label="Kind">
        <Select value={kind} onChange={(e) => setKind(e.target.value as ListingKind)}>
          {LISTING_KINDS.map((k) => <option key={k} value={k}>{kindMeta(k).label}</option>)}
        </Select>
      </Field>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Research Analyst" /></Field>
      <Field label="Slug" hint="Auto-generated from the name if left blank"><Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="research-analyst" /></Field>
      <Field label="Summary"><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A short description" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <Field label="Pricing">
          <Select value={model} onChange={(e) => setModel(e.target.value as PricingModel)}>
            <option value="free">Free</option>
            <option value="one_time">One-time</option>
            <option value="subscription">Subscription</option>
          </Select>
        </Field>
      </div>
      {model !== 'free' && <Field label="Amount (USD)"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
    </Modal>
  );
}
