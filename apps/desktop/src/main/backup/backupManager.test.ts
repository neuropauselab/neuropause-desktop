import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupManager } from './backupManager';

let root: string;
let dataDir: string;
let backupsDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'np-backup-'));
  dataDir = join(root, 'data');
  backupsDir = join(root, 'backups');
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function manager(now = () => 1_700_000_000_000): BackupManager {
  return new BackupManager({ dataDir, backupsDir, appVersion: '1.0.0', dataVersion: () => 1, now });
}

async function write(rel: string, content: string): Promise<void> {
  const path = join(dataDir, rel);
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, content);
}

describe('BackupManager', () => {
  // Phase 8 (8.2): the business domain's prefix pattern captures every
  // enterprise-module store live at snapshot time — and restore brings the
  // records back byte-for-byte. This is the data-loss-class fix under test.
  it('backs up and restores ALL enterprise-module stores via the business prefix', async () => {
    await write('enterprise-module-finance.json', '{"records":[{"id":"inv-1"}]}');
    await write('enterprise-module-hr-employees.json', '{"records":[{"id":"emp-1"}]}');
    await write('unrelated.json', '{}'); // not covered — never captured
    const info = await manager().create('manual', ['business']);
    expect(info.domains).toEqual(['business']);
    const listedFiles = (await manager().validate(info.id)).checked;
    expect(listedFiles).toBe(2);
    // Simulate the failure mode Phase 8 exists to prevent: business data wiped.
    await write('enterprise-module-finance.json', '{"records":[]}');
    // Later clock: the pre-restore safety snapshot must get its own id, not
    // collide with (and overwrite) the backup being restored.
    const result = await manager(() => 1_700_000_100_000).restore(info.id, ['business']);
    expect(result.ok).toBe(true);
    const restored = await fs.readFile(join(dataDir, 'enterprise-module-finance.json'), 'utf8');
    expect(restored).toContain('inv-1');
  });

  it('snapshots only the files that exist and records them in the manifest', async () => {
    await write('registry.json', '{"installs":[]}');
    await write('graph.json', '{"nodes":[]}');
    const info = await manager().create('manual', ['registry', 'knowledgeGraph']);
    expect(info.domains.sort()).toEqual(['knowledgeGraph', 'registry']);
    expect(info.sizeBytes).toBeGreaterThan(0);
    const listed = await manager().list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(info.id);
  });

  it('validates a clean backup and detects tampering', async () => {
    await write('registry.json', '{"installs":[1]}');
    const info = await manager().create('manual', ['registry']);

    const clean = await manager().validate(info.id);
    expect(clean.valid).toBe(true);
    expect(clean.checked).toBe(1);

    // Tamper with the stored copy.
    await fs.writeFile(join(backupsDir, info.id, 'data', 'registry.json'), 'corrupted');
    const dirty = await manager().validate(info.id);
    expect(dirty.valid).toBe(false);
    expect(dirty.mismatched).toContain('registry.json');
  });

  it('restores a backup and snapshots a safety backup first', async () => {
    await write('registry.json', 'ORIGINAL');
    const info = await manager().create('manual', ['registry']);

    // Mutate live data after the backup.
    await write('registry.json', 'CHANGED');
    const result = await manager(() => 1_700_000_111_000).restore(info.id);

    expect(result.ok).toBe(true);
    expect(result.restored).toContain('registry');
    expect(result.safetyBackupId).not.toBeNull();
    expect(await fs.readFile(join(dataDir, 'registry.json'), 'utf8')).toBe('ORIGINAL');

    // The safety backup captured the CHANGED state.
    const safety = await manager().validate(result.safetyBackupId as string);
    expect(safety.valid).toBe(true);
  });

  it('selectively restores only the requested domains', async () => {
    await write('registry.json', 'REG-ORIG');
    await write('memory.json', 'MEM-ORIG');
    const info = await manager().create('manual', ['registry', 'aiMemory']);

    await write('registry.json', 'REG-NEW');
    await write('memory.json', 'MEM-NEW');

    const result = await manager(() => 1_700_000_222_000).restore(info.id, ['registry']);
    expect(result.restored).toEqual(['registry']);
    expect(await fs.readFile(join(dataDir, 'registry.json'), 'utf8')).toBe('REG-ORIG'); // restored
    expect(await fs.readFile(join(dataDir, 'memory.json'), 'utf8')).toBe('MEM-NEW'); // untouched
  });

  it('walks directory domains (timeline) into individual file entries', async () => {
    await write(join('timeline', 'part-1.ndjson'), 'a');
    await write(join('timeline', 'part-2.ndjson'), 'b');
    const info = await manager().create('manual', ['timeline']);
    const validation = await manager().validate(info.id);
    expect(validation.checked).toBe(2);
    expect(validation.valid).toBe(true);
  });

  it('deletes a backup', async () => {
    await write('registry.json', 'x');
    const info = await manager().create('manual', ['registry']);
    expect(await manager().delete(info.id)).toBe(true);
    expect(await manager().list()).toHaveLength(0);
  });
});
