import type { ReactNode } from 'react';
import type { ConnectedAccount, ConnectorDto, ConnectorLogEntry } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { StatusBadge, IconAction } from '@renderer/operations/primitives';
import { EntraConnectorPanel } from './EntraConnectorPanel';
import { LiveConnectorInspector } from './LiveConnectorInspector';
import { DOT_BG, TEXT_TONE, type OpsTone } from '@renderer/operations/lib';
import {
  AUTH_LABEL,
  CAPABILITY_LABEL,
  CATEGORY_LABEL,
  connectorGlyph,
  healthMeta,
  relativeTime,
  statusMeta,
  syncMeta,
} from './connectorLib';

export interface ConnectorActions {
  onConnect: () => void;
  onDisconnect: (accountId: string) => void;
  onReconnect: (accountId: string) => void;
  onRefresh: (accountId: string) => void;
  onSync: (accountId?: string | null) => void;
  onCheckHealth: () => void;
}

export interface DetailNotice {
  tone: OpsTone;
  text: string;
}

const LOG_TONE: Record<ConnectorLogEntry['level'], OpsTone> = {
  info: 'gray',
  warn: 'orange',
  error: 'red',
};

/** A small labelled pill. */
function Pill({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="rounded-md [background:var(--fill-2)] px-2 py-0.5 text-2xs font-medium text-muted">{children}</span>
  );
}

function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">{children}</h3>;
}

function AccountRow({
  account,
  actions,
  pending,
}: {
  account: ConnectedAccount;
  actions: ConnectorActions;
  pending: boolean;
}): JSX.Element {
  const s = statusMeta(account.status);
  const h = healthMeta(account.health);
  const sync = syncMeta(account.lastSyncState);
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full [background:var(--fill-2)] text-muted">
        <Icon name="user" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{account.label}</span>
          <StatusBadge tone={s.tone} label={s.label} pulse={account.status === 'connecting'} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-faint">
          <span className={cn('font-medium', TEXT_TONE[h.tone])}>{h.label}</span>
          <span>·</span>
          <span>
            {sync.label}
            {account.lastSyncAt ? ` · ${relativeTime(account.lastSyncAt)}` : ''}
          </span>
          <span>·</span>
          <span>{account.grantedScopes.length} scopes</span>
        </div>
        {account.error && <div className="mt-0.5 truncate text-2xs text-syspink">{account.error}</div>}
      </div>
      <div className="flex items-center gap-0.5">
        <IconAction icon="refresh" label="Sync" tone="gray" disabled={pending} onClick={() => actions.onSync(account.id)} />
        <IconAction icon="bolt" label="Refresh token" tone="gray" disabled={pending} onClick={() => actions.onRefresh(account.id)} />
        <IconAction icon="external" label="Reconnect" tone="gray" disabled={pending} onClick={() => actions.onReconnect(account.id)} />
        <IconAction icon="logout" label="Disconnect" tone="red" disabled={pending} onClick={() => actions.onDisconnect(account.id)} />
      </div>
    </div>
  );
}

