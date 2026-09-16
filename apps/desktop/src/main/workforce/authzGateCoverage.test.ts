/**
 * S166 — registration ↔ classification pairing invariant.
 *
 * rc.27 shipped a registered workforce channel (`security:auditIntegrity.status`, S115)
 * with no WORKFORCE_CHANNEL_PERMISSIONS entry. The gate's composition-time throw is
 * correct fail-closed behavior — but it fired for the first time inside the PACKAGED
 * app's initRuntimeCore on Windows (S165), because nothing in CI ever composed the real
 * handler set. This test closes that class: it derives the registered channel set from
 * the workforce composition root ITSELF (the authoritative registration source — not a
 * second hand-maintained registry) and fails, in CI, if any channel it registers is
 * absent from the classification map.
 *
 * Source-scan extraction is the same accepted pattern as channelStoreCoverageGate.test.ts:
 * every handler def in workforce/index.ts is written literally as `channel: IpcChannel.X`,
 * and the entire handlers array passes through withWorkforceAuthz. If a future refactor
 * registers channels another way, the extraction count assertion below fails loudly
 * rather than silently passing on an empty set.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcChannel } from '@neuropause/shared';
import { WORKFORCE_CHANNEL_PERMISSIONS, withWorkforceAuthz } from './authzGate';
import type { SecureHandlerDef } from '../ipc/secureBridge';

const COMPOSITION_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'index.ts');

/** Every `channel: IpcChannel.X` literal in the composition root, resolved to its runtime string. */
function registeredChannels(): string[] {
  const source = readFileSync(COMPOSITION_ROOT, 'utf8');
  const names = [...source.matchAll(/channel:\s*IpcChannel\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(15); // extraction guard: a refactor must not silently empty this
  const channels = names.map((name) => {
    const value = (IpcChannel as Record<string, string>)[name];
    expect(value, `IpcChannel.${name} referenced in workforce/index.ts must exist`).toBeTruthy();
    return value;
  });
  return [...new Set(channels)];
}

describe('S166 — every registered workforce channel is classified', () => {
  it('every channel registered in the composition root has a permission classification', () => {
    const unclassified = registeredChannels().filter(
      (channel) => !WORKFORCE_CHANNEL_PERMISSIONS[channel],
    );
    expect(unclassified, 'unclassified registered channels (add to WORKFORCE_CHANNEL_PERMISSIONS)').toEqual([]);
  });

  it('withWorkforceAuthz composes the full registered set without throwing (the rc.27 failure mode)', () => {
    const defs = registeredChannels().map(
      (channel): SecureHandlerDef =>
        ({ channel, schema: undefined, handler: () => undefined }) as unknown as SecureHandlerDef,
    );
    const stamped = withWorkforceAuthz(defs);
    expect(stamped).toHaveLength(defs.length);
    for (const def of stamped) {
      expect(def.requireAuth).toBe(true);
      expect(def.permission).toBeTruthy();
      expect(def.audit).toBe(true);
    }
  });

  it('the S115 channel carries exactly its documented read-only scope', () => {
    expect(WORKFORCE_CHANNEL_PERMISSIONS[IpcChannel.SecurityAuditIntegrityStatus]).toBe(
      'operations:read',
    );
  });
});
