import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPilotService, type PilotService } from './pilotService';

const T0 = new Date('2026-07-01T00:00:00.000Z');

describe('createPilotService', () => {
  let filePath: string;
  let clock: Date;
  let svc: PilotService;

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-pilot-${randomUUID()}.json`);
    clock = T0;
    svc = createPilotService({ filePath, now: () => clock });
    await svc.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('starts disabled with no timestamps', () => {
    expect(svc.getStatus()).toEqual({ enabled: false, joinedAt: null, leftAt: null });
  });

  it('joining stamps joinedAt once; re-enabling while on is a no-op', async () => {
    const on = await svc.setEnabled(true);
    expect(on).toEqual({ enabled: true, joinedAt: T0.toISOString(), leftAt: null });
    clock = new Date(T0.getTime() + 60_000);
    const again = await svc.setEnabled(true);
    expect(again.joinedAt).toBe(T0.toISOString());
  });

  it('leaving stamps leftAt and keeps the original joinedAt', async () => {
    await svc.setEnabled(true);
    clock = new Date(T0.getTime() + 60_000);
    const off = await svc.setEnabled(false);
    expect(off).toEqual({
      enabled: false,
      joinedAt: T0.toISOString(),
      leftAt: clock.toISOString(),
    });
  });

  it('rejoining clears leftAt and preserves the first joinedAt', async () => {
    await svc.setEnabled(true);
    clock = new Date(T0.getTime() + 60_000);
    await svc.setEnabled(false);
    clock = new Date(T0.getTime() + 120_000);
    const back = await svc.setEnabled(true);
    expect(back).toEqual({ enabled: true, joinedAt: T0.toISOString(), leftAt: null });
  });

  it('persists across a reload', async () => {
    await svc.setEnabled(true);
    const reloaded = createPilotService({ filePath, now: () => clock });
    await reloaded.load();
    expect(reloaded.getStatus().enabled).toBe(true);
    expect(reloaded.getStatus().joinedAt).toBe(T0.toISOString());
  });
});
