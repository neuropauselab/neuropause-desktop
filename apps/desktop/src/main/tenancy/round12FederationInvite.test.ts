/**
 * P13C ROUND 12 — M-11. A DISPLAY NAME IS NOT AN IDENTIFIER.
 *
 * `inviteOrg` computed its target as `org-${slug(input.name)}` and wrote an
 * invitation to whatever that produced. So the recipient of a federation
 * invitation — a record that appears in another organization's inbox carrying an
 * attacker-chosen trust level and 500 characters of attacker-chosen message —
 * was selected by a string the caller typed.
 *
 * Real organization ids are `org_<uuid>` (`orgStore`), so the minted `org-<slug>`
 * space cannot intersect a genuine organization. There is exactly one exception,
 * and it is the one that matters: the seeded `org-default`, reachable by anyone
 * who types "Default".
 *
 * THE CODEBASE HAD ALREADY WRITTEN THIS DOWN. `tenancy/migrationInventory.ts`
 * has said since Round 4: *"`inviteOrg` derives the target organization id from
 * a display name, so the only ids it can address are hyphen-slugs — real
 * federation between two UI-created organizations is not currently
 * expressible."* Four rounds read that sentence and shipped, which is the same
 * shape as `drStore` (Round 4 prose, closed in Round 10) and
 * `connectorControlStore` (Round 8 prose, closed in Round 10). Prose is not a
 * boundary.
 *
 * WHAT WAS ALREADY SAFE, so this suite does not claim credit for it:
 * `respondInvitation` refuses `accept` unless `inv.toOrg === me`, and that is
 * regression-tested in `federationSweepTenancy.test.ts`. The sender could never
 * complete the federation alone. What it COULD do is write into a stranger's
 * inbox, and mint unbounded junk rows addressed to nobody.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { FederationRuntimeStore } from '../federation/runtime/fedStore';

let dir: string;
let fed: FederationRuntimeStore;
let who: TenantScope | null = null;

/** Real-shaped ids: `org_<uuid>`, which is what `orgStore` mints. */
const A = { tenantId: `org_${randomUUID()}`, workspaceId: 'ws-a' };
const B = { tenantId: `org_${randomUUID()}`, workspaceId: 'ws-b' };
const C = { tenantId: `org_${randomUUID()}`, workspaceId: 'ws-c' };

