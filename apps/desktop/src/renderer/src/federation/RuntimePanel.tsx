/**
 * Federation Runtime panel: the home org and its federated peers, organization
 * invitations (inbound + outbound), trust relationships, and shared resources.
 * Invite peers, respond to invitations, configure trust, and share / revoke
 * resources — every share is gated on the peer's trust capabilities.
 */
import { useMemo, useState } from 'react';
import { OpsPanel, Stat, StatusBadge, OpsTable, IconAction } from '@renderer/operations/primitives';
import { Modal, Field, Input, Textarea, Select } from '@renderer/developer/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { useFederation } from './FederationProvider';
import {
  federationStatusMeta,
  invitationStatusMeta,
  relativeTime,
  sharedKindLabel,
  trustLevelMeta,
} from './lib';
import type { ShareAccess, SharedResourceKind, TrustLevel } from '@neuropause/shared';

export function RuntimePanel(): JSX.Element {
  const { orgs, summary, invitations, trust, shared, inviteOrg, respondInvite, setTrust, shareResource, revokeShare } = useFederation();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const peers = orgs.filter((o) => o.role === 'peer');
  const activePeers = useMemo(() => peers.filter((p) => p.status === 'active'), [peers]);
  const pendingInvites = invitations.filter((i) => i.status === 'pending');
  /**
   * P13C ROUND 12 — M-11. Everyone in the directory who is not us.
   *
   * On a fresh install this is usually empty, and the Invite button is
   * disabled rather than offering a text box that fabricates an id. That is
   * the honest state of federation today — see `fedStore.inviteOrg`.
   */
  const invitableOrgs = useMemo(() => orgs.filter((o) => o.role !== 'home'), [orgs]);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="globe" label="Federated orgs" value={summary?.orgs ?? orgs.length} tone="blue" hint={`${summary?.activePeers ?? activePeers.length} active peers`} />
        <Stat icon="verified" label="Trusted peers" value={summary?.trustedPeers ?? 0} tone="purple" />
        <Stat icon="upload" label="Shared out" value={summary?.sharedOut ?? 0} tone="green" />
        <Stat icon="download" label="Shared in" value={summary?.sharedIn ?? 0} tone="accent" />
      </div>

      <OpsPanel
        title="Organizations"
        subtitle="The home organization and federated peers"
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setInviteOpen(true)}>Invite</Button>}
      >
        <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Organization</th><th className="px-4 py-2.5 font-medium">Role</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Trust</th><th className="px-4 py-2.5 font-medium">Region</th><th className="px-4 py-2.5 text-right font-medium">Shared</th></tr>}>
          {orgs.map((o) => {
            const tm = trustLevelMeta(o.trustLevel);
            const sm = federationStatusMeta(o.status);
            return (
              <tr key={o.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5"><div className="font-medium text-ink">{o.name}</div><div className="text-2xs text-faint">{o.slug}</div></td>
                <td className="px-4 py-2.5">{o.role === 'home' ? <StatusBadge tone="accent" label="Home" /> : <span className="text-xs text-muted">Peer</span>}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={sm.tone} label={sm.label} /></td>
                <td className="px-4 py-2.5"><StatusBadge tone={tm.tone} label={tm.label} /></td>
                <td className="px-4 py-2.5 text-xs text-muted">{o.regionId}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{o.role === 'home' ? '—' : `↑${o.sharedOut} ↓${o.sharedIn}`}</td>
              </tr>
            );
          })}
        </OpsTable>
      </OpsPanel>

      {pendingInvites.length > 0 && (
        <OpsPanel title="Invitations" subtitle="Pending organization invitations">
          <div className="space-y-2">
            {pendingInvites.map((inv) => {
              const im = invitationStatusMeta(inv.status);
              const inbound = inv.direction === 'inbound';
              return (
                <div key={inv.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{inbound ? inv.fromOrgName : inv.toOrgName}</span>
                      <StatusBadge tone={inbound ? 'blue' : 'gray'} label={inbound ? 'Inbound' : 'Outbound'} />
                      <StatusBadge tone={im.tone} label={im.label} />
                    </div>
                    {inv.message && <p className="mt-0.5 truncate text-xs text-faint">{inv.message}</p>}
                  </div>
                  {inbound ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button variant="primary" size="sm" onClick={() => void respondInvite(inv.id, true)}>Accept</Button>
                      <Button variant="ghost" size="sm" onClick={() => void respondInvite(inv.id, false)}>Decline</Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-2xs text-faint">{relativeTime(inv.createdAt)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </OpsPanel>
      )}

      <OpsPanel title="Trust relationships" subtitle="Delegated trust and sharing capabilities per peer">
        {trust.length === 0 ? (
          <EmptyState icon="shield" title="No trust relationships" description="Accept an invitation to establish trust with a peer." compact />
        ) : (
          <div className="space-y-2">
            {trust.map((t) => {
              const tm = trustLevelMeta(t.trustLevel);
              const levels: TrustLevel[] = ['basic', 'verified', 'full'];
              return (
                <div key={t.id} className="surface-raised flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{t.peerOrgName}</span>
                    <StatusBadge tone={tm.tone} label={tm.label} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-2xs text-faint">
                    <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={t.canShareWorkers} onChange={(e) => void setTrust({ peerOrg: t.peerOrg, canShareWorkers: e.target.checked })} />Share workers</label>
                    <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={t.canShareData} onChange={(e) => void setTrust({ peerOrg: t.peerOrg, canShareData: e.target.checked })} />Share data</label>
                    <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={t.delegatedApproval} onChange={(e) => void setTrust({ peerOrg: t.peerOrg, delegatedApproval: e.target.checked })} />Delegated approval</label>
                    <Select value={t.trustLevel} onChange={(e) => void setTrust({ peerOrg: t.peerOrg, trustLevel: e.target.value as TrustLevel })} className="!h-7 !py-0 text-2xs">
                      {levels.map((l) => <option key={l} value={l}>{trustLevelMeta(l).label}</option>)}
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </OpsPanel>

      <OpsPanel
        title="Shared resources"
        subtitle="Projects, workspaces, AI workers, policies, and connectors shared across the federation"
        actions={<Button variant="secondary" size="sm" icon="upload" onClick={() => setShareOpen(true)} disabled={activePeers.length === 0}>Share</Button>}
      >
        {shared.length === 0 ? (
          <EmptyState icon="layers" title="Nothing shared yet" description="Share a resource with a trusted peer." compact />
        ) : (
          <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Resource</th><th className="px-4 py-2.5 font-medium">Kind</th><th className="px-4 py-2.5 font-medium">Peer</th><th className="px-4 py-2.5 font-medium">Direction</th><th className="px-4 py-2.5 font-medium">Access</th><th className="px-4 py-2.5 text-right font-medium" /></tr>}>
            {shared.map((s) => (
              <tr key={s.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{sharedKindLabel(s.kind)}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{s.peerOrgName}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={s.direction === 'outbound' ? 'green' : 'blue'} label={s.direction === 'outbound' ? 'Outbound' : 'Inbound'} /></td>
                <td className="px-4 py-2.5 text-xs text-muted">{s.access === 'collaborate' ? 'Collaborate' : 'Read'}</td>
                <td className="px-4 py-2.5 text-right">{s.direction === 'outbound' && <IconAction icon="trash" label="Revoke" tone="red" onClick={() => void revokeShare(s.id)} />}</td>
              </tr>
            ))}
          </OpsTable>
        )}
      </OpsPanel>

      {inviteOpen && (
        <InviteModal
          /* P13C ROUND 12 — M-11. Invitees are CHOSEN from the resolvable
             directory, never typed. A name the user types is not an id, and
             the store now refuses one it cannot resolve. */
          candidates={invitableOrgs.map((o) => ({ id: o.id, name: o.name }))}
          onClose={() => setInviteOpen(false)}
          onInvite={inviteOrg}
        />
      )}
      {shareOpen && <ShareModal peers={activePeers.map((p) => ({ id: p.id, name: p.name }))} onClose={() => setShareOpen(false)} onShare={shareResource} />}
    </div>
  );
}

function InviteModal({ candidates, onClose, onInvite }: { candidates: { id: string; name: string }[]; onClose: () => void; onInvite: (input: { toOrg: string; trustLevel: TrustLevel; message?: string }) => Promise<void> }): JSX.Element {
  const [toOrg, setToOrg] = useState(candidates[0]?.id ?? '');
  const [trustLevel, setTrustLevel] = useState<TrustLevel>('basic');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!toOrg) return;
    setBusy(true);
    await onInvite({ toOrg, trustLevel, message: message.trim() || undefined });
    setBusy(false);
    onClose();
  };
  return (
    <Modal open title="Invite organization" subtitle="Send a federation invitation to a peer organization" onClose={onClose} footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !toOrg}>Send invitation</Button></>}>
      <div className="space-y-3">
        {candidates.length === 0 ? (
          /* Stated, not implied. Previously this was a free-text box whose value
             was slugified into an organization id, so it always "worked" and
             usually addressed nobody. An empty directory is the truth. */
          <p className="text-sm text-muted">
            No other organizations are resolvable from this install yet, so there is nobody to invite.
          </p>
        ) : (
          <Field label="Organization">
            <Select value={toOrg} onChange={(e) => setToOrg(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Initial trust level"><Select value={trustLevel} onChange={(e) => setTrustLevel(e.target.value as TrustLevel)}><option value="basic">Basic</option><option value="verified">Verified</option><option value="full">Full</option></Select></Field>
        <Field label="Message" hint="Optional"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Why you'd like to federate" /></Field>
      </div>
    </Modal>
  );
}

function ShareModal({ peers, onClose, onShare }: { peers: { id: string; name: string }[]; onClose: () => void; onShare: (input: { kind: SharedResourceKind; name: string; peerOrg: string; access: ShareAccess }) => Promise<string | null> }): JSX.Element {
  const [kind, setKind] = useState<SharedResourceKind>('project');
  const [name, setName] = useState('');
  const [peerOrg, setPeerOrg] = useState(peers[0]?.id ?? '');
  const [access, setAccess] = useState<ShareAccess>('read');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    if (!name.trim() || !peerOrg) return;
    setBusy(true);
    const err = await onShare({ kind, name: name.trim(), peerOrg, access });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  const kinds: SharedResourceKind[] = ['project', 'workspace', 'ai_worker', 'governance_policy', 'connector'];
  return (
    <Modal open title="Share a resource" subtitle="Sharing is gated on the peer's trust capabilities" onClose={onClose} footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !name.trim()}>Share</Button></>}>
      <div className="space-y-3">
        <Field label="Kind"><Select value={kind} onChange={(e) => setKind(e.target.value as SharedResourceKind)}>{kinds.map((k) => <option key={k} value={k}>{sharedKindLabel(k)}</option>)}</Select></Field>
        <Field label="Resource name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Forecast" autoFocus /></Field>
        <Field label="Peer organization"><Select value={peerOrg} onChange={(e) => setPeerOrg(e.target.value)}>{peers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Access"><Select value={access} onChange={(e) => setAccess(e.target.value as ShareAccess)}><option value="read">Read</option><option value="collaborate">Collaborate</option></Select></Field>
        {error && <p className="rounded-lg [background:var(--sysred-tint)] px-3 py-2 text-xs text-sysred">{error}</p>}
      </div>
    </Modal>
  );
}
