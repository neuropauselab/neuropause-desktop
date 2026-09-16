/**
 * P0 — GRANTED SCOPE, FAIL-CLOSED. The programme's FIRST production behaviour change.
 *
 * THE DEFECT: `persistConnected` recorded `tokens.scopes.length ? tokens.scopes :
 * (manifest.oauth?.scopes ?? [])`, so a token response omitting its scope list caused the
 * MANIFEST — what we ASKED FOR — to be stored as what we were GIVEN. Both `m365/executor.ts`
 * and `cst/sendTransition.ts` consume that field, so a fabricated grant would have been
 * checked against a fiction. Fail-OPEN on authority: the inverse of CLAUDE §2 #8, and a
 * violation of the AUTHORITY family's law that PRESENCE IN THE SYSTEM IS NEVER AUTHORITY.
 *
 * HONEST STATE, recorded so this is never overstated: the branch is **LATENT — it did NOT
 * fire in the r3 ceremony profile.** `manifest.oauth.scopes` is 22 entries; r3 stored 21 —
 * the same list minus `offline_access`, which Microsoft consumes to mint a refresh token and
 * does not echo in the granted `scope` claim. That delta is the fingerprint of a REAL token
 * response. Had the fallback fired, the stored set would have equalled the manifest exactly.
 * The 21-vs-7 discrepancy is manifest over-request (F-1 / F-N16-5), not storage fabrication.
 *
 * THE TRADE, stated in one line as ruled: this trades a **FAIL-OPEN LIE for a FAIL-CLOSED
 * CONFLATION** — a net safety gain and a lateral honesty move. `ConnectedAccount.grantedScopes`
 * is `string[]` in the FROZEN contract, so `[]` cannot distinguish "told nothing" from
 * "granted nothing". Modelling UNKNOWN honestly needs a nullable field: queued as FG-13.
 *
 * NOT CHANGED: the refresh path (`:359`), per RFC 6749 §5.1 — `scope` is optional on refresh
 * when identical to the original grant, so clearing it would break every working connection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE = readFileSync(join(__dirname, 'connectorService.ts'), 'utf8');

/**
 * CODE ONLY — block and line comments stripped.
 *
 * The first draft of the adversarial pin matched the fail-open pattern inside the very comment
 * that documents its removal, so the pin failed against a file that was already correct. A pin
 * that cannot tell code from prose about code is not pinning behaviour.
 */
const SERVICE_CODE = SERVICE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The assignment under test, isolated to its own line. */
const connectLine = (): string =>
  SERVICE_CODE.split('\n').find((l) => /^\s*grantedScopes:\s*tokens\.scopes,\s*$/.test(l)) ?? '';

describe('P0 · the connect path stores what was GRANTED, never what was REQUESTED', () => {
  it('scopes present → stored VERBATIM; scopes absent → stored [] — one identity assignment does both', () => {
    // `grantedScopes: tokens.scopes` is an identity: a non-empty list is carried through
    // unchanged, and an empty one stays empty. There is no branch that can substitute a value.
    expect(connectLine(), 'the connect path must assign tokens.scopes with no conditional').not.toBe('');
    expect(connectLine()).toMatch(/grantedScopes:\s*tokens\.scopes,/);
    expect(SERVICE_CODE).not.toMatch(/grantedScopes:\s*tokens\.scopes\.length\s*\?\s*tokens\.scopes\s*:\s*\(/);
  });

  it('ADVERSARIAL MUTATION — the manifest fallback is ABSENT IN ANY FORM', () => {
    // Restoring the fallback in any shape must make this suite fail. The pin flip IS the
    // acceptance test (the executionGate precedent). Each pattern below is a way the
    // fail-open could come back: the original ternary, an ?? default, or any read of the
    // manifest's own scope list while assigning grantedScopes.
    // ENUMERATE every grantedScopes assignment rather than pattern-matching for the bad shape:
    // a whitelist cannot be evaded by a fallback spelled a new way. Exactly two are permitted —
    // the connect-path identity, and the refresh-path carry-forward (RFC 6749 §5.1).
    const assignments = SERVICE_CODE.split('\n')
      .filter((l) => /^\s*grantedScopes:/.test(l))
      .map((l) => l.trim());
    expect(assignments).toEqual([
      'grantedScopes: tokens.scopes.length ? tokens.scopes : existing.grantedScopes,', // refresh — unchanged
      'grantedScopes: tokens.scopes,', // connect — P0
    ]);
    // And the manifest's own scope list must not be read ANYWHERE in this file, in any form.
    expect(SERVICE_CODE).not.toMatch(/manifest\.oauth\?\.scopes/);
    expect(SERVICE_CODE).not.toMatch(/grantedScopes:[^\n]*manifest/);
  });

  it('the REFRESH path is deliberately unchanged — RFC 6749 §5.1 carry-forward', () => {
    expect(SERVICE_CODE).toMatch(/grantedScopes:\s*tokens\.scopes\.length\s*\?\s*tokens\.scopes\s*:\s*existing\.grantedScopes/);
  });
});

describe('P0 · an empty granted-scope set REFUSES at the executor — fail-closed and loud', () => {
  /** The real predicate from `m365/executor.ts:107-109`, driven with the real message shape. */
  const hasScope = (granted: readonly string[], want: string): boolean =>
    granted.some((g) => g.toLowerCase() === want.toLowerCase());

  const check = (granted: readonly string[], actionScopes: readonly string[]) => {
    const missing = actionScopes.filter((s) => !hasScope(granted, s));
    return missing.length > 0
      ? { ok: false as const, message: `Missing Graph permission(s): ${missing.join(', ')}. Grant them in Azure and reconnect.` }
      : { ok: true as const };
  };

  it('mail.send against [] → DENY with the named missing-permission message', () => {
    const r = check([], ['Mail.Send']);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toBe(
      'Missing Graph permission(s): Mail.Send. Grant them in Azure and reconnect.',
    );
  });

  it('the real executor still carries that predicate and its message — the pin is not describing a copy', () => {
    const EXEC = readFileSync(join(__dirname, 'm365', 'executor.ts'), 'utf8');
    expect(EXEC).toMatch(/const missing = action\.scopes\.filter\(\(s\) => !hasScope\(granted, s\)\)/);
    expect(EXEC).toMatch(/Missing Graph permission\(s\)/);
  });

  it('a genuine grant still passes — the change refuses absence, not everything', () => {
    expect(check(['Mail.Send', 'Mail.Read'], ['Mail.Send']).ok).toBe(true);
  });
});
