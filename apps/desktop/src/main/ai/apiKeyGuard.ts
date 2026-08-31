/**
 * PROVIDER-KEY SAFETY AT THE REQUEST BOUNDARY.
 *
 * THE DEFECT THIS CLOSES, reproduced on this repo's node v20.20.2:
 *
 *   new Request(url, { headers: { 'x-api-key': 'sk-ant-SEC\nRET123456789' } })
 *   → TypeError: Headers.append: "sk-ant-SEC\nRET123456789" is an invalid header value.
 *
 * The key is VERBATIM in that message. The cloud clients call `fetch` inside a
 * `try/finally` with no `catch`, so the TypeError escaped intact and was copied
 * — unchanged, hop after hop — into `attempted[].reason`, then into the routing
 * envelope, then across IPC, and finally BOTH rendered in the assistant's
 * "Why?" popover AND written in cleartext to `assistant-conversations.json`.
 * That is a live credential outside the encrypted vault, in a file no redaction
 * pass ever touches.
 *
 * It is reachable: the Settings field only `.trim()`s (which strips surrounding
 * whitespace, not an EMBEDDED newline) and the IPC contract is `z.string()
 * .min(1)`, so a key pasted with a line wrap — the ordinary result of copying
 * from a wrapped terminal or a PDF — is stored exactly as typed.
 *
 * WHY REDACTION ALONE IS NOT THE FIX. `logger.redactCredentialText` is reused
 * below, but it cannot be the whole answer: its `sk-` rule needs 8+ characters
 * after the prefix, and a key broken by a newline presents only `sk-ant-SEC`
 * (7) before the break. A leak that depends on the secret's own shape is not a
 * control. So the primary defence REFUSES THE REQUEST rather than scrubbing its
 * wreckage, and redaction is the second layer for whatever a provider throws
 * next.
 *
 * Pure and dependency-light on purpose, so both cloud clients and the
 * connection validator can share exactly one rule.
 */
import { redactCredentialText } from '../logger';

/**
 * Characters that can never appear in an HTTP header value.
 *
 * Per RFC 7230 a field value is made of visible ASCII plus space and tab; CR,
 * LF and NUL are the ones that actually arrive in practice, from a wrapped
 * paste. Testing the whole C0/C1 range keeps this honest rather than
 * enumerating the three we happen to have seen.
 */
/** True when `key` can be placed in a header without throwing. */
export function isHeaderSafeApiKey(key: string): boolean {
  if (key.length === 0) return false;
  // Scanned by code point rather than matched by a regex: a control-character
  // CLASS is exactly what `no-control-regex` exists to flag, and suppressing
  // that rule to write the check would be louder than simply not needing it.
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return false;
  }
  return true;
}

/**
 * The message shown when a key cannot be sent.
 *
 * Deliberately actionable and deliberately EMPTY OF KEY MATERIAL: it names the
 * likely cause (a line break from a wrapped paste) and the remedy, and it is
 * safe to render, persist and put in a support bundle — which the raw
 * TypeError was not.
 */
export const INVALID_KEY_DETAIL =
  'The saved API key contains an invalid character — usually a line break from a wrapped copy-paste. Re-enter the key on one line.';

/**
 * Throw a clean, key-free error when `key` cannot be used as a header value.
 *
 * Called BEFORE the request is constructed, so the provider SDK never sees a
 * value that would make it echo the secret back in an exception.
 */
export function assertHeaderSafeApiKey(key: string): void {
  if (!isHeaderSafeApiKey(key)) throw new Error(INVALID_KEY_DETAIL);
}

/**
 * Scrub credential-shaped material from an error on its way out of a provider
 * client — the second layer, for anything thrown that we did not anticipate.
 *
 * Returns a NEW Error rather than mutating: the original may be inspected by a
 * caller that already holds it, and rewriting another frame's error in place is
 * how a stack stops meaning what it says.
 */
export function redactProviderError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err ?? 'The request failed.');
  const safe = redactCredentialText(raw);
  const out = new Error(safe);
  if (err instanceof Error) {
    out.name = err.name;
    out.stack = err.stack;
  }
  return out;
}
