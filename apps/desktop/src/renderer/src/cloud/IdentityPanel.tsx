/**
 * Identity Federation. SSO connections (SAML / OIDC) with issuer, domains, and
 * attribute mapping; SCIM provisioning; and the MFA policy. Connections can be
 * created, enabled/disabled, enforced, deleted, and **tested** — the test runs
 * the real federation engine against a representative assertion and shows the
 * mapped identity or the rejection reason.
 */
import { useState } from 'react';
import type { FederationResult, SsoConnection, SsoProtocol } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { TEXT_TONE } from '@renderer/operations/lib';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { Modal, Field, Input, Select } from '@renderer/developer/primitives';
import { cn } from '@renderer/lib/cn';
import { useCloud } from './CloudProvider';
import { ssoProtocolMeta, ssoStatusMeta, mfaMethodLabel, relativeTime } from './lib';

export function IdentityPanel(): JSX.Element {
  const { ssoConnections, identitySummary, scim, mfa, createSso, updateSso, deleteSso, testSso, setScim, scimSync, setMfa } = useCloud();
  const [creating, setCreating] = useState(false);
  const [testResult, setTestResult] = useState<{ name: string; result: FederationResult } | null>(null);

  return (
    <div className="space-y-6">
      <OpsPanel
        title="Single sign-on"
        subtitle="Federate enterprise identity providers over SAML and OpenID Connect"
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setCreating(true)}>Add connection</Button>}
      >
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="lock" label="Connections" value={identitySummary?.connections ?? ssoConnections.length} tone="accent" />
          <Stat icon="check" label="Active" value={identitySummary?.active ?? 0} tone="green" />
          <Stat icon="shield" label="Enforced" value={identitySummary?.enforced ? 'Yes' : 'No'} tone={identitySummary?.enforced ? 'green' : 'gray'} />
          <Stat icon="user" label="Provisioned" value={identitySummary?.provisionedUsers ?? 0} tone="blue" />
        </div>

        {ssoConnections.length === 0 ? (
          <EmptyState icon="lock" title="No SSO connections" description="Add a SAML or OIDC identity provider." compact />
        ) : (
          <div className="space-y-3">
            {ssoConnections.map((c) => (
              <ConnectionCard
                key={c.id}
                conn={c}
                onToggle={() => updateSso({ id: c.id, status: c.status === 'active' ? 'disabled' : 'active' })}
                onEnforce={() => updateSso({ id: c.id, enforced: !c.enforced })}
                onDelete={() => deleteSso(c.id)}
                onTest={async () => { const result = await testSso(c.id); setTestResult({ name: c.name, result }); }}
              />
            ))}
          </div>
        )}
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="SCIM provisioning" subtitle="Automated user lifecycle from your IdP">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon name="connectors" size={15} className={scim?.status === 'enabled' ? TEXT_TONE.green : TEXT_TONE.gray} />
                  <span className="font-medium">SCIM 2.0</span>
                  <StatusBadge tone={scim?.status === 'enabled' ? 'green' : 'gray'} label={scim?.status === 'enabled' ? 'Enabled' : 'Disabled'} />
                </div>
                <div className="mt-1 text-2xs text-faint">{scim?.provisioned ?? 0} users provisioned{scim?.lastSyncAt ? ` · last sync ${relativeTime(scim.lastSyncAt)}` : ''}</div>
              </div>
              <Button variant={scim?.status === 'enabled' ? 'secondary' : 'primary'} size="sm" onClick={() => setScim(scim?.status !== 'enabled')}>{scim?.status === 'enabled' ? 'Disable' : 'Enable'}</Button>
            </div>
            {scim?.status === 'enabled' && (
              <>
                <div className="rounded-xl border border-[var(--hairline)] px-3 py-2 text-2xs">
                  <span className="text-faint">Endpoint </span><code className="[background:var(--fill-2)] rounded px-1.5 py-0.5">{scim.endpoint}</code>
                  <span className="ml-2 text-faint">Token </span><code className="[background:var(--fill-2)] rounded px-1.5 py-0.5">••••{scim.tokenLast4}</code>
                </div>
                <Button variant="ghost" size="sm" icon="refresh" onClick={() => void scimSync()}>Sync now</Button>
              </>
            )}
          </div>
        </OpsPanel>

        <OpsPanel title="Multi-factor authentication" subtitle="Tenant-wide MFA policy">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl [background:var(--fill-1)] px-3 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon name="shield" size={15} className={mfa?.required ? TEXT_TONE.green : TEXT_TONE.gray} />
                  <span className="font-medium">Require MFA</span>
                  <StatusBadge tone={mfa?.required ? 'green' : 'gray'} label={mfa?.required ? 'Required' : 'Optional'} />
                </div>
                <div className="mt-1 text-2xs text-faint">{mfa?.required ? `${mfa.graceDays}-day grace period` : 'Users may opt in'}</div>
              </div>
              <Button variant={mfa?.required ? 'secondary' : 'primary'} size="sm" onClick={() => setMfa({ required: !mfa?.required })}>{mfa?.required ? 'Make optional' : 'Require'}</Button>
            </div>
            <div>
              <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Allowed methods</div>
              <div className="flex flex-wrap gap-1.5">
                {(['totp', 'webauthn', 'sms'] as const).map((m) => {
                  const on = mfa?.methods.includes(m) ?? false;
                  return (
                    <button
                      key={m}
                      onClick={() => { const cur = new Set(mfa?.methods ?? []); if (on) cur.delete(m); else cur.add(m); void setMfa({ methods: [...cur] }); }}
                      className={cn('rounded-lg px-2.5 py-1 text-2xs transition-colors', on ? 'bg-sysblue/15 text-sysblue' : '[background:var(--fill-2)] text-faint')}
                    >
                      {mfaMethodLabel(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </OpsPanel>
      </div>

      {creating && <CreateSsoModal onClose={() => setCreating(false)} onCreate={async (input) => { await createSso(input); setCreating(false); }} />}
      {testResult && <TestResultModal name={testResult.name} result={testResult.result} onClose={() => setTestResult(null)} />}
    </div>
  );
}

function ConnectionCard({ conn, onToggle, onEnforce, onDelete, onTest }: { conn: SsoConnection; onToggle: () => void; onEnforce: () => void; onDelete: () => void; onTest: () => void }): JSX.Element {
  const proto = ssoProtocolMeta(conn.protocol);
  const status = ssoStatusMeta(conn.status);
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [background:var(--fill-2)]', TEXT_TONE[proto.tone])}><Icon name="lock" size={17} /></span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold tracking-tight">{conn.name}</h3>
              <StatusBadge tone={proto.tone} label={proto.label} />
              <StatusBadge tone={status.tone} label={status.label} />
              {conn.enforced && conn.status === 'active' && <StatusBadge tone="orange" label="Enforced" />}
            </div>
            <div className="mt-0.5 truncate text-2xs text-faint">{conn.issuer}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {conn.domains.map((d) => <span key={d} className="rounded [background:var(--fill-2)] px-1.5 py-0.5 text-3xs text-faint">{d}</span>)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" icon="play" onClick={onTest}>Test</Button>
          <Button variant="ghost" size="sm" onClick={onToggle}>{conn.status === 'active' ? 'Disable' : 'Enable'}</Button>
          <Button variant="ghost" size="sm" icon="shield" onClick={onEnforce}>{conn.enforced ? 'Unenforce' : 'Enforce'}</Button>
          <button onClick={onDelete} className="rounded-lg p-1.5 text-faint hover:text-sysred" title="Delete"><Icon name="trash" size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function CreateSsoModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; protocol: SsoProtocol; issuer: string; entityId?: string; ssoUrl: string; clientId?: string; domains: string[] }) => void }): JSX.Element {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<SsoProtocol>('saml');
  const [issuer, setIssuer] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');
  const [domains, setDomains] = useState('');
  const valid = name.trim() && issuer.trim() && ssoUrl.trim();
  return (
    <Modal
      open
      title="Add SSO connection"
      subtitle="Federate a SAML or OIDC identity provider"
      onClose={onClose}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" icon="plus" disabled={!valid} onClick={() => onCreate({ name: name.trim(), protocol, issuer: issuer.trim(), ssoUrl: ssoUrl.trim(), domains: domains.split(',').map((d) => d.trim()).filter(Boolean) })}>Add</Button></>}
    >
      <div className="space-y-3">
        <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Okta" /></Field>
        <Field label="Protocol"><Select value={protocol} onChange={(e) => setProtocol(e.target.value as SsoProtocol)}><option value="saml">SAML 2.0</option><option value="oidc">OpenID Connect</option></Select></Field>
        <Field label="Issuer" hint="The IdP entity id / issuer URL"><Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="http://www.okta.com/exk..." /></Field>
        <Field label={protocol === 'saml' ? 'SSO URL' : 'Authorization endpoint'}><Input value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} placeholder="https://idp.example.com/sso" /></Field>
        <Field label="Email domains" hint="Comma-separated; users on these domains route here"><Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.io" /></Field>
      </div>
    </Modal>
  );
}

function TestResultModal({ name, result, onClose }: { name: string; result: FederationResult; onClose: () => void }): JSX.Element {
  return (
    <Modal open title={`Test — ${name}`} subtitle="The federation engine evaluated a representative assertion" onClose={onClose} footer={<Button variant="primary" size="sm" onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2.5', result.ok ? 'bg-sysgreen/10' : 'bg-sysred/10')}>
          <Icon name={result.ok ? 'check' : 'close'} size={16} className={result.ok ? TEXT_TONE.green : TEXT_TONE.red} />
          <span className="text-sm font-medium">{result.reason}</span>
        </div>
        {result.identity && (
          <div className="space-y-1.5 rounded-xl border border-[var(--hairline)] p-3 text-sm">
            <Row label="Subject" value={result.identity.subject} />
            <Row label="Email" value={result.identity.email} />
            <Row label="Display name" value={result.identity.displayName} />
            <Row label="Mapped role" value={result.identity.mappedRole} />
            <Row label="MFA satisfied" value={result.identity.mfaSatisfied ? 'Yes' : 'No'} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-2xs text-faint">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}
