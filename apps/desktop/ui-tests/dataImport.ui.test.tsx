/**
 * Import Center — the review surfaces, rendered and clicked.
 *
 * The gap this file closes is specific and was real: `dp:preview`,
 * `dp:reclassify` and the `rowActions` field of `dp:import` were all
 * implemented, contract-checked and unit-tested in the main process, and none
 * of them was reachable from the screen. A backend test suite cannot tell you
 * that; only mounting the component and clicking can.
 *
 * Every handler below is the REAL one, over real temp files and real Zod
 * schemas. Nothing about the import pipeline is mocked — only Electron's
 * message transport.
 *
 * The load-bearing assertions are again the refusals:
 *   - a sensitive value must not appear in the rendered DOM, not even inside
 *     an error message;
 *   - a row that exactly matches an existing record must not offer "create";
 *   - a row the engine declined to guess for must not arrive pre-answered;
 *   - a correction must reset the approval tick, because approving a table is
 *     approving a reading of it.
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
import { initDataPlane } from '@main/dataPlane/index';
import { ImportPanel } from '@renderer/dataCommandCenter/ImportPanel';
import { TEST_TENANT_SCOPE } from '@main/tenancy/testScope';

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';

/** Classifies as CUSTOMERS. The misclassification the correction exists for. */
const ORDERS = ['Order Number,Customer,Total', 'SO-1,Acme Ltd,1200', 'SO-2,Borealis,800'].join('\n');

const CUSTOMERS = [
  'Customer Code,Customer Name,Email,Phone,Credit Limit',
  'CUS-1,Acme Ltd,a@acme.example,+91 98765 43210,50000',
  'CUS-2,Borealis Trading,b@bor.example,+91 98765 43211,25000',
].join('\n');

/** `monthlySalary` carries `sensitive: true` in the ontology. */
const PAYROLL = [
  'Employee Number,Name,Email,Monthly Salary',
  'E-1,Asha Rao,asha@example.com,125000',
  'E-2,Ravi Kumar,ravi@example.com,not-a-number',
].join('\n');

const DESCRIPTORS: EnterpriseModuleDescriptor[] = [
  {
    id: 'crm-customers',
    title: 'Customers',
    singular: 'Customer',
    plural: 'Customers',
    icon: 'user',
    description: 'test',
    titleField: 'name',
    permissions: { read: 'crm:read', write: 'crm:manage' },
    fields: [
      { key: 'name', label: 'Customer Name', type: 'text', required: true },
      { key: 'customerCode', label: 'Customer Code', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
    ],
  },
  {
    id: 'hr-employees',
    title: 'Employees',
    singular: 'Employee',
    plural: 'Employees',
    icon: 'user',
    description: 'test',
    titleField: 'name',
    permissions: { read: 'people:read', write: 'people:manage' },
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
  },
];

let dir: string;
let stores: Map<string, EnterpriseRecordStore>;
let granted: Set<EnterprisePermission>;

const noop = (): void => undefined;

/**
 * jsdom's `File` has had `arrayBuffer()` only recently, and the panel reads
 * bytes before anything else. Polyfilled rather than worked around, so the
 * component under test runs its real code path.
 */
function fileOf(name: string, body: string): File {
  const file = new File([body], name, { type: 'text/csv' });
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(body).buffer,
    });
  }
  return file;
}

async function upload(container: HTMLElement, file: File): Promise<void> {
  const user = userEvent.setup();
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input rendered');
  await user.upload(input, file);
  await screen.findByText('What was found', {}, { timeout: 5000 });
}

/**
 * Row cards, in the order the preview returned them.
 *
 * Queried by the `Row N` marker rather than by title: a customer's name
 * appears in the card heading, again in "Matches <name>", and again in the
 * differences table, so `getByText(name)` is ambiguous exactly when a match
 * exists — which is the case these tests are about.
 */
function rowCards(): HTMLElement[] {
  // `queryAll`, not `getAll`: "there are no rows" is a legitimate outcome to
  // wait for, and `getAll` throws instead of returning [].
  return screen.queryAllByText(/^Row \d+$/).map((el) => {
    const li = el.closest('li');
    if (li === null) throw new Error('row marker is not inside a row card');
    return li;
  });
}

