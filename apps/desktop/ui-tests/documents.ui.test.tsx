/**
 * Documents, rendered and clicked, against the real main handlers.
 *
 * The assertions that matter are the ones about what is NOT on screen and what
 * the screen refuses to claim:
 *   - a PDF is listed as stored and not readable, with the reason, and no
 *     extracted fields appear beside it;
 *   - every value can be expanded to the exact line of the document it was
 *     read from;
 *   - an arithmetic disagreement is shown before anything can be done with the
 *     numbers;
 *   - a candidate link is offered, and nothing is linked until a person
 *     presses the button.
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
import { initDocuments } from '@main/documents/index';
import { DocumentsPanel } from '@renderer/dataCommandCenter/DocumentsPanel';
import { TEST_TENANT_SCOPE } from '@main/tenancy/testScope';

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';

const INVOICE_TEXT = [
  'ACME LTD',
  'TAX INVOICE',
  '',
  'Invoice Number: INV-0001',
  'Invoice Date: 2026-08-10',
  'Vendor: Acme Ltd',
  'Bill To: Borealis Trading',
  'Currency: INR',
  'Subtotal: 1000',
  'Total Tax: 180',
  'Grand Total: 1180',
].join('\n');

const CUSTOMERS: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [{ key: 'name', label: 'Customer Name', type: 'text', required: true }],
};

let dir: string;
let stores: Map<string, EnterpriseRecordStore>;
let granted: Set<EnterprisePermission>;

function fileOf(name: string, body: Buffer | string, type = 'text/plain'): File {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const file = new File([bytes], name, { type });
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
  return file;
}

async function upload(container: HTMLElement, file: File): Promise<void> {
  const user = userEvent.setup();
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input rendered');
  await user.upload(input, file);
  await screen.findByText(file.name, {}, { timeout: 5000 });
}

beforeEach(async () => {
  cleanup();
  clearRoutes();
  dir = join(tmpdir(), `np-docs-ui-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  granted = new Set<EnterprisePermission>(['data:read', 'data:import', 'crm:read', 'crm:manage']);
  stores = new Map([
    ['crm-customers', new EnterpriseRecordStore(join(dir, 'crm.json'), 'crm-customers', 'crm-customers').bindScope(() => TEST_TENANT_SCOPE)],
  ]);
  await Promise.all([...stores.values()].map((s) => s.load()));

  const sub = initDocuments({
    userDataDir: dir,
    actor: () => ACTOR,
    now: () => T0,
    audit: () => undefined,
    authorize: (permission) => {
      if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
    },
    modules: () => [CUSTOMERS],
    storeFor: (id) => stores.get(id) ?? null,
  });
  for (const h of sub.handlers) route(h.channel, (payload) => h.handler(h.schema.parse(payload)));
});

afterEach(async () => {
  cleanup();
  await Promise.all([...stores.values()].map((s) => s.flush()));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('Documents', () => {
  it('states the OCR boundary before anything is uploaded', async () => {
    render(<DocumentsPanel />);
    // The reason a scan will not be read belongs on the drop zone, not in an
    // error the person only meets after picking a file.
    await waitFor(() => expect(screen.getByText(/No OCR engine is bundled/i)).toBeTruthy());
    expect(screen.getByText(/Readable:/).textContent).toContain('docx');
  });

  it('reads an invoice and shows the line each value came from', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('invoice.txt', INVOICE_TEXT));

    await screen.findByText('1180');
    expect(screen.getByText('INV-0001')).toBeTruthy();

    // Evidence is one click away, and it is the ACTUAL source line.
    const totalRow = screen.getByText('1180').closest('li')!;
    await user.click(within(totalRow).getByText('Source'));
    await waitFor(() => expect(within(totalRow).getByText('Grand Total: 1180')).toBeTruthy());
    expect(within(totalRow).getByText(/Line \d+/)).toBeTruthy();
  });

  it('a PDF is listed as stored and NOT read, with the reason', async () => {
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('scan.pdf', Buffer.from('%PDF-1.7\nbinary', 'ascii'), 'application/pdf'));

    await screen.findByText('Not readable');
    // Twice on purpose: once in the upload result line, once on the card. Both
    // are the engine's own words, not a UI paraphrase.
    expect(screen.getAllByText(/No PDF engine is bundled|PDF text extraction/i).length).toBeGreaterThan(0);
    // No fabricated extraction sits next to it.
    expect(screen.getByText('0 fields read')).toBeTruthy();
  });

  it('shows an arithmetic disagreement before the numbers can be used', async () => {
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('broken.txt', INVOICE_TEXT.replace('Grand Total: 1180', 'Grand Total: 1200')));

    // Uploading opens the document, so the disagreement is on screen without
    // anyone going looking for it.
    await screen.findByText('Needs review');
    await waitFor(() => expect(screen.getByText(/arithmetic does not agree/i)).toBeTruthy());
    // It names all three numbers and picks no winner — which of them was
    // misread is not knowable from the document alone.
    const message = screen.getByText(/arithmetic does not agree/i).textContent ?? '';
    expect(message).toContain('1000');
    expect(message).toContain('180');
    expect(message).toContain('1200');
  });

  it('offers a customer link and links nothing until a person confirms', async () => {
    const crm = stores.get('crm-customers')!;
    crm.create({ title: 'Borealis Trading', fields: { name: 'Borealis Trading' }, actor: ACTOR, now: T0 });
    await crm.flush();

    const user = userEvent.setup();
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('invoice.txt', INVOICE_TEXT));

    await screen.findByText(/Offered, not linked/i);
    expect(screen.getByText(/Not linked to anything yet/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirm link' }));
    await waitFor(() => expect(screen.getByText(new RegExp(`Confirmed by ${ACTOR}`))).toBeTruthy());
    // Once confirmed it stops being offered — a link is not a suggestion that
    // survives being accepted.
    expect(screen.queryByRole('button', { name: 'Confirm link' })).toBeNull();
  });

  it('a correction keeps the original next to it', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('invoice.txt', INVOICE_TEXT));

    const totalRow = (await screen.findByText('1180')).closest('li')!;
    await user.click(within(totalRow).getByText('Correct'));
    const box = within(totalRow).getByLabelText('New value for Total');
    await user.clear(box);
    await user.type(box, '11800');
    await user.type(
      within(totalRow).getByLabelText('Why Total is being corrected'),
      'The printed total is missing a digit.',
    );
    await user.click(within(totalRow).getByRole('button', { name: 'Save correction' }));

    await screen.findByText('Corrections');
    const entry = screen.getByText('Corrections').parentElement!;
    // Both values, and the person. Overwriting the extraction would lose the
    // fact that the machine and the person disagreed.
    expect(within(entry).getByText('1180')).toBeTruthy();
    expect(within(entry).getByText('11800')).toBeTruthy();
    expect(entry.textContent).toContain(ACTOR);
  });

  it('will not save a correction with no reason', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('invoice.txt', INVOICE_TEXT));

    const totalRow = (await screen.findByText('1180')).closest('li')!;
    await user.click(within(totalRow).getByText('Correct'));
    const save = within(totalRow).getByRole('button', { name: 'Save correction' }) as HTMLButtonElement;
    // The reason is kept forever alongside the original; an empty one makes
    // the record useless to whoever reads it next.
    expect(save.disabled).toBe(true);
  });

  it('asks rather than guessing when it cannot name the type', async () => {
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('notes.txt', 'Meeting notes. We agreed to reconvene next week.'));
    await screen.findByText('Not recognised');
    expect(screen.getByText(/please say which it is|no phrase/i)).toBeTruthy();
    // …and the control to answer is right there.
    expect(screen.getByLabelText('Change it to')).toBeTruthy();
  });

  it('every channel this screen touches is a real handler', async () => {
    const user = userEvent.setup();
    const { container } = render(<DocumentsPanel />);
    await upload(container, fileOf('invoice.txt', INVOICE_TEXT));
    await user.click(screen.getByLabelText('Search documents'));
    await waitFor(() => expect(unroutedChannels()).toEqual([]));
  });
});
