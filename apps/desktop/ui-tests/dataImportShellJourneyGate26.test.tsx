/**
 * P13C ROUND 61 — GATE 26. THE DATA IMPORT, REACHED AS A USER REACHES IT.
 *
 * THE GAP this closes, quoted from the Gate-26 row: the driven journey "covered
 * account→onboarding→AI→settings→switcher→relaunch but not an interactive
 * Data-import click-through".
 *
 * `dataImport.ui.test.tsx` already drives the import PIPELINE hard — 12 tests
 * over entity correction, redaction, row actions, near-duplicates. But every one
 * of them mounts `<ImportPanel>` in ISOLATION. Nothing had ever proved a user can
 * REACH it: sidebar → lazy Suspense chunk → tab strip → panel. A panel that works
 * perfectly and cannot be navigated to is not a feature, and only a shell-level
 * mount can tell the difference.
 *
 * So this file deliberately does NOT re-litigate the twelve pipeline behaviours.
 * Its whole value is the PATH, plus one end-to-end write that proves the path
 * carries real data to the real store.
 *
 * Everything below the App is real: real AppShell, real Sidebar, real lazy
 * chunk, real DataCommandCenterView, real ImportPanel, real `initDataPlane`
 * handlers over real temp files and real Zod schemas. Only Electron's message
 * transport and the auth status are substituted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AuthStatus,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { route, clearRoutes, unroutedChannels } from './setup';
import { initDataPlane } from '@main/dataPlane';
import { EnterpriseRecordStore } from '@main/enterprise/framework/enterpriseRecordStore';
import { TEST_TENANT_SCOPE } from '@main/tenancy/testScope';

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}));

const LOCAL: AuthStatus = {
  state: 'local',
  principal: { id: 'device-1', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' },
};

vi.mock('@renderer/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ status: LOCAL, initializing: false }),
}));

const { default: App } = await import('@renderer/App');
const { ThemeProvider } = await import('@renderer/providers/ThemeProvider');

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';

const CUSTOMERS = [
  'Customer Code,Customer Name,Email,Phone,Credit Limit',
  'CUS-1,Acme Ltd,a@acme.example,+91 98765 43210,50000',
  'CUS-2,Borealis Trading,b@bor.example,+91 98765 43211,25000',
].join('\n');

/**
 * ONE destination module, deliberately. Under a full-shell mount the approval
 * checkbox and the Import button are queried from the whole document; a second
 * table would make both ambiguous. Keep this single-module, or switch to scoped
 * `within(...)` queries before adding one.
 */
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
      { key: 'code', label: 'Customer Code', type: 'text' },
      { key: 'name', label: 'Customer Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'creditLimit', label: 'Credit Limit', type: 'number' },
    ],
  },
];

let dir: string;
let stores: Map<string, EnterpriseRecordStore>;
let granted: Set<EnterprisePermission>;

/** jsdom's File may lack arrayBuffer(); ImportPanel reads bytes before anything else. */
function fileOf(name: string, body: string): File {
  const file = new File([body], name, { type: 'text/csv' });
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(body).buffer,
    });
  }
  return file;
}

function routeBoot(): void {
  route(IpcChannel.WorkspaceCtxBootstrap, () => ({
    workspaces: [{ id: 'wsc_1', name: 'Default', color: '#8888ff' }],
    activeId: 'wsc_1',
    activeSnapshot: { activeSection: 'intent-home', tabs: [], activeTabId: null },
  }));
  route(IpcChannel.ExperienceProfileGet, () => ({
    state: 'completed',
    workspaceType: null,
    aiModeChosen: true,
    attributes: [],
    completedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }));
  route(IpcChannel.OnboardingStatus, () => ({
    firstRun: false,
    startedAt: null,
    completedAt: null,
    steps: [],
    nextStep: null,
  }));
  route(IpcChannel.AppGetThemeSource, () => 'system');
  route(IpcChannel.AppGetInfo, () => ({ version: '0.0.0-test', platform: 'darwin', arch: 'arm64' }));
  route(IpcChannel.LiveSyncStatus, () => null);
  route(IpcChannel.IntentBoard, () => ({ intents: [], roleViews: [] }));
  route(IpcChannel.IntentWorkspaces, () => ({ workspaces: [] }));
  route(IpcChannel.IntentGovernance, () => ({}));
  route(IpcChannel.EnterpriseWorkspaceActive, () => ({
    id: 'workspace-default',
    name: 'Default Workspace',
    organizationId: 'org-default',
  }));
  // Served by the identity subsystem, NOT by initDataPlane — the host view fires
  // it on mount and it must be routed separately or the panel never settles.
  route(IpcChannel.IdentityQueue, () => []);
}

