/**
 * Organization Exchange. Import packs shared in from the network (knowledge,
 * AI worker, automation, and connector bundles), publish your own packs to
 * share, and remove packs you've published. In this single-tenant app the
 * external organizations are seeded fixtures and "import" records local adoption.
 */
import { useState } from 'react';
import { PACK_KINDS, type ExchangePack, type PackItem, type PackKind } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge, IconAction } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useEcosystem } from './EcosystemProvider';
import { Modal, Field, Input, Select } from '@renderer/developer/primitives';
import { formatNum, packKindMeta, TEXT_TONE } from './lib';

export function OrgExchangePanel(): JSX.Element {
  const { packs, packsStats, importPack, removePack, publishPack } = useEcosystem();
  const [publishOpen, setPublishOpen] = useState(false);

  const mine = packs.filter((p) => p.isLocal);
  const network = packs.filter((p) => !p.isLocal);

  return (
    <div>
      <OpsPanel
        title="Organization Exchange"
        subtitle="Share and adopt curated packs across the organization network"
        actions={<Button size="sm" variant="primary" icon="upload" onClick={() => setPublishOpen(true)}>Publish a pack</Button>}
      >
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-2 text-xs text-faint">
          <Icon name="info" size={13} />
          <span>Representative network. Packs shared from other organizations are example listings to illustrate the exchange — your own published packs are real. Live cross-organization exchange arrives with network sync.</span>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="package" label="Packs" value={packsStats?.total ?? packs.length} tone="accent" />
          <Stat icon="upload" label="Published" value={packsStats?.published ?? mine.length} tone="purple" />
          <Stat icon="download" label="Imported" value={packsStats?.imported ?? 0} tone="green" />
          <Stat icon="globe" label="From network" value={network.length} tone="blue" />
        </div>

        <SectionLabel icon="upload" label="My packs" />
        {mine.length === 0 ? (
          <EmptyState icon="package" title="You haven't published any packs" description="Bundle knowledge, workers, automations, or connectors and share them." compact />
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mine.map((p) => <PackCard key={p.id} pack={p} onImport={() => void importPack(p.id)} onRemove={() => void removePack(p.id)} />)}
          </div>
        )}

        <SectionLabel icon="globe" label="Shared from the network" />
        {network.length === 0 ? (
          <EmptyState icon="globe" title="Nothing shared yet" compact />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {network.map((p) => <PackCard key={p.id} pack={p} onImport={() => void importPack(p.id)} onRemove={() => void removePack(p.id)} />)}
          </div>
        )}
      </OpsPanel>

      {publishOpen && <PublishPackModal onClose={() => setPublishOpen(false)} onPublish={publishPack} />}
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: Parameters<typeof Icon>[0]['name']; label: string }): JSX.Element {
  return (
    <div className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
      <Icon name={icon} size={12} />
      {label}
    </div>
  );
}

function PackCard({ pack, onImport, onRemove }: { pack: ExchangePack; onImport: () => void; onRemove: () => void }): JSX.Element {
  const meta = packKindMeta(pack.kind);
  return (
    <div className="surface-raised flex flex-col rounded-2xl p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [background:var(--fill-2)]', TEXT_TONE[meta.tone])}><Icon name={meta.icon} size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold tracking-tight">{pack.name}</h3>
          <div className="text-2xs text-faint">{meta.label} · {pack.publisherOrg}</div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{pack.summary}</p>
      <ul className="mt-2 space-y-0.5">
        {pack.items.slice(0, 3).map((it, i) => (
          <li key={i} className="flex items-center gap-1.5 text-2xs text-muted"><Icon name="dot" size={12} className="text-faint" />{it.name}<span className="text-faint">· {it.detail}</span></li>
        ))}
        {pack.items.length > 3 && <li className="text-2xs text-faint">+{pack.items.length - 3} more</li>}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--hairline)] pt-3">
        <span className="inline-flex items-center gap-1 text-2xs text-faint"><Icon name="download" size={12} />{formatNum(pack.installs)}</span>
        <div className="flex items-center gap-1">
          {pack.installed ? <StatusBadge tone="green" label="Imported" /> : <Button size="sm" variant="primary" icon="download" onClick={onImport}>Import</Button>}
          {pack.isLocal && <IconAction icon="trash" label="Remove" tone="red" onClick={onRemove} />}
        </div>
      </div>
    </div>
  );
}

interface DraftItem {
  name: string;
  detail: string;
}

function PublishPackModal({ onClose, onPublish }: { onClose: () => void; onPublish: (input: { name: string; summary: string; kind: PackKind; items: PackItem[] }) => Promise<unknown> }): JSX.Element {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<PackKind>('knowledge');
  const [items, setItems] = useState<DraftItem[]>([{ name: '', detail: '' }]);
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, patch: Partial<DraftItem>): void => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = (): void => setItems((prev) => [...prev, { name: '', detail: '' }]);
  const removeItem = (i: number): void => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const packItems: PackItem[] = items.filter((it) => it.name.trim()).map((it) => ({ kind, name: it.name.trim(), detail: it.detail.trim() || '—' }));
      await onPublish({ name: name.trim(), summary: summary.trim(), kind, items: packItems });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Publish a pack"
      subtitle="Bundle items to share across the organization network."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>Publish</Button>
        </>
      }
    >
      <Field label="Pack name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Onboarding Knowledge Pack" /></Field>
      <Field label="Summary"><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What this pack provides" /></Field>
      <Field label="Kind">
        <Select value={kind} onChange={(e) => setKind(e.target.value as PackKind)}>
          {PACK_KINDS.map((k) => <option key={k} value={k}>{packKindMeta(k).label}</option>)}
        </Select>
      </Field>
      <Field label="Items">
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Item name" />
              <Input value={it.detail} onChange={(e) => setItem(i, { detail: e.target.value })} placeholder="Detail" />
              <IconAction icon="trash" label="Remove item" tone="red" onClick={() => removeItem(i)} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon="plus" onClick={addItem}>Add item</Button>
        </div>
      </Field>
    </Modal>
  );
}
