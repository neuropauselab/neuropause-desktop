/**
 * Launch Workstream 5 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14
 * model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process launch control plane: the deployment runtime, rollout engine,
 *                            deployment + government templates, the pilot / GA / customer-success /
 *                            commercial / partner / government-readiness / training / documentation
 *                            registries, the Launch Operations Center, launch-readiness scoring, and
 *                            governance.
 *   adapter-verified       — external commercial/identity systems (CRM, ERP, identity providers, email
 *                            providers, payment providers, marketplace APIs); represented until configured.
 *   business-data-pending  — pilot / enterprise / government customers, contracts, revenue, renewals, and
 *                            production adoption; never signed, invoiced, or fabricated.
 *   infrastructure-pending — customer production environments, government production networks, national
 *                            cloud infrastructure, production rollouts, and marketplace publication.
 * A test asserts no customer, government, contract, revenue, deployment, or production-usage row is ever
 * classified live — this is deployment READINESS, not claimed deployment.
 */
import type { DoEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: DoEvidenceLevel;
  note: string;
}

export const DO_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process launch control plane ──
  { capability: 'Deployment Runtime', epic: 'E1', level: 'live-verified', note: 'Registry + lifecycle + real prerequisite validation; deny-by-default.' },
  { capability: 'Rollout Engine', epic: 'E4', level: 'live-verified', note: 'Rollout plans + waves + controlled-release sequencing (plan only).' },
  { capability: 'Deployment Templates', epic: 'E1', level: 'live-verified', note: 'Reusable deployment templates by rollout mode.' },
  { capability: 'Rollback Plans', epic: 'E1', level: 'live-verified', note: 'Rollback plan registry per deployment.' },
  { capability: 'Pilot Program Runtime', epic: 'E2', level: 'live-verified', note: 'Pilot workflow + success criteria; completion refused until criteria met.' },
  { capability: 'Government Deployment Templates', epic: 'E3', level: 'live-verified', note: 'Eight profile templates; each flagged deployed:false.' },
  { capability: 'Enterprise Rollout Framework', epic: 'E4', level: 'live-verified', note: 'Single/multi-tenant, regional/global rollout modelling.' },
  { capability: 'GA Program', epic: 'E5', level: 'live-verified', note: 'GA checklist + approval; version promotion via reused Release.' },
  { capability: 'GA Go/No-Go Gate', epic: 'E5', level: 'live-verified', note: 'Reused Release GA gate; result flagged releasedToRealWorld:false.' },
  { capability: 'Customer Success Runtime', epic: 'E6', level: 'live-verified', note: 'Health scoring over supplied signals; playbooks + EBRs.' },
  { capability: 'Commercial Registry', epic: 'E7', level: 'live-verified', note: 'Opportunity/quote/contract/license registries; entities represented.' },
  { capability: 'Partner Registry', epic: 'E8', level: 'live-verified', note: 'SI/consulting/technology/marketplace/training partner registries.' },
  { capability: 'Government Readiness Templates', epic: 'E9', level: 'live-verified', note: 'Department models + approval workflows; operational models only.' },
  { capability: 'Launch Operations Center', epic: 'E10', level: 'live-verified', note: 'Dashboards over verified in-process data; customer/commercial tiles pending.' },
  { capability: 'Training Registry', epic: 'E11', level: 'live-verified', note: 'Course/certification/assessment registries; assets represented.' },
  { capability: 'Documentation', epic: 'E12', level: 'live-verified', note: 'Deterministic launch-guide outlines; no case studies fabricated.' },
  { capability: 'Launch Readiness Scoring', epic: 'E13', level: 'live-verified', note: 'Composes the reused readiness of prior platforms into a launch score.' },
  { capability: 'Governance', epic: 'E14', level: 'live-verified', note: 'Every deployment audited on the one ledger with a replay id.' },
  // ── Adapter-verified — external commercial/identity systems, until configured ──
  { capability: 'CRM', epic: 'E7', level: 'adapter-verified', note: 'Represented CRM integration; not connected until configured.' },
  { capability: 'ERP', epic: 'E7', level: 'adapter-verified', note: 'Represented ERP integration; not connected until configured.' },
  { capability: 'Identity Providers', epic: 'E1', level: 'adapter-verified', note: 'Represented SSO/IdP integration for deployments; until configured.' },
  { capability: 'Email Providers', epic: 'E6', level: 'adapter-verified', note: 'Represented email delivery; no external email is sent.' },
  { capability: 'Payment Providers', epic: 'E7', level: 'adapter-verified', note: 'Represented payment integration; no charge is made.' },
  { capability: 'Marketplace APIs', epic: 'E8', level: 'adapter-verified', note: 'Represented marketplace APIs; no listing is published.' },
  // ── Business-data-pending — real customers, contracts, and revenue; never fabricated ──
  { capability: 'Pilot Customers', epic: 'E2', level: 'business-data-pending', note: 'No contracted pilot customer exists; pilots represented.' },
  { capability: 'Enterprise Customers', epic: 'E4', level: 'business-data-pending', note: 'No enterprise customer deployment exists or is claimed.' },
  { capability: 'Government Customers', epic: 'E9', level: 'business-data-pending', note: 'No government engagement or adoption exists or is claimed.' },
  { capability: 'Contracts', epic: 'E7', level: 'business-data-pending', note: 'No signed contract exists; contracts represented, signed:false.' },
  { capability: 'Revenue', epic: 'E7', level: 'business-data-pending', note: 'No production revenue exists; pipeline value is not revenue.' },
  { capability: 'Renewals', epic: 'E6', level: 'business-data-pending', note: 'No renewal is committed; renewals represented.' },
  { capability: 'Production Adoption', epic: 'E6', level: 'business-data-pending', note: 'No production usage or adoption metric exists.' },
  // ── Infrastructure-pending — real customer/government infrastructure; represented until it exists ──
  { capability: 'Customer Production Environments', epic: 'E1', level: 'infrastructure-pending', note: 'No real customer production environment is provisioned.' },
  { capability: 'Government Production Networks', epic: 'E9', level: 'infrastructure-pending', note: 'No government production network is connected.' },
  { capability: 'National Cloud Infrastructure', epic: 'E3', level: 'infrastructure-pending', note: 'No national/sovereign cloud is provisioned.' },
  { capability: 'Production Rollouts', epic: 'E4', level: 'infrastructure-pending', note: 'No real production rollout occurs; waves are plan-only.' },
  { capability: 'Marketplace Publication', epic: 'E8', level: 'infrastructure-pending', note: 'No marketplace listing is published.' },
];

export interface DoReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function doReadiness(matrix: CapabilityEvidence[] = DO_MATRIX): DoReadiness {
  const by = (l: DoEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 6
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 5
