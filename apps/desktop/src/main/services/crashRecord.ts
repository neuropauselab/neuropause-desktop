/**
 * Pure crash-record assembly. Kept deliberately electron-free so it is directly
 * unit-testable (the crash reporter itself imports electron and cannot be). The
 * message and stack are scrubbed with the shared canonical redactor before a
 * record is ever written to the on-device crash archive — defense-in-depth: the
 * support-bundle generator re-scrubs on export, but this keeps the at-rest
 * crashes.log clean at the source, so nothing sensitive is persisted even if the
 * file is opened directly.
 */
import { redactSensitive } from '@neuropause/shared';
import type { CrashCategory, CrashRecord } from '@neuropause/shared';

/** Build a redaction-scrubbed crash record. `atIso` is injected so this stays pure. */
export function buildCrashRecord(
  category: CrashCategory,
  kind: string,
  message: string,
  stack: string | undefined,
  atIso: string,
): CrashRecord {
  return {
    at: atIso,
    category,
    kind,
    message: redactSensitive(message ?? ''),
    stack: stack ? redactSensitive(stack) : null,
  };
}
