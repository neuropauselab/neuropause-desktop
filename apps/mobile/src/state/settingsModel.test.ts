/**
 * Mobile M1-13 — pure tests for the Settings view-model.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionSession } from '../lib/sealedClient';
import { formatEndpoint, settingsRows, type SessionHello } from './settingsModel';

const session: CompanionSession = {
  host: '10.0.0.2',
  port: 47600,
  deviceId: 'cd_abc',
  desktopName: 'Studio Mac',
  orgName: 'Acme',
  desktopPublicKeyB64: 'k',
};

const hello: SessionHello = {
  desktopName: 'Studio Mac',
  orgName: 'Acme',
  user: 'sam@acme.co',
  deviceId: 'cd_abc',
  protocolVersion: 1,
};

describe('settingsModel', () => {
  it('formats the endpoint', () => {
    expect(formatEndpoint(session)).toBe('10.0.0.2:47600');
  });

  it('builds rows enriched by session.hello', () => {
    const rows = settingsRows(session, hello, '0.1.0');
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map['Signed in as']).toBe('sam@acme.co');
    expect(map['Connection']).toBe('10.0.0.2:47600');
    expect(map['Protocol']).toBe('v1');
    expect(map['App version']).toBe('0.1.0');
  });

  it('falls back to session values and omits user when hello is absent', () => {
    const rows = settingsRows(session, null, '0.1.0');
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('Signed in as');
    expect(rows.find((r) => r.label === 'Desktop')?.value).toBe('Studio Mac');
    expect(rows.find((r) => r.label === 'Protocol')?.value).toBe('—');
  });
});
