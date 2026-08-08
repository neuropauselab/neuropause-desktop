/**
 * Mobile M1-12 — pure tests for the Notifications view-model.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionNotification } from '@neuropause/shared';
import { colors } from '../theme/tokens';
import { priorityColor, unreadCount } from './notificationsModel';

const note = (over: Partial<CompanionNotification> = {}): CompanionNotification => ({
  id: 'n1',
  title: 'Bill approved',
  body: 'Acme Corp bill was approved.',
  priority: 'normal',
  at: '2026-08-08T06:00:00.000Z',
  read: false,
  ...over,
});

describe('notificationsModel', () => {
  it('maps priority to a token colour', () => {
    expect(priorityColor('critical')).toBe(colors.danger);
    expect(priorityColor('high')).toBe(colors.bands.watch);
    expect(priorityColor('normal')).toBe(colors.accent);
    expect(priorityColor('low')).toBe(colors.faint);
  });

  it('counts unread', () => {
    expect(unreadCount([note(), note({ read: true }), note({ read: false })])).toBe(2);
    expect(unreadCount([])).toBe(0);
    expect(unreadCount([note({ read: true })])).toBe(0);
  });
});
