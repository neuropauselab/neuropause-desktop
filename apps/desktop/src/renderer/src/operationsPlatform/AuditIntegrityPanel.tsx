/**
 * S115 — the operator-facing Audit Integrity panel. A read-only view of the governance audit chain's
 * cryptographic integrity, fetched through the governed security IPC (`ipc.security.auditIntegrity`)
 * → the secure bridge → the main read branch → the workforce governance AuditLog, which verifies the
 * SHA-256 hash chain AND (if present) the Ed25519 head signature, fail-closed.
 *
 * It mutates nothing. It renders exactly the sanitized status the main process returns — ONLY
 * {state, algorithm, keyId, keyVersion}. No key material, no chain head, no audit entries ever cross
 * this boundary. It NEVER hardcodes success: an unsigned chain reads UNSIGNED and a tampered chain
 * reads VERIFICATION FAILED (red), never SIGNED.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import { LoadingBlock } from '@renderer/operationsCenter/primitives';

interface AuditIntegrity {
  state: 'SIGNED' | 'UNSIGNED' | 'VERIFICATION_FAILED';
  algorithm?: string;
  keyId?: string;
  keyVersion?: number;
}

function stateTone(state: string): OpsTone {
  if (state === 'SIGNED') return 'green';
  if (state === 'VERIFICATION_FAILED') return 'red';
  return 'orange'; // UNSIGNED — truthful, backward-compatible; not a failure but not verified
}
function stateLabel(state: string): string {
  if (state === 'SIGNED') return 'Signed & verified';
  if (state === 'VERIFICATION_FAILED') return 'Verification FAILED';
  return 'Unsigned';
}

export function AuditIntegrityPanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<AuditIntegrity | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.security.auditIntegrity();
      setData(resp);
      setState('ready');
    } catch {
      setMessage('Audit integrity status could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Verifying audit integrity…" />;

  const s = data?.state ?? 'UNSIGNED';

  return (
    <OpsPanel
      title="Audit integrity"
      subtitle="Governance audit chain — SHA-256 hash chain + Ed25519 head signature, verified live, read-only"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      {state === 'error' ? (
        <div className="rounded-2xl border border-[var(--hairline)] px-4 py-3 text-2xs text-faint">{message}</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={stateTone(s)} label={stateLabel(s)} />
            {data?.algorithm && <StatusBadge tone="gray" label={`Algorithm: ${data.algorithm}`} />}
            {data?.keyId && <StatusBadge tone="gray" label={`Key: ${data.keyId}`} />}
            {data?.keyVersion !== undefined && <StatusBadge tone="gray" label={`Version: ${data.keyVersion}`} />}
          </div>
          <div className="surface-raised rounded-2xl px-4 py-3 text-2xs text-faint shadow-card">
            {s === 'SIGNED' &&
              'The audit chain hashes intact and its head signature verifies under the durable key. No key material is exposed here.'}
            {s === 'UNSIGNED' &&
              'The audit chain hashes intact but carries no signature on record (unsigned history). This is a truthful backward-compatible state.'}
            {s === 'VERIFICATION_FAILED' &&
              'Integrity verification FAILED — the hash chain or the head signature did not verify. Investigate the governance audit store.'}
          </div>
        </>
      )}
    </OpsPanel>
  );
}