/** Tick a group and record the approval reason the high-risk gate demands. */
async function approveGroup(why: string): Promise<void> {
  const user = userEvent.setup();
  const box = screen.getByRole('checkbox');
  if (!(box as HTMLInputElement).checked) await user.click(box);
  const reason = await screen.findByLabelText('Why are you approving this?');
  await user.type(reason, why);
}

beforeEach(async () => {
  cleanup();
  clearRoutes();
  dir = join(tmpdir(), `np-dcc-ui-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  granted = new Set<EnterprisePermission>([
    'data:read',
    'data:import',
    'data:approve',
    'crm:read',
    'crm:manage',
    'people:read',
    'people:manage',
  ]);
  stores = new Map(
    DESCRIPTORS.map((d) => [d.id, new EnterpriseRecordStore(join(dir, `${d.id}.json`), d.id, d.id).bindScope(() => TEST_TENANT_SCOPE)]),
  );
  await Promise.all([...stores.values()].map((s) => s.load()));

  const sub = initDataPlane({
    userDataDir: dir,
    storeFor: (id) => stores.get(id) ?? null,
    actor: () => ACTOR,
    tenantId: () => 'org_1',
    now: () => T0,
    audit: () => undefined,
    authorize: (permission) => {
      if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
    },
    modules: () => DESCRIPTORS,
    saveExport: async (name) => `/tmp/${name}`,
    onImported: () => undefined,
  });

  // Every Data Plane channel, wired to its real handler through its real schema.
  for (const h of sub.handlers) {
    route(h.channel, (payload) => h.handler(h.schema.parse(payload)));
  }
});

afterEach(async () => {
  cleanup();
  await Promise.all([...stores.values()].map((s) => s.flush()));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/* ── 1. Entity correction ──────────────────────────────────────────────── */

describe('correcting what a file is', () => {
  it('is reachable from the screen, recomputes, and un-ticks the approval', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    // A payroll export reads as EMPLOYEES, and reads perfectly well as
    // CUSTOMERS too — which is what makes it the right fixture here: the
    // correction produces a usable table, so the reset of the tick is visible
    // rather than masked by the group becoming blocked.
    await upload(container, fileOf('payroll.csv', PAYROLL));
    expect(screen.getByText('Hr · Employee')).toBeTruthy();

    // Tick it FIRST. A tick that was never placed cannot be shown to survive
    // or not survive the correction, and "it is unticked afterwards" would be
    // vacuously true for a high-risk table that starts unticked anyway.
    const before = screen.getByRole('checkbox') as HTMLInputElement;
    await user.click(before);
    expect(before.checked).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Change what this is' }));
    await user.selectOptions(screen.getByLabelText('This table contains'), 'customer');
    await user.type(screen.getByLabelText('Why'), 'These are trading accounts, not staff.');
    await user.click(screen.getByRole('button', { name: 'Re-analyze as this' }));

    await screen.findByText(/You corrected this from/);
    expect(screen.getByText('Crm · Customer')).toBeTruthy();
    // The correction names what it came FROM, and quotes the reason it was
    // audited under.
    const note = screen.getByText(/You corrected this from/).textContent ?? '';
    expect(note).toContain('Employee');
    expect(note).toContain('trading accounts');

    /**
     * The tick is GONE. Approving a table is approving a reading of it; a tick
     * placed against "these are employees" cannot survive being told they are
     * customers. An overridden table always requires approval, so this is also
     * the `data:approve` gate re-arming.
     */
    const after = screen.getByRole('checkbox') as HTMLInputElement;
    expect(after.checked).toBe(false);
    expect(after.disabled).toBe(false);
  });

  it('does not trap the reviewer when the correction turns out to be wrong', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('orders.csv', ORDERS));

    // Order columns cannot satisfy an employee's required fields, so this
    // correction leaves nothing importable.
    await user.click(screen.getByRole('button', { name: 'Change what this is' }));
    await user.selectOptions(screen.getByLabelText('This table contains'), 'employee');
    await user.type(screen.getByLabelText('Why'), 'Mistaken — testing the dead end.');
    await user.click(screen.getByRole('button', { name: 'Re-analyze as this' }));

    await screen.findByText('Nothing in this file can be imported');

    /**
     * The group is STILL on screen, with the correction that caused it and the
     * way back.
     *
     * It was not: `nothingToImport` replaced the entire group list with a
     * "choose a different file" card, so a wrong correction destroyed the only
     * control that could undo it. Re-uploading the file was the only recovery,
     * which makes the correction feature something a reviewer learns not to
     * touch.
     */
    expect(screen.getByText('What was found')).toBeTruthy();
    expect(screen.getByText(/You corrected this from/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change what this is' })).toBeTruthy();
    // And it is honest about why nothing can be written.
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('refuses to submit a correction with no reason', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('orders.csv', ORDERS));

    await user.click(screen.getByRole('button', { name: 'Change what this is' }));
    await user.selectOptions(screen.getByLabelText('This table contains'), 'employee');

    const apply = screen.getByRole('button', { name: 'Re-analyze as this' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByText(/written to the audit log under your name/)).toBeTruthy();
  });
});

/* ── 2. Row preview ────────────────────────────────────────────────────── */

describe('looking at the rows before approving them', () => {
  it('puts the real prepared values on screen', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('customers.csv', CUSTOMERS));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));
    const [acme, borealis] = rowCards();
    expect(within(acme!).getByText('Acme Ltd')).toBeTruthy();
    expect(within(borealis!).getByText('Borealis Trading')).toBeTruthy();

    // Values are behind an explicit reveal, and really are the mapped values.
    await user.click(within(acme!).getByText('Show values'));
    // `getAllBy`: the address appears both as the incoming value and, once a
    // match exists, in the differences table.
    await waitFor(() => expect(within(acme!).getAllByText('a@acme.example').length).toBeGreaterThan(0));
    expect(within(acme!).getByText('CUS-1')).toBeTruthy();
  });

  it('never renders a sensitive value — not as data, not inside an error', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('payroll.csv', PAYROLL));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));

    // Reveal BOTH rows, including the one whose salary failed to parse — the
    // error message for that row embeds the offending value upstream.
    for (const card of rowCards()) {
      await user.click(within(card).getByText('Show values'));
    }

    const html = container.innerHTML;
    expect(html).not.toContain('125000');
    expect(html).not.toContain('not-a-number');
    // The field is still ACKNOWLEDGED. Hiding the value is not the same as
    // pretending the column was not there.
    expect(screen.getAllByText(/hidden/i).length).toBeGreaterThan(0);
  });

  it('a search box cannot be used to probe a hidden value', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('payroll.csv', PAYROLL));
    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));

    // Searching the hidden value finds NOTHING — the haystack excludes
    // redacted fields, so the box cannot be used to confirm a salary one digit
    // at a time.
    //
    // Asserting the EMPTY STATE, not just "no row cards": a rejected preview
    // also renders zero row cards (the panel turns the rejection into an error
    // block), so `toHaveLength(0)` alone cannot tell working redaction from a
    // broken IPC call.
    await user.type(screen.getByLabelText('Search rows'), '125000');
    await waitFor(() => expect(screen.getByText(/No rows match this filter and search/)).toBeTruthy(), {
      timeout: 3000,
    });
    expect(rowCards()).toHaveLength(0);

    // …while a visible value still searches normally, which is what makes the
    // assertion above about redaction rather than a broken search box.
    await user.clear(screen.getByLabelText('Search rows'));
    await user.type(screen.getByLabelText('Search rows'), 'Asha');
    await waitFor(() => expect(rowCards()).toHaveLength(1), { timeout: 3000 });
    expect(within(rowCards()[0]!).getByText('Asha Rao')).toBeTruthy();
  });
});

/* ── 3. Row actions against existing records ───────────────────────────── */

describe('rows that match something already stored', () => {
  /** Seed a customer whose identity key the incoming file repeats exactly. */
  const seedAcme = async (): Promise<string> => {
    const store = stores.get('crm-customers')!;
    const rec = store.create({
      title: 'Acme Ltd',
      fields: { name: 'Acme Ltd', customerCode: 'CUS-1', email: 'old@acme.example', phone: '000' },
      actor: ACTOR,
      now: T0,
    });
    await store.flush();
    return rec.id;
  };

  it('offers skip and update but NOT create — an exact identity match cannot be duplicated', async () => {
    await seedAcme();
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('customers.csv', CUSTOMERS));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));
    const row = rowCards()[0]!;

    expect(within(row).getByText(/Matches/)).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Update the existing record' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /^Create/ })).toBeNull();
  });

  it('choosing update actually updates the stored record instead of creating a second one', async () => {
    const existingId = await seedAcme();
    const store = stores.get('crm-customers')!;
    expect(store.list({ status: 'active', limit: 100 }).length).toBe(1);

    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('customers.csv', CUSTOMERS));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));
    await user.click(within(rowCards()[0]!).getByRole('button', { name: 'Update the existing record' }));

    await approveGroup('Checked against the signed customer register.');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Import another file', {}, { timeout: 5000 });

    const all = store.list({ status: 'active', limit: 100 });
    // One record, not two: the whole point of matching before writing.
    expect(all.filter((r) => r.fields.customerCode === 'CUS-1').length).toBe(1);
    const updated = all.find((r) => r.id === existingId);
    expect(updated?.fields.email).toBe('a@acme.example');
  });

  it('shows what an update would overwrite, before it is chosen', async () => {
    await seedAcme();
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('customers.csv', CUSTOMERS));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));
    const row = rowCards()[0]!;
    await user.click(within(row).getByText('Show values'));

    await waitFor(() => expect(within(row).getByText('What updating would change')).toBeTruthy());
    // The value being LOST is named, not just the value arriving. A diff that
    // shows only the new value is not a diff.
    expect(within(row).getByText('old@acme.example')).toBeTruthy();
    expect(within(row).getAllByText('a@acme.example').length).toBeGreaterThan(0);
  });
});

/* ── 4. Near-duplicates: the engine refuses, so the screen must ask ────── */

describe('rows that only match after normalising', () => {
  /**
   * A name-only file against a name-only record.
   *
   * `identityOf` returns the FIRST complete keyset, and customer identity is
   * `[[customerCode], [email], [name]]` — so a row carrying a code keys on the
   * code and matches EXACTLY. Dropping the other columns is what forces the
   * name path, where "Acme Pvt Ltd" and "Acme Private Limited" agree only
   * after canonicalisation. That is the near-duplicate case, and it is the one
   * the engine deliberately will not decide.
   */
  const NAME_ONLY = [
    'Customer Name,Phone',
    'Acme Private Limited,+91 90000 00001',
    'Borealis Trading,+91 90000 00002',
  ].join('\n');

  const seedNameOnly = async (): Promise<void> => {
    const store = stores.get('crm-customers')!;
    store.create({ title: 'Acme Pvt Ltd', fields: { name: 'Acme Pvt Ltd' }, actor: ACTOR, now: T0 });
    await store.flush();
  };

  it('asks instead of guessing, and pre-selects nothing', async () => {
    await seedNameOnly();
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('names.csv', NAME_ONLY));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));
    const row = rowCards()[0]!;

    // Hedged language, not the confident "Matches" used for an exact hit.
    expect(within(row).getByText(/Looks like/)).toBeTruthy();
    expect(within(row).getByText(/needs a person/)).toBeTruthy();
    expect(within(row).getByText('Needs a decision')).toBeTruthy();

    // All three are on offer, because normalisation agreeing is a hint: two
    // real companies can normalise to the same string.
    const update = within(row).getByRole('button', { name: 'Update the existing record' });
    const create = within(row).getByRole('button', { name: /^Create new/ });
    const skip = within(row).getByRole('button', { name: 'Skip' });

    /**
     * NOTHING is pre-selected. The engine's `review` verdict is a refusal to
     * answer, and rendering it as a highlighted default would convert that
     * refusal into an answer the reviewer never gave.
     */
    for (const button of [update, create, skip]) {
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('an undecided row is counted on screen and then skipped, not guessed', async () => {
    await seedNameOnly();
    const store = stores.get('crm-customers')!;
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('names.csv', NAME_ONLY));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));

    // Stated before the click, not discovered in the results.
    expect(screen.getByText(/1 row needs a decision/)).toBeTruthy();

    await approveGroup('Importing the rest; leaving the ambiguous one.');
    await waitFor(() =>
      expect(screen.getByText(/still awaiting a decision and will be skipped/)).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Import another file', {}, { timeout: 5000 });

    // The unambiguous row went in; the ambiguous one did not produce a twin,
    // and the record it resembled is untouched.
    const names = store.list({ status: 'active', limit: 100 }).map((r) => r.fields.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('Acme Pvt Ltd');
    expect(names).toContain('Borealis Trading');
    expect(names).not.toContain('Acme Private Limited');
  });

  it('deciding "create" really does add the separate record', async () => {
    await seedNameOnly();
    const store = stores.get('crm-customers')!;
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('names.csv', NAME_ONLY));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));

    // Present FIRST. `waitFor(queryBy…toBeNull)` succeeds on its first poll, so
    // asserting only the absence would pass just as happily against a warning
    // that never rendered, or a regex that had drifted.
    expect(screen.getByText(/1 row needs a decision/)).toBeTruthy();

    await user.click(within(rowCards()[0]!).getByRole('button', { name: /^Create new/ }));

    // …and gone once it is answered.
    await waitFor(() => expect(screen.queryByText(/1 row needs a decision/)).toBeNull());

    await approveGroup('They are different companies.');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Import another file', {}, { timeout: 5000 });

    const names = store.list({ status: 'active', limit: 100 }).map((r) => r.fields.name);
    expect(names).toHaveLength(3);
    expect(names).toContain('Acme Pvt Ltd');
    expect(names).toContain('Acme Private Limited');
  });
});

/* ── 5. A failed import must not destroy the review ────────────────────── */

describe('when the import itself fails', () => {
  it('keeps the plan, the decisions and the approval reason on screen', async () => {
    const store = stores.get('crm-customers')!;
    store.create({
      title: 'Acme Ltd',
      fields: { name: 'Acme Ltd', customerCode: 'CUS-1', email: 'old@acme.example' },
      actor: ACTOR,
      now: T0,
    });
    await store.flush();

    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    await upload(container, fileOf('customers.csv', CUSTOMERS));

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards()).toHaveLength(2));
    await user.click(within(rowCards()[0]!).getByRole('button', { name: 'Update the existing record' }));
    await approveGroup('Checked against the register.');

    // Make the write fail the way it really can: the scope goes away between
    // review and click.
    granted.delete('crm:read');
    await user.click(screen.getByRole('button', { name: 'Import' }));

    // `Missing permission crm:read` → the permission branch of `friendlyError`.
    await screen.findByText('Permission required', {}, { timeout: 5000 });

    /**
     * Everything the reviewer built is STILL THERE.
     *
     * It was not: a failure moved the panel to the error stage, which renders
     * an error card and nothing else, and both of its buttons called
     * `startOver`. A reviewer who had paged through the rows, answered the
     * ambiguous ones and written an approval reason lost all of it — on the
     * error they are most likely to see, the stale-match refusal.
     */
    expect(screen.getByText('What was found')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Why are you approving this?') as HTMLTextAreaElement).value).toBe(
      'Checked against the register.',
    );
    expect(
      within(rowCards()[0]!)
        .getByRole('button', { name: 'Update the existing record' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    // And the same click succeeds once the cause is gone — no re-upload.
    granted.add('crm:read');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Import another file', {}, { timeout: 5000 });
    expect(store.list({ status: 'active', limit: 100 })).toHaveLength(2);
  });
});

/* ── 6. Nothing silently unrouted ──────────────────────────────────────── */

describe('the wiring itself', () => {
  it('every channel the import screen touches is a real handler', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportPanel onImported={noop} />);
    // Payroll → customer, because those are the only two entities whose
    // destination modules this fixture registers, and the correction has to
    // land somewhere importable for `dp:import` to be exercised at all.
    await upload(container, fileOf('payroll.csv', PAYROLL));

    // Drive ALL of them in one pass. An earlier version of this test stopped
    // at the preview, so `dp:reclassify` and `dp:import` — the two write-side
    // channels — were outside the very check named after them.
    await user.click(screen.getByRole('button', { name: 'Change what this is' }));
    await user.selectOptions(screen.getByLabelText('This table contains'), 'customer');
    await user.type(screen.getByLabelText('Why'), 'Exercising the reclassify channel.');
    await user.click(screen.getByRole('button', { name: 'Re-analyze as this' }));
    await screen.findByText(/You corrected this from/);

    await user.click(screen.getByRole('button', { name: 'Look at the rows' }));
    await waitFor(() => expect(rowCards().length).toBeGreaterThan(0));

    await approveGroup('Exercising the import channel.');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Import another file', {}, { timeout: 5000 });

    /**
     * A rejected channel is caught by the panel and rendered as "the rows
     * could not be shown", which looks exactly like a legitimate permission
     * refusal. Without this check a typo in a channel name would leave the
     * suite green while the feature was dead.
     */
    expect(unroutedChannels()).toEqual([]);
  });
});
