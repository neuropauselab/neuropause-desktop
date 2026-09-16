/**
 * ERP Session 89 — the reorder EXECUTION UI action, tested at the surface. Proves the operator path:
 * "Create Purchase Request" is offered ONLY for executable (READY_FOR_OPERATOR_REVIEW) rows, requires
 * an EXPLICIT confirmation before the governed command is dispatched, calls the governed helper with
 * the right arguments exactly once, and states plainly that it creates a draft PR only. No automatic
 * execution: nothing is dispatched without the confirm click.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockState = vi.hoisted(() => ({
  calls: [] as Array<{ reportId: string; sku: string }>,
  result: { ok: true, data: { requestNumber: 'PR-REORDER-REORDER-DECISION-2026-07-31-1-SKU-1' } } as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } },
}));

vi.mock('@renderer/lib/ipc', () => ({
  ipc: {
    platform: {
      createReorderPurchaseRequest: (reportId: string, sku: string) => {
        mockState.calls.push({ reportId, sku });
        return Promise.resolve(mockState.result);
      },
    },
  },
}));

import { ReorderExecutionPanel } from '@renderer/enterprise/modules/ReorderExecutionPanel';

const REPORT_NUMBER = 'REORDER-DECISION-2026-07-31-1';
const rows = JSON.stringify([
  { sku: 'SKU-1', availableStock: 5, openSupply: 0, reorderLevel: 20, suggestedQuantity: 45, estimatedOrderValue: 180, requiredApprovalSteps: ['Manager approval'], readinessStatus: 'READY_FOR_OPERATOR_REVIEW' },
  { sku: 'SKU-2', availableStock: 3, openSupply: 0, reorderLevel: 20, suggestedQuantity: 47, estimatedOrderValue: 0, requiredApprovalSteps: [], readinessStatus: 'SUPPLIER_DATA_MISSING' },
  { sku: 'SKU-3', availableStock: 900, openSupply: 0, reorderLevel: 20, suggestedQuantity: 0, estimatedOrderValue: null, requiredApprovalSteps: [], readinessStatus: 'REORDER_NOT_REQUIRED' },
]);

beforeEach(() => { mockState.calls = []; mockState.result = { ok: true, data: { requestNumber: `PR-REORDER-${REPORT_NUMBER}-SKU-1` } }; });
afterEach(() => cleanup());

const panel = (): JSX.Element => <ReorderExecutionPanel reportId="rep-1" reportNumber={REPORT_NUMBER} rowsJson={rows} />;

describe('S89 reorder execution UI', () => {
  it('offers "Create Purchase Request" ONLY for the executable row, and shows the draft-only statement + deterministic PR number', () => {
    render(panel());
    // Only SKU-1 (READY_FOR_OPERATOR_REVIEW) is offered.
    expect(screen.getByText('SKU-1')).toBeTruthy();
    expect(screen.queryByText('SKU-2')).toBeNull();
    expect(screen.queryByText('SKU-3')).toBeNull();
    expect(screen.getByText(/Draft PR #:/).textContent).toContain(`PR-REORDER-${REPORT_NUMBER}-SKU-1`);
    expect(screen.getByText(/DRAFT purchase request only/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Create Purchase Request/i })).toHaveLength(1);
  });

  it('requires EXPLICIT confirmation — clicking the button does NOT dispatch until Confirm', async () => {
    const user = userEvent.setup();
    render(panel());
    await user.click(screen.getByRole('button', { name: /Create Purchase Request/i }));
    // The confirmation appears; nothing has been dispatched yet.
    expect(mockState.calls).toHaveLength(0);
    const dialog = screen.getByRole('alertdialog', { name: /Confirm reorder execution/i });
    expect(within(dialog).getByText(/creates a draft PR only/i)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Confirm — create draft PR/i }));
    expect(mockState.calls).toEqual([{ reportId: 'rep-1', sku: 'SKU-1' }]);
    expect(await screen.findByText(/Draft purchase request PR-REORDER-.*-SKU-1 created/i)).toBeTruthy();
  });

  it('Cancel dismisses the confirmation without dispatching', async () => {
    const user = userEvent.setup();
    render(panel());
    await user.click(screen.getByRole('button', { name: /Create Purchase Request/i }));
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(mockState.calls).toHaveLength(0);
  });

  it('surfaces a governed refusal (e.g. stale) without pretending success', async () => {
    mockState.result = { ok: false, error: { code: 'REORDER_NOT_EXECUTABLE', message: 'The recommendation is stale. Regenerate before executing.' } };
    const user = userEvent.setup();
    render(panel());
    await user.click(screen.getByRole('button', { name: /Create Purchase Request/i }));
    await user.click(screen.getByRole('button', { name: /Confirm — create draft PR/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toMatch(/stale/i);
    expect(mockState.calls).toHaveLength(1);
  });

  it('renders nothing when no row is executable', () => {
    const noneExec = JSON.stringify([{ sku: 'SKU-9', suggestedQuantity: 0, readinessStatus: 'REORDER_NOT_REQUIRED' }]);
    const { container } = render(<ReorderExecutionPanel reportId="rep-1" reportNumber={REPORT_NUMBER} rowsJson={noneExec} />);
    expect(container.firstChild).toBeNull();
  });
});
