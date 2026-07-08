import { describe, expect, it } from 'vitest';
import {
  canTransitionRecordStatus,
  coerceFieldValue,
  deriveRecordTitle,
  matchesRecordSearch,
  validateEnterpriseRecordInput,
  validateModuleDescriptor,
  type EnterpriseEntity,
  type EnterpriseFieldDef,
  type EnterpriseModuleDescriptor,
} from '@neuropause/shared';

const DESC: EnterpriseModuleDescriptor = {
  id: 'crm',
  title: 'CRM',
  singular: 'Contact',
  plural: 'Contacts',
  icon: 'user',
  description: '',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'score', label: 'Score', type: 'number', min: 0, max: 100 },
    { key: 'stage', label: 'Stage', type: 'select', options: [{ value: 'lead', label: 'Lead' }] },
    { key: 'vip', label: 'VIP', type: 'boolean' },
  ],
  titleField: 'name',
  permissions: { read: 'operations:read', write: 'operations:manage' },
};

describe('coerceFieldValue', () => {
  const num: EnterpriseFieldDef = { key: 'n', label: 'N', type: 'number' };
  const bool: EnterpriseFieldDef = { key: 'b', label: 'B', type: 'boolean' };
  it('coerces by type and treats empty as null', () => {
    expect(coerceFieldValue(num, '42')).toBe(42);
    expect(coerceFieldValue(num, 'abc')).toBeNull();
    expect(coerceFieldValue(num, '')).toBeNull();
    expect(coerceFieldValue(bool, 'true')).toBe(true);
    expect(coerceFieldValue(bool, 0)).toBe(false);
  });
});

describe('validateEnterpriseRecordInput', () => {
  it('passes a valid record and coerces values', () => {
    const r = validateEnterpriseRecordInput(DESC, {
      fields: { name: 'Ada', score: '80', vip: 'true' },
    });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ name: 'Ada', score: 80, vip: true, stage: null });
  });

  it('flags a missing required field', () => {
    const r = validateEnterpriseRecordInput(DESC, { fields: { score: 10 } });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toMatch(/required/i);
  });

  it('enforces numeric bounds and select membership', () => {
    expect(validateEnterpriseRecordInput(DESC, { fields: { name: 'A', score: 200 } }).ok).toBe(
      false,
    );
    expect(validateEnterpriseRecordInput(DESC, { fields: { name: 'A', stage: 'ghost' } }).ok).toBe(
      false,
    );
  });
});

describe('status transitions', () => {
  it('permits active↔archived and →deleted; deleted is terminal', () => {
    expect(canTransitionRecordStatus('active', 'archived')).toBe(true);
    expect(canTransitionRecordStatus('archived', 'active')).toBe(true);
    expect(canTransitionRecordStatus('active', 'deleted')).toBe(true);
    expect(canTransitionRecordStatus('deleted', 'active')).toBe(false);
    expect(canTransitionRecordStatus('active', 'active')).toBe(true);
  });
});

describe('deriveRecordTitle', () => {
  it('prefers an explicit title, else the titleField, else a fallback', () => {
    expect(deriveRecordTitle(DESC, { name: 'Ada' }, 'Explicit')).toBe('Explicit');
    expect(deriveRecordTitle(DESC, { name: 'Ada' })).toBe('Ada');
    expect(deriveRecordTitle(DESC, { name: null })).toBe('Untitled Contact');
  });
});

describe('matchesRecordSearch', () => {
  const entity: EnterpriseEntity = {
    id: 'a',
    moduleId: 'crm',
    kind: 'contact',
    title: 'Ada Lovelace',
    status: 'active',
    fields: { company: 'Analytical Engines' },
    tags: ['vip'],
    rev: 1,
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    metadata: {},
  };
  it('matches title, tags, and field values case-insensitively', () => {
    expect(matchesRecordSearch(entity, 'ada')).toBe(true);
    expect(matchesRecordSearch(entity, 'ENGINES')).toBe(true);
    expect(matchesRecordSearch(entity, 'vip')).toBe(true);
    expect(matchesRecordSearch(entity, 'zzz')).toBe(false);
    expect(matchesRecordSearch(entity, '')).toBe(true);
  });
});

describe('validateModuleDescriptor', () => {
  it('accepts a well-formed descriptor', () => {
    expect(validateModuleDescriptor(DESC)).toEqual([]);
  });
  it('flags bad id, duplicate keys, empty select options, unknown titleField', () => {
    const problems = validateModuleDescriptor({
      ...DESC,
      id: 'Bad Id',
      titleField: 'ghost',
      fields: [
        { key: 'dup', label: 'D', type: 'text' },
        { key: 'dup', label: 'D2', type: 'text' },
        { key: 'sel', label: 'S', type: 'select' },
      ],
    });
    expect(problems.join(' ')).toMatch(/kebab-case/);
    expect(problems.join(' ')).toMatch(/Duplicate field key/);
    expect(problems.join(' ')).toMatch(/must declare options/);
    expect(problems.join(' ')).toMatch(/titleField/);
  });
});
