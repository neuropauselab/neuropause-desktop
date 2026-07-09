/**
 * Maintenance → Asset Categories — master data for classifying assets. Pure
 * framework CRUD (RBAC, audit, timeline, search, rendering); no stock effect.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { ASSET_CATEGORIES_MODULE_ID, ASSET_CATEGORY_KIND } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const ASSET_CATEGORY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ASSET_CATEGORIES_MODULE_ID,
  title: 'Asset Categories',
  singular: 'Asset Category',
  plural: 'Asset Categories',
  icon: 'tag',
  description: 'Classifications for maintainable assets.',
  group: 'Maintenance',
  titleField: 'name',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Production Equipment' },
    { key: 'code', label: 'Code', type: 'text', placeholder: 'CAT-01' },
    { key: 'description', label: 'Description', type: 'textarea', column: false },
  ],
};

export function createAssetCategoryModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ASSET_CATEGORIES_MODULE_ID, ASSET_CATEGORY_KIND);
  return defineEnterpriseModule({ descriptor: ASSET_CATEGORY_DESCRIPTOR, store });
}
