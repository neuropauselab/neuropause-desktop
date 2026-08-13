/**
 * Medical Device Pack → Products.
 *
 * An Enterprise Module like every other one: a descriptor plus the framework's
 * record store. CRUD, RBAC, audit, timeline events, renderer broadcasts,
 * offline persistence and the generic list/detail/form UI are INHERITED — none
 * of it is re-implemented here, which is the whole reason the pack sits on the
 * framework rather than beside it.
 *
 * What this file adds on top of the descriptor is the small set of rules the
 * generic validator cannot express:
 *   • product codes are unique within a tenant, compared on a normalized key
 *     so `TR-1001`, `tr 1001` and `tr.1001` cannot coexist as three products;
 *   • regulatory metadata must be a JSON object, refused with a readable
 *     message rather than silently stored as unparseable text;
 *   • a serial-tracked article must also be lot-tracked, because a serial
 *     number that cannot be attributed to a batch cannot be recalled by batch.
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  ANATOMICAL_TAXONOMY,
  DEVICE_PRODUCTS_MODULE_ID,
  DEVICE_PRODUCT_KIND,
  MATERIAL_TAXONOMY,
  PRODUCT_CATEGORY_TAXONOMY,
  PRODUCT_FAMILY_TAXONOMY,
  REGULATORY_METADATA_FIELD,
  STERILE_STATUS_TAXONOMY,
  deviceProductFromRecord,
  normalizeProductCode,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../enterprise/framework';

const options = (t: typeof PRODUCT_FAMILY_TAXONOMY): { value: string; label: string; tone?: string }[] =>
  t.values.map((v) => ({ value: v.value, label: v.label, ...(v.tone ? { tone: v.tone } : {}) }));

/**
 * The declarative description of a medical device product.
 *
 * Only `productCode` and `productName` are required. Every classification field
 * is optional because a manufacturer's catalogue is populated over time and a
 * form that refuses a product until its anatomical category is chosen produces
 * guessed data, which is worse than absent data on a record a recall reads.
 */
export const DEVICE_PRODUCT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: DEVICE_PRODUCTS_MODULE_ID,
  title: 'Medical Device Products',
  singular: 'Product',
  plural: 'Products',
  icon: 'package',
  description:
    'The device catalogue: identity, classification, material, sterility, packaging and traceability configuration. Records what the manufacturer knows; makes no regulatory claim.',
  group: 'Medical Devices',
  titleField: 'productName',
  permissions: { read: 'medicalDevice:product.read', write: 'medicalDevice:product.write' },
  fields: [
    { key: 'productCode', label: 'Product Code', type: 'text', required: true, placeholder: 'TR-1001' },
    { key: 'productName', label: 'Product Name', type: 'text', required: true, placeholder: '4.5mm Cortical Screw' },
    {
      key: 'productFamily',
      label: 'Family',
      type: 'select',
      filterable: true,
      options: options(PRODUCT_FAMILY_TAXONOMY),
    },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      filterable: true,
      options: options(PRODUCT_CATEGORY_TAXONOMY),
    },
    {
      key: 'anatomicalCategory',
      label: 'Anatomical Category',
      type: 'select',
      column: false,
      options: options(ANATOMICAL_TAXONOMY),
    },
    { key: 'material', label: 'Material', type: 'select', filterable: true, options: options(MATERIAL_TAXONOMY) },
    { key: 'size', label: 'Size', type: 'text', column: false, placeholder: '4.5 × 40 mm' },
    { key: 'dimensions', label: 'Dimensions', type: 'text', column: false, placeholder: 'Ø4.5 mm, L40 mm' },
    {
      key: 'sterileStatus',
      label: 'Sterility',
      type: 'select',
      default: 'not_specified',
      badge: true,
      filterable: true,
      options: options(STERILE_STATUS_TAXONOMY),
      help: 'The sterility state you record for this article. NeuroPause cannot verify it and does not claim to.',
    },
    { key: 'packaging', label: 'Packaging', type: 'text', column: false, placeholder: 'Single sterile blister' },
    {
      key: 'batchLotTracked',
      label: 'Batch / Lot Tracked',
      type: 'boolean',
      default: true,
      help: 'Lots can only be recorded for products with this on.',
    },
    {
      key: 'serialTracked',
      label: 'Serial Tracked',
      type: 'boolean',
      default: false,
      column: false,
      help: 'Serial tracking requires batch/lot tracking — a serial that cannot be attributed to a batch cannot be recalled by batch.',
    },
    {
      key: 'udi',
      label: 'UDI',
      type: 'text',
      column: false,
      placeholder: 'Optional',
      help: 'Holding a UDI here records the identifier. It does not make anything UDI-compliant.',
    },
    {
      key: REGULATORY_METADATA_FIELD,
      label: 'Regulatory Metadata',
      type: 'textarea',
      column: false,
      placeholder: '{"riskClass":"IIb","market":"EU"}',
      help: 'Free-form JSON. What is required differs by device, market and year, so nothing here is mandatory and no schema is imposed.',
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'inactive', label: 'Inactive', tone: 'orange' },
        { value: 'discontinued', label: 'Discontinued', tone: 'neutral' },
      ],
    },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export interface DeviceProductModuleOptions {
  /**
   * The tenant a write belongs to. Injected rather than read from a global so
   * the module is testable and so a cross-tenant write is impossible by
   * construction — the caller never supplies the tenant.
   */
  tenantId: () => string;
}

