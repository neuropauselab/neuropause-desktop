/**
 * Reserved synthetic namespaces for a device-local principal (S17 local-first /
 * FG-6 / DECISIONS D-12). These are PURE string rules with NO `AuthStatus`
 * dependency, so the reserve / no-strip / deny rules are unit-tested
 * independently of the union — and this module compiles before the `local`
 * union member exists (it is the FG-6 checkpoint).
 *
 *   actor namespace  — `local:<id>`                (CST admission actor)
 *   tenant identity  — `local-<id>@device.invalid` (RFC-6761 non-routable)
 *
 * Neither is EVER stripped: the whole string IS the identity in dedup, policy
 * matching, tenancy, ownership, and evidence. Nothing may route/send/sync to
 * `@device.invalid`; an outbound recipient there is invalid BY RULE — a
 * fail-closed edge check, never a lookup that could time out.
 */

/** Reserved actor-namespace prefix. A local principal's actor is `local:<id>`. */
export const LOCAL_ACTOR_PREFIX = 'local:';

/** Reserved non-routable email domain for the device-local tenant identity. */
export const DEVICE_INVALID_DOMAIN = 'device.invalid';

/** The self-disclosing governed-actor string for a local principal id. */
export function localActorId(principalId: string): string {
  return `${LOCAL_ACTOR_PREFIX}${principalId}`;
}

/**
 * True when a string occupies the reserved actor namespace. A cloud-authenticated
 * id that matches this is a FORGERY — the caller denies (FG-6 pin 1); it is never
 * "normalized" by stripping the prefix (pin 2).
 */
export function isReservedLocalActor(actor: string): boolean {
  return actor.startsWith(LOCAL_ACTOR_PREFIX);
}

/** The synthetic, non-routable tenant/membership email for a local principal id. */
export function localSessionEmail(principalId: string): string {
  return `local-${principalId}@${DEVICE_INVALID_DOMAIN}`;
}

/**
 * True when an email is in the reserved non-routable device namespace. Any
 * outbound recipient here is invalid BY RULE (D-12 addendum) — callers at the
 * send edge fail closed on it. Case-insensitive; the whole address is never
 * stripped back to a "real" identity.
 */
export function isDeviceInvalidEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${DEVICE_INVALID_DOMAIN}`);
}
