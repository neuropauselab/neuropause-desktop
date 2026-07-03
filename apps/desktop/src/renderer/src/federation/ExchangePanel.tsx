/**
 * Organization Exchange panel: publishable, signed, versioned artifacts across
 * six kinds. Publish a new artifact, add versions, rate, verify the Ed25519
 * signature, set verification status, and roll back to a previous version.
 */
import { useState } from 'react';
import { OpsPanel, Stat, StatusBadge, OpsTable, IconAction } from '@renderer/operations/primitives';
import { Modal, Field, Input, Textarea, Select } from '@renderer/developer/primitives';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { useFederation } from './FederationProvider';
import { exchangeKindLabel, relativeTime, scopeMeta, verificationMeta } from './lib';
import type { ExchangeArtifact, ExchangeKind, ExchangeScope, VerificationStatus } from '@neuropause/shared';

export function ExchangePanel(): JSX.Element {
  const { artifacts, exchangeSummary, publishArtifact, publishVersion, rate, setVerification, rollback, install, verifyVersion } = useFederation();
  const [publishOpen, setPublishOpen] = useState(false);
  const [selected, setSelected] = useState<ExchangeArtifact | null>(null);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="package" label="Artifacts" value={exchangeSummary?.artifacts ?? artifacts.length} tone="blue" />
        <Stat icon="upload" label="Published" value={exchangeSummary?.published ?? 0} tone="green" />
        <Stat icon="verified" label="Verified" value={exchangeSummary?.verified ?? 0} tone="purple" />
        <Stat icon="download" label="Installs" value={exchangeSummary?.installs ?? 0} tone="accent" />
      </div>

      <OpsPanel
        title="Exchange artifacts"
        subtitle="Signed, versioned artifacts published to the federation"
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setPublishOpen(true)}>Publish</Button>}
      >
        <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Artifact</th><th className="px-4 py-2.5 font-medium">Kind</th><th className="px-4 py-2.5 font-medium">Scope</th><th className="px-4 py-2.5 font-medium">Verification</th><th className="px-4 py-2.5 font-medium">Version</th><th className="px-4 py-2.5 text-right font-medium">Rating</th><th className="px-4 py-2.5 text-right font-medium">Installs</th><th className="px-4 py-2.5" /></tr>}>
          {artifacts.map((a) => {
            const sc = scopeMeta(a.scope);
            const vm = verificationMeta(a.verification);
            const current = a.versions.find((v) => v.id === a.currentVersionId);
            return (
              <tr key={a.id} className="cursor-pointer border-t border-[var(--hairline)] hover:[background:var(--fill-1)]" onClick={() => setSelected(a)}>
                <td className="px-4 py-2.5"><div className="font-medium text-ink">{a.name}</div><div className="text-2xs text-faint">{a.publisherOrgName}</div></td>
                <td className="px-4 py-2.5 text-xs text-muted">{exchangeKindLabel(a.kind)}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={sc.tone} label={sc.label} /></td>
                <td className="px-4 py-2.5"><StatusBadge tone={vm.tone} label={vm.label} /></td>
                <td className="px-4 py-2.5 font-mono text-2xs text-muted">v{current?.version ?? '—'}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{a.ratingCount > 0 ? `★ ${a.rating}` : '—'}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{a.installs}</td>
                <td className="px-4 py-2.5 text-right"><Icon name="chevron-right" size={14} className="text-faint" /></td>
              </tr>
            );
          })}
        </OpsTable>
      </OpsPanel>

      {publishOpen && <PublishModal onClose={() => setPublishOpen(false)} onPublish={publishArtifact} />}
      {selected && (
        <ArtifactModal
          artifact={artifacts.find((a) => a.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onPublishVersion={publishVersion}
          onRate={rate}
          onSetVerification={setVerification}
          onRollback={rollback}
          onInstall={install}
          onVerify={verifyVersion}
        />
      )}
    </div>
  );
}

