/**
 * Global Governance panel: federation-wide policies, delegated approvals, the
 * shared audit trail, and the compliance report. Add cross-org policies, resolve
 * delegated approvals, and run a test federated action through the engine — every
 * federated action lands in the shared audit trail.
 */
import { useState } from 'react';
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { Modal, Field, Input, Textarea, Select } from '@renderer/developer/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { useFederation } from './FederationProvider';
import { complianceMeta, policyEffectMeta, relativeTime, scoreTone } from './lib';
import type { FedPolicyEffect, FedPolicyScope } from '@neuropause/shared';

export function GovernancePanel(): JSX.Element {
  const { policies, govSummary, approvals, audit, compliance, addPolicy, setPolicyEnabled, resolveApproval, migrationRequired, quarantinedPolicies, claimPolicy, discardPolicy } = useFederation();
  const [addOpen, setAddOpen] = useState(false);
  const [migMsg, setMigMsg] = useState<string | null>(null);
  const [migBusy, setMigBusy] = useState<string | null>(null);
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  // S144 — resolve one quarantined legacy policy; the store returns the outcome so the message is truthful.
  const onClaim = async (id: string, name: string): Promise<void> => {
    setMigBusy(id); setMigMsg(null);
    try {
      const ok = await claimPolicy(id);
      setMigMsg(ok ? `Claimed "${name}" — it now governs only your organization.` : `Could not claim "${name}" (already resolved or no active organization).`);
    } finally { setMigBusy(null); }
  };
  const onDiscard = async (id: string, name: string): Promise<void> => {
    setMigBusy(id); setMigMsg(null);
    try {
      const ok = await discardPolicy(id);
      setMigMsg(ok ? `Discarded "${name}".` : `Could not discard "${name}" (already resolved or no active organization).`);
    } finally { setMigBusy(null); }
  };

  return (
    <div>
      {/* S144 — the P13C legacy-policy migration/quarantine surface (was governed + tested but renderer-dark).
          Governance evaluation fails closed while any legacy policy is unattributed; this is where a
          federation:manage admin resolves them. Shown only when there is something to resolve. */}
      {(migrationRequired > 0 || quarantinedPolicies.length > 0) && (
        <OpsPanel
          title="Legacy policy migration"
          subtitle={`${migrationRequired} unattributed legacy ${migrationRequired === 1 ? 'policy is' : 'policies are'} quarantined — governance fails closed until each is claimed or discarded`}
        >
          {migMsg && <div className="mb-3 rounded-md border border-[var(--hairline)] px-3 py-2 text-2xs text-muted">{migMsg}</div>}
          {quarantinedPolicies.length === 0 ? (
            <EmptyState icon="shield" title={`${migrationRequired} quarantined`} description="Their contents are visible only to a federation administrator; open this on an admin session to claim or discard them." compact />
          ) : (
            <div className="space-y-2">
              {quarantinedPolicies.map((p) => (
                <div key={p.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="font-medium text-ink">{p.name}</span><StatusBadge tone="orange" label="Quarantined" /></div>
                    <div className="truncate text-2xs text-faint">{p.description} · <span className="font-mono">{p.action}</span></div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" size="sm" disabled={migBusy !== null} onClick={() => void onClaim(p.id, p.name)}>Claim</Button>
                    <Button variant="ghost" size="sm" disabled={migBusy !== null} onClick={() => void onDiscard(p.id, p.name)}>Discard</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="shield" label="Active policies" value={govSummary?.activePolicies ?? 0} tone="blue" hint={`${govSummary?.policies ?? policies.length} total`} />
        <Stat icon="checklist" label="Pending approvals" value={govSummary?.pendingApprovals ?? pendingApprovals.length} tone={pendingApprovals.length > 0 ? 'orange' : 'green'} />
        <Stat icon="clipboard" label="Audit entries" value={govSummary?.auditEntries ?? audit.length} tone="accent" />
        <Stat icon="verified" label="Compliance" value={`${govSummary?.complianceScore ?? 0}%`} tone={scoreTone(govSummary?.complianceScore ?? 0)} />
      </div>

      <OpsPanel
        title="Cross-organization policies"
        subtitle="Federation-wide rules evaluated on every cross-org action (most-restrictive wins)"
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setAddOpen(true)}>Add policy</Button>}
      >
        <OpsTable head={<tr className="text-left text-2xs uppercase tracking-wider text-faint"><th className="px-4 py-2.5 font-medium">Policy</th><th className="px-4 py-2.5 font-medium">Action</th><th className="px-4 py-2.5 font-medium">Scope</th><th className="px-4 py-2.5 font-medium">Effect</th><th className="px-4 py-2.5 text-right font-medium">Enabled</th></tr>}>
          {policies.map((p) => {
            const em = policyEffectMeta(p.effect);
            return (
              <tr key={p.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5"><div className="font-medium text-ink">{p.name}</div><div className="text-2xs text-faint">{p.description}</div></td>
                <td className="px-4 py-2.5 font-mono text-2xs text-muted">{p.action}</td>
                <td className="px-4 py-2.5 text-xs capitalize text-muted">{p.scope}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={em.tone} label={em.label} /></td>
                <td className="px-4 py-2.5 text-right"><input type="checkbox" checked={p.enabled} onChange={(e) => void setPolicyEnabled(p.id, e.target.checked)} /></td>
              </tr>
            );
          })}
        </OpsTable>
      </OpsPanel>

      <OpsPanel title="Delegated approvals" subtitle="Cross-org actions awaiting review">
        {pendingApprovals.length === 0 ? (
          <EmptyState icon="check" title="No approvals outstanding" description="Federated actions requiring approval will appear here." compact />
        ) : (
          <div className="space-y-2">
            {pendingApprovals.map((a) => (
              <div key={a.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs font-medium text-ink">{a.action}</span><StatusBadge tone="orange" label="Pending" /></div>
                  <div className="truncate text-2xs text-faint">{a.fromOrgName} → {a.toOrgName} · {relativeTime(a.requestedAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="primary" size="sm" onClick={() => void resolveApproval(a.id, true)}>Approve</Button>
                  <Button variant="ghost" size="sm" onClick={() => void resolveApproval(a.id, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <div className="grid gap-6 lg:grid-cols-2">
        <OpsPanel title="Compliance" subtitle="Federation compliance checks">
          <div className="space-y-2">
            {compliance.map((r) => {
              const cm = complianceMeta(r.status);
              return (
                <div key={r.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium text-ink">{r.rule}</span><span className="text-2xs text-faint">{r.framework}</span></div><p className="truncate text-2xs text-faint">{r.detail}</p></div>
                  <StatusBadge tone={cm.tone} label={cm.label} />
                </div>
              );
            })}
          </div>
        </OpsPanel>

        <OpsPanel title="Shared audit trail" subtitle="Every federated action, traceable">
          <div className="space-y-1.5">
            {audit.slice(0, 12).map((e) => {
              const em = policyEffectMeta(e.decision);
              return (
                <div key={e.id} className="surface-raised rounded-xl p-2.5 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-2xs font-medium text-ink">{e.action}</span>
                    <StatusBadge tone={em.tone} label={em.label} />
                  </div>
                  <div className="mt-0.5 truncate text-2xs text-faint">{e.detail} · {relativeTime(e.at)}</div>
                </div>
              );
            })}
          </div>
        </OpsPanel>
      </div>

      {addOpen && <AddPolicyModal onClose={() => setAddOpen(false)} onAdd={addPolicy} />}
    </div>
  );
}

function AddPolicyModal({ onClose, onAdd }: { onClose: () => void; onAdd: (input: { name: string; description: string; scope: FedPolicyScope; effect: FedPolicyEffect; action: string }) => Promise<void> }): JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  const [scope, setScope] = useState<FedPolicyScope>('all');
  const [effect, setEffect] = useState<FedPolicyEffect>('require_approval');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (!name.trim() || !action.trim()) return;
    setBusy(true);
    await onAdd({ name: name.trim(), description: description.trim(), scope, effect, action: action.trim() });
    setBusy(false);
    onClose();
  };
  return (
    <Modal open title="Add cross-org policy" subtitle="Applies to matching federated actions across the federation" onClose={onClose} footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !name.trim() || !action.trim()}>Add policy</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Block external data export" autoFocus /></Field>
        <Field label="Action" hint="The federated action this policy matches"><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="export_data" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope"><Select value={scope} onChange={(e) => setScope(e.target.value as FedPolicyScope)}><option value="all">All peers</option><option value="trusted">Trusted only</option><option value="partner">Partner only</option></Select></Field>
          <Field label="Effect"><Select value={effect} onChange={(e) => setEffect(e.target.value as FedPolicyEffect)}><option value="allow">Allow</option><option value="require_approval">Require approval</option><option value="deny">Deny</option></Select></Field>
        </div>
      </div>
    </Modal>
  );
}