beforeEach(async () => {
  dir = join(tmpdir(), `np-r12-fed-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  // A is the home organization of this install.
  fed = new FederationRuntimeStore(join(dir, 'fed.json'), A.tenantId, 'Alpha').bindScope(() => who);
  await fed.load();
  who = null;
});
afterEach(async () => {
  // The store persists on a debounce, so a bare rm races the write it triggered.
  // Same retry the Round 10 org-ownership suite uses.
  await (fed as unknown as { flush?: () => Promise<void> }).flush?.();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
});

/** Put a real directory row in place, the way accepting an invitation does. */
function seedDirectory(id: string, name: string): void {
  (fed as unknown as { orgs: Map<string, unknown> }).orgs.set(id, {
    id,
    name,
    slug: name.toLowerCase(),
    role: 'peer',
    status: 'active',
    regionId: 'us-east',
    trustLevel: 'basic',
    joinedAt: new Date().toISOString(),
    sharedOut: 0,
    sharedIn: 0,
  });
}

describe('the target is resolved by ID, never minted from a name', () => {
  it('a resolvable peer CAN be invited — the gate is not "always no"', () => {
    seedDirectory(B.tenantId, 'Beta');
    who = A;
    const inv = fed.inviteOrg({ toOrg: B.tenantId, trustLevel: 'basic' });
    expect(inv.toOrg).toBe(B.tenantId);
    expect(inv.fromOrg).toBe(A.tenantId);
    // The name comes from the RESOLVED record, not from any payload.
    expect(inv.toOrgName).toBe('Beta');
  });

  it('an unresolvable id is REFUSED, and writes nothing', () => {
    who = A;
    const before = fed.listInvitations().length;
    expect(() => fed.inviteOrg({ toOrg: `org_${randomUUID()}`, trustLevel: 'full' })).toThrow(
      /not available to invite/,
    );
    expect(fed.listInvitations()).toHaveLength(before);
  });

  it('THE OLD ATTACK: a slugified display name no longer addresses anybody', () => {
    // `org-default` was the one real id the slug space could hit. Passing it as
    // an id now resolves against the directory and finds nothing.
    who = A;
    expect(() => fed.inviteOrg({ toOrg: 'org-default', trustLevel: 'full' })).toThrow(
      /not available to invite/,
    );
    expect(() => fed.inviteOrg({ toOrg: 'org-beta', trustLevel: 'full' })).toThrow(
      /not available to invite/,
    );
  });

  it('a caller cannot invite ITSELF — the reflexive case the accept guard missed', () => {
    // Self-invitation let a caller accept its own invitation (toOrg === me) and
    // overwrite its own directory row with an attacker-supplied name.
    who = A;
    expect(() => fed.inviteOrg({ toOrg: A.tenantId, trustLevel: 'full' })).toThrow(
      /not available to invite/,
    );
  });

  it('the refusal does not distinguish "no such org" from "not yours"', () => {
    // One message, so a caller cannot enumerate which ids exist on the install —
    // the same oracle `orgStore` and the runtime supervisor both refuse.
    who = A;
    const unknown = (() => {
      try {
        fed.inviteOrg({ toOrg: `org_${randomUUID()}`, trustLevel: 'basic' });
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    const mine = (() => {
      try {
        fed.inviteOrg({ toOrg: A.tenantId, trustLevel: 'basic' });
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    expect(unknown).toBe(mine);
    expect(unknown).not.toMatch(/exist|unknown|yourself|self|permission/i);
  });
});

describe('names cannot be used to steer the target', () => {
  it('two organizations sharing a display name stay distinct', () => {
    // Under slug-derivation both collapsed onto `org-acme`, so whichever tenant
    // held that id could accept an invitation intended for the other.
    seedDirectory(B.tenantId, 'Acme');
    seedDirectory(C.tenantId, 'Acme');
    who = A;
    const toB = fed.inviteOrg({ toOrg: B.tenantId, trustLevel: 'basic' });
    const toC = fed.inviteOrg({ toOrg: C.tenantId, trustLevel: 'basic' });
    expect(toB.toOrg).toBe(B.tenantId);
    expect(toC.toOrg).toBe(C.tenantId);
    expect(toB.toOrg).not.toBe(toC.toOrg);
  });

  it('renaming an organization does not move an existing invitation', () => {
    seedDirectory(B.tenantId, 'Beta');
    who = A;
    const inv = fed.inviteOrg({ toOrg: B.tenantId, trustLevel: 'basic' });
    seedDirectory(B.tenantId, 'Beta Renamed');
    const still = fed.listInvitations().find((i) => i.id === inv.id)!;
    // The id is the anchor. Under name-derivation the target silently orphaned.
    expect(still.toOrg).toBe(B.tenantId);
  });

  it('a removed organization cannot be invited afterwards', () => {
    seedDirectory(B.tenantId, 'Beta');
    who = A;
    expect(() => fed.inviteOrg({ toOrg: B.tenantId, trustLevel: 'basic' })).not.toThrow();
    (fed as unknown as { orgs: Map<string, unknown> }).orgs.delete(B.tenantId);
    expect(() => fed.inviteOrg({ toOrg: B.tenantId, trustLevel: 'basic' })).toThrow(
      /not available to invite/,
    );
  });
});

describe('the sender remains the caller, not the payload', () => {
  it('B inviting C is filed as from B, even though A is the home org', () => {
    seedDirectory(B.tenantId, 'Beta');
    seedDirectory(C.tenantId, 'Gamma');
    who = B;
    const inv = fed.inviteOrg({ toOrg: C.tenantId, trustLevel: 'basic' });
    expect(inv.fromOrg).toBe(B.tenantId);
    expect(inv.toOrg).toBe(C.tenantId);
  });

  it('an unresolved caller cannot invite at all', () => {
    seedDirectory(B.tenantId, 'Beta');
    who = null;
    expect(() => fed.inviteOrg({ toOrg: B.tenantId, trustLevel: 'basic' })).toThrow();
  });
});
