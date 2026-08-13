/**
 * P13C ROUND 10, FRESH RED TEAM — AUTHORITY MUST FOLLOW THE PRINCIPAL.
 *
 * Round 9's H5 was a STORE bound to the session-only resolver while its siblings
 * were principal-aware. Round 10 built `resolverAttachment.test.ts` to make that
 * impossible — and it only looked at `bindScope`, i.e. at DATA.
 *
 * The fresh red team then found the same defect one layer out, in the
 * AUTHORIZATION path:
 *
 *     const authorizationOrgId = () => tenantContext.resolveFull()…
 *
 * `tenantContext.resolveFull` reads the active workspace and knows nothing about
 * background principals, while every store in that subsystem resolves through
 * `activeTenantScope`, which prefers a principal. So inside `runAsPrincipal`,
 * DATA resolved to the principal's organization and AUTHORITY resolved to the
 * session's.
 *
 * The companion gateway runs every LAN request under a principal derived from
 * the paired device's `boundTenantId` and dispatches module writes through it. A
 * person who is Admin in org A and read-only in org B could therefore write in B
 * from a B-bound phone while A was on screen: B's own revocation of their write
 * right was simply not the thing being consulted.
 *
 * These tests pin the PRIMITIVE — that the two resolvers diverge under a
 * principal, and that the one authorization uses is the principal-aware one.
 * They deliberately do not boot `initEnterprise`, which needs Electron and most
 * of the app; the binding itself is asserted as a source invariant in
 * `resolverAttachment.test.ts`. That split is a real limitation and is stated
 * rather than hidden.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TenantScope } from '@neuropause/shared';
import { runAsPrincipal, tenantPrincipal, resolveTenantScope } from './backgroundPrincipal';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

describe('the two resolvers genuinely diverge — so choosing wrong is a real bug', () => {
  it('under a principal for A while the session is B, the raw resolver still says B', () => {
    const session = () => B;
    const principal = tenantPrincipal({ jobId: 'companion', scope: A })!;

    runAsPrincipal(principal, () => {
      // What `activeTenantScope` answers — the principal.
      expect(resolveTenantScope(session)?.tenantId).toBe('org-a');
      // What `tenantContext.scope` would answer — the session. THIS is what
      // `authorizationOrgId` used to read.
      expect(session().tenantId).toBe('org-b');
    });
  });

  it('outside a principal the two agree, which is why this went unnoticed', () => {
    const session = () => B;
    expect(resolveTenantScope(session)?.tenantId).toBe('org-b');
    expect(session().tenantId).toBe('org-b');
  });

  it('a SYSTEM principal yields no tenant rather than falling back to the session', () => {
    // The subtle half: a present principal always wins, including when its scope
    // is null. Falling through would hand a global job the signed-in tenant.
    const session = () => B;
    const sys = tenantPrincipal({ jobId: 'x', scope: null });
    expect(sys).toBeNull(); // fail-closed: no tenant, no principal, no run
    expect(resolveTenantScope(session)?.tenantId).toBe('org-b');
  });
});

describe('the authorization path is bound to the principal-aware resolver', () => {
  const src = readFileSync(join(MAIN, 'enterprise/index.ts'), 'utf8');

  it('authorizationOrgId does not read the raw session resolver', () => {
    const fn = src.slice(src.indexOf('const authorizationOrgId'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(
      /tenantContext\s*\.\s*(?:resolveFull|resolve|scope)\b/.test(body),
      'authorizationOrgId must not resolve authority from the session while every store in ' +
        'this subsystem resolves data from the principal. That divergence let a companion ' +
        'device act in the tenant it was paired to under the permissions of the tenant on screen.',
    ).toBe(false);
    expect(body).toContain('activeTenantScope()');
  });

  /**
   * The platform-operator predicate was declared, documented, and NEVER PASSED.
   * `authzGate` has exactly one line that can satisfy a `cloud:operate`
   * permission, and its input was `undefined` — so every install-wide channel
   * this program spent four rounds moving onto platform authority refused
   * everyone, operators included. It failed CLOSED, which is why no isolation
   * test ever saw it, and it meant the whole platform-authority model was
   * unexercised.
   */
  it('createAuthorize receives an isPlatformOperator predicate', () => {
    const call = src.slice(src.indexOf('createAuthorize({'));
    const body = call.slice(0, call.indexOf('\n  });'));
    expect(
      body.includes('isPlatformOperator'),
      'Nothing passed isPlatformOperator, so cloud:operate refused every caller including ' +
        'platform operators — fail-closed, and the reason four rounds of platform-authority ' +
        'work had never once been exercised through it.',
    ).toBe(true);
  });

  it('the composition root binds the operator registry to the gate', () => {
    const core = readFileSync(join(MAIN, 'runtimeCore.ts'), 'utf8');
    expect(core).toContain('enterprise.bindPlatformOperator(');
    // …and it happens after the registry has loaded, or the predicate answers
    // from an empty list.
    const load = core.indexOf('await platformOperators.load()');
    const bind = core.indexOf('enterprise.bindPlatformOperator(');
    expect(load).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(load);
  });
});

describe('the marketplace second door requires platform authority', () => {
  it('marketplace install no longer runs on an organization role', () => {
    const src = readFileSync(join(MAIN, 'marketplace/index.ts'), 'utf8');
    expect(
      /const INSTALL: EnterprisePermission = 'workforce:manage'/.test(src),
      'marketplace:install reaches the SAME installService.install as workforce:install, ' +
        'which requires cloud:operate. A family authz gate cannot see a handler registered ' +
        'outside its family, so the parity has to be asserted by resource.',
    ).toBe(false);
    expect(src).toContain("const INSTALL: EnterprisePermission = 'cloud:operate'");
  });
});
