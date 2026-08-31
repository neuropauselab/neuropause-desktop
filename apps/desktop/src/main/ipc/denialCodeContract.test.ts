/**
 * D-6 — THE AUTHORIZATION ERROR CONTRACT.
 *
 * THE DEFECT, quoted from PROGRAM-13C-FINAL-CERTIFICATION.md: *"authorization
 * outcomes are distinguishable only by matching English prose. Rewording a
 * message silently changes renderer behaviour."*
 *
 * These pins hold three separate things, and the third is the gate itself:
 *
 *  1. THE CROSS-SIDE VOCABULARY IS IDENTICAL. Main and renderer each declare the
 *     code set because there is no non-frozen module both can import
 *     (`packages/shared/` is frozen). Both new files claim this test holds them
 *     together — so it must actually read both files, or the claim is decoration.
 *
 *  2. THE STAMP IS TRANSPORT, NOT CONTENT. It round-trips exactly, never nests,
 *     and never survives to a screen.
 *
 *  3. REWORDING A MESSAGE CANNOT CHANGE CLASSIFICATION. That is D-6 stated as an
 *     executable property rather than a paragraph.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DENIAL_CODE,
  DENIAL_CODES,
  DENIAL_STAMP_OPEN,
  classifyDenial,
  isStamped,
  stampDenial,
} from './denialCode';

import {
  DENIAL_CODE as R_DENIAL_CODE,
  DENIAL_CODES as R_DENIAL_CODES,
  DENIAL_STAMP_OPEN as R_STAMP_OPEN,
  attributeDenialCode,
  denialCodeOf,
  isDeniedError,
  unstampDenial,
} from '../../renderer/src/lib/ipcError';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MAIN_SRC = join(HERE, 'denialCode.ts');
const RENDERER_SRC = join(HERE, '..', '..', 'renderer', 'src', 'lib', 'ipcError.ts');

/** The AuthorizationError shape the enterprise layer really throws. */
function authorizationError(permission: string): Error {
  const e = new Error(`Not authorized: missing permission "${permission}".`);
  e.name = 'AuthorizationError';
  return e;
}

