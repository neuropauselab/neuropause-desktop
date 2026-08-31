/**
 * D-7b — THE HIGHEST-SEVERITY SILENT WRITE: EnterpriseModuleScreen's
 * delete/archive path, and the hold that rides on it.
 *
 * `RecordDetail.takeAlternative` archives a record and then closes the HOLD that
 * recommended archiving. Three things were wrong, and only the first was filed:
 *
 *  1. The hold-close outcome was DISCARDED behind `.catch(() => undefined)`.
 *     `hold:resolve` answers `HoldRecord | null` and returns **null** for an
 *     unknown, already-resolved or out-of-scope hold — pinned as intended
 *     behaviour in `decisionsIpc.test.ts`. So the most likely failure never
 *     reached the catch at all, and the renderer could not tell "hold closed"
 *     from "hold still open".
 *
 *  2. The ARCHIVE result was discarded too. That channel refuses by RESOLVING
 *     `{ok:false}`, so a refused archive still closed the hold with the note
 *     "Archived instead of deleting; every link keeps resolving" — a false
 *     statement written into governance evidence. Nothing may be claimed about
 *     the hold until the archive is real.
 *
 *  3. `requestDelete` treated `{ok:false}` WITHOUT an assessment as success and
 *     fell through to `onChanged()`, closing the modal as though the record had
 *     been deleted.
 *
 * WHY A MESSAGE ALONE WOULD NOT HAVE WORKED. `onChanged()` is
 * `() => { setDetail(null); void refresh(); }`, and `RecordDetail` is mounted
 * behind `{detail && …}`. Under React 18 automatic batching the unmount and the
 * message land in the SAME render pass, so a naive fix renders the message zero
 * frames — green at the state layer, invisible to the user. The fix therefore
 * does not call `onChanged()` on a failure, mirroring `ModuleForm.submit`, which
 * already returns early and keeps its modal open. Where the archive DID succeed
 * and only the hold failed, `onRefresh()` updates the list WITHOUT unmounting.
 *
 * Every route below uses a channel constant verified to exist. The friendly
 * method is `remove` while the constant is `EnterpriseModuleDelete`; routing a
 * non-existent constant binds `undefined`, the real call goes unrouted and
 * throws, and the test passes for the wrong reason. The success controls exist
 * to catch exactly that.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import {
  IpcChannel,
  type EnterpriseEntity,
  type EnterpriseModuleSummary,
} from '@neuropause/shared';
import { EnterpriseModuleScreen } from '@renderer/enterprise/modules/EnterpriseModuleScreen';

const MODULE: EnterpriseModuleSummary = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  group: 'CRM',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  recordCount: 1,
  activeCount: 1,
  // Both MUST stay as they are: `aiSummary: true` mounts a section that invokes
  // a summarize channel, and a non-empty `actions` renders buttons that invoke
  // another — neither is routed here.
  aiSummary: false,
  actions: [],
};

const RECORD: EnterpriseEntity = {
  id: 'rec_1',
  moduleId: 'crm-customers',
  kind: 'customer',
  title: 'Acme Ltd',
  status: 'active',
  fields: { name: 'Acme Ltd' },
  tags: [],
  rev: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as EnterpriseEntity;

/** The refusal that opens the hold dialog: not ok, carries an assessment + holdId. */
const REFUSAL_WITH_HOLD = {
  ok: false,
  holdId: 'hold_1',
  assessment: {
    risk: 'high_risk',
    recommendation: 'Three invoices still reference this customer.',
    evidence: [{ label: 'Invoices', detail: '3 linked' }],
    alternative: 'Archive it instead — every link keeps resolving.',
  },
};

/** Open the detail modal, press Delete, and land in the hold dialog. */
async function reachHoldDialog(): Promise<ReturnType<typeof userEvent.setup>> {
  render(<EnterpriseModuleScreen module={MODULE} />);
  const user = userEvent.setup();
  await user.click(await screen.findByText('Acme Ltd'));
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  await screen.findByRole('button', { name: 'Archive instead' });
  return user;
}

beforeEach(() => {
  clearRoutes();
  cleanup();
  route(IpcChannel.EnterpriseModuleList, () => [RECORD]);
  route(IpcChannel.EnterpriseModuleDelete, () => REFUSAL_WITH_HOLD);
});