function PublishModal({ onClose, onPublish }: { onClose: () => void; onPublish: (input: { kind: ExchangeKind; name: string; summary: string; scope: ExchangeScope }) => Promise<void> }): JSX.Element {
  const [kind, setKind] = useState<ExchangeKind>('ai_worker');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [scope, setScope] = useState<ExchangeScope>('private');
  const [busy, setBusy] = useState(false);
  const kinds: ExchangeKind[] = ['ai_worker', 'connector_pack', 'governance_policy', 'workflow_template', 'knowledge_package', 'dashboard_template'];
  const scopes: ExchangeScope[] = ['private', 'public', 'partner', 'regional'];
  const submit = async (): Promise<void> => {
    if (!name.trim() || !summary.trim()) return;
    setBusy(true);
    await onPublish({ kind, name: name.trim(), summary: summary.trim(), scope });
    setBusy(false);
    onClose();
  };
  return (
    <Modal open title="Publish artifact" subtitle="Publishes a signed v1.0.0 to the exchange" onClose={onClose} footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !name.trim() || !summary.trim()}>Publish</Button></>}>
      <div className="space-y-3">
        <Field label="Kind"><Select value={kind} onChange={(e) => setKind(e.target.value as ExchangeKind)}>{kinds.map((k) => <option key={k} value={k}>{exchangeKindLabel(k)}</option>)}</Select></Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Revenue Analyst" autoFocus /></Field>
        <Field label="Summary"><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="What this artifact does" /></Field>
        <Field label="Scope"><Select value={scope} onChange={(e) => setScope(e.target.value as ExchangeScope)}>{scopes.map((s) => <option key={s} value={s}>{scopeMeta(s).label}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

function ArtifactModal({ artifact, onClose, onPublishVersion, onRate, onSetVerification, onRollback, onInstall, onVerify }: {
  artifact: ExchangeArtifact;
  onClose: () => void;
  onPublishVersion: (input: { artifactId: string; version: string; changelog: string }) => Promise<void>;
  onRate: (artifactId: string, stars: number) => Promise<void>;
  onSetVerification: (artifactId: string, verification: VerificationStatus) => Promise<void>;
  onRollback: (artifactId: string) => Promise<void>;
  onInstall: (artifactId: string) => Promise<void>;
  onVerify: (artifactId: string, versionId: string) => Promise<boolean>;
}): JSX.Element {
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [verifyResult, setVerifyResult] = useState<Record<string, boolean>>({});
  const current = artifact.versions.find((v) => v.id === artifact.currentVersionId);
  const publishable = artifact.versions.length > 1;

  const doVerify = async (versionId: string): Promise<void> => {
    const ok = await onVerify(artifact.id, versionId);
    setVerifyResult((prev) => ({ ...prev, [versionId]: ok }));
  };

  return (
    <Modal open title={artifact.name} subtitle={`${exchangeKindLabel(artifact.kind)} · ${artifact.publisherOrgName}`} onClose={onClose} footer={<Button variant="ghost" size="sm" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{artifact.summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge {...scopeMeta(artifact.scope)} />
          <StatusBadge {...verificationMeta(artifact.verification)} />
          <span className="text-xs text-faint">{artifact.ratingCount > 0 ? `★ ${artifact.rating} (${artifact.ratingCount})` : 'Unrated'}</span>
          <span className="text-xs text-faint">· {artifact.installs} installs</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" icon="download" onClick={() => void onInstall(artifact.id)}>Install</Button>
          <Button variant="ghost" size="sm" onClick={() => void onRate(artifact.id, 5)}>Rate ★5</Button>
          {artifact.verification === 'unverified' && <Button variant="ghost" size="sm" icon="verified" onClick={() => void onSetVerification(artifact.id, 'verified')}>Verify</Button>}
          {publishable && <Button variant="ghost" size="sm" icon="undo" onClick={() => void onRollback(artifact.id)}>Rollback</Button>}
        </div>

        <div>
          <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-faint">Versions</div>
          <div className="space-y-1.5">
            {[...artifact.versions].reverse().map((v) => {
              const isCurrent = v.id === artifact.currentVersionId;
              const verified = verifyResult[v.id];
              return (
                <div key={v.id} className="surface-raised flex items-center justify-between gap-2 rounded-xl p-2.5 shadow-card">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-ink">v{v.version}</span>
                      {isCurrent && <StatusBadge tone="green" label="Current" />}
                      {v.status === 'rolled_back' && <StatusBadge tone="gray" label="Rolled back" />}
                    </div>
                    <div className="truncate text-2xs text-faint">{v.changelog} · {relativeTime(v.publishedAt)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {verified !== undefined && <StatusBadge tone={verified ? 'green' : 'red'} label={verified ? 'Signature OK' : 'Invalid'} />}
                    <IconAction icon="shield" label="Verify signature" onClick={() => void doVerify(v.id)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[var(--hairline)] pt-3">
          <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-faint">Publish new version</div>
          <div className="flex items-end gap-2">
            <Field label="Version"><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={bumpHint(current?.version)} className="w-28" /></Field>
            <Field label="Changelog"><Input value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed" /></Field>
            <Button variant="primary" size="sm" disabled={!version.trim()} onClick={() => { void onPublishVersion({ artifactId: artifact.id, version: version.trim(), changelog: changelog.trim() || 'Update.' }); setVersion(''); setChangelog(''); }}>Add</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function bumpHint(version?: string): string {
  if (!version) return '1.0.0';
  const parts = version.split('.').map((n) => Number(n));
  if (parts.length === 3) return `${parts[0]}.${parts[1] + 1}.0`;
  return '1.1.0';
}