describe('D-6 · the two vocabularies are one vocabulary', () => {
  it('main and renderer declare the SAME codes and the SAME stamp', () => {
    expect(R_DENIAL_CODE).toEqual(DENIAL_CODE);
    expect([...R_DENIAL_CODES].sort()).toEqual([...DENIAL_CODES].sort());
    expect(R_STAMP_OPEN).toBe(DENIAL_STAMP_OPEN);
  });

  // Imports alone would still pass if one side silently dropped a code and the
  // other never used it. Read the FILES, so a divergence is caught as text.
  it('every code literal appears in BOTH source files', () => {
    const main = readFileSync(MAIN_SRC, 'utf8');
    const renderer = readFileSync(RENDERER_SRC, 'utf8');
    const missing: string[] = [];
    for (const code of DENIAL_CODES) {
      if (!main.includes(`'${code}'`)) missing.push(`main is missing '${code}'`);
      if (!renderer.includes(`'${code}'`)) missing.push(`renderer is missing '${code}'`);
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('the vocabulary is non-empty and every code is a distinct kebab-case token', () => {
    expect(DENIAL_CODES.length).toBeGreaterThan(0);
    expect(new Set(DENIAL_CODES).size).toBe(DENIAL_CODES.length);
    for (const c of DENIAL_CODES) expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

describe('D-6 · the stamp is transport, not content', () => {
  it('round-trips a message exactly', () => {
    const original = 'Not authorized: missing permission "crm:manage".';
    const wire = stampDenial(DENIAL_CODE.MISSING_PERMISSION, original);
    expect(wire).not.toBe(original);
    expect(isStamped(wire)).toBe(true);

    const { code, message } = unstampDenial(wire);
    expect(code).toBe(DENIAL_CODE.MISSING_PERMISSION);
    expect(message).toBe(original); // byte-for-byte the text main produced
  });

  it('never nests a stamp on a rethrow', () => {
    const once = stampDenial(DENIAL_CODE.NOT_AUTHENTICATED, 'Sign in to continue.');
    const twice = stampDenial(DENIAL_CODE.MISSING_PERMISSION, once);
    expect(twice).toBe(once);
  });

  it('leaves an unstamped message completely alone', () => {
    const plain = 'The database is unavailable.';
    const { code, message } = unstampDenial(plain);
    expect(code).toBeNull();
    expect(message).toBe(plain);
  });

  it('strips an UNRECOGNISED stamp rather than leaking the wire prefix to a screen', () => {
    // A code added in main but not yet in the renderer must degrade to
    // "unclassified failure" — never to a user reading "NPDENY:…".
    const { code, message } = unstampDenial(`${DENIAL_STAMP_OPEN}some-future-code|Boom`);
    expect(code).toBeNull();
    expect(message).not.toContain(DENIAL_STAMP_OPEN);
    expect(message).not.toContain('some-future-code');
  });

  it('the renderer restores the clean message on the error object itself', () => {
    const err = new Error(stampDenial(DENIAL_CODE.NOT_A_MEMBER, 'No organization member is bound to this account.'));
    const out = attributeDenialCode(err);
    expect(out).toBe(err); // same object, same identity
    expect(err.message).toBe('No organization member is bound to this account.');
    expect(denialCodeOf(err)).toBe(DENIAL_CODE.NOT_A_MEMBER);
  });

  it('attribution is best-effort and never turns a rejection into a different one', () => {
    expect(attributeDenialCode('a string')).toBe('a string');
    expect(attributeDenialCode(undefined)).toBeUndefined();
    expect(denialCodeOf(null)).toBeNull();
    expect(denialCodeOf({ ipcDenialCode: 'not-a-real-code' })).toBeNull();
  });
});

describe('D-6 · classification comes from the TYPE, not the wording', () => {
  it('recognises AuthorizationError by its constructor', () => {
    expect(classifyDenial(authorizationError('crm:manage'))).toBe(DENIAL_CODE.MISSING_PERMISSION);
  });

  /**
   * THE GATE. This is D-6 as an executable property: an `AuthorizationError`
   * whose message has been reworded into something that matches NONE of the old
   * regexes must still classify as a denial. Before this contract the renderer
   * would have read the new wording as a fault and shown "something went wrong"
   * for a refusal — a confident false claim about the user's account.
   */
  it('REWORDING THE MESSAGE DOES NOT CHANGE THE ANSWER', () => {
    const reworded = authorizationError('crm:manage');
    reworded.message = 'Your role does not include this capability.'; // no "permission", no "denied"

    // The old prose test would have failed on this text …
    expect(/not authorized|permission|forbidden|denied/i.test(reworded.message)).toBe(false);
    // … and the contract still classifies it correctly.
    expect(classifyDenial(reworded)).toBe(DENIAL_CODE.MISSING_PERMISSION);

    const wire = new Error(stampDenial(classifyDenial(reworded)!, reworded.message));
    attributeDenialCode(wire);
    expect(denialCodeOf(wire)).toBe(DENIAL_CODE.MISSING_PERMISSION);
    expect(isDeniedError(wire)).toBe(true);
    expect(wire.message).toBe('Your role does not include this capability.');
  });

  it('classifies the untyped denial throws the bridge still produces', () => {
    expect(classifyDenial(new Error('Sign in to continue.'))).toBe(DENIAL_CODE.NOT_AUTHENTICATED);
    expect(classifyDenial(new Error('Authorization is not available.'))).toBe(
      DENIAL_CODE.AUTHZ_UNAVAILABLE,
    );
    expect(classifyDenial(new Error('No organization member is bound to this account.'))).toBe(
      DENIAL_CODE.NOT_A_MEMBER,
    );
    expect(classifyDenial(new Error('Untrusted sender'))).toBe(DENIAL_CODE.UNTRUSTED_SENDER);
  });

  /**
   * FAIL-CLOSED IN THE OTHER DIRECTION. "You may not" and "it is broken" are
   * different answers; an unrecognised failure must never be dressed as a
   * refusal, or a crash starts telling users their account lacks access.
   */
  it('does NOT classify a fault, a timeout, or a validation failure as a denial', () => {
    expect(classifyDenial(new Error('Request timed out: enterprise:module.list'))).toBeNull();
    expect(classifyDenial(new Error('Invalid request for enterprise:module.list'))).toBeNull();
    expect(classifyDenial(new Error('ENOENT: no such file or directory'))).toBeNull();
    expect(classifyDenial(new Error('No handler registered for x'))).toBeNull();
    expect(classifyDenial('a thrown string')).toBeNull();
    expect(classifyDenial(null)).toBeNull();
  });
});

/**
 * The tenancy vocabulary already existed — eight values, typed, in frozen
 * `packages/shared`, carried by `TenantContextError.reason`. This contract
 * READS it rather than inventing a parallel answer, and the split between
 * "refusal" and "fault" is the load-bearing part.
 */
function tenantContextError(reason: string, message = 'refused'): Error {
  const e = new Error(message) as Error & { reason: string };
  e.name = 'TenantContextError';
  e.reason = reason;
  return e;
}

describe('D-6 · tenancy refusals classify from their TYPED reason', () => {
  it('maps the authority reasons onto denial codes', () => {
    expect(classifyDenial(tenantContextError('not_signed_in'))).toBe(DENIAL_CODE.NOT_AUTHENTICATED);
    for (const r of ['not_a_member', 'not_in_workspace', 'member_inactive', 'tenant_not_operable']) {
      expect(classifyDenial(tenantContextError(r)), r).toBe(DENIAL_CODE.NOT_A_MEMBER);
    }
  });

  /**
   * THE ONE THAT MATTERS. `not_loaded` is a COLD START and `workspace_orphaned`
   * is a data fault. Reporting either as "you do not have access" would be a
   * confident false claim about the user's account. They must NOT classify as
   * denials — the surface shows them as the faults they are.
   */
  it('refuses to call a cold start or a data fault a denial', () => {
    expect(classifyDenial(tenantContextError('not_loaded'))).toBeNull();
    expect(classifyDenial(tenantContextError('no_workspace'))).toBeNull();
    expect(classifyDenial(tenantContextError('workspace_orphaned'))).toBeNull();
  });

  it('classifies a future reason deliberately rather than by default', () => {
    // An unrecognised reason falls through to null: a new tenancy state must be
    // classified on purpose, never silently inherited as "denied".
    expect(classifyDenial(tenantContextError('some_future_reason'))).toBeNull();
  });

  it('reads the reason, not the message — rewording the refusal changes nothing', () => {
    const a = tenantContextError('not_a_member', 'No organization member is bound to this account.');
    const b = tenantContextError('not_a_member', 'Totally different wording.');
    expect(classifyDenial(a)).toBe(classifyDenial(b));
    expect(classifyDenial(b)).toBe(DENIAL_CODE.NOT_A_MEMBER);
  });
});

describe('D-6 · isDeniedError — code first, prose only as fallback', () => {
  it('answers from the CODE when one is present, ignoring the wording entirely', () => {
    const err = new Error(stampDenial(DENIAL_CODE.MISSING_PERMISSION, 'Anything at all.'));
    attributeDenialCode(err);
    expect(isDeniedError(err)).toBe(true);
  });

  // The fallback is deliberate: not every denial flows through the stamping
  // bridge yet (the REST gateway calls runSecureHandler directly). Removing it
  // would turn a working denial banner into a blank screen.
  it('still recognises a legacy UNSTAMPED denial by prose', () => {
    expect(isDeniedError(new Error('Not authorized: missing permission "crm:read".'))).toBe(true);
    expect(isDeniedError(new Error('Sign in to continue.'))).toBe(true);
    expect(isDeniedError('permission denied')).toBe(true);
  });

  it('does not call an ordinary fault a denial', () => {
    expect(isDeniedError(new Error('The database is unavailable.'))).toBe(false);
    expect(isDeniedError(new Error(''))).toBe(false);
    expect(isDeniedError(undefined)).toBe(false);
  });
});
