/**
 * NP-013 — RULE-009 at the metadata store door: "credential material cannot
 * appear in connector metadata" (ARCHITECTURE-SPEC §53), enforced instead of
 * asserted. `connectors.json` is PLAIN JSON on disk and its shape doc claims
 * "never any token material" — until now that claim had no runtime guard,
 * while three ConnectedAccount fields carry PROVIDER-CONTROLLED strings
 * (label from the OAuth token response's workspace/team name, error from
 * provider error_description, grantedScopes verbatim): a hostile or
 * compromised provider could smuggle token bytes into plaintext disk.
 *
 * The scrub rule is main's ONE credential-text rule (`redactCredentialText`,
 * logger.ts — the same rule the log boundary enforces): credentials only,
 * never emails or paths, because an account's label/externalId is
 * legitimately the user's own email (every M365 connection) and blanking it
 * would falsify the Connectors UI. That divergence from the shared
 * `redactSensitive` is deliberate, documented at the rule, and pinned here
 * (an email label SURVIVES).
 *
 * Scrub, not refuse: refusing the upsert would let a hostile provider DoS the
 * connection flow with a token-shaped workspace name. The account persists;
 * the credential-shaped VALUE does not. Values only, never keys — the
 * legitimate `accessTokenExpiresAt` DISPLAY field (an ISO date) is untouched
 * because no date matches a credential shape.
 */
import type { ConnectedAccount } from '@neuropause/shared';
import { redactCredentialText } from '../logger';

export interface ScrubResult {
  readonly account: ConnectedAccount;
  /** Field names whose value changed — the RULE-009 evidence, never the value. */
  readonly scrubbedFields: readonly string[];
}

/** Pure. Returns the same object identity when nothing needed scrubbing. */
export function scrubAccountMetadata(account: ConnectedAccount): ScrubResult {
  const scrubbedFields: string[] = [];
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(account)) {
    let next: unknown = value;
    if (typeof value === 'string') {
      next = redactCredentialText(value);
    } else if (Array.isArray(value)) {
      const scrubbedArr = value.map((v) => (typeof v === 'string' ? redactCredentialText(v) : v));
      if (scrubbedArr.some((v, i) => v !== value[i])) next = scrubbedArr;
    }
    if (next !== value) {
      scrubbedFields.push(key);
      out ??= { ...(account as unknown as Record<string, unknown>) };
      out[key] = next;
    }
  }
  return out === null
    ? { account, scrubbedFields }
    : { account: out as unknown as ConnectedAccount, scrubbedFields };
}
