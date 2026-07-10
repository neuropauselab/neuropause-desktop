/**
 * Global connection indicator for the App Shell toolbar. Renders a live status dot (green / orange / red /
 * grey) reflecting the REAL connection assessment, with a dropdown that breaks it down — network, app-backend
 * latency, and live-sync state — and offers real actions: Reconnect (re-ping now), Pause / Resume sync, and
 * Sync now. All values come from `useConnection()`; nothing here is simulated.
 */
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Menu, MenuItem, MenuSeparator } from '@renderer/components/ui/Menu';
import { useConnection } from '@renderer/state/ConnectionProvider';
import type { ConnectionTone } from '@neuropause/shared';

const TONE_COLOR: Record<ConnectionTone, string> = { green: '#46a758', orange: '#f5a623', red: '#e5484d', gray: '#8b8b8b' };

function Row({ icon, label, value, color }: { icon: IconName; label: string; value: string; color?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5">
      <Icon name={icon} size={14} className="text-faint" />
      <span className="flex-1 text-sm text-muted">{label}</span>
      <span className="text-xs font-medium" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

export function ConnectionIndicator(): JSX.Element {
  const { assessment, sync, syncPaused, reconnect, pauseSync, resumeSync, syncNow } = useConnection();
  const color = TONE_COLOR[assessment.tone];
  const online = assessment.state !== 'offline';

  return (
    <Menu
      width={300}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Connection: ${assessment.label}`}
          title={`${assessment.label} — ${assessment.detail}`}
          className={`relative flex h-8 w-8 items-center justify-center rounded-lg outline-none transition focus-visible:shadow-focus ${open ? 'fill-active text-ink' : 'text-muted hover:text-ink fill-hover'}`}
        >
          <span className="relative flex h-2.5 w-2.5">
            {assessment.state === 'online' && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ background: color }} />
            )}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          </span>
        </button>
      )}
    >
      <div className="px-2.5 pb-1.5 pt-1">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="text-base font-semibold">{assessment.label}</span>
        </div>
        <p className="mt-0.5 text-xs leading-snug text-muted">{assessment.detail}</p>
      </div>
      <MenuSeparator />
      <Row icon="globe" label="Network" value={online ? 'Online' : 'Offline'} color={online ? undefined : TONE_COLOR.red} />
      <Row
        icon="server"
        label="App backend"
        value={assessment.state === 'connecting' ? 'Connecting…' : assessment.latencyMs !== null ? `${assessment.latencyMs}ms` : 'Unreachable'}
        color={assessment.state === 'degraded' || assessment.state === 'connecting' ? undefined : color}
      />
      {sync && (
        <Row
          icon="refresh"
          label="Sync"
          value={syncPaused ? 'Paused' : sync.pendingCount > 0 ? `${sync.pendingCount} pending` : sync.state === 'syncing' ? 'Syncing…' : sync.state === 'error' ? 'Error' : 'Up to date'}
          color={sync.state === 'error' ? TONE_COLOR.red : sync.pendingCount > 0 || syncPaused ? TONE_COLOR.orange : undefined}
        />
      )}
      <MenuSeparator />
      <MenuItem icon="refresh" onClick={() => reconnect()}>Reconnect</MenuItem>
      {sync && (syncPaused ? (
        <MenuItem icon="play" onClick={() => resumeSync()}>Resume sync</MenuItem>
      ) : (
        <MenuItem icon="pause" onClick={() => pauseSync()}>Pause sync</MenuItem>
      ))}
      {sync && !syncPaused && <MenuItem icon="refresh" onClick={() => syncNow()}>Sync now</MenuItem>}
    </Menu>
  );
}
