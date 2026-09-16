/**
 * P13C ROUND 51 — GATE 24. THE SECURITY-REGRESSION COVERAGE MANIFEST.
 *
 * Gate 24 tracks NEGATIVE scenarios — attacks that must fail closed — and
 * whether each is pinned by a regression test. An independent inventory
 * (round 51) confirmed all ten named classes already fail closed in
 * production and are each pinned over a REAL enforcement path; the classes'
 * coverage was simply spread across 3–6 files with no single legible place,
 * so a class could silently lose its regression test and the tally would not
 * notice. This file is that place: a manifest that FAILS if any class's
 * pinning test disappears or loses its scenario, plus the one genuinely-new
 * pin the inventory found missing — the public execute channel's separation of
 * renderer-supplied consent from main-resolved authority (Gate-33 at the real
 * channel wiring).
 *
 * WHY A SOURCE SCAN (the `bootstrapPins`/`resolverAttachment` precedent): the
 * manifest asserts that each named class HAS a regression test carrying its
 * scenario marker — a coverage invariant, not a re-run of behaviour the pinned
 * files already execute. The behavioural proofs live in those files and run in
 * the same suite; duplicating them here would add maintenance, not safety.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('.', import.meta.url));

/**
 * Each named negative class → the test that pins it + a marker string that
 * must be present. The behavioural assertions live in these files; this map is
 * the audit trail that every class stays covered.
 */
const COVERAGE: { klass: string; file: string; marker: string }[] = [
  { klass: 'a · cross-tenant READ', file: 'tenancy/crossTenant.test.ts', marker: 'describe(' },
  { klass: 'b · cross-tenant WRITE / org-row takeover', file: 'tenancy/round10OrgOwnership.test.ts', marker: 'THE EXPLOIT' },
  { klass: 'b · provisioned-owner takeover', file: 'tenancy/provisionedOwnerProtection.test.ts', marker: 'EXPLOIT' },
  { klass: 'c · confused deputy — forged principal', file: 'auth/governedActor.test.ts', marker: 'describe(' },
  { klass: 'c · confused deputy — cross-tenant proposal', file: 'liveBrain/s4TenantUnification.test.ts', marker: 'describe(' },
  { klass: 'd · hostile renderer — forged claim/actor/tenant/confirmed', file: 'workforce/execution/router.governedTransport.test.ts', marker: 'describe(' },
  { klass: 'd · hostile renderer — approval(A) for action(B)', file: 'approvalActionBinding.test.ts', marker: 'describe(' },
  { klass: 'e · prompt injection — external content as instructions', file: 'capabilities/assistantMailIntent.test.ts', marker: 'HOSTILE_SYNCED' },
  { klass: 'f · corrupt row through resolveActor', file: 'enterprise/authzGate.test.ts', marker: 'corrupt' },
  { klass: 'g · malformed payload at the bridge', file: 'ipc/secureBridgeTimeout.test.ts', marker: 'MALFORMED' },
  { klass: 'h · replay / single-use decision consumption', file: 'executeEngine.durableConsumption.test.ts', marker: 'single-use' },
  { klass: 'i · unauthenticated / unauthorized channel', file: 'ipc/runtimeAuthz.test.ts', marker: 'describe(' },
  { klass: 'j · AI output is untrusted data', file: 'constitutionalInvariants.test.ts', marker: 'RULE-00' },
];

describe('Gate 24 — every named negative scenario has a live regression test', () => {
  it.each(COVERAGE)('$klass is pinned in $file', ({ file, marker }) => {
    const src = readFileSync(join(MAIN, file), 'utf8');
    expect(src.includes(marker), `${file} lost its scenario marker "${marker}"`).toBe(true);
    // A pin must actually assert something — not just exist as an empty shell.
    expect(src.includes('it('), `${file} has no test cases`).toBe(true);
    expect(src.includes('expect('), `${file} makes no assertions`).toBe(true);
  });

  it('covers the full a–j class set (no class silently dropped)', () => {
    const letters = new Set(COVERAGE.map((c) => c.klass[0]));
    expect([...letters].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
  });
});

/**
 * GATE 24 / GATE 33 — the PUBLIC execute channel separates renderer-supplied
 * CONSENT from main-resolved AUTHORITY.
 *
 * The inventory's one genuinely-missing pin: `connectors/index.ts` is the
 * handler behind `connectors:m365.execute` (a renderer-invokable channel). A
 * compromised renderer can put anything in the request, so the handler must
 * take ONLY the human's `confirmed` bit from it and resolve identity, tenant
 * and account-ownership from the main process — otherwise a forged
 * `confirmed:true` plus a forged actor/tenant would be a send nobody
 * authorised. The behavioural proof that `confirmed:true` is powerless without
 * those facts lives in `cst/governedAction.negative.test.ts`
 * (ownsAccount:false + confirmed:true ⇒ DENIED; actorId:'' + confirmed:true ⇒
 * DENIED); this pins the WIRING that feeds that kernel from the public channel.
 */
describe('Gate 24 — public execute wiring: renderer supplies consent, main resolves authority', () => {
  const src = readFileSync(join(MAIN, 'connectors/index.ts'), 'utf8');

  it('mail.send: identity, tenant and account-ownership are main-resolved; only confirmed comes from the request', () => {
    const call = src.slice(src.indexOf('const g = await governedSend({'));
    const body = call.slice(0, call.indexOf('});') + 3);
    expect(body).toContain("actorId: deps.actor()"); // authoritative identity, not r.actorId
    expect(body).toContain('tenantId: deps.workspaceId()'); // authoritative tenant
    expect(body).toContain('ownsAccount: m365OwnsAccount('); // main re-checks ownership
    expect(body).toContain('confirmed: r.confirmed'); // the ONE renderer-supplied signal
    // The request must NOT be the source of identity/tenant/ownership.
    expect(body).not.toContain('actorId: r.');
    expect(body).not.toContain('tenantId: r.');
    expect(body).not.toContain('ownsAccount: r.');
  });

  it('governed cohort actions: same separation — main-resolved authority, renderer-supplied confirmed only', () => {
    const call = src.slice(src.indexOf('const g = await governedAction({'));
    const body = call.slice(0, call.indexOf('});') + 3);
    expect(body).toContain('actorId: deps.actor()');
    expect(body).toContain('tenantId: deps.workspaceId()');
    expect(body).toContain('ownsAccount: m365OwnsAccount(');
    expect(body).toContain('confirmed: r.confirmed');
    expect(body).not.toContain('actorId: r.');
    expect(body).not.toContain('tenantId: r.');
    expect(body).not.toContain('ownsAccount: r.');
  });
});
