import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore, DEFAULT_WORKSPACE_ID } from './workspaceStore';
import { ORG_ID } from '../org/seed';

const opened: WorkspaceStore[] = [];
const paths: string[] = [];

function tempPath(): string {
  const p = join(tmpdir(), `nps-ws-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

async function newStore(path: string): Promise<WorkspaceStore> {
  const s = new WorkspaceStore(path);
  opened.push(s);
  await s.load();
  return s;
}

afterEach(async () => {
  for (const s of opened.splice(0)) await s.flush();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

describe('WorkspaceStore', () => {
  it('seeds a default isolated workspace bound to the seeded org', async () => {
    const s = await newStore(tempPath());
    const active = s.active();
    expect(active.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(active.organizationId).toBe(ORG_ID);
    expect(active.isolation).toBe('isolated');
    expect(s.list().length).toBe(1);
  });

  it('creates and switches workspaces', async () => {
    const s = await newStore(tempPath());
    const ws = s.create('Acme Corp', 'org-acme');
    expect(s.list().length).toBe(2);
    expect(s.activeWorkspaceId()).toBe(DEFAULT_WORKSPACE_ID);

    const switched = s.switch(ws.id);
    expect(switched?.id).toBe(ws.id);
    expect(s.active().id).toBe(ws.id);
    expect(s.active().organizationId).toBe('org-acme');
  });

  it('returns null when switching to an unknown workspace', async () => {
    const s = await newStore(tempPath());
    expect(s.switch('nope')).toBeNull();
  });

  it('persists workspaces and the active selection across reloads', async () => {
    const path = tempPath();
    const s1 = await newStore(path);
    const ws = s1.create('Second', 'org-2');
    s1.switch(ws.id);
    s1.rename(ws.id, 'Second Renamed');
    await s1.flush();

    const s2 = await newStore(path);
    expect(s2.list().length).toBe(2);
    expect(s2.active().id).toBe(ws.id);
    expect(s2.active().name).toBe('Second Renamed');
  });
});

// GATE 23 — workspace names are unique case-insensitively WITHIN a tenant.
describe('WorkspaceStore — name uniqueness within a tenant (Gate 23)', () => {
  it('rejects a duplicate workspace name in the SAME tenant — fail closed', async () => {
    const s = await newStore(tempPath());
    s.create('Operations', 'org-acme');
    expect(() => s.create('Operations', 'org-acme')).toThrow(
      /A workspace named "Operations" already exists in this organization\./,
    );
    // The second create did not land — the tenant still has exactly one.
    expect(s.list().filter((w) => w.organizationId === 'org-acme')).toHaveLength(1);
  });

  it('ALLOWS the same workspace name in a DIFFERENT tenant', async () => {
    const s = await newStore(tempPath());
    const a = s.create('Operations', 'org-a');
    const b = s.create('Operations', 'org-b');
    expect(a.id).not.toBe(b.id);
    expect(a.organizationId).toBe('org-a');
    expect(b.organizationId).toBe('org-b');
  });

  it('rejects a case-insensitive / whitespace duplicate within the tenant', async () => {
    const s = await newStore(tempPath());
    s.create('Operations', 'org-acme');
    expect(() => s.create('  operations ', 'org-acme')).toThrow(/already exists/);
  });

  it('rejects a RENAME that collides with a sibling in the same tenant (case-insensitive)', async () => {
    const s = await newStore(tempPath());
    s.create('Operations', 'org-acme');
    const sales = s.create('Sales', 'org-acme');
    expect(() => s.rename(sales.id, 'operations')).toThrow(/already exists/);
    // The colliding rename did not apply — Sales keeps its name.
    expect(s.list().find((w) => w.id === sales.id)?.name).toBe('Sales');
  });

  it('allows a unique create + unique rename, and renaming a workspace to its OWN name (no self-collision)', async () => {
    const s = await newStore(tempPath());
    const ws = s.create('Projects', 'org-acme');
    const renamed = s.rename(ws.id, 'Projects 2026');
    expect(renamed?.name).toBe('Projects 2026');
    // A workspace may keep (or re-case) its own name — it is not its own sibling.
    expect(() => s.rename(ws.id, 'projects 2026')).not.toThrow();
    // And a name used only in ANOTHER tenant is free here.
    s.create('Ops-B', 'org-b');
    expect(() => s.rename(ws.id, 'Ops-B')).not.toThrow();
  });
});
