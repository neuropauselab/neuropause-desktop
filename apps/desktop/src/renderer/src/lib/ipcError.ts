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

/* ------------------------------------------------------------------------- *
 * D-6 — THE AUTHORIZATION ERROR CONTRACT (renderer side)
 * ------------------------------------------------------------------------- *
 *
 * THE DEFECT, quoted from the certification: *"authorization outcomes are
 * distinguishable only by matching English prose. Rewording a message silently
 * changes renderer behaviour."* Seven renderer sites grew their own regex —
 * `/not authorized|permission|forbidden|denied/i` and friends — over sentences
 * the main process happened to write.
 *
 * The main process was never the problem: `enterprise/authz.ts` throws a typed
 * `AuthorizationError` carrying the missing permission. `secureBridge.ts`
 * flattened it to a message one frame before the boundary, and, as the header
 * of this file already records, Electron serializes only `message`.
 *
 * So the code travels in the message and is taken off HERE, at the same single
 * chokepoint that already attaches channel attribution — and the clean message
 * is restored, so the ~80 sites rendering `err.message` see exactly the text
 * they saw before. The stamp is transport; it must never reach a screen.
 *
 * WHY THIS VOCABULARY IS DUPLICATED IN MAIN (`main/ipc/denialCode.ts`) and must
 * not be "fixed" by merging: renderer resolves `@renderer/*`, main resolves
 * `@neuropause/shared`, and `packages/shared/` is a FROZEN surface — there is
 * no non-frozen module both sides can import. `denialCodeContract.test.ts`
 * reads both files and fails if they drift, so the duplicate is checked rather
 * than merely hoped for.
 */

/** The closed set of authorization outcomes. Mirrors `main/ipc/denialCode.ts`. */
export const DENIAL_CODE = {
  NOT_AUTHENTICATED: 'not-authenticated',
  MISSING_PERMISSION: 'missing-permission',
  NOT_A_MEMBER: 'not-a-member',
  AUTHZ_UNAVAILABLE: 'authz-unavailable',
  UNTRUSTED_SENDER: 'untrusted-sender',
} as const;

export type DenialCode = (typeof DENIAL_CODE)[keyof typeof DENIAL_CODE];
export const DENIAL_CODES: readonly DenialCode[] = Object.values(DENIAL_CODE);

/** The wire prefix. Mirrors `main/ipc/denialCode.ts`. */
export const DENIAL_STAMP_OPEN = 'NPDENY:';
/** Delimits the code from the message. Mirrors `main/ipc/denialCode.ts`. */
export const DENIAL_STAMP_CLOSE = '|';

const DENIAL_PROP = 'ipcDenialCode';

/** Split a stamped message into its code and the original text. */
export function unstampDenial(message: string): { code: DenialCode | null; message: string } {
  if (!message.startsWith(DENIAL_STAMP_OPEN)) return { code: null, message };
  const rest = message.slice(DENIAL_STAMP_OPEN.length);
  for (const code of DENIAL_CODES) {
    if (rest.startsWith(`${code}${DENIAL_STAMP_CLOSE}`))
      return { code, message: rest.slice(code.length + DENIAL_STAMP_CLOSE.length) };
  }
  // A stamp we do not recognise is NOT a denial we may act on, and its text is
  // not safe to display as-is. Report no code and hand back the remainder so a
  // future code added in main degrades to "unclassified failure" rather than to
  // a leaked wire prefix on screen.
  const cut = rest.indexOf(DENIAL_STAMP_CLOSE);
  return { code: null, message: cut === -1 ? rest : rest.slice(cut + DENIAL_STAMP_CLOSE.length) };
}

/**
 * Take the denial code off a rejection, restore its clean message, and record
 * the code on the error.
 *
 * The message rewrite is the one place this module touches `message`, and it is
 * a restoration, not a change: the text after this call is byte-for-byte what
 * the main process produced before stamping. Same object, same stack, same
 * identity — every existing consumer is unaffected.
 */
export function attributeDenialCode<E>(err: E): E {
  if (!(err instanceof Error)) return err;
  const { code, message } = unstampDenial(err.message);
  if (code === null && message === err.message) return err;
  try {
    err.message = message;
  } catch {
    /* a frozen error keeps its stamped message rather than losing the rejection */
  }
  if (code !== null && Object.isExtensible(err) && !(DENIAL_PROP in err)) {
    try {
      Object.defineProperty(err, DENIAL_PROP, {
        value: code,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    } catch {
      /* best-effort, exactly as channel attribution is */
    }
  }
  return err;
}

/** The denial code carried by a rejection, or `null` when it is not a denial. */
export function denialCodeOf(err: unknown): DenialCode | null {
  if (typeof err !== 'object' || err === null) return null;
  const value = (err as Record<string, unknown>)[DENIAL_PROP];
  return typeof value === 'string' && (DENIAL_CODES as readonly string[]).includes(value)
    ? (value as DenialCode)
    : null;
}

/**
 * Legacy prose fallback — the union of the seven regexes this contract replaces.
 *
 * Kept deliberately, and deliberately SECOND. Not every denial in the product
 * flows through the stamping bridge yet (the REST gateway calls
 * `runSecureHandler` directly, and some surfaces reject before it), so removing
 * the prose path would turn a working denial banner into a blank screen — the
 * exact failure class Gate 15 exists to prevent. It is a fallback, not the
 * contract: when a code is present it is never consulted.
 */
function looksLikeDenialProse(message: string): boolean {
  return /not authori[sz]|permission|forbidden|denied|sign in/i.test(message);
}

/**
 * Was this rejection a refusal of authority, as opposed to a broken call?
 *
 * CODE FIRST, PROSE ONLY AS FALLBACK. This is the whole point of D-6: with a
 * code present, rewording any message cannot change the answer.
 */
export function isDeniedError(err: unknown): boolean {
  if (denialCodeOf(err) !== null) return true;
  // An error that carried a RECOGNISED code and was classified above is done;
  // reaching here means no code, so fall back to the prose the sites used before.
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.length > 0 && looksLikeDenialProse(message);
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
