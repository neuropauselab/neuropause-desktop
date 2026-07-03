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