describe('D-7b — the hold outcome is no longer discarded', () => {
  it('a hold that RESOLVES NULL is reported — the failure no catch could ever see', async () => {
    let resolveCalls = 0;
    route(IpcChannel.EnterpriseModuleSetStatus, () => ({ ok: true, record: RECORD }));
    // The real refusal shape: unknown / already-resolved / out-of-scope.
    route(IpcChannel.HoldResolve, () => {
      resolveCalls += 1;
      return null;
    });

    const user = await reachHoldDialog();
    await user.click(screen.getByRole('button', { name: 'Archive instead' }));

    const alert = await screen.findByRole('alert');
    // It must say the archive HAPPENED and the hold did NOT close — conflating
    // them would be a new false claim in place of the old silence.
    expect(alert.textContent).toMatch(/archived/i);
    expect(alert.textContent).toMatch(/still open/i);
    expect(resolveCalls).toBe(1);
  });

  it('a hold that REJECTS is reported identically — both shapes mean "not closed"', async () => {
    route(IpcChannel.EnterpriseModuleSetStatus, () => ({ ok: true, record: RECORD }));
    route(IpcChannel.HoldResolve, () => {
      // A Manager holds `crm:manage` but not `governance:manage`, so this is the
      // real refusal for a role the product actually seeds.
      throw new Error('Not authorized: missing permission "governance:manage".');
    });

    const user = await reachHoldDialog();
    await user.click(screen.getByRole('button', { name: 'Archive instead' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/still open/i);
  });

  it('the message SURVIVES — it is not destroyed by the unmount in the same pass', async () => {
    route(IpcChannel.EnterpriseModuleSetStatus, () => ({ ok: true, record: RECORD }));
    route(IpcChannel.HoldResolve, () => null);

    const user = await reachHoldDialog();
    await user.click(screen.getByRole('button', { name: 'Archive instead' }));
    await screen.findByRole('alert');

    // Still readable after the list refresh has had time to run. This is the
    // assertion a state-layer-only fix would fail: `onChanged()` would have
    // unmounted the component and rendered the message zero frames.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/still open/i);
  });
});

describe('D-7b — nothing is claimed about the hold until the archive is real', () => {
  it('a REFUSED archive reports the reason and never closes the hold', async () => {
    let resolveCalls = 0;
    route(IpcChannel.EnterpriseModuleSetStatus, () => ({
      ok: false,
      errors: { _: 'Invalid status transition.' },
    }));
    route(IpcChannel.HoldResolve, () => {
      resolveCalls += 1;
      return null;
    });

    const user = await reachHoldDialog();
    await user.click(screen.getByRole('button', { name: 'Archive instead' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid status transition.');
    // THE GOVERNANCE POINT: the hold must not be closed with a note claiming an
    // archive that was refused.
    expect(resolveCalls).toBe(0);
    // And it must not read as though the archive succeeded.
    expect(alert.textContent).not.toMatch(/still open/i);
  });
});

describe('D-7b — a refused delete is not mistaken for a deletion', () => {
  it('{ok:false} with no assessment is reported instead of closing the modal', async () => {
    route(IpcChannel.EnterpriseModuleDelete, () => ({
      ok: false,
      errors: { _: 'This record is referenced by a posted document.' },
    }));

    render(<EnterpriseModuleScreen module={MODULE} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Acme Ltd'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('referenced by a posted document');
  });

  it('a REJECTED delete is reported verbatim, not swallowed', async () => {
    route(IpcChannel.EnterpriseModuleDelete, () => {
      throw new Error('Not authorized: missing permission "crm:manage".');
    });

    render(<EnterpriseModuleScreen module={MODULE} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Acme Ltd'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('crm:manage');
  });
});

describe('D-7b — success controls (the routes are real, the pass is not an accident)', () => {
  it('archive + hold close both succeeding shows NO alert', async () => {
    let resolveCalls = 0;
    route(IpcChannel.EnterpriseModuleSetStatus, () => ({ ok: true, record: RECORD }));
    route(IpcChannel.HoldResolve, () => {
      resolveCalls += 1;
      return { id: 'hold_1', status: 'resolved' };
    });

    const user = await reachHoldDialog();
    await user.click(screen.getByRole('button', { name: 'Archive instead' }));

    // The hold channel really was reached — this is what proves the constant is
    // right and the refusal tests are not passing on an UNROUTED throw.
    await waitFor(() => expect(resolveCalls).toBe(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a successful delete shows no alert', async () => {
    let deleteCalls = 0;
    route(IpcChannel.EnterpriseModuleDelete, () => {
      deleteCalls += 1;
      return { ok: true };
    });

    render(<EnterpriseModuleScreen module={MODULE} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Acme Ltd'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
