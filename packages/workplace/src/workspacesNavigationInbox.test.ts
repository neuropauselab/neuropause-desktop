import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from '@neuropause/business';
import { createWorkplacePlatform, type WorkplacePlatform } from './platform';

describe('Modules 1,2,3 — Workspaces, Navigation, Unified Inbox', () => {
  let runtime: EnterpriseRuntime;
  let business: BusinessPlatform;
  let wp: WorkplacePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    business = createBusinessPlatform(runtime, { clock });
    wp = createWorkplacePlatform(runtime, { clock, business });
  });

  it('creates workspaces across scopes', async () => {
    await wp.workspaces().create({ name: 'My Space', scope: 'personal', ownerId: 'u1' });
    await wp.workspaces().create({ name: 'Team A', scope: 'team' });
    expect(wp.workspaces().count()).toBe(2);
    expect(wp.workspaces().byScope('personal').length).toBe(1);
  });

  it('navigation favorites/pins/recent; global search REUSES Enterprise Search', async () => {
    await wp.navigation().addFavorite('u1', { label: 'CRM', target: '/crm' });
    await wp.navigation().pinApp('u1', 'documents');
    wp.navigation().recordRecent('u1', { label: 'Doc', target: '/doc/1' });
    const sb = wp.navigation().sidebar('u1');
    expect(sb.favorites.length).toBe(1);
    expect(sb.pinnedApps).toContain('documents');
    expect((await wp.navigation().search('Acme')).total).toBe(0);
    await business.crm().createAccount({ name: 'Acme' });
    expect((await wp.navigation().search('Acme')).total).toBeGreaterThan(0);
  });

  it('unified inbox aggregates all item kinds', async () => {
    await wp.inbox().push({ userId: 'u1', kind: 'task', title: 'Review doc' });
    await wp.inbox().push({ userId: 'u1', kind: 'approval', title: 'Approve PO' });
    await wp.inbox().push({ userId: 'u1', kind: 'ai-suggestion', title: 'Draft reply' });
    expect(wp.inbox().count('u1')).toBe(3);
    expect(wp.inbox().unread('u1').length).toBe(3);
    const first = wp.inbox().list('u1')[0]!;
    wp.inbox().markRead(first.id);
    expect(wp.inbox().unread('u1').length).toBe(2);
  });
});
