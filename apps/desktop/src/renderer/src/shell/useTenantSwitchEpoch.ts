import { useEffect, useRef, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('tenant-switch');

/**
 * P13C ROUND 61 — GATE 26. A counter that increments once per REAL tenant change.
 *
 * THE DEFECT it exists to close: the shell remounted on a local VIEW change but
 * not on a TENANT change, so after switching org workspaces every already-mounted
 * surface kept rendering the PREVIOUS tenant's data — BusinessView's per-tenant
 * `recordCount`, the Data import history, module screens — until the user
 * happened to navigate. The Gate-26 driven run recorded it as "after a tenant
 * switch other mounted surfaces still refetch only on navigation".
 *
 * CLASSIFICATION, deliberate: UI-TRUTH / FRESHNESS (§4), NOT a tenancy breach.
 * The enterprise record store re-resolves scope on every call and fails closed,
 * and the switch is membership-gated — the user was authorized for the data
 * still on screen. Filing it as security would misdirect the fix at the
 * authorization layer, which behaves correctly.
 *
 * THE SIGNAL ALREADY EXISTED: `workspaceStore.switch()` emits `changed`, bridged
 * onto the allowlisted `enterprise:event` broadcast with kind `workspace`. No new
 * channel and no new hub are introduced — only three renderer files listened, none
 * of them shell chrome.
 *
 * WHY AN EPOCH RATHER THAN THE ID: the consumer keys a React subtree on this. Using
 * the id directly would remount once at boot, when the first read resolves
 * `null → workspace-default` — a real cost (lost scroll, closed panels) for a
 * non-event. The epoch adopts the first observed value silently and increments only
 * on a genuine CHANGE. A read that THROWS keeps the previous value: a transient
 * refusal or a boot-window miss is not a tenant change and must not remount anything.
 */
export function useTenantSwitchEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  // `undefined` = never read yet; `null` = read, and there is no active tenant.
  const lastId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;

    const read = async (): Promise<void> => {
      let id: string | null;
      try {
        const ws = (await ipc.enterprise.activeWorkspace()) as { id?: unknown } | null;
        id = ws && typeof ws === 'object' && typeof ws.id === 'string' ? ws.id : null;
      } catch {
        return; // keep the previous value — a refusal is not a change
      }
      if (!alive) return;
      if (lastId.current === undefined) {
        lastId.current = id; // first resolution — adopt, never remount
        return;
      }
      if (lastId.current !== id) {
        lastId.current = id;
        log.info('active tenant changed — remounting the view so it refetches');
        setEpoch((e) => e + 1);
      }
    };

    void read();
    const off = ipc.enterprise.onEvent((e: unknown) => {
      if (e && typeof e === 'object' && (e as { kind?: unknown }).kind === 'workspace') void read();
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, []);

  return epoch;
}
