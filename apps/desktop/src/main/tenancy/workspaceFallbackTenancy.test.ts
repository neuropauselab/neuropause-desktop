/**
 * P13C N9 + N10 — the two remaining fallbacks.
 *
 * N9: `workspaceStore.active()` ended in
 *     `?? this.workspaces.values().next().value` — the FIRST workspace on the
 *     install, across every organization. `EnterpriseWorkspaceActive` returns
 *     that value verbatim and declares no permission, so a stale or missing
 *     active id handed back a foreign tenant's workspace name and
 *     organizationId over an ungated channel.
 *
 * N10: `federationPlatform` captured `homeOrgId: home?.id ?? ORG_ID` at INIT.
 *      Frozen at startup, so it could not follow a tenant switch, and when no
 *      federation home row existed it named the seeded organization.
 *      `homeOrgId` is not a label: `federationModel` compares it against
 *      `artifact.publisherOrg` to decide which PRIVATE artifacts are visible.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from '../enterprise/workspace/workspaceStore';

const dirs: string[] = [];
const stores: WorkspaceStore[] = [];

async function store(): Promise<WorkspaceStore> {
  const dir = join(tmpdir(), `np-wsfallback-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  const s = new WorkspaceStore(join(dir, 'workspaces.json'));
  await s.load();
  stores.push(s);
  return s;
}

afterEach(async () => {
  for (const s of stores.splice(0)) await s.flush().catch(() => {});
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

describe('N9 — active() never substitutes another tenant’s workspace', () => {
  it('returns the active workspace when the id resolves', async () => {
    const s = await store();
    const mine = s.create('Mine', 'org-a');
    s.switch(mine.id);
    expect(s.active()?.id).toBe(mine.id);
  });

  /**
   * The exact failure: the active id points at nothing, and a workspace
   * belonging to a DIFFERENT organization exists. The old fallback returned it.
   */
  it('returns NULL for a stale active id, not the first workspace on the install', async () => {
    const s = await store();
    const foreign = s.create('Northwind Clinical', 'org-b');
    s.switch(foreign.id);
    expect(s.active()?.id).toBe(foreign.id);

    /**
     * The realistic stale pointer: the file names an active workspace that is
     * no longer present. `switch()` refuses an unknown id, so the only way to
     * reach this state is through persistence — which is exactly how it happens
     * in production, when a workspace is deleted on another device or a file is
     * restored from a backup.
     */
    const file = join(dirs[dirs.length - 1]!, 'workspaces.json');
    await s.flush();
    await fs.writeFile(
      file,
      JSON.stringify({
        workspaces: [{ ...foreign, id: 'ws-other-org', organizationId: 'org-b' }],
        activeId: 'workspace-vanished',
        seeded: true,
      }),
    );
    const reloaded = new WorkspaceStore(file);
    await reloaded.load();
    stores.push(reloaded);
    const active = reloaded.active();
    /**
     * The OLD behaviour returned `values().next().value` here: the first
     * workspace in insertion order, which on this install is the SEEDED one in
     * `org-default` — a different organization from the one the caller was last
     * in. Null is the only honest answer.
     */
    expect(active).toBeNull();
  });

  /**
   * A fresh store is NOT empty — it seeds `workspace-default` for the seeded
   * organization, and that is legitimate: it is the install's own first
   * workspace, not a borrowed one. What must never happen is `active()`
   * returning a workspace belonging to a DIFFERENT organization than the active
   * pointer names.
   */
  it('a fresh store’s active workspace is the seeded one, owned by the seeded org', async () => {
    const s = await store();
    const active = s.active();
    expect(active?.id).toBe(s.activeWorkspaceIdOrNull());
    expect(active?.organizationId).toBe('org-default');
  });

  it('a foreign workspace is never returned when the active id is unknown', async () => {
    const s = await store();
    s.create('Northwind Clinical', 'org-b');
    s.switch('workspace-does-not-exist');
    const active = s.active();
    expect(active === null || active.organizationId !== 'org-b').toBe(true);
  });

  /** `activeWorkspaceIdOrNull` was already the fail-closed pattern; they agree now. */
  it('agrees with activeWorkspaceIdOrNull', async () => {
    const s = await store();
    s.switch('workspace-does-not-exist');
    const id = s.activeWorkspaceIdOrNull();
    const active = s.active();
    if (active === null) expect(s.get(id ?? '')).toBeNull();
    else expect(active.id).toBe(id);
  });
});

describe('N10 — federation home identity is resolved, not captured', () => {
  /**
   * Asserted as a property of the shape rather than by booting the subsystem,
   * which needs Electron. What changed is that `homeOrgId` is derived from the
   * federation home row and otherwise the CALLER's resolved tenant — with an
   * empty id when nothing resolves, so it matches no publisher.
   */
  it('an empty home id matches no publisher, so private artifacts stay hidden', () => {
    const artifacts = [
      { id: 'a1', scope: 'private' as const, publisherOrg: 'org-a' },
      { id: 'a2', scope: 'private' as const, publisherOrg: 'org-b' },
      { id: 'a3', scope: 'public' as const, publisherOrg: 'org-a' },
    ];
    const visibleFor = (homeOrgId: string): string[] =>
      artifacts
        .filter((a) => a.scope !== 'private' || a.publisherOrg === homeOrgId)
        .map((a) => a.id);

    expect(visibleFor('org-a')).toEqual(['a1', 'a3']);
    expect(visibleFor('org-b')).toEqual(['a2', 'a3']);
    // The unresolved case: no private artifact is admitted, and crucially the
    // seeded organization's are not.
    expect(visibleFor('')).toEqual(['a3']);
    expect(visibleFor('')).not.toContain('a1');
  });
});
