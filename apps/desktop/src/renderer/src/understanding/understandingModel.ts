/**
 * The Understand screen's pure model.
 *
 * Two jobs, both kept out of the component so they can be asserted directly:
 *
 *  1. Turn REAL system state (populated modules, connected accounts) into
 *     `system_derived` attributes. These are the only attributes NeuroPause
 *     writes about you without being told, so each one carries the count it
 *     was computed from — an unsourced derived fact is indistinguishable from
 *     an invention, and the whole surface's credibility rests on the
 *     difference.
 *  2. Build the correction patch. A correction is not an overwrite: it changes
 *     the value AND restamps provenance to `corrected`, so an inference that
 *     was wrong is visibly a thing the user fixed, not a thing NeuroPause
 *     always knew.
 */
import type { UnderstandingAttribute } from '@neuropause/shared';

/** Real, counted inputs. Nothing here is estimated. */
export interface DerivedInputs {
  /** Modules that actually hold records, with their counts. */
  populatedModules: { moduleId: string; title: string; recordCount: number }[];
  /** Connector accounts genuinely in a connected/healthy state. */
  connectedAccounts: { provider: string }[];
}

/**
 * Derive the "from your data and connections" attributes.
 *
 * Returns [] when there is nothing real to say. That empty result is the
 * correct output, not a gap to fill: a fresh install genuinely knows nothing
 * about your business, and saying so is the honest screen.
 */
export function deriveSystemAttributes(
  inputs: DerivedInputs,
  at: string,
): UnderstandingAttribute[] {
  const out: UnderstandingAttribute[] = [];
  const populated = inputs.populatedModules.filter((m) => m.recordCount > 0);
  if (populated.length > 0) {
    const total = populated.reduce((n, m) => n + m.recordCount, 0);
    const ranked = [...populated].sort((a, b) => b.recordCount - a.recordCount);
    const top = ranked.slice(0, 3).map((m) => `${m.title} (${m.recordCount})`);
    // "Largest: Finance (1), CRM (1), Quotes (1)" is nonsense — with every
    // count equal there is no largest, and naming one implies a ranking the
    // data does not support. Say "Across" when nothing actually leads.
    const hasLeader = ranked.length > 1 && ranked[0]!.recordCount > ranked[1]!.recordCount;
    const lead = hasLeader ? 'Largest' : 'Across';
    const more = populated.length > top.length ? `, and ${populated.length - top.length} more` : '';
    out.push({
      key: 'system.data',
      label: 'Your data',
      value: `${total.toLocaleString()} record${total === 1 ? '' : 's'} across ${populated.length} area${populated.length === 1 ? '' : 's'}`,
      status: 'system_derived',
      source: `Counted from your records. ${lead}: ${top.join(', ')}${more}.`,
      updatedAt: at,
    });
  }
  if (inputs.connectedAccounts.length > 0) {
    const providers = [...new Set(inputs.connectedAccounts.map((a) => a.provider))].sort();
    out.push({
      key: 'system.connections',
      label: 'Connected',
      value: providers.join(', '),
      status: 'connected',
      source: `${inputs.connectedAccounts.length} authenticated account${inputs.connectedAccounts.length === 1 ? '' : 's'} reporting a healthy state.`,
      updatedAt: at,
    });
  }
  return out;
}

/**
 * The patch a correction sends. `corrected` is a distinct provenance from
 * `stated` on purpose: it records that NeuroPause had it wrong first.
 */
export function correctionPatch(
  attribute: UnderstandingAttribute,
  newValue: string,
  at: string,
): UnderstandingAttribute {
  const trimmed = newValue.trim();
  return {
    ...attribute,
    value: trimmed || attribute.value,
    status: 'corrected',
    source:
      attribute.status === 'inferred'
        ? `You corrected this. NeuroPause had inferred “${attribute.value}”.`
        : 'You corrected this.',
    updatedAt: at,
  };
}

/**
 * Confirming an inference promotes it to `stated` — the ONE place an inference
 * is allowed to become a fact, and only because a person said so. The old
 * inferred value is kept in the source line so the promotion stays auditable.
 */
export function confirmationPatch(
  attribute: UnderstandingAttribute,
  at: string,
): UnderstandingAttribute {
  return {
    ...attribute,
    status: 'stated',
    source: `You confirmed this. ${attribute.source}`,
    updatedAt: at,
  };
}

/** A new attribute a person adds by hand. Always `stated`. */
export function manualAttribute(label: string, value: string, at: string): UnderstandingAttribute {
  return {
    key: `user.${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'}`,
    label: label.trim(),
    value: value.trim(),
    status: 'stated',
    source: 'You added this.',
    updatedAt: at,
  };
}

/** Derived attributes are computed each load; they are never user-editable. */
export function isEditable(attribute: UnderstandingAttribute): boolean {
  return attribute.status !== 'system_derived' && attribute.status !== 'connected';
}
