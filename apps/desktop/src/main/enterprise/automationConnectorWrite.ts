/**
 * P2.5 — connector-write classification for the automation runtime (pure).
 *
 * Automations fire autonomously on events, so the ONE inviolable rule is: a
 * connector write (an outbound send or a data modification) must NEVER be executed
 * automatically — it is HELD for explicit user confirmation. This classifier turns
 * the previously-blind `connector-write` no-op into an honest, grounded outcome: it
 * looks the requested action up in the real Microsoft 365 write registry (so the
 * message carries the true label + whether it mutates) and always reports that the
 * write is held for confirmation, never sent. Pure: the action registry is passed
 * in, so it unit-tests without the connector layer.
 */
import type { AutomationAction } from '@neuropause/shared';

/** The minimal shape of a registered connector write action this classifier reads. */
export interface ConnectorWriteActionMeta {
  id: string;
  label: string;
  /** true = mutates external data (send / create / update / delete) → confirmation-gated. */
  mutates: boolean;
}

export interface ConnectorWriteOutcome {
  ok: boolean;
  message: string;
  /** Whether the classified target is a data-mutating write (vs a read helper). */
  mutates: boolean;
  /** Whether the target action was resolved in the registry. */
  resolved: boolean;
}

/**
 * Classify a `connector-write` automation action and enforce the never-auto-send
 * invariant. Returns `ok: true` (the automation step is handled — the write is
 * queued for confirmation, not a failure) with a message that truthfully states no
 * live write occurred.
 */
export function classifyConnectorWrite(
  action: AutomationAction,
  registry: readonly ConnectorWriteActionMeta[],
): ConnectorWriteOutcome {
  const actionId = typeof action.config?.actionId === 'string' ? action.config.actionId : null;
  const target = action.connectorId ?? 'connector';
  const known = actionId ? registry.find((a) => a.id === actionId) : undefined;

  if (known) {
    const verb = known.mutates ? 'write' : 'read';
    return {
      ok: true,
      resolved: true,
      mutates: known.mutates,
      message: `Microsoft 365 ${verb} “${known.label}” held for explicit confirmation — NeuroPause never sends or modifies data automatically.`,
    };
  }

  return {
    ok: true,
    resolved: false,
    mutates: true,
    message: `connector-write to ${target} held for explicit confirmation — NeuroPause never sends or modifies data automatically.`,
  };
}
