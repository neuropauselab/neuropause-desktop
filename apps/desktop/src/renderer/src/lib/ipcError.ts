/**
 * Channel attribution for a rejected IPC call.
 *
 * A7. When `invoke` rejects, the renderer is handed a message and nothing else.
 * That is by design on the main side — `secureBridge.ts` deliberately replaces
 * internal failures with a clean `IpcError` ("Surface a clean message to the
 * renderer (never internal stack detail)") — and Electron's IPC only serializes
 * an error's `message`, so no custom property survives the trip. The result is
 * that a denial reads `Not authorized` with no indication of what was denied,
 * and a bridge timeout reads `Request timed out` with no indication of what
 * timed out. Roughly eighty call sites render exactly that string into the UI.
 *
 * The renderer is the one place that still knows: it named the channel when it
 * made the call. This module records that fact onto the rejection on its way
 * out of `invoke`, so the knowledge is no longer discarded one stack frame
 * after it was available.
 *
 * Deliberately additive. `message`, `stack` and object identity are untouched,
 * so every existing consumer — the `err.message` display sites, the error
 * boundaries' crash reports, `retrievalStatus.ipcErrorDetail` — behaves exactly
 * as it did. The channel is extra information for whoever wants it, never a
 * change to what anyone already reads.
 *
 * Pure and DOM-free: no `window`, no Electron, so it is covered by the Node test
 * gate alongside the other renderer leaves under `lib/`.
 */

/** The property `attributeIpcChannel` writes. Namespaced so it cannot collide with a real error field. */
const CHANNEL_PROP = 'ipcChannel';

/** A rejection that carries the channel whose `invoke` produced it. */
export interface IpcChannelError extends Error {
  readonly ipcChannel: string;
}

/**
 * Record `channel` on a rejection value and return it unchanged.
 *
 * Every branch here is a refusal to make a failure worse. A non-object rejection
 * (a thrown string, `undefined` from a badly-behaved handler) has nowhere to put
 * the property and is passed through. A frozen or sealed error is left alone.
 * An already-attributed error keeps its first attribution, which is the innermost
 * and therefore the most specific one. And the write itself is guarded, because
 * `defineProperty` throws on a non-configurable clash — attribution failing must
 * never turn a handled rejection into a different, unhandled one.
 *
 * The property is enumerable so `console.error(err)` and devtools show it without
 * anyone knowing to look, and non-writable so a later frame cannot rewrite the
 * origin of a failure it did not cause.
 */
export function attributeIpcChannel<E>(err: E, channel: string): E {
  if (typeof err !== 'object' || err === null) return err;
  if (!Object.isExtensible(err)) return err;
  if (CHANNEL_PROP in err) return err;
  try {
    Object.defineProperty(err, CHANNEL_PROP, {
      value: channel,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  } catch {
    /* attribution is best-effort; the rejection propagates either way */
  }
  return err;
}

/** The channel a rejection came from, or `null` if it was not produced by `invoke`. */
export function ipcChannelOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const value = (err as Record<string, unknown>)[CHANNEL_PROP];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** True when `err` is an `Error` carrying channel attribution. */
export function isIpcChannelError(err: unknown): err is IpcChannelError {
  return err instanceof Error && ipcChannelOf(err) !== null;
}

/**
 * A one-line description of a failed call, for logs.
 *
 * Not for the UI: it names an internal channel, which is meaningful to whoever is
 * reading a console or a support bundle and noise to whoever is reading a panel.
 * The user-facing sites keep rendering `err.message` on its own.
 */
export function describeIpcFailure(err: unknown, channel?: string): string {
  const where = channel ?? ipcChannelOf(err) ?? 'unknown channel';
  const what =
    err instanceof Error && err.message
      ? err.message
      : typeof err === 'string' && err
        ? err
        : 'rejected with no message';
  return `${where}: ${what}`;
}
