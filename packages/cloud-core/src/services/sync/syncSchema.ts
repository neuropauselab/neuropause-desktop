/**
 * Sync envelope schema — the SCHEMA-LEVEL teeth for Principle 5,
 * "Synchronize state, never secrets."
 *
 * `hasSecretKey` walks the state object (and nested objects/arrays) and the
 * schema's superRefine REJECTS any envelope whose state contains a key matching
 * SECRET_FIELD_PATTERN. Consequence: a secret-bearing sync payload is a
 * validation error, not something a reviewer has to catch. This is the NCEA
 * forward rule realized in code.
 */
import { z } from 'zod';
import { SYNCABLE_STATE_KINDS, SECRET_FIELD_PATTERN } from '@neuropause/shared-cloud';

/** Returns the offending key path if a secret-like KEY exists anywhere, else null. */
export function hasSecretKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = hasSecretKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const here = path ? `${path}.${k}` : k;
      if (SECRET_FIELD_PATTERN.test(k)) return here;
      const nested = hasSecretKey(v, here);
      if (nested) return nested;
    }
  }
  return null;
}

const stateObject = z.record(z.unknown()).superRefine((val, ctx) => {
  const offending = hasSecretKey(val);
  if (offending) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `secret-like field '${offending}' may not be synchronized (Principle 5: state, never secrets)`,
    });
  }
});

export const syncEnvelopeSchema = z.object({
  kind: z.enum(SYNCABLE_STATE_KINDS),
  entityId: z.string().min(1),
  deviceId: z.string().min(1),
  /** version vector: deviceId -> counter. */
  vv: z.record(z.number().int().nonnegative()),
  updatedAt: z.number().int().nonnegative(),
  state: stateObject,
});

export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;
