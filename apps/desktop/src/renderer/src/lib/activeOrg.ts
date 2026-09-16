/**
 * P13C ROUND 36 — GATE 15. ONE RESOLVER FOR "WHICH CLOUD ORG AM I IN?".
 *
 * Four screens carried the same two defects, found by the round-36 sweep:
 *
 *  1. `ipc.org.list().catch(() => [])` — "the org service is down" rendered as
 *     "you have no organization", and in two of the four the UI then steered
 *     the user toward a WRONG ACTION: Feature Flags fell back to free-tier
 *     entitlements for a paying customer, and Subscription offered the
 *     create-your-first-org wizard to someone who already has one. This
 *     resolver never swallows: a failed list THROWS into the caller's
 *     existing error state.
 *
 *  2. `orgs[0]` — the P13C FINDING-6 bug (first org in the list), which on a
 *     multi-organization account is simply another organization's data.
 *     `AdministrationView` fixed it by name-matching against the ACTIVE local
 *     organization with null-on-ambiguity; this is that rule, shared.
 */
import type { CloudOrganizationSummary } from '@neuropause/shared';
import { ipc } from './ipc';

export interface ActiveCloudOrg {
  orgs: CloudOrganizationSummary[];
  /**
   * The caller's active organization, or null. Null with `orgs.length > 0`
   * means AMBIGUOUS — the screen must say it could not determine the active
   * organization, never guess one and never claim there are none.
   */
  active: CloudOrganizationSummary | null;
}

export async function fetchActiveCloudOrg(): Promise<ActiveCloudOrg> {
  // Deliberately un-caught: the caller's error state is the only honest sink.
  const orgs = await ipc.org.list();
  if (orgs.length === 0) return { orgs, active: null };
  if (orgs.length === 1) return { orgs, active: orgs[0] };

  // Multi-org: resolve by name against the active LOCAL organization (the
  // cloud and local id spaces differ). The local read is best-effort — its
  // failure degrades to "ambiguous", never to a guess.
  const localOrgs = await ipc.enterprise.organizations().catch(() => null);
  const activeLocalName = localOrgs?.find((o) => o.active)?.name ?? null;
  const matches = activeLocalName === null ? [] : orgs.filter((o) => o.name === activeLocalName);
  return { orgs, active: matches.length === 1 ? matches[0] : null };
}

/** The message a screen shows for the ambiguous case. One copy, not four. */
export const AMBIGUOUS_ORG_MESSAGE =
  'Your account belongs to several organizations and the active one could not be determined. Open Administration to check the active organization.';
