/**
 * Identity resolution, rendered and clicked, against the real main handlers.
 *
 * The whole feature is a claim about a screen, so a model test cannot verify
 * it: Program 9 already had the ambiguity DETECTION and the failure was that
 * nothing rendered it. These tests mount the real panel and drive real clicks
 * through the real `initIdentity` handlers over real temp files.
 *
 * What each test is actually protecting:
 *   - the question reaches the screen at all, with the engine's own reason;
 *   - the side-by-side tells the person which values would be filled and which
 *     would be kept, BEFORE they confirm;
 *   - confirming writes through the real store and does not overwrite;
 *   - "not a match" and "create new" are reachable and do different things;
 *   - the queue empties from the BACKEND after a write, not from local state;
 *   - a sensitive value never reaches the DOM;
 *   - a refusal is shown as a refusal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import type { EnterpriseModuleDescriptor, EnterprisePermission } from '@neuropause/shared';
import { EnterpriseRecordStore } from '@main/enterprise/framework/enterpriseRecordStore';
import { ProvenanceStore } from '@main/dataPlane/importer';
import { initIdentity, type IdentitySubsystem } from '@main/identity/index';
import { IdentityPanel } from '@renderer/dataCommandCenter/IdentityPanel';

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';
const WS = 'workspace-a';

const CUSTOMERS: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'personalPhone', label: 'Personal Phone', type: 'text' },
  ],
};

let dir: string;
let store: EnterpriseRecordStore;
let identity: IdentitySubsystem;
let granted: Set<EnterprisePermission>;
let provenance: ProvenanceStore;

/** Raise a question the way the connector bridge does. */
async function raise(
  over: Partial<Parameters<IdentitySubsystem['store']['raiseMatch']>[0]> = {},
): Promise<void> {
  await identity.store.raiseMatch({
    workspaceId: WS,
    provider: 'hubspot',
    connectionId: 'acct_1',
    providerEntityType: 'hubspot_companies',
    providerEntityId: '900',
    incomingLabel: 'Acme Private Limited',
    incoming: [
      { field: 'name', label: 'Name', value: 'Acme Private Limited' },
      { field: 'industry', label: 'Industry', value: 'Retail' },
    ],
    destinationModuleId: CUSTOMERS.id,
    destinationLabel: CUSTOMERS.title,
    candidates: [],
    state: 'ambiguous',
    reason: 'Matches an existing record only after normalising the name.',
    ...over,
  });
}

function candidateFor(
  id: string,
  label: string,
  differs: { field: string; label: string; existing: string; incoming: string }[],
): Parameters<IdentitySubsystem['store']['raiseMatch']>[0]['candidates'][number] {
  return {
    subject: { kind: 'record', scopeId: CUSTOMERS.id, id, label },
    evidence: [
      {
        kind: 'name_canonical',
        field: 'name',
        value: label,
        detail: 'The names agree only after canonicalising them.',
      },
    ],
    confidence: 0.2,
    differs,
  };
}

