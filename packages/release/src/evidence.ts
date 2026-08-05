/**
 * Sprint 6 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14 model).
 * Evidence is NEVER promoted without a real, executed basis:
 *   live-verified          — the in-process release runtimes that really execute: release/version
 *                            runtime, packaging, RC validation, the GA gate, release management,
 *                            automation, customer/support/success operations, license runtime,
 *                            monitoring, analytics, the executive dashboard, production-ops playbooks,
 *                            governance, and documentation.
 *   adapter-verified       — external distribution channels (GitHub Releases, private enterprise
 *                            repositories, Azure/AWS marketplaces, the Docker registry); represented and
 *                            never claimed live until a real publication URL is confirmed.
 *   business-data-pending  — real customer growth, revenue, renewals, adoption, expansion, and
 *                            production usage; never fabricated.
 *   infrastructure-pending — external marketplace publication, customer production environments,
 *                            regional deployments, and CDN distribution; represented until they occur.
 * A test asserts that no adapter, business-data, or infrastructure capability is ever classified live.
 */
import type { ReleaseEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: ReleaseEvidenceLevel;
  note: string;
}

export const RELEASE_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — in-process release runtimes that really execute ──
  { capability: 'GA / Release Runtime', epic: 'E1', level: 'live-verified', note: 'Release + version registries and a governed lifecycle; illegal transitions rejected.' },
  { capability: 'Version Registry', epic: 'E1', level: 'live-verified', note: 'One record per version with a real release history.' },
  { capability: 'Packaging Runtime', epic: 'E2', level: 'live-verified', note: 'Seven package descriptors with real checksums; reuses the production installer.' },
  { capability: 'RC Validation', epic: 'E3', level: 'live-verified', note: 'Reuses the Sprint-4 end-to-end validation; areas passed only with a real step behind them.' },
  { capability: 'GA Gate', epic: 'E4', level: 'live-verified', note: 'Evidence-based Go/No-Go; requires a real executive approver; never asserts real-world GA.' },
  { capability: 'Release Management', epic: 'E5', level: 'live-verified', note: 'Scheduling, promotion, hotfix/patch/LTS registries, and release notes.' },
  { capability: 'Release Automation', epic: 'E10', level: 'live-verified', note: 'Packaging + checksum validation are real; signing represented (no cert invoked).' },
  { capability: 'Customer Operations', epic: 'E6', level: 'live-verified', note: 'Registry + deployment/license inventory reused; usage/renewal reported pending.' },
  { capability: 'Support Operations', epic: 'E7', level: 'live-verified', note: 'Tickets/escalation/RCA via the reused operations IncidentRegistry.' },
  { capability: 'Customer Success Operations', epic: 'E8', level: 'live-verified', note: 'Health/adoption math over real usage; null with no data.' },
  { capability: 'License Runtime', epic: 'E12', level: 'live-verified', note: 'Trial/Community/Professional/Enterprise via reused commercial licensing; real seats.' },
  { capability: 'Operational Monitoring', epic: 'E13', level: 'live-verified', note: 'GA dashboards; platform health reuses the operations overview.' },
  { capability: 'Business Analytics', epic: 'E14', level: 'live-verified', note: 'Real counts from in-process registries; commercial metrics reported pending.' },
  { capability: 'Executive Dashboard', epic: 'E17', level: 'live-verified', note: 'Operational snapshot; live tiles only where a real source exists.' },
  { capability: 'Production Operations Playbooks', epic: 'E16', level: 'live-verified', note: 'Six operational playbooks generated in-process.' },
  { capability: 'Governance', epic: 'E15', level: 'live-verified', note: 'Every release operation audited on the one hash-chained ledger with a replay id.' },
  { capability: 'Documentation', epic: 'E9', level: 'live-verified', note: 'Eleven guides; reuses the reliability + production documentation generators.' },
  // ── Adapter-verified — external distribution channels, until a real publication ──
  { capability: 'GitHub Releases', epic: 'E11', level: 'adapter-verified', note: 'Represented; never claimed live until a real publication URL is confirmed.' },
  { capability: 'Private Enterprise Repositories', epic: 'E11', level: 'adapter-verified', note: 'Represented; publication requires the customer repository + confirmation.' },
  { capability: 'Azure Marketplace', epic: 'E11', level: 'adapter-verified', note: 'Represented; listing not claimed until published and confirmed.' },
  { capability: 'AWS Marketplace', epic: 'E11', level: 'adapter-verified', note: 'Represented; listing not claimed until published and confirmed.' },
  { capability: 'Docker Registry', epic: 'E11', level: 'adapter-verified', note: 'Represented; image push not claimed until performed against a real registry.' },
  // ── Business-data-pending — real commercial metrics; never fabricated ──
  { capability: 'Customer Growth', epic: 'E14', level: 'business-data-pending', note: 'Requires real production customers; never invented.' },
  { capability: 'Revenue', epic: 'E14', level: 'business-data-pending', note: 'No revenue is recorded or claimed here.' },
  { capability: 'Renewals', epic: 'E6', level: 'business-data-pending', note: 'Renewal figures require real contracts + usage; not fabricated.' },
  { capability: 'Adoption', epic: 'E8', level: 'business-data-pending', note: 'Adoption scored only from real supplied usage; null with no data.' },
  { capability: 'Expansion', epic: 'E8', level: 'business-data-pending', note: 'Expansion signals require real production usage; not fabricated.' },
  { capability: 'Production Usage', epic: 'E13', level: 'business-data-pending', note: 'Live usage metrics require real production traffic; reported pending.' },
  // ── Infrastructure-pending — external publication + customer infrastructure ──
  { capability: 'External Marketplace Publication', epic: 'E11', level: 'infrastructure-pending', note: 'Actual listing on an external marketplace has not occurred; represented only.' },
  { capability: 'Customer Production Environments', epic: 'E1', level: 'infrastructure-pending', note: 'Real customer production clusters are provisioned by the customer.' },
  { capability: 'Regional Deployments', epic: 'E2', level: 'infrastructure-pending', note: 'Multi-region distribution requires real infrastructure; represented.' },
  { capability: 'CDN Distribution', epic: 'E11', level: 'infrastructure-pending', note: 'CDN-backed artifact distribution requires a configured CDN; represented.' },
];

export interface ReleaseReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function releaseReadiness(matrix: CapabilityEvidence[] = RELEASE_MATRIX): ReleaseReadiness {
  const by = (l: ReleaseEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 5
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 4
