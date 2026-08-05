/**
 * Modules 2, 3, 4 — Department / Business / Industry AI worker catalogs. Each worker is a
 * reusable TEMPLATE (capabilities + governed tool domains + default permissions) instantiated by
 * the registry as an agent. Industry specialists reuse the Wave 9 industry keys — no vertical
 * logic is duplicated.
 */
import { DEPARTMENT_WORKERS, BUSINESS_WORKERS, INDUSTRY_SPECIALISTS, type ToolDomain } from './constants';

export interface WorkerTemplate {
  name: string;
  category: 'department' | 'business' | 'industry';
  capabilities: string[];
  toolDomains: ToolDomain[];
  defaultPermissions: string[];
}

export function defineDepartmentWorkers(): WorkerTemplate[] {
  return DEPARTMENT_WORKERS.map((name) => ({
    name,
    category: 'department',
    capabilities: ['brief', 'summarize', 'analyze', 'draft'],
    toolDomains: ['workspace', 'search', 'knowledge', 'documents'],
    defaultPermissions: ['read:all', 'draft:documents'],
  }));
}

export function defineBusinessWorkers(): WorkerTemplate[] {
  const toolMap: Record<string, ToolDomain[]> = {
    'Sales Executive': ['crm', 'search', 'documents'],
    'CRM Manager': ['crm', 'workspace'],
    'Customer Success Manager': ['crm', 'knowledge'],
    'Procurement Officer': ['procurement', 'inventory'],
    'Finance Analyst': ['finance', 'erp'],
    Accountant: ['finance', 'erp'],
    'HR Manager': ['hr', 'workspace'],
    Recruiter: ['hr', 'search'],
    'Project Manager': ['workspace', 'calendar'],
    'Portfolio Manager': ['workspace', 'finance'],
    'Inventory Manager': ['inventory', 'procurement'],
    'Manufacturing Planner': ['manufacturing', 'inventory'],
    'Quality Manager': ['manufacturing', 'knowledge'],
    'Compliance Officer': ['knowledge', 'documents'],
    'Legal Assistant': ['documents', 'knowledge'],
    'Executive Assistant': ['workspace', 'calendar', 'documents'],
  };
  return BUSINESS_WORKERS.map((name) => ({
    name,
    category: 'business',
    capabilities: ['plan', 'draft', 'analyze', 'recommend'],
    toolDomains: toolMap[name] ?? ['workspace'],
    defaultPermissions: ['read:domain', 'draft:proposals'],
  }));
}

export function defineIndustrySpecialists(): WorkerTemplate[] {
  return INDUSTRY_SPECIALISTS.map((name) => ({
    name: `${name} Specialist`,
    category: 'industry',
    capabilities: ['plan', 'draft', 'analyze', 'advise'],
    toolDomains: ['knowledge', 'search', 'documents', 'workspace'],
    defaultPermissions: ['read:industry', 'draft:proposals'],
  }));
}

export function allWorkerTemplates(): WorkerTemplate[] {
  return [...defineDepartmentWorkers(), ...defineBusinessWorkers(), ...defineIndustrySpecialists()];
}
