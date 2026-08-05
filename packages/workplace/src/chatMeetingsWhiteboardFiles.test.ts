import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createWorkplacePlatform, type WorkplacePlatform } from './platform';

describe('Modules 9,10,11,12 — Chat, Meetings, Whiteboard, Files', () => {
  let runtime: EnterpriseRuntime;
  let wp: WorkplacePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    wp = createWorkplacePlatform(runtime, { clock });
  });

  it('chat: channels, mentions, reactions, threads', async () => {
    const ch = await wp.chat().createChannel({ name: 'general', kind: 'channel' });
    const m = await wp.chat().send({ channelId: ch.id, authorId: 'u1', text: 'hi @bob' });
    expect(m.mentions).toContain('bob');
    wp.chat().react(m.id, ':thumbsup:');
    expect(wp.chat().channelMessages(ch.id).length).toBe(1);
  });

  it('meetings are represented; recording is metadata only', async () => {
    const meet = await wp.meetings().schedule({ title: 'Review', kind: 'video', start: 1000 });
    expect(meet.status).toBe('scheduled');
    expect(meet.note).toMatch(/adapter-verified/);
    expect(wp.meetings().recordingMetadata(meet.id).hasRecording).toBe(false);
  });

  it('whiteboard objects + files metadata search', async () => {
    const b = await wp.whiteboard().createBoard({ name: 'Plan', ownerId: 'u1' });
    wp.whiteboard().addObject(b.id, { kind: 'sticky', content: 'idea' });
    expect(wp.whiteboard().boardsList()[0]!.objects.length).toBe(1);
    await wp.files().register({ name: 'budget.xlsx', scope: 'team', ownerId: 'u1', tags: ['finance'] });
    expect(wp.files().search('finance').length).toBe(1);
    expect(wp.files().list('team')[0]!.note).toMatch(/metadata only/);
  });
});
