/**
 * In-app help catalog (Phase 8 · RC hardening 8.14) — the FIXED set of
 * documentation the app can open. Docs are bundled into the packaged build
 * (electron-builder extraResources → resources/docs), so a pilot user with
 * nothing but the DMG has real documentation one click away.
 *
 * Fail-closed by construction: the IPC contract validates against this enum,
 * and the main handler resolves ONLY these relative paths under the bundled
 * docs root — there is no arbitrary-path or arbitrary-URL surface.
 */

export const HELP_DOC_IDS = [
  'quick-start',
  'installation',
  'user-finance',
  'user-hr',
  'user-inventory-procurement',
  'pilot-orientation',
  'troubleshooting',
  'eula',
  'privacy',
  'third-party-notices',
] as const;

export type HelpDocId = (typeof HELP_DOC_IDS)[number];

export interface HelpDocMeta {
  id: HelpDocId;
  title: string;
  description: string;
  /** Path relative to the bundled docs root (and to docs/ in the repo for dev). */
  relativePath: string;
}

export const HELP_DOCS: readonly HelpDocMeta[] = [
  { id: 'quick-start', title: 'Quick Start', description: 'Get productive in your first session.', relativePath: 'guides/QUICK-START.md' },
  { id: 'installation', title: 'Installation', description: 'Install NeuroPause and get past first launch.', relativePath: 'guides/INSTALLATION.md' },
  { id: 'user-finance', title: 'Finance Guide', description: 'Chart of accounts, invoices, payments and journals.', relativePath: 'user/FINANCE-GETTING-STARTED.md' },
  { id: 'user-hr', title: 'HR & Payroll Guide', description: 'Employees, attendance, leave and payroll runs.', relativePath: 'user/HR-GETTING-STARTED.md' },
  { id: 'user-inventory-procurement', title: 'Inventory & Procurement Guide', description: 'Products, purchase orders and goods receipt.', relativePath: 'user/INVENTORY-PROCUREMENT-GETTING-STARTED.md' },
  { id: 'pilot-orientation', title: 'Pilot Orientation', description: 'What the pilot includes and how to give feedback.', relativePath: 'user/PILOT-ORIENTATION.md' },
  { id: 'troubleshooting', title: 'Troubleshooting', description: 'Common issues and how to collect diagnostics.', relativePath: 'guides/TROUBLESHOOTING.md' },
  { id: 'eula', title: 'License Agreement (EULA)', description: 'The end-user license agreement for this software.', relativePath: 'legal/EULA.md' },
  { id: 'privacy', title: 'Privacy Notice', description: 'What the app stores locally and what ever leaves the device.', relativePath: 'legal/PRIVACY.md' },
  { id: 'third-party-notices', title: 'Third-Party Notices', description: 'Open-source licenses bundled with the app.', relativePath: 'THIRD-PARTY-NOTICES.md' },
];

export const HELP_DOC_BY_ID: Record<HelpDocId, HelpDocMeta> = Object.fromEntries(
  HELP_DOCS.map((d) => [d.id, d]),
) as Record<HelpDocId, HelpDocMeta>;
