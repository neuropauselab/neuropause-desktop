/**
 * NP-016 — RULING-2 CANONICAL ALIASES (ARCHITECTURE-SPEC §24–26).
 *
 * The spec names capabilities and connectors in a namespaced form
 * (`NP-CON-M365-000001`, `NP-CAP-M365-MAIL-SEND-0001`); this system names them
 * flatly (`microsoft-entra`, `mail.send`). The operator's Ruling 2 settled the
 * relationship: the namespaced scheme applies to NEW connectors and
 * capabilities from the ladder onward, existing identifiers STAY, and the two
 * are related by an alias — never by a rename. No mass rename, ever.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD: **an alias is a naming projection
 * and grants nothing.** Resolving `NP-CAP-M365-MAIL-SEND-0001` yields the
 * string `mail.send` and no authority, no certification, no admission — every
 * predicate in the system continues to key on the EXISTING id it always used
 * (`mutationAssuranceFor`, `isCertifiedConsequential`), which is why this
 * module sits ABOVE them and is imported by neither. Spec §24 is explicit that
 * a connector id "does not mean authorized / connected / consented / paid /
 * certified"; an alias of that id cannot mean more than the id.
 *
 * WHY ONLY TWO ROWS. Ruling 2 says existing ids are aliased "in the registry
 * when it lands". Assigning canonical NUMBERS to the other 21 connectors and
 * 33 M365 actions is a REGISTRY decision, not a fact about this system — and
 * minting fifty identifiers nobody ruled on is invention, which the
 * source-integrity rule forbids. So this table covers exactly what is both
 * real today and exemplified by the spec: the certified vertical. Everything
 * else stays unaliased and says so (`canonicalFor` answers null), until the
 * registry slice assigns them.
 *
 * PURE: no I/O, no governance import, no runtime dependency on the connector
 * registry (the alias TARGETS are pinned against the real registries by test,
 * so a drifted id fails a test rather than silently aliasing nothing).
 */

export interface CanonicalAlias {
  /** The spec-shaped canonical name (§24–25). */
  readonly canonical: string;
  /** The identifier this system actually uses, and keeps using. */
  readonly existing: string;
  readonly kind: 'connector' | 'capability';
  /** Why this row exists — the spec section it comes from and the reality it names. */
  readonly note: string;
}

export const CANONICAL_ALIASES: readonly CanonicalAlias[] = [
  {
    canonical: 'NP-CON-M365-000001',
    existing: 'microsoft-entra',
    kind: 'connector',
    note:
      'ARCHITECTURE-SPEC §24 example. NOTE the reality it names: there is no separate microsoft-365 ' +
      'connector — Outlook mail and calendar ride the microsoft-entra identity connector on one Graph ' +
      'token, so the M365-shaped canonical name aliases an IDENTITY-DIRECTORY connector.',
  },
  {
    canonical: 'NP-CAP-M365-MAIL-SEND-0001',
    existing: 'mail.send',
    kind: 'capability',
    note:
      'ARCHITECTURE-SPEC §25 example. The single certified consequential capability. Its sibling actions ' +
      'on the same connector are deliberately NOT aliased here: §25\'s whole point is that the connector ' +
      'does not carry its capabilities\' standing.',
  },
];

/** The canonical name for an existing id, or null when none has been assigned. */
export function canonicalFor(existing: string): string | null {
  return CANONICAL_ALIASES.find((a) => a.existing === existing)?.canonical ?? null;
}

/** The existing id for a canonical name, or null. Deny-by-default: never a guess. */
export function existingFor(canonical: string): string | null {
  return CANONICAL_ALIASES.find((a) => a.canonical === canonical)?.existing ?? null;
}