beforeEach(async () => {
  cleanup();
  clearRoutes();
  routeBoot();

  dir = join(tmpdir(), `np-import-shell-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  granted = new Set<EnterprisePermission>([
    'data:read',
    'data:import',
    'data:approve',
    'crm:read',
    'crm:manage',
  ]);
  stores = new Map(
    DESCRIPTORS.map((d) => [
      d.id,
      new EnterpriseRecordStore(join(dir, `${d.id}.json`), d.id, d.id).bindScope(
        () => TEST_TENANT_SCOPE,
      ),
    ]),
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
  // Every Data Plane channel, wired to its REAL handler through its REAL schema.
  for (const h of sub.handlers) {
    route(h.channel, (payload) => h.handler(h.schema.parse(payload)));
  }
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/** Mount the real App and wait for the real sidebar. */
async function mountShell(): Promise<void> {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  await screen.findByRole('button', { name: 'Business' }, { timeout: 5000 });
}

describe('data import reached through the real shell (Gate 26)', () => {
  it('navigates sidebar → Data → Import and completes a real import end to end', async () => {
    const user = userEvent.setup();
    await mountShell();

    // (1) The import surface is NOT the landing section — so what follows is a
    // real navigation, not an artefact of where the shell happens to open.
    expect(screen.queryByText('Drop a file here')).toBeNull();

    // (2) The user clicks "Data" in the real sidebar; the lazy chunk must resolve.
    await user.click(screen.getByRole('button', { name: 'Data' }));
    const tabs = await screen.findByRole('tablist', {}, { timeout: 5000 });

    // (3) …and picks the Import tab from the real tab strip.
    await user.click(within(tabs).getByRole('tab', { name: /Import/ }));
    await screen.findByText('Drop a file here', {}, { timeout: 5000 });

    // (4) Upload. The visible "Choose a file" button only proxies to a hidden
    // input, which opens no picker in jsdom — drive the input itself.
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input rendered');
    await user.upload(input, fileOf('customers.csv', CUSTOMERS));
    await screen.findByText('What was found', {}, { timeout: 5000 });

    // (5) Approve the single group, supplying a reason only if this reading is
    // classified high-risk — whether it is depends on the fixture, so ask.
    const box = screen.getByRole('checkbox');
    if (!(box as HTMLInputElement).checked) await user.click(box);
    const reason = screen.queryByLabelText('Why are you approving this?');
    if (reason) await user.type(reason, 'verified against the source system');

    // (6) Commit.
    await user.click(screen.getByRole('button', { name: 'Import' }));

    // (7) THE PROOF THE PATH CARRIES DATA: the real store, on disk, has the rows.
    await waitFor(
      async () => {
        const store = stores.get('crm-customers');
        expect(store).toBeTruthy();
        expect((await store!.list()).length).toBe(2);
      },
      { timeout: 8000 },
    );
  });

  it('leaves no data-plane channel unrouted along the journey', async () => {
    const user = userEvent.setup();
    await mountShell();
    await user.click(screen.getByRole('button', { name: 'Data' }));
    const tabs = await screen.findByRole('tablist', {}, { timeout: 5000 });
    await user.click(within(tabs).getByRole('tab', { name: /Import/ }));
    await screen.findByText('Drop a file here', {}, { timeout: 5000 });

    // Scoped, not blanket: a full-App mount legitimately fires unrelated shell
    // channels (notifications, flags, runtimeState…) that their callers swallow.
    // Narrowing to the subsystem under test keeps the protection this assertion
    // exists for — a channel-name typo silently becoming a passing test — without
    // failing on noise that is not this journey's business.
    const relevant = unroutedChannels().filter(
      (c) => c.startsWith('dp:') || c === 'identity:queue',
    );
    expect(relevant).toEqual([]);
  });
});
