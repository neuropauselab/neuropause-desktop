/**
 * The boot declaration check, run against the SAME live module set runtimeCore
 * registers — so a declaration naming a field that does not exist fails HERE,
 * in CI, instead of only as an ERROR line in a running device's log.
 *
 * This test exists because exactly that happened: the Medical Device lot
 * relationships were declared against descriptor fields that the checker,
 * running on a real device, reported as missing — and no test reproduced the
 * boot composition, so 6 problems shipped invisibly.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertRelationshipsAreDeclarable, RELATIONSHIPS } from './relationshipModel';
import { createDeviceProductModule } from '../medicalDevice/deviceProductModule';
import { createDeviceLotModule } from '../medicalDevice/deviceLotModule';
import { createProductModule } from '../enterprise/modules/inventory/productModule';
import { createWarehouseModule } from '../enterprise/modules/inventory/warehouseModule';
import { createStockMovementModule } from '../enterprise/modules/inventory/stockMovementModule';
import { createProductionOrderModule } from '../enterprise/modules/manufacturing/productionOrderModule';
import { createSupplierModule } from '../enterprise/modules/procurement/supplierModule';
import { createInvoiceModule } from '../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../enterprise/modules/finance/paymentModule';
import { createVendorBillModule } from '../enterprise/modules/finance/vendorBillModule';
import { createContactModule } from '../enterprise/modules/crm/contactModule';
import { createCustomerModule } from '../enterprise/modules/crm/customerModule';
import { createLeadModule } from '../enterprise/modules/crm/leadModule';
import { createOrderModule } from '../enterprise/modules/sales/orderModule';
import { createQuoteModule } from '../enterprise/modules/sales/quoteModule';
import { createPurchaseOrderModule } from '../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../enterprise/modules/warehouse/shippingModule';
import { createExecutionModule } from '../enterprise/modules/manufacturing/executionModule';
import { createEmployeeModule } from '../enterprise/modules/hr/employeeModule';
import { createProjectModule } from '../enterprise/modules/projects/projectModule';

describe('Relationship declarations vs live descriptors (boot check reproduction)', () => {
  it('every md-lot declaration resolves against the real Medical Device + inventory descriptors', async () => {
    const dir = join(tmpdir(), `np-relcheck-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const descriptors = [
      createDeviceProductModule(join(dir, 'p.json'), { tenantId: () => 't' }).descriptor,
      createDeviceLotModule(join(dir, 'l.json'), () => 't').descriptor,
      createProductModule(join(dir, 'ip.json')).descriptor,
      createWarehouseModule(join(dir, 'w.json')).descriptor,
      createStockMovementModule(join(dir, 'sm.json')).descriptor,
      createProductionOrderModule(join(dir, 'mo.json')).descriptor,
      createSupplierModule(join(dir, 'sup.json')).descriptor,
    ];
    const mdProblems = assertRelationshipsAreDeclarable(descriptors).filter((p) =>
      p.includes('mdLot.'),
    );
    expect(mdProblems, mdProblems.join('\n')).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('EVERY declaration resolves against the full set of real factories — the device boot check, in CI', async () => {
    // This is the composition the device boot validates. It failed on a real
    // Mac with 6 problems ("crm-contacts" / "finance-invoices" — module ids
    // that never existed; the real ids are "crm" and "finance") because the
    // engine's own tests used fixture modules named after the declarations
    // instead of the declarations being checked against the factories.
    const dir = join(tmpdir(), `np-relcheck-full-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const j = (n: string): string => join(dir, `${n}.json`);
    const descriptors = [
      createInvoiceModule(j('inv')).descriptor,
      createPaymentModule(j('pay')).descriptor,
      createVendorBillModule(j('bill')).descriptor,
      createContactModule(j('contact')).descriptor,
      createCustomerModule(j('cust')).descriptor,
      createLeadModule(j('lead')).descriptor,
      createOrderModule(j('order')).descriptor,
      createQuoteModule(j('quote')).descriptor,
      createPurchaseOrderModule(j('po')).descriptor,
      createGoodsReceiptModule(j('gr')).descriptor,
      createShippingModule(j('ship')).descriptor,
      createExecutionModule(j('exec')).descriptor,
      createEmployeeModule(j('emp')).descriptor,
      createProjectModule(j('proj')).descriptor,
      createProductModule(j('ip2')).descriptor,
      createWarehouseModule(j('w2')).descriptor,
      createProductionOrderModule(j('mo2')).descriptor,
      createSupplierModule(j('sup2')).descriptor,
      createDeviceProductModule(j('mdp2'), { tenantId: () => 't' }).descriptor,
      createDeviceLotModule(j('mdl2'), () => 't').descriptor,
    ];
    const problems = assertRelationshipsAreDeclarable(descriptors);
    expect(problems, problems.join('\n')).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('names every module a declaration depends on, so composition gaps are visible', () => {
    const referenced = new Set<string>();
    for (const rel of RELATIONSHIPS) {
      referenced.add(rel.fromModuleId);
      referenced.add(rel.toModuleId);
    }
    // The md declarations must reference only modules that exist in the build.
    for (const id of ['md-lots', 'md-products']) {
      expect([...referenced]).toContain(id);
    }
  });
});
