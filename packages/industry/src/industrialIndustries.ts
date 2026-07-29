/**
 * Industrial verticals (Industries 7, 8, 9, 14, 16, 17, 18). Compose on Wave 8 manufacturing /
 * inventory / assets / procurement / projects / hr — no core logic duplicated. Factory execution,
 * field operations, and flight/vehicle operations remain regulated-external.
 */
import type { IndustrySolution } from './types';

export function defineManufacturing(): IndustrySolution {
  return {
    key: 'manufacturing',
    name: 'Manufacturing (Factory Ops / Planning / Quality / Maintenance / OEE / Digital Twin)',
    reusesDomains: ['manufacturing', 'inventory', 'procurement', 'assets', 'projects', 'automation'],
    objects: [
      { name: 'WorkOrder', fields: [{ name: 'productSku', type: 'text' }, { name: 'qty', type: 'number' }], reusesDomain: 'manufacturing' },
      { name: 'DigitalTwin', fields: [{ name: 'assetId', type: 'reference' }, { name: 'state', type: 'text' }], reusesDomain: 'assets' },
    ],
    workflows: [{ name: 'ProductionPlanning', steps: ['plan', 'schedule', 'quality'], requiresApproval: false }],
    kpis: [
      { name: 'workOrders', unit: 'count', compute: (c) => c.business?.manufacturing().count() ?? 0 },
      { name: 'workCenters', unit: 'count', compute: (c) => c.business?.manufacturing().workCenters().length ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }],
    connectors: [{ system: 'SAP', category: 'erp' }, { system: 'Oracle', category: 'erp' }],
    aiSkills: [{ name: 'OeeCopilot', description: 'assist OEE analysis from real data' }, { name: 'MaintenanceAssistant', description: 'assist maintenance planning' }],
    documentTemplates: [{ name: 'WorkInstruction', format: 'pdf', sections: ['steps', 'quality-checks'] }],
  };
}

export function defineLogistics(): IndustrySolution {
  return {
    key: 'logistics',
    name: 'Logistics & Supply Chain (Fleet / Warehouses / Routes / Shipments / Cold Chain)',
    reusesDomains: ['inventory', 'assets', 'procurement', 'projects', 'automation'],
    objects: [
      { name: 'Shipment', fields: [{ name: 'origin', type: 'text' }, { name: 'destination', type: 'text' }], reusesDomain: 'inventory' },
      { name: 'Vehicle', fields: [{ name: 'plate', type: 'text' }, { name: 'capacity', type: 'number' }], reusesDomain: 'assets' },
    ],
    workflows: [{ name: 'ShipmentTracking', steps: ['book', 'dispatch', 'transit', 'deliver'], requiresApproval: false }],
    kpis: [
      { name: 'warehouses', unit: 'count', compute: (c) => c.business?.inventory().warehouses().length ?? 0 },
      { name: 'fleetAssets', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }],
    connectors: [{ system: 'SAP', category: 'erp' }],
    aiSkills: [{ name: 'RouteCopilot', description: 'assist route planning' }, { name: 'ColdChainMonitor', description: 'summarize cold-chain excursions' }],
    documentTemplates: [{ name: 'BillOfLading', format: 'pdf', sections: ['shipper', 'consignee', 'goods'] }],
  };
}

