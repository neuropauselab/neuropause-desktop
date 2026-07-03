import { useState, type ReactNode } from 'react';
import type { CloudMembership, CloudOrgRole } from '@neuropause/shared';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { Spinner } from '@renderer/components/Spinner';
import { ASSIGNABLE_ROLES, ROLE_LABEL, useCloudOrg } from './CloudOrgProvider';

const ALL_ROLES: CloudOrgRole[] = ['owner', ...ASSIGNABLE_ROLES];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'error' | 'ok';
  children: ReactNode;
  onDismiss?: () => void;
}): JSX.Element {
  const color = tone === 'error' ? 'border-syspink/30 text-syspink' : 'border-sysgreen/30 text-ink';
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${color}`}
    >
      <div className="min-w-0 text-sm">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-muted hover:text-ink"
          aria-label="Dismiss"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

function initialOf(text: string): string {
  return text.trim().charAt(0).toUpperCase() || '?';
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'no expiry';
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** Member + invitation management for the active organization. */
export function OrgMembers(): JSX.Element {
  const {
    activeOrg,
    members,
    membersLoading,
    membersError,
    busy,
    inviteMember,
    changeRole,
    removeMember,
  } = useCloudOrg();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CloudOrgRole>('member');
  const [actionError, setActionError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!activeOrg) return <></>;
  const canManage = activeOrg.role === 'owner' || activeOrg.role === 'admin';
  const active = members.filter((m) => m.status === 'active');
  const invited = members.filter((m) => m.status === 'invited');

  const doInvite = async (): Promise<void> => {
    setActionError(null);
    try {
      const token = await inviteMember(email, role);
      setIssued({ email: email.trim(), token });
      setCopied(false);
      setEmail('');
    } catch (e) {
      setActionError((e as Error).message || 'Could not send the invitation.');
    }
  };
  const onChangeRole = async (m: CloudMembership, next: CloudOrgRole): Promise<void> => {
    if (next === m.role) return;
    setActionError(null);
    try {
      await changeRole(m.id, next);
    } catch (e) {
      setActionError((e as Error).message || 'Could not change the role.');
    }
  };
  const onRemove = async (m: CloudMembership): Promise<void> => {
    setActionError(null);
    try {
      await removeMember(m.id);
    } catch (e) {
      setActionError((e as Error).message || 'Could not remove the member.');
    }
  };
  const copyToken = (): void => {
    if (!issued) return;
    void navigator.clipboard.writeText(issued.token);
    setCopied(true);
  };

  if (membersLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner size={18} />
        <span className="text-sm">Loading members…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {membersError && <Banner tone="error">{membersError}</Banner>}
      {actionError && (
        <Banner tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}

      {canManage && (
        <Card>
          <CardHeader icon={<Icon name="plus" size={16} />} title="Invite a member" tint="green" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && EMAIL_RE.test(email.trim())) void doInvite();
              }}
              placeholder="teammate@company.com"
              className="h-9 min-w-[220px] flex-1 rounded-xl px-3 text-base surface-raised shadow-card outline-none placeholder:text-faint focus-visible:shadow-focus"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as CloudOrgRole)}
              className="h-9 rounded-xl px-2.5 pr-8 text-base surface-raised shadow-card text-ink outline-none focus-visible:shadow-focus"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              icon="plus"
              disabled={!EMAIL_RE.test(email.trim()) || busy}
              onClick={() => void doInvite()}
            >
              Invite
            </Button>
          </div>

          {issued && (
            <div className="mt-3 rounded-xl surface-raised p-3">
              <p className="text-sm text-muted">
                Invitation created for <span className="text-ink">{issued.email}</span>. Share this
                one-time token so they can join:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-white/5 px-2.5 py-1.5 text-sm text-ink">
                  {issued.token}
                </code>
                <Button size="sm" icon={copied ? 'check' : 'download'} onClick={copyToken}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <button
                  onClick={() => setIssued(null)}
                  className="shrink-0 text-muted hover:text-ink"
                  aria-label="Dismiss"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<Icon name="user" size={16} />}
          title={`Members (${active.length})`}
          tint="blue"
        />
        <ul className="mt-2 divide-y divide-white/5">
          {active.map((m) => {
            const isSelf = m.id === activeOrg.membershipId;
            const name = m.userDisplayName || m.userEmail || 'Member';
            const showEmail = Boolean(m.userDisplayName && m.userEmail);
            return (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-medium text-accent">
                  {initialOf(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base text-ink">
                    {name}
                    {isSelf && <span className="ml-1.5 text-2xs text-faint">(You)</span>}
                  </div>
                  {showEmail && <div className="truncate text-sm text-muted">{m.userEmail}</div>}
                </div>
                {canManage && !isSelf ? (
                  <>
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void onChangeRole(m, e.target.value as CloudOrgRole)}
                      className="h-8 rounded-lg px-2 pr-7 text-sm surface-raised text-ink outline-none focus-visible:shadow-focus disabled:opacity-50"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      disabled={busy}
                      onClick={() => void onRemove(m)}
                    />
                  </>
                ) : (
                  <span className="rounded-md bg-white/5 px-2 py-0.5 text-2xs uppercase tracking-wide text-faint">
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader
          icon={<Icon name="clock" size={16} />}
          title={`Pending invitations (${invited.length})`}
          tint="orange"
        />
        <div className="mt-2">
          {invited.length === 0 ? (
            <p className="py-2 text-sm text-muted">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {invited.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sysorange/15 text-sysorange">
                    <Icon name="clock" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base text-ink">{m.invitedEmail}</div>
                    <div className="truncate text-sm text-muted">
                      Expires {formatExpiry(m.inviteExpiresAt)}
                    </div>
                  </div>
                  <span className="rounded-md bg-white/5 px-2 py-0.5 text-2xs uppercase tracking-wide text-faint">
                    {ROLE_LABEL[m.role]}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onRemove(m)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {!canManage && (
        <p className="text-sm text-muted">
          You have view-only access to members. Owners and admins can invite and manage people.
        </p>
      )}
    </div>
  );
}