beforeEach(async () => {
  cleanup();
  clearRoutes();
  dir = join(tmpdir(), `np-identity-ui-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  granted = new Set<EnterprisePermission>([
    'data:read',
    'data:approve',
    'crm:read',
    'crm:manage',
    'governance:manage',
  ]);
  store = new EnterpriseRecordStore(join(dir, 'crm.json'), CUSTOMERS.id, CUSTOMERS.id);
  await store.load();
  provenance = new ProvenanceStore(join(dir, 'provenance.json'));
  await provenance.load();

  identity = initIdentity({
    userDataDir: dir,
    workspaceId: () => WS,
    actor: () => ACTOR,
    now: () => T0,
    audit: () => undefined,
    allows: (permission) => granted.has(permission),
    authorize: (permission) => {
      if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
    },
    modules: () => [CUSTOMERS],
    storeFor: (id) => (id === CUSTOMERS.id ? store : null),
    provenance,
    onImported: () => undefined,
  });
  for (const h of identity.handlers) route(h.channel, (payload) => h.handler(h.schema.parse(payload), {} as never));
});

afterEach(async () => {
  cleanup();
  await identity.store.flush();
  await store.flush();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
});

describe('Identity resolution', () => {
  it('says so honestly when there is nothing to decide', async () => {
    render(<IdentityPanel />);
    await waitFor(() => expect(screen.getByText(/No open questions/i)).toBeTruthy());
    // The empty state names the failure it replaces, so the feature is legible
    // even when idle.
    expect(screen.getByText(/counted in a summary and discarded/i)).toBeTruthy();
    expect(unroutedChannels()).toEqual([]);
  });

  it('renders the question with the engine’s own reason', async () => {
    await raise();
    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');
    expect(screen.getByText('Matches an existing record only after normalising the name.')).toBeTruthy();
    expect(screen.getByText(/would be written to Customers/i)).toBeTruthy();
    expect(unroutedChannels()).toEqual([]);
  });

  it('shows what confirming would fill and what it would keep', async () => {
    const record = store.create({
      title: 'Acme Pvt Ltd',
      fields: { name: 'Acme Pvt Ltd', phone: '+1 555 0000', industry: '' },
      actor: 'a person',
      now: T0,
    });
    await store.flush();
    await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Acme Private Limited' },
        { field: 'industry', label: 'Industry', value: 'Retail' },
        { field: 'phone', label: 'Phone', value: '+1 555 9999' },
      ],
      candidates: [
        candidateFor(record.id, record.title, [
          { field: 'industry', label: 'Industry', existing: '', incoming: 'Retail' },
          { field: 'phone', label: 'Phone', existing: '+1 555 0000', incoming: '+1 555 9999' },
        ]),
      ],
    });

    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');

    /**
     * This is the assertion the whole screen exists for. A person about to link
     * two records has to be able to see, per field, whether their own value
     * survives — otherwise "confirm" is a blind merge with a friendly label.
     */
    const industryRow = screen.getByText('Industry').closest('tr')!;
    expect(within(industryRow).getByText('Will be filled in')).toBeTruthy();
    const phoneRow = screen.getByText('Phone').closest('tr')!;
    expect(within(phoneRow).getByText('Kept as it is')).toBeTruthy();
    expect(screen.getByText(/never overwrites a value that is already there/i)).toBeTruthy();
  });

  it('confirming writes through the real store, filling only the blank', async () => {
    const record = store.create({
      title: 'Acme Pvt Ltd',
      fields: { name: 'Acme Pvt Ltd', phone: '+1 555 0000', industry: '' },
      actor: 'a person',
      now: T0,
    });
    await store.flush();
    await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Acme Private Limited' },
        { field: 'industry', label: 'Industry', value: 'Retail' },
        { field: 'phone', label: 'Phone', value: '+1 555 9999' },
      ],
      candidates: [candidateFor(record.id, record.title, [])],
    });

    const user = userEvent.setup();
    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');
    await user.click(screen.getByRole('button', { name: /Yes, this is the same/i }));

    await waitFor(() => expect(screen.getByText(/Linked to Acme Pvt Ltd/i)).toBeTruthy());
    const after = store.get(record.id)!;
    expect(after.fields.industry).toBe('Retail');
    expect(after.fields.phone).toBe('+1 555 0000');

    // The queue emptied because the BACKEND says so — the panel re-reads rather
    // than optimistically removing the card. A screen that hides a question it
    // failed to resolve is worse than one that never showed it.
    await waitFor(() => expect(screen.getByText(/No open questions/i)).toBeTruthy());
    expect(await identity.store.queue(WS, 10)).toHaveLength(0);
  });

  it('“create a new record” creates one, and is reachable with no candidates', async () => {
    await raise();
    const user = userEvent.setup();
    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');
    // With nothing to match against, the panel says so rather than offering a
    // disabled confirm button with no explanation.
    expect(screen.getByText(/Nothing in NeuroPause looks like this/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Yes, this is the same/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Create a new record/i }));
    await waitFor(() => expect(screen.getByText(/Created Acme Private Limited/i)).toBeTruthy());
    expect(store.list({ status: 'active', limit: 10 })).toHaveLength(1);
    expect(store.list({ status: 'active', limit: 10 })[0]!.fields.industry).toBe('Retail');
  });

  it('“not a match” records the decision and creates nothing', async () => {
    await raise();
    const user = userEvent.setup();
    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');
    await user.click(screen.getByRole('button', { name: /Not a match/i }));

    await waitFor(() => expect(screen.getByText(/Left unlinked/i)).toBeTruthy());
    expect(store.list({ status: 'active', limit: 10 })).toHaveLength(0);
    // …and it is remembered, so a later sync can see a person already said no.
    await waitFor(() => expect(screen.getByText('Not matched')).toBeTruthy());
  });

  it('lets a person pick between two candidates, and confirms the one they picked', async () => {
    const first = store.create({ title: 'Acme Pvt Ltd', fields: { name: 'Acme Pvt Ltd' }, actor: 'p', now: T0 });
    const second = store.create({ title: 'Acme Limited', fields: { name: 'Acme Limited' }, actor: 'p', now: T0 });
    await store.flush();
    await raise({
      candidates: [candidateFor(first.id, first.title, []), candidateFor(second.id, second.title, [])],
      reason: 'Two records match after normalising the name.',
    });

    const user = userEvent.setup();
    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');

    // The default selection is the first candidate, and choosing the second
    // actually changes what gets confirmed. Without this, a two-candidate
    // ambiguity would silently resolve to whichever came back first — which is
    // guessing with extra steps.
    await user.click(screen.getByRole('radio', { name: /Acme Limited/i }));
    await waitFor(() => expect(screen.getByText(/Why Acme Limited is offered/i)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Yes, this is the same/i }));

    await waitFor(() => expect(screen.getByText(/Linked to Acme Limited/i)).toBeTruthy());
    const links = await identity.store.listIdentities(WS, 10);
    expect(links[0]!.subject?.id).toBe(second.id);
  });

  it('never renders a sensitive value', async () => {
    await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Acme Private Limited' },
        { field: 'personalPhone', label: 'Personal Phone', value: '+44 7700 900000' },
      ],
      candidates: [
        candidateFor('rec_x', 'Acme Pvt Ltd', [
          {
            field: 'personalPhone',
            label: 'Personal Phone',
            existing: '+44 7700 111111',
            incoming: '+44 7700 900000',
          },
        ]),
      ],
    });
    const { container } = render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');
    // Masked in the main process, so it is not in the DOM at all — not hidden
    // by CSS, not present in a title attribute, not one devtools inspection
    // away.
    expect(container.innerHTML).not.toContain('7700 900000');
    expect(container.innerHTML).not.toContain('7700 111111');
  });

  it('shows a refusal as a refusal', async () => {
    await raise();
    // The person can read the queue but cannot write to the destination module.
    granted.delete('crm:manage');
    const user = userEvent.setup();
    render(<IdentityPanel />);
    await screen.findByText('Acme Private Limited');
    await user.click(screen.getByRole('button', { name: /Create a new record/i }));

    // The refusal is stated in the person's terms — the destination module is
    // already named on the card above, and the permission string itself is not
    // something a user can act on.
    await waitFor(() => expect(screen.getByText('Permission required')).toBeTruthy());
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
    expect(store.list({ status: 'active', limit: 10 })).toHaveLength(0);
    // The question is still there. A failed decision must not look like a
    // completed one.
    expect(screen.getByText('Acme Private Limited')).toBeTruthy();
  });

  it('lists a background service with the permissions it actually holds', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:read', 'crm:manage'],
    });
    svc.allows('crm:manage');
    // Awaited on purpose: `note` chains behind the service's own registration,
    // and the very first action used to be lost against a row that did not
    // exist yet.
    await svc.note('Bridged hubspot/hubspot_companies');

    const user = userEvent.setup();
    render(<IdentityPanel />);
    await screen.findByText('Connector sync');
    expect(screen.getByText('crm:read, crm:manage')).toBeTruthy();
    expect(screen.getByText('Bridged hubspot/hubspot_companies')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();

    // Stopping it from the screen actually strips its authority.
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy());
    expect(svc.allows('crm:manage')).toBe(false);
  });
});