export function defineConstruction(): IndustrySolution {
  return {
    key: 'construction',
    name: 'Construction (Projects / BOQ / Contracts / Equipment / Site Safety)',
    reusesDomains: ['projects', 'procurement', 'assets', 'hr', 'accounting', 'automation'],
    objects: [
      { name: 'BillOfQuantities', fields: [{ name: 'item', type: 'text' }, { name: 'qty', type: 'number' }], reusesDomain: 'procurement' },
      { name: 'SiteSafetyReport', fields: [{ name: 'site', type: 'text' }, { name: 'incidents', type: 'number' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'ProjectDelivery', steps: ['tender', 'award', 'build', 'handover'], requiresApproval: true }],
    kpis: [
      { name: 'projects', unit: 'count', compute: (c) => c.business?.projects().count() ?? 0 },
      { name: 'equipment', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }],
    connectors: [{ system: 'Oracle', category: 'erp' }],
    aiSkills: [{ name: 'BoqAssistant', description: 'assist bill-of-quantities' }, { name: 'SafetyCopilot', description: 'summarize site safety' }],
    documentTemplates: [{ name: 'Contract', format: 'pdf', sections: ['scope', 'boq', 'milestones'] }],
  };
}

export function defineEnergy(): IndustrySolution {
  return {
    key: 'energy',
    name: 'Energy & Utilities (Power / Water / Gas / Assets / Field Operations)',
    reusesDomains: ['assets', 'projects', 'procurement', 'inventory', 'automation'],
    objects: [
      { name: 'GridAsset', fields: [{ name: 'type', type: 'text' }, { name: 'capacity', type: 'number' }], reusesDomain: 'assets' },
      { name: 'FieldWorkOrder', fields: [{ name: 'assetId', type: 'reference' }, { name: 'task', type: 'text' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'FieldMaintenance', steps: ['detect', 'dispatch', 'repair', 'verify'], requiresApproval: false }],
    kpis: [
      { name: 'gridAssets', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
      { name: 'workOrders', unit: 'count', compute: (c) => c.business?.projects().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }],
    connectors: [{ system: 'SAP', category: 'erp' }],
    aiSkills: [{ name: 'OutageCopilot', description: 'assist outage triage' }, { name: 'AssetHealthAssistant', description: 'summarize asset health' }],
    documentTemplates: [{ name: 'FieldReport', format: 'pdf', sections: ['asset', 'work', 'readings'] }],
  };
}

export function defineAutomotive(): IndustrySolution {
  return {
    key: 'automotive',
    name: 'Automotive (OEM / Dealers / Service / Warranty / VIN / Parts)',
    reusesDomains: ['manufacturing', 'crm', 'inventory', 'accounting', 'automation'],
    objects: [
      { name: 'Vehicle', fields: [{ name: 'vin', type: 'text' }, { name: 'model', type: 'text' }], reusesDomain: 'manufacturing' },
      { name: 'WarrantyClaim', fields: [{ name: 'vin', type: 'reference' }, { name: 'amount', type: 'number' }], reusesDomain: 'accounting' },
    ],
    workflows: [{ name: 'ServiceVisit', steps: ['book', 'diagnose', 'repair', 'invoice'], requiresApproval: false }],
    kpis: [
      { name: 'dealers', unit: 'count', compute: (c) => c.business?.crm().counts().accounts ?? 0 },
      { name: 'parts', unit: 'count', compute: (c) => c.business?.inventory().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }],
    connectors: [{ system: 'SAP', category: 'erp' }, { system: 'Salesforce', category: 'crm' }],
    aiSkills: [{ name: 'WarrantyCopilot', description: 'assist warranty adjudication' }, { name: 'PartsAssistant', description: 'assist parts lookup' }],
    documentTemplates: [{ name: 'ServiceOrder', format: 'pdf', sections: ['vehicle', 'work', 'parts'] }],
  };
}

export function defineAviation(): IndustrySolution {
  return {
    key: 'aviation',
    name: 'Aviation (Aircraft / Fleet / Maintenance / Crew / Flight Operations)',
    reusesDomains: ['assets', 'hr', 'projects', 'procurement', 'automation'],
    objects: [
      { name: 'Aircraft', fields: [{ name: 'tail', type: 'text' }, { name: 'type', type: 'text' }], reusesDomain: 'assets' },
      { name: 'MaintenanceCheck', fields: [{ name: 'aircraftId', type: 'reference' }, { name: 'check', type: 'text' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'MaintenanceCheck', steps: ['schedule', 'inspect', 'sign-off'], requiresApproval: true }],
    kpis: [
      { name: 'aircraft', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
      { name: 'crew', unit: 'count', compute: (c) => c.business?.hr().count() ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }],
    connectors: [{ system: 'SAP', category: 'erp' }],
    aiSkills: [{ name: 'MaintenanceCopilot', description: 'assist maintenance scheduling' }, { name: 'CrewAssistant', description: 'assist crew rostering' }],
    documentTemplates: [{ name: 'MaintenanceRecord', format: 'pdf', sections: ['aircraft', 'check', 'sign-off'] }],
  };
}

export function defineAgriculture(): IndustrySolution {
  return {
    key: 'agriculture',
    name: 'Agriculture (Farms / Crops / Livestock / Irrigation / Supply Chain)',
    reusesDomains: ['assets', 'inventory', 'procurement', 'projects', 'automation'],
    objects: [
      { name: 'Farm', fields: [{ name: 'name', type: 'text' }, { name: 'hectares', type: 'number' }], reusesDomain: 'assets' },
      { name: 'CropCycle', fields: [{ name: 'crop', type: 'text' }, { name: 'season', type: 'text' }], reusesDomain: 'projects' },
    ],
    workflows: [{ name: 'CropCycle', steps: ['plant', 'irrigate', 'harvest', 'sell'], requiresApproval: false }],
    kpis: [
      { name: 'farms', unit: 'count', compute: (c) => c.business?.assets().count() ?? 0 },
      { name: 'suppliers', unit: 'count', compute: (c) => c.business?.procurement().suppliers().length ?? 0 },
    ],
    compliancePacks: [{ pack: 'iso-9001' }, { pack: 'glp' }],
    connectors: [{ system: 'SAP', category: 'erp' }],
    aiSkills: [{ name: 'YieldCopilot', description: 'assist yield analysis' }, { name: 'IrrigationAssistant', description: 'assist irrigation planning' }],
    documentTemplates: [{ name: 'HarvestReport', format: 'pdf', sections: ['crop', 'yield', 'quality'] }],
  };
}
