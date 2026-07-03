import { describe, expect, it } from 'vitest';
import { MigrationEngine, type MigrationDefinition, type MigrationEngineDeps } from './migrationEngine';

function makeDeps(overrides: Partial<MigrationEngineDeps> = {}): {
  deps: MigrationEngineDeps;
  state: { version: number; applied: string[]; backups: number; restores: number };
} {
  const state = { version: 0, applied: [] as string[], backups: 0, restores: 0 };
  const deps: MigrationEngineDeps = {
    getCurrentVersion: async () => state.version,
    setCurrentVersion: async (v) => {
      state.version = v;
    },
    definitions: [],
    backup: async () => {
      state.backups += 1;
      return `backup-${state.backups}`;
    },
    restore: async () => {
      state.restores += 1;
    },
    context: { dataDir: '/tmp', log: () => undefined },
    now: () => 1_000,
    ...overrides,
  };
  return { deps, state };
}

const def = (id: string, toVersion: number, up: () => void): MigrationDefinition => ({
  id,
  domain: 'configuration',
  toVersion,
  up,
});

describe('MigrationEngine', () => {
  it('reports up-to-date status when no migration is pending', async () => {
    const { deps } = makeDeps({ definitions: [], getCurrentVersion: async () => 1 });
    const status = await new MigrationEngine(deps).status();
    expect(status).toMatchObject({ currentVersion: 1, targetVersion: 0, pending: 0, upToDate: true });
  });

  it('runs pending migrations in ascending version order and stamps the version', async () => {
    const order: string[] = [];
    const { deps, state } = makeDeps({
      definitions: [
        def('c', 3, () => order.push('c')),
        def('a', 1, () => order.push('a')),
        def('b', 2, () => order.push('b')),
      ],
    });
    const report = await new MigrationEngine(deps).run();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(report.ok).toBe(true);
    expect(report.fromVersion).toBe(0);
    expect(report.toVersion).toBe(3);
    expect(state.version).toBe(3);
    expect(report.steps.map((s) => s.status)).toEqual(['applied', 'applied', 'applied']);
  });

  it('takes exactly one backup before running', async () => {
    const { deps, state } = makeDeps({ definitions: [def('a', 1, () => undefined), def('b', 2, () => undefined)] });
    await new MigrationEngine(deps).run();
    expect(state.backups).toBe(1);
  });

  it('does not execute or back up on a dry run', async () => {
    let ran = false;
    const { deps, state } = makeDeps({ definitions: [def('a', 1, () => (ran = true))] });
    const report = await new MigrationEngine(deps).run({ dryRun: true });
    expect(ran).toBe(false);
    expect(state.backups).toBe(0);
    expect(state.version).toBe(0);
    expect(report.steps[0].status).toBe('pending');
  });

  it('restores the backup and reverts the version when a step fails', async () => {
    const { deps, state } = makeDeps({
      definitions: [
        def('a', 1, () => undefined),
        def('b', 2, () => {
          throw new Error('boom');
        }),
        def('c', 3, () => undefined),
      ],
    });
    const report = await new MigrationEngine(deps).run();
    expect(report.ok).toBe(false);
    expect(report.recovered).toBe(true);
    expect(state.restores).toBe(1);
    expect(state.version).toBe(0); // reverted to the pre-migration version
    const statuses = report.steps.map((s) => s.status);
    expect(statuses).toEqual(['applied', 'failed', 'rolledBack']);
  });

  it('only considers migrations newer than the current version', async () => {
    const ran: string[] = [];
    const { deps } = makeDeps({
      getCurrentVersion: async () => 2,
      definitions: [
        def('old', 1, () => ran.push('old')),
        def('current', 2, () => ran.push('current')),
        def('new', 3, () => ran.push('new')),
      ],
    });
    await new MigrationEngine(deps).run();
    expect(ran).toEqual(['new']);
  });
});