/** Build the Medical Device Products module. */
export function createDeviceProductModule(
  storePath: string,
  options: DeviceProductModuleOptions,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, DEVICE_PRODUCTS_MODULE_ID, DEVICE_PRODUCT_KIND);
  return defineEnterpriseModule({
    descriptor: DEVICE_PRODUCT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(DEVICE_PRODUCT_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        const tenantId = options.tenantId();

        const code = str(result.values.productCode).trim();
        if (code) {
          const key = normalizeProductCode(code);
          // Uniqueness is checked against the CURRENT record set, in this
          // tenant only. `input.recordId` is set by the update path so a
          // product never collides with itself.
          const selfId = str(input.recordId);
          const clash = store
            .list()
            .find(
              (r) =>
                r.id !== selfId &&
                str(r.metadata?.tenantId) === tenantId &&
                normalizeProductCode(str(r.fields.productCode)) === key,
            );
          if (clash) {
            errors.productCode = `Product code "${code}" is already used by "${clash.title}". Codes must be unique — comparison ignores case, spaces, dots and dashes.`;
          }
        }

        const meta = str(result.values[REGULATORY_METADATA_FIELD]).trim();
        if (meta) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(meta);
          } catch {
            parsed = undefined;
          }
          if (parsed === undefined || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            errors[REGULATORY_METADATA_FIELD] =
              'Regulatory metadata must be a JSON object, e.g. {"riskClass":"IIb"}. Leave it empty if you have nothing to record.';
          }
        }

        if (result.values.serialTracked === true && result.values.batchLotTracked !== true) {
          errors.serialTracked =
            'Serial tracking needs batch/lot tracking — a serial number that cannot be attributed to a batch cannot be recalled by batch.';
        }

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      onChange: ({ record }) => {
        // Stamp the tenant on first write. The record store copies metadata
        // through unchanged, so this is the one place tenancy is decided and
        // the renderer has no way to influence it.
        if (!str(record.metadata?.tenantId)) {
          store.update(record.id, { metadata: { tenantId: options.tenantId() } });
        }
      },
      summarize: async (record: EnterpriseEntity): Promise<EnterpriseRecordSummary> => {
        const product = deviceProductFromRecord(record);
        const tracking = product.batchLotTracked
          ? product.serialTracked
            ? 'batch/lot and serial tracked'
            : 'batch/lot tracked'
          : 'not batch/lot tracked';
        return {
          moduleId: DEVICE_PRODUCTS_MODULE_ID,
          recordId: record.id,
          headline: `${product.productCode} · ${product.productName}`,
          summary:
            `${product.productName} (${product.productCode})` +
            (product.productFamily ? `, filed under ${product.productFamily}` : '') +
            (product.material ? `, ${product.material}` : '') +
            ` — ${tracking}.`,
          risk: product.batchLotTracked ? 'low' : 'medium',
          riskReason: product.batchLotTracked
            ? 'Batches of this product can be traced forward and backward.'
            : 'Batch/lot tracking is off, so this product cannot be traced by batch. Turn it on before recording lots.',
          executiveExplanation:
            'Classification here is catalogue configuration. NeuroPause makes no regulatory or certification claim about any product.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
