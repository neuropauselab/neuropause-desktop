import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from '@neuropause/business';
import { createWorkplacePlatform, type WorkplacePlatform } from './platform';

describe('Modules 7,8 — Tasks (reuse Wave 8 projects) + Calendar', () => {
  let runtime: EnterpriseRuntime;
  let business: BusinessPlatform;
  let wp: WorkplacePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    business = createBusinessPlatform(runtime, { clock });
    wp = createWorkplacePlatform(runtime, { clock, business });
  });

  it('tasks: kanban + REUSES Wave 8 project tasks (no duplication)', async () => {
    const t = await wp.tasks().create({ ownerId: 'u1', title: 'Write tests', priority: 'high' });
    await wp.tasks().move(t.id, 'doing');
    expect(wp.tasks().kanban('u1').doing.length).toBe(1);
    const proj = await business.projects().createProject({ name: 'Launch' });
    await business.projects().addTask({ projectId: proj.id, name: 'design' });
    expect(wp.tasks().projectTasks().length).toBe(1);
    expect(wp.tasks().projectTasks()[0]!.name).toBe('design');
  });

  it('calendar: real room-conflict detection + scheduling assistant', async () => {
    const room = await wp.calendar().registerRoom({ name: 'Boardroom', capacity: 10 });
    await wp.calendar().createEvent({ title: 'Sync', start: 100, end: 200, roomId: room.id });
    await expect(wp.calendar().createEvent({ title: 'Clash', start: 150, end: 250, roomId: room.id })).rejects.toThrow(/booked/);
    const slot = wp.calendar().suggestSlot([{ start: 150, end: 250 }, { start: 300, end: 400 }], room.id);
    expect(slot).toEqual({ start: 300, end: 400 });
  });
});
