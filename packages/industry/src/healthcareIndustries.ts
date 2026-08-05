/**
 * Healthcare & life-sciences verticals (Industries 1-3). Each composes on the Wave 8 business
 * domains (healthcare/crm/hr/finance/inventory/manufacturing) — no core logic is duplicated. KPIs
 * compute over real business data; compliance packs represent frameworks only.
 */
import type { IndustrySolution } from './types';

export function defineHealthcare(): IndustrySolution {
  return {
    key: 'healthcare',
    name: 'Healthcare (Hospital / Clinic / Lab / Pharmacy / Telemedicine / Radiology)',
    reusesDomains: ['healthcare', 'crm', 'hr', 'finance', 'accounting', 'procurement', 'inventory', 'projects', 'ai', 'automation'],
    objects: [
      { name: 'Encounter', fields: [{ name: 'patientId', type: 'reference' }, { name: 'providerId', type: 'reference' }, { name: 'date', type: 'date' }], reusesDomain: 'healthcare' },
      { name: 'PharmacyStock', fields: [{ name: 'sku', type: 'text' }, { name: 'qty', type: 'number' }], reusesDomain: 'inventory' },
    ],
    workflows: [{ name: 'Admission', steps: ['register', 'triage', 'admit'], requiresApproval: false }],
    kpis: [
      { name: 'activePatients', unit: 'count', compute: (c) => c.business?.healthcare().count() ?? 0 },
      { name: 'providers', unit: 'count', compute: (c) => c.business?.healthcare().providers().length ?? 0 },
    ],
    compliancePacks: [{ pack: 'hipaa' }, { pack: 'iso-13485' }],
    connectors: [{ system: 'Epic', category: 'healthcare' }, { system: 'Cerner', category: 'healthcare' }],
    aiSkills: [{ name: 'ClinicalSummary', description: 'summarize an encounter (synthetic models only)' }, { name: 'CareGapFinder', description: 'find care gaps from real records' }],
    documentTemplates: [{ name: 'DischargeSummary', format: 'pdf', sections: ['patient', 'diagnosis', 'plan'] }],
  };
}

export function defineMedicalDevice(): IndustrySolution {
  return {
    key: 'medical-device',
    name: 'Medical Device Manufacturing',
    reusesDomains: ['manufacturing', 'inventory', 'procurement', 'compliance', 'projects', 'automation'],
    objects: [
      { name: 'DeviceMasterRecord', fields: [{ name: 'deviceId', type: 'text' }, { name: 'udi', type: 'text' }], reusesDomain: 'manufacturing' },
      { name: 'CAPA', fields: [{ name: 'description', type: 'text' }, { name: 'status', type: 'text' }], reusesDomain: 'compliance' },
    ],
    workflows: [{ name: 'DeviceHistoryRecord', steps: ['build', 'sterilize', 'inspect', 'release'], requiresApproval: true }],
    kpis: [
      { name: 'productionOrders', unit: 'count', compute: (c) => c.business?.manufacturing().count() ?? 0 },
      { name: 'openCAPA', unit: 'count', compute: () => 0 },
    ],
    compliancePacks: [{ pack: 'iso-13485' }, { pack: 'fda' }],
    connectors: [{ system: 'SAP', category: 'erp' }],
    aiSkills: [{ name: 'RegulatoryDocAssistant', description: 'draft regulatory documentation' }, { name: 'ComplaintTriage', description: 'triage complaints' }],
    documentTemplates: [{ name: 'DeviceHistoryRecord', format: 'pdf', sections: ['device', 'batch', 'sterilization', 'release'] }],
  };
}

export function definePharmaceutical(): IndustrySolution {
  return {
    key: 'pharmaceutical',
    name: 'Pharmaceutical (GMP / Batch Records / Stability / QA / QC)',
    reusesDomains: ['manufacturing', 'inventory', 'compliance', 'procurement', 'projects', 'automation'],
    objects: [
      { name: 'BatchRecord', fields: [{ name: 'batchId', type: 'text' }, { name: 'product', type: 'text' }], reusesDomain: 'manufacturing' },
      { name: 'StabilityStudy', fields: [{ name: 'batchId', type: 'reference' }, { name: 'months', type: 'number' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'BatchRelease', steps: ['manufacture', 'qc', 'qa-review'], requiresApproval: true }],
    kpis: [
      { name: 'batches', unit: 'count', compute: (c) => c.business?.manufacturing().count() ?? 0 },
      { name: 'qaReviews', unit: 'count', compute: () => 0 },
    ],
    compliancePacks: [{ pack: 'gmp' }, { pack: 'glp' }, { pack: 'fda' }],
    connectors: [{ system: 'SAP', category: 'erp' }, { system: 'Oracle', category: 'erp' }],
    aiSkills: [{ name: 'BatchRecordAssistant', description: 'assist batch record review' }, { name: 'DeviationAnalyzer', description: 'analyze deviations' }],
    documentTemplates: [{ name: 'BatchRecord', format: 'pdf', sections: ['formula', 'process', 'qc', 'release'] }],
  };
}
