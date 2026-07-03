/**
 * API Keys & OAuth Applications. Mint scoped API keys (the full secret is shown
 * exactly once), revoke them, and register/remove OAuth applications. Secrets are
 * never re-displayed — the registry stores only a hash.
 */
import { useState } from 'react';
import { ALL_API_SCOPES, type ApiScope, type OAuthGrantType } from '@neuropause/shared';
import { OpsPanel, StatusBadge, IconAction, OpsTable } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { useDeveloper } from './DeveloperProvider';
import { Modal, Field, Input, CodeBlock, InlineCode } from './primitives';
import { relativeTime } from './lib';

const GRANT_TYPES: OAuthGrantType[] = ['authorization_code', 'client_credentials', 'refresh_token'];

export function ApiKeysPanel(): JSX.Element {
  const { keys, oauthApps, createKey, revokeKey, createOAuthApp, deleteOAuthApp } = useDeveloper();

  const [keyModal, setKeyModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<Set<ApiScope>>(new Set(['marketplace:read']));
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [appModal, setAppModal] = useState(false);
  const [appName, setAppName] = useState('');
  const [appRedirect, setAppRedirect] = useState('https://example.com/callback');
  const [appScopes, setAppScopes] = useState<Set<ApiScope>>(new Set(['marketplace:read']));
  const [appGrants, setAppGrants] = useState<Set<OAuthGrantType>>(new Set(['authorization_code']));
  const [newClientSecret, setNewClientSecret] = useState<string | null>(null);

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const submitKey = async (): Promise<void> => {
    if (!keyName.trim() || keyScopes.size === 0) return;
    setBusy(true);
    try {
      const res = await createKey(keyName.trim(), [...keyScopes]);
      setNewSecret(res.secret);
      setKeyModal(false);
      setKeyName('');
      setKeyScopes(new Set(['marketplace:read']));
    } finally {
      setBusy(false);
    }
  };

  const submitApp = async (): Promise<void> => {
    if (!appName.trim() || appGrants.size === 0) return;
    setBusy(true);
    try {
      const res = await createOAuthApp({
        name: appName.trim(),
        redirectUris: appRedirect.split(',').map((s) => s.trim()).filter(Boolean),
        scopes: [...appScopes],
        grantTypes: [...appGrants],
      });
      setNewClientSecret(res.clientSecret);
      setAppModal(false);
      setAppName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <OpsPanel
        title="API keys"
        subtitle="Bearer tokens for the API gateway, scoped to least privilege"
        actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setKeyModal(true)}>New key</Button>}
      >
        {keys.length === 0 ? (
          <EmptyState icon="lock" title="No API keys" description="Create a scoped key to call the gateway." compact action={<Button size="sm" icon="plus" onClick={() => setKeyModal(true)}>New key</Button>} />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Prefix</th>
                <th className="px-4 py-2.5">Scopes</th>
                <th className="px-4 py-2.5">Last used</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </>
            }
          >
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5 font-medium">{k.name}</td>
                <td className="px-4 py-2.5"><InlineCode>{k.prefix}…{k.last4}</InlineCode></td>
                <td className="px-4 py-2.5 text-muted" title={k.scopes.join(', ')}>{k.scopes.length} scope{k.scopes.length === 1 ? '' : 's'}</td>
                <td className="px-4 py-2.5 text-muted">{k.lastUsedAt ? relativeTime(k.lastUsedAt) : 'never'}</td>
                <td className="px-4 py-2.5">{k.revokedAt ? <StatusBadge tone="red" label="Revoked" /> : <StatusBadge tone="green" label="Active" />}</td>
                <td className="px-4 py-2.5 text-right">{!k.revokedAt && <IconAction icon="trash" label="Revoke" tone="red" onClick={() => void revokeKey(k.id)} />}</td>
              </tr>
            ))}
          </OpsTable>
        )}
      </OpsPanel>

      <OpsPanel
        title="OAuth applications"
        subtitle="Authorization-code and client-credentials apps for third-party integrations"
        actions={<Button size="sm" icon="plus" onClick={() => setAppModal(true)}>New app</Button>}
      >
        {oauthApps.length === 0 ? (
          <EmptyState icon="puzzle" title="No OAuth applications" description="Register an app to issue OAuth-based access." compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Client ID</th>
                <th className="px-4 py-2.5">Grants</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5" />
              </>
            }
          >
            {oauthApps.map((a) => (
              <tr key={a.id} className="border-t border-[var(--hairline)]">
                <td className="px-4 py-2.5 font-medium">{a.name}</td>
                <td className="px-4 py-2.5"><InlineCode>{a.clientId}</InlineCode></td>
                <td className="px-4 py-2.5 text-muted">{a.grantTypes.length}</td>
                <td className="px-4 py-2.5 text-muted">{relativeTime(a.createdAt)}</td>
                <td className="px-4 py-2.5 text-right"><IconAction icon="trash" label="Delete" tone="red" onClick={() => void deleteOAuthApp(a.id)} /></td>
              </tr>
            ))}
          </OpsTable>
        )}
      </OpsPanel>

      {/* Create key */}
      <Modal
        open={keyModal}
        title="Create API key"
        subtitle="The full secret is shown only once after creation."
        onClose={() => setKeyModal(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setKeyModal(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !keyName.trim() || keyScopes.size === 0} onClick={() => void submitKey()}>Create key</Button>
          </>
        }
      >
        <Field label="Key name"><Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="CI pipeline" /></Field>
        <ScopePicker selected={keyScopes} onToggle={(s) => setKeyScopes((prev) => toggle(prev, s))} />
      </Modal>

      {/* Create OAuth app */}
      <Modal
        open={appModal}
        title="Register OAuth application"
        onClose={() => setAppModal(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAppModal(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !appName.trim() || appGrants.size === 0} onClick={() => void submitApp()}>Register</Button>
          </>
        }
      >
        <Field label="Application name"><Input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Acme Integration" /></Field>
        <Field label="Redirect URIs" hint="Comma-separated"><Input value={appRedirect} onChange={(e) => setAppRedirect(e.target.value)} /></Field>
        <Field label="Grant types">
          <div className="flex flex-wrap gap-1.5">
            {GRANT_TYPES.map((g) => (
              <Chip key={g} active={appGrants.has(g)} onClick={() => setAppGrants((prev) => toggle(prev, g))}>{g.replace(/_/g, ' ')}</Chip>
            ))}
          </div>
        </Field>
        <ScopePicker selected={appScopes} onToggle={(s) => setAppScopes((prev) => toggle(prev, s))} />
      </Modal>

      {/* One-time secret reveals */}
      <Modal open={newSecret !== null} title="API key created" subtitle="Copy this now — it will not be shown again." onClose={() => setNewSecret(null)} footer={<Button variant="primary" onClick={() => setNewSecret(null)}>Done</Button>}>
        {newSecret && <CodeBlock value={newSecret} label="Secret token" />}
        <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Icon name="shield" size={14} className="mt-0.5 text-sysorange" />Store this in a secret manager. NeuroPause keeps only a hash and cannot recover it.</p>
      </Modal>

      <Modal open={newClientSecret !== null} title="OAuth app registered" subtitle="Copy the client secret now — it will not be shown again." onClose={() => setNewClientSecret(null)} footer={<Button variant="primary" onClick={() => setNewClientSecret(null)}>Done</Button>}>
        {newClientSecret && <CodeBlock value={newClientSecret} label="Client secret" />}
      </Modal>
    </div>
  );
}

function ScopePicker({ selected, onToggle }: { selected: Set<ApiScope>; onToggle: (s: ApiScope) => void }): JSX.Element {
  return (
    <Field label="Scopes" hint="Grant only what the integration needs.">
      <div className="grid grid-cols-2 gap-1.5">
        {ALL_API_SCOPES.map((s) => (
          <Chip key={s} active={selected.has(s)} onClick={() => onToggle(s)}>{s}</Chip>
        ))}
      </div>
    </Field>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-2xs font-medium outline-none transition focus-visible:shadow-focus ${active ? 'bg-accent text-accent-fg' : 'surface text-muted hover:text-ink'}`}
    >
      {active && <Icon name="check" size={11} />}
      {children}
    </button>
  );
}