/** The right-hand detail pane for the selected connector. */
export function ConnectorDetail({
  dto,
  logs,
  actions,
  pending,
  connecting,
  notice,
}: {
  dto: ConnectorDto;
  logs: ConnectorLogEntry[];
  actions: ConnectorActions;
  pending: boolean;
  connecting: boolean;
  notice: DetailNotice | null;
}): JSX.Element {
  const meta = statusMeta(dto.status);
  const isApiKey = dto.authType === 'api_key';
  const canConnect =
    dto.configured && !isApiKey && (dto.multiAccount || dto.accounts.length === 0) && !connecting && !pending;

  // The setup/seam banner (shown once, in priority order).
  let banner: DetailNotice | null = null;
  if (isApiKey) {
    banner = { tone: 'blue', text: 'This connector authenticates with an API key. Key entry arrives with the Stage 2 sync adapters.' };
  } else if (!dto.configured && dto.setupHint) {
    banner = { tone: 'orange', text: dto.setupHint };
  }

  const connectLabel = connecting
    ? 'Opening browser…'
    : dto.accounts.length > 0
      ? 'Connect another'
      : 'Connect';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-3.5 border-b border-[var(--hairline)] px-6 py-5">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white ring-1 ring-black/10"
          style={{ backgroundColor: dto.brandColor }}
        >
          {connectorGlyph(dto.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-lg font-semibold tracking-tight">{dto.name}</h2>
            <StatusBadge tone={meta.tone} label={meta.label} pulse={dto.status === 'connecting'} />
          </div>
          <p className="mt-0.5 text-xs text-faint">{dto.provider}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill>{CATEGORY_LABEL[dto.category]}</Pill>
            <Pill>{AUTH_LABEL[dto.authType]}</Pill>
            <Pill>v{dto.version}</Pill>
            {dto.multiAccount && <Pill>Multi-account</Pill>}
          </div>
        </div>
        {dto.accounts.length > 0 && (
          <Button size="sm" variant="ghost" icon="activity" onClick={actions.onCheckHealth} disabled={pending}>
            Health
          </Button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {banner && (
          <div
            className={cn(
              'mb-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs',
              banner.tone === 'orange'
                ? 'border-sysorange/30 [background:rgb(var(--c-orange)/0.08)]'
                : 'border-sysblue/30 [background:rgb(var(--c-blue)/0.08)]',
            )}
          >
            <Icon name={banner.tone === 'orange' ? 'info' : 'sparkles'} size={15} className={cn('mt-0.5 shrink-0', TEXT_TONE[banner.tone])} />
            <span className="text-muted">{banner.text}</span>
          </div>
        )}

        {notice && (
          <div
            className={cn(
              'mb-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs',
              notice.tone === 'red'
                ? 'border-syspink/30 [background:rgb(var(--c-pink)/0.08)]'
                : notice.tone === 'green'
                  ? 'border-sysgreen/30 [background:rgb(var(--c-green)/0.08)]'
                  : 'border-[var(--hairline)] [background:var(--fill-1)]',
            )}
          >
            <Icon
              name={notice.tone === 'red' ? 'info' : notice.tone === 'green' ? 'check' : 'info'}
              size={15}
              className={cn('mt-0.5 shrink-0', TEXT_TONE[notice.tone])}
            />
            <span className="text-muted">{notice.text}</span>
          </div>
        )}

        {/* About */}
        <section className="mb-6">
          <SectionTitle>About</SectionTitle>
          <p className="text-sm text-muted">{dto.description}</p>
        </section>

        {/* Connect */}
        <section className="mb-6">
          <Button size="md" variant="primary" icon="plus" onClick={actions.onConnect} disabled={!canConnect}>
            {connectLabel}
          </Button>
          {!dto.configured && !isApiKey && (
            <p className="mt-2 text-2xs text-faint">
              Connecting becomes available once this provider&rsquo;s credentials are configured.
            </p>
          )}
        </section>

        {/* Accounts */}
        <section className="mb-6">
          <SectionTitle>Connected accounts</SectionTitle>
          {dto.accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--hairline)] px-4 py-6 text-center text-xs text-faint">
              No accounts connected yet.
            </div>
          ) : (
            <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
              {dto.accounts.map((a) => (
                <AccountRow key={a.id} account={a} actions={actions} pending={pending} />
              ))}
            </div>
          )}
        </section>

        {/* P4.1 — Live Connector Inspector: runtime state, per-account health, operator controls, lifecycle. */}
        {dto.accounts.length > 0 && <LiveConnectorInspector connectorId={dto.id} />}

        {/* Capabilities */}
        <section className="mb-6">
          <SectionTitle>Capabilities</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {dto.capabilities.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-md [background:var(--fill-1)] px-2 py-1 text-2xs font-medium text-muted">
                <Icon name="check" size={11} className="text-sysgreen" />
                {CAPABILITY_LABEL[c]}
              </span>
            ))}
          </div>
        </section>

        {/* Permissions */}
        <section className="mb-6">
          <SectionTitle>Permissions requested</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
            {dto.scopes.map((scope, idx) => (
              <div key={scope.id} className={cn('flex items-start gap-2.5 px-3.5 py-2.5', idx > 0 && 'border-t border-[var(--hairline)]')}>
                <Icon name="lock" size={13} className="mt-0.5 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="text-xs font-medium">{scope.label}</div>
                  <div className="text-2xs text-faint">{scope.description}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-2xs text-faint">All scopes are read-only — NeuroPause reads to build your timeline and memory, never writes.</p>
        </section>

        {/* Microsoft Entra — connector-specific live directory/permissions/tokens */}
        {dto.id === 'microsoft-entra' && <EntraConnectorPanel dto={dto} />}

        {/* Activity log */}
        <section>
          <SectionTitle>Recent activity</SectionTitle>
          {logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--hairline)] px-4 py-5 text-center text-2xs text-faint">
              No activity yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {logs.slice(0, 12).map((entry) => (
                <div key={entry.id} className="flex items-center gap-2.5 text-2xs">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_BG[LOG_TONE[entry.level]])} />
                  <span className="shrink-0 rounded [background:var(--fill-2)] px-1.5 py-0.5 font-medium text-faint">{entry.phase}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{entry.message}</span>
                  <span className="shrink-0 tabular-nums text-faint">{relativeTime(entry.at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
