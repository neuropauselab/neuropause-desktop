/**
 * S17 local-first — the ONE affordance a device-local session shows: an honest
 * "you are working locally" line + a way to connect a cloud account to sync.
 *
 * It states a truth derived from the auth state beneath (the renderer is in the
 * `local` branch), not a decoration: no account is connected, cloud features are
 * absent, and the button reveals the real sign-in path (never a fake one).
 */
interface LocalModeBannerProps {
  /** Reveal the sign-in surface so the user can connect a cloud account. */
  onConnect: () => void;
}

export function LocalModeBanner({ onConnect }: LocalModeBannerProps): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Working locally"
      className="flex items-center justify-center gap-3 border-b border-[var(--hairline)] surface-raised px-4 py-2 text-sm text-muted"
    >
      <span>
        Working locally — your data stays on this device.
      </span>
      <button
        type="button"
        onClick={onConnect}
        className="rounded px-2 py-1 text-sm font-medium underline underline-offset-2 hover:opacity-80"
      >
        Connect an account to sync
      </button>
    </div>
  );
}
