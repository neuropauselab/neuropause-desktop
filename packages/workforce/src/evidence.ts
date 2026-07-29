/**
 * Wave 11 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data:
 *   live-verified          — workforce runtime, agent registry, workers, collaboration, planning,
 *                            reasoning (evidence from real sources), governed tool runtime, memory,
 *                            human collaboration, AI organization, governance-restricted workflows,
 *                            executive AI, marketplace, and SDK — executed in-process
 *   adapter-verified       — external LLM / voice / translation / OCR providers, until configured
 *   business-data-pending  — organization tasks / business work / AI conversations / enterprise
 *                            knowledge; registries start empty and are never fabricated
 *   regulated-external     — autonomous financial approval, payroll, banking, tax filing, clinical
 *                            decisions, and legal decisions; represented only, never executed
 * A test asserts nothing regulated-external or business-data-pending is marked live-verified.
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const WORKFORCE_MATRIX: CapabilityEvidence[] = [
  // Live-verified — executed in-process, through the existing runtime and governance
  { capability: 'Enterprise Workforce Runtime + Agent Registry', module: 'M1', level: 'live-verified', note: 'Lifecycle/identity/capabilities/permissions/sessions — governed on the one chain.' },
  { capability: 'Department AI workers', module: 'M2', level: 'live-verified', note: 'Seven C-suite assistant templates instantiated as agents.' },
  { capability: 'Business AI workers', module: 'M3', level: 'live-verified', note: 'Sixteen business worker templates (sales/finance/HR/…).' },
  { capability: 'Industry AI specialists', module: 'M4', level: 'live-verified', note: 'Twelve specialists reusing the Wave 9 industry keys — no vertical logic duplicated.' },
  { capability: 'Multi-Agent Collaboration', module: 'M5', level: 'live-verified', note: 'Delegation/messaging/task distribution/team goals — no isolated agents.' },
  { capability: 'Enterprise Planning Engine', module: 'M6', level: 'live-verified', note: 'Goal → dependency-ordered task graph; execution reuses the Wave 5 platform.' },
  { capability: 'Reasoning Engine', module: 'M7', level: 'live-verified', note: 'Steps/reflection/self-verification/confidence; evidence collected from REAL sources — never fabricated.' },
  { capability: 'Tool Runtime (governed)', module: 'M8', level: 'live-verified', note: 'CRM/ERP/finance/HR/workspace/search — only through governed APIs, every use audited.' },
  { capability: 'Enterprise Memory', module: 'M9', level: 'live-verified', note: 'Long-term/session/organization/team/workspace-context memory.' },
  { capability: 'Human Collaboration', module: 'M10', level: 'live-verified', note: 'Reuses the Wave 4 HITL — AI may not self-approve; human override always wins.' },
  { capability: 'AI Organization', module: 'M11', level: 'live-verified', note: 'Departments/teams/managers/org chart from the real registry.' },
  { capability: 'Autonomous Workflows (governance-restricted)', module: 'M13', level: 'live-verified', note: 'AI-initiated restricted workflows stop at awaiting-approval — never run without a human.' },
  { capability: 'Executive AI', module: 'M14', level: 'live-verified', note: 'CEO/CFO/COO/CTO/CRO/CHRO briefings from real runtime data — no KPI fabricated.' },
  { capability: 'AI Marketplace', module: 'M15', level: 'live-verified', note: 'Install/upgrade/publish workers, skills, templates, prompt packs.' },
  { capability: 'Worker SDK', module: 'M16', level: 'live-verified', note: 'Register workers/skills/tools/planning/memory/reasoning modules.' },
  { capability: 'Workforce Governance', module: 'M17', level: 'live-verified', note: 'Every AI action records user/org/worker/evidence/reasoning/approval/replay id on the one chain.' },
  // Adapter-verified — external AI providers, until configured
  { capability: 'External LLM providers', module: 'M18', level: 'adapter-verified', note: 'Deep neural generation represented; adapter-verified until configured; not called here.' },
  { capability: 'Voice providers', module: 'M18', level: 'adapter-verified', note: 'Represented; adapter-verified until configured.' },
  { capability: 'Translation services', module: 'M18', level: 'adapter-verified', note: 'Represented; adapter-verified until configured.' },
  { capability: 'OCR services', module: 'M18', level: 'adapter-verified', note: 'Represented; adapter-verified until configured.' },
  // Business-data-pending — real content; registries start empty
  { capability: 'Organization tasks', module: 'M8/M13', level: 'business-data-pending', note: 'Empty until real tasks exist.' },
  { capability: 'Business work', module: 'M3', level: 'business-data-pending', note: 'Empty until real business data exists in the reused platforms.' },
  { capability: 'AI conversations', module: 'M5/M7', level: 'business-data-pending', note: 'Empty until real conversations occur.' },
  { capability: 'Enterprise knowledge', module: 'M12', level: 'business-data-pending', note: 'Empty until real knowledge is published.' },
  // Regulated-external — represented only, never executed autonomously
  { capability: 'Autonomous financial approval', module: 'M10/M13', level: 'regulated-external', note: 'Requires a human approver. Proposed, never auto-approved.' },
  { capability: 'Autonomous payroll', module: 'M13', level: 'regulated-external', note: 'Requires governed payroll + human. Never executed autonomously.' },
  { capability: 'Autonomous banking', module: 'M13', level: 'regulated-external', note: 'Requires bank rails + human. Never executed autonomously.' },
  { capability: 'Autonomous tax filing', module: 'M13', level: 'regulated-external', note: 'Requires a government portal + human. Never executed autonomously.' },
  { capability: 'Autonomous clinical decisions', module: 'M4/M7', level: 'regulated-external', note: 'Requires clinician oversight. Never made autonomously.' },
  { capability: 'Autonomous legal decisions', module: 'M3/M7', level: 'regulated-external', note: 'Requires human legal review. Never made autonomously.' },
  { capability: 'Production changes / security policy', module: 'M13', level: 'regulated-external', note: 'Require approval; no self-modification or policy bypass. Never executed.' },
  { capability: 'Human identity impersonation', module: 'M1', level: 'regulated-external', note: 'Never implemented — agents have their own distinct DID identity.' },
];

export interface WorkforceReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
}

export function workforceReadiness(matrix: CapabilityEvidence[] = WORKFORCE_MATRIX): WorkforceReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    regulatedExternal: by('regulated-external'),
  };
}
