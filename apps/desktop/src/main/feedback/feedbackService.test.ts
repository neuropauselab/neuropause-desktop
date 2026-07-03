import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFeedbackStore, type FeedbackStore } from './feedbackService';

const T0 = new Date('2026-07-01T00:00:00.000Z');

describe('createFeedbackStore', () => {
  let filePath: string;
  let clock: Date;
  let seq: number;
  let store: FeedbackStore;

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-feedback-${randomUUID()}.json`);
    clock = T0;
    seq = 0;
    store = createFeedbackStore({ filePath, now: () => clock, id: () => `fb-${++seq}` });
    await store.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('stores a trimmed entry with id, timestamp, and defaults', async () => {
    const entry = await store.submit({ category: 'bug', message: '  the panel flickers  ' });
    expect(entry).toMatchObject({
      id: 'fb-1',
      category: 'bug',
      message: 'the panel flickers',
      createdAt: T0.toISOString(),
      appVersion: null,
      context: null,
    });
  });

  it('rejects an empty or whitespace-only message', async () => {
    await expect(store.submit({ category: 'idea', message: '   ' })).rejects.toThrow(
      'Feedback message is required.',
    );
    expect(store.list()).toHaveLength(0);
  });

  it('lists entries newest-first', async () => {
    await store.submit({ category: 'idea', message: 'first' });
    clock = new Date(T0.getTime() + 60_000);
    await store.submit({ category: 'praise', message: 'second' });
    const list = store.list();
    expect(list.map((e) => e.message)).toEqual(['second', 'first']);
  });

  it('keeps appVersion and context when provided', async () => {
    const entry = await store.submit({
      category: 'question',
      message: 'how do I export?',
      appVersion: '1.0.0-rc.1',
      context: 'operations',
    });
    expect(entry.appVersion).toBe('1.0.0-rc.1');
    expect(entry.context).toBe('operations');
  });

  it('persists across a reload', async () => {
    await store.submit({ category: 'bug', message: 'kept' });
    const reloaded = createFeedbackStore({ filePath, now: () => clock });
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0].message).toBe('kept');
  });

  it('exportAll stamps the export time and includes all entries', async () => {
    await store.submit({ category: 'idea', message: 'a' });
    clock = new Date(T0.getTime() + 120_000);
    const out = store.exportAll();
    expect(out.exportedAt).toBe(clock.toISOString());
    expect(out.entries).toHaveLength(1);
  });

  it('clear removes everything, reports the count, and persists', async () => {
    await store.submit({ category: 'bug', message: 'a' });
    await store.submit({ category: 'idea', message: 'b' });
    const removed = await store.clear();
    expect(removed).toBe(2);
    const reloaded = createFeedbackStore({ filePath });
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(0);
  });
});
