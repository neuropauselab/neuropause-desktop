import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createWorkplacePlatform, type WorkplacePlatform } from './platform';

describe('Modules 4,5,6 — Documents, Knowledge, Notes', () => {
  let runtime: EnterpriseRuntime;
  let wp: WorkplacePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    wp = createWorkplacePlatform(runtime, { clock });
  });

  it('documents: versioning, comments, and approval — all governed', async () => {
    const doc = await wp.documents().create({ title: 'Spec', ownerId: 'u1', content: 'v1' });
    await wp.documents().edit(doc.id, 'v2', 'u1');
    expect(wp.documents().get(doc.id)!.version).toBe(2);
    expect(wp.documents().historyOf(doc.id).length).toBe(2);
    await wp.documents().addComment(doc.id, { authorId: 'u2', text: 'looks good' });
    expect(wp.documents().commentsOf(doc.id).length).toBe(1);
    await wp.documents().submitForApproval(doc.id, 'u1');
    await wp.documents().approve(doc.id, 'mgr');
    expect(wp.documents().get(doc.id)!.status).toBe('approved');
  });

  it('knowledge: articles + real in-process search', async () => {
    await wp.knowledge().create({ kind: 'sop', title: 'Onboarding SOP', body: 'steps to onboard' });
    await wp.knowledge().create({ kind: 'faq', title: 'VPN FAQ', body: 'how to connect the vpn' });
    expect(wp.knowledge().count()).toBe(2);
    expect(wp.knowledge().search('vpn').length).toBe(1);
    expect(wp.knowledge().list('sop').length).toBe(1);
  });

  it('notes: create + real extractive summary', async () => {
    const n = await wp.notes().create({ ownerId: 'u1', kind: 'meeting', title: 'Standup', body: 'We shipped Wave 10. Next up docs.' });
    expect(wp.notes().summarize(n.id).summary).toContain('We shipped Wave 10');
  });
});
