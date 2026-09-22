/**
 * TEST FIXTURES — NOT PRODUCTION TERMS, NOT A LEGAL ARTEFACT.
 *
 * NP-PILOT-FIRST-004 §5 Q1, verbatim: the implementation "may use a clearly labelled
 * test/draft fixture for automated testing" and "that fixture must never be accepted as
 * production/real-participant terms."
 *
 * This file exists so the test suite can exercise consent binding, and for no other reason.
 * Everything in it is deliberately marked so that it cannot be mistaken for real terms:
 *
 *   - the version string begins with `TEST-FIXTURE-`
 *   - the content reference points at this file, not at a published document
 *   - the digest is a literal marker, not a hash of any real terms text
 *
 * The production registry (`pilot_terms`) ships EMPTY from migration 0016. Nothing here is
 * inserted by the migration, by a seed script, or by any production code path — it is
 * reachable only from tests that import it explicitly.
 *
 * REAL ENROLLMENT REMAINS BLOCKED until a human publishes authoritative terms.
 */
import type { PilotControl, PilotTerms } from './types';

export const TEST_TERMS_VERSION = 'TEST-FIXTURE-terms-v1';

export const TEST_TERMS: PilotTerms = {
  id: '00000000-0000-4000-8000-0000000000t1'.replace('t1', '0001'),
  version: TEST_TERMS_VERSION,
  status: 'PUBLISHED',
  digest: 'TEST-FIXTURE-DIGEST-NOT-A-REAL-HASH',
  contentReference: 'apps/backend/src/pilot/testFixtures.ts (TEST FIXTURE — NOT PUBLISHED TERMS)',
  publishedAt: '2026-01-01T00:00:00.000Z',
};

export const TEST_TERMS_DRAFT: PilotTerms = {
  ...TEST_TERMS,
  id: '00000000-0000-4000-8000-000000000002',
  version: 'TEST-FIXTURE-terms-draft',
  status: 'DRAFT',
  publishedAt: null,
};

export const TEST_TERMS_RETIRED: PilotTerms = {
  ...TEST_TERMS,
  id: '00000000-0000-4000-8000-000000000003',
  version: 'TEST-FIXTURE-terms-retired',
  status: 'RETIRED',
};

/**
 * Put a memory repository into a state where enrollment is possible, so that tests about
 * OTHER behaviour are not all blocked on the two governance gates.
 *
 * `cap` has no default that means "unlimited": a test must say what boundary it is exercising,
 * exactly as production must be told what boundary a human approved.
 */
export function seedPilotFixtures(
  repo: { terms: PilotTerms[]; control: PilotControl },
  opts: { cap?: number; terms?: PilotTerms[] } = {},
): void {
  // COPIES, not the shared constants. A test that mutates a terms row - which is exactly what
  // the digest-mismatch and re-publication cases must do - would otherwise poison every later
  // test in the file, because `push` stores the reference. Found the hard way: a mutation in
  // one case made an unrelated CONTROL test fail three describes later.
  repo.terms.push(...(opts.terms ?? [TEST_TERMS, TEST_TERMS_DRAFT, TEST_TERMS_RETIRED]).map((t) => ({ ...t })));
  repo.control.maxParticipants = opts.cap ?? 100;
}
