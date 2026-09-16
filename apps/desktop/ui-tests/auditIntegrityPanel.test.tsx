/**
 * S115 — the operator-facing Audit Integrity panel renders the REAL sanitized integrity status of the
 * governance audit chain, fetched through the governed security IPC (`ipc.security.auditIntegrity` →
 * `security:auditIntegrity.status`, 'operations:read'). Proves the real UI → bridge → governed read
 * path and that the panel reflects ACTUAL status: a tampered chain visibly reads VERIFICATION FAILED,
 * never hardcoded to signed; and only {state, algorithm, keyId, keyVersion} ever render — no secrets.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { AuditIntegrityPanel } from '@renderer/operationsPlatform/AuditIntegrityPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('AuditIntegrityPanel', () => {
  it('renders SIGNED with algorithm/key metadata from the governed read', async () => {
    let sawChannel = false;
    route(IpcChannel.SecurityAuditIntegrityStatus, () => {
      sawChannel = true;
      return { state: 'SIGNED', algorithm: 'Ed25519', keyId: 'np-audit', keyVersion: 1 };
    });
    render(<AuditIntegrityPanel />);
    await waitFor(() => expect(screen.getByText('Signed & verified')).toBeTruthy());
    expect(sawChannel).toBe(true);
    expect(screen.getByText('Algorithm: Ed25519')).toBeTruthy();
    expect(screen.getByText('Key: np-audit')).toBeTruthy();
    expect(screen.getByText('Version: 1')).toBeTruthy();
  });

  it('a tampered chain visibly reads VERIFICATION FAILED (never hardcoded signed)', async () => {
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({
      state: 'VERIFICATION_FAILED',
      algorithm: 'Ed25519',
      keyId: 'np-audit',
      keyVersion: 1,
    }));
    render(<AuditIntegrityPanel />);
    await waitFor(() => expect(screen.getByText('Verification FAILED')).toBeTruthy());
    expect(screen.getByText(/Integrity verification FAILED/)).toBeTruthy();
    expect(screen.queryByText('Signed & verified')).toBeNull();
  });

  it('an unsigned history reads UNSIGNED truthfully, with no key metadata', async () => {
    route(IpcChannel.SecurityAuditIntegrityStatus, () => ({ state: 'UNSIGNED' }));
    render(<AuditIntegrityPanel />);
    await waitFor(() => expect(screen.getByText('Unsigned')).toBeTruthy());
    expect(screen.queryByText(/Algorithm:/)).toBeNull();
    expect(screen.queryByText(/Key:/)).toBeNull();
  });

  it('never renders private key material even if the response were to carry it', async () => {
    // Defense-in-depth: the panel only reads the four safe fields, so injected secret-shaped
    // properties must not appear anywhere in the rendered output.
    route(IpcChannel.SecurityAuditIntegrityStatus, () =>
      ({
        state: 'SIGNED',
        algorithm: 'Ed25519',
        keyId: 'np-audit',
        keyVersion: 1,
        // deliberately-planted fields the panel must ignore:
        privateKeyPem: '-----BEGIN PRIVATE KEY-----LEAK-----END PRIVATE KEY-----',
        signature: 'BASE64SIGLEAK',
      }) as unknown as { state: 'SIGNED' },
    );
    const { container } = render(<AuditIntegrityPanel />);
    await waitFor(() => expect(screen.getByText('Signed & verified')).toBeTruthy());
    expect(container.textContent).not.toContain('PRIVATE KEY');
    expect(container.textContent).not.toContain('LEAK');
    expect(container.textContent).not.toContain('BASE64SIGLEAK');
  });
});
