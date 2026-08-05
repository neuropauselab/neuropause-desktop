/**
 * EPICs 2-8 — the phase provisioners. Each phase (infrastructure, kubernetes, databases, dns-tls,
 * secrets, deployment, monitoring) REUSES the Program 1B generator to produce its artifact, then gates it:
 *   • missing prerequisites or no approval  → status 'pending' (nothing generated, nothing provisioned).
 *   • all inputs + approval present         → status 'prepared' (artifact generated + apply commands).
 * `provisioned` is ALWAYS false — this orchestrator applies nothing. Real provisioning is the operator's
 * out-of-band step against real infrastructure, promoted only on real evidence.
 */
import type { PlatformAutomation } from '@neuropause/platform-automation';
import type { ProvisioningPhase, RequiredInput } from './constants';
import type { EpContext, OperatorInputs, ProvisioningStep } from './types';
import type { EnvironmentProvisioningGovernance } from './governance';
import type { PrerequisiteGate } from './prerequisites';

interface PhaseSpec {
  phase: ProvisioningPhase;
  epic: string;
  requiredInputs: RequiredInput[];
  evidenceRequired: string[];
  generate: (pa: PlatformAutomation, inputs: OperatorInputs) => Promise<{ artifactName: string; applyCommands: string[] }>;
}

const SECRET_BACKEND = { aws: 'aws-secrets-manager', azure: 'azure-key-vault', gcp: 'google-secret-manager', 'self-hosted': 'hashicorp-vault' } as const;

export const PHASE_SPECS: Record<ProvisioningPhase, PhaseSpec> = {
  infrastructure: {
    phase: 'infrastructure',
    epic: 'E2',
    requiredInputs: ['cloudProvider', 'cloudCredentialsRef'],
    evidenceRequired: ['terraform-plan-output', 'terraform-apply-output'],
    generate: async (pa, inputs) => {
      const { artifact, commands } = await pa.terraform().plan({ provider: inputs.cloudProvider ?? 'self-hosted', environment: 'production' });
      return { artifactName: artifact.name, applyCommands: commands };
    },
  },
  kubernetes: {
    phase: 'kubernetes',
    epic: 'E3',
    requiredInputs: ['cloudProvider', 'cloudCredentialsRef', 'domain'],
    evidenceRequired: ['rollout-status', 'cluster-health'],
    generate: async (pa, inputs) => {
      const artifact = await pa.kubernetes().generateAll({ environment: 'production', host: inputs.domain ?? 'api.<domain>' });
      return { artifactName: artifact.name, applyCommands: ['kubectl apply -f ' + artifact.name] };
    },
  },
  databases: {
    phase: 'databases',
    epic: 'E4',
    requiredInputs: ['cloudProvider', 'cloudCredentialsRef'],
    evidenceRequired: ['db-connectivity', 'encryption-config', 'backup-config'],
    generate: async (pa) => {
      const artifact = await pa.database().generateAll('production');
      return { artifactName: artifact.name, applyCommands: ['# provision managed Postgres/Redis/Qdrant per descriptor', 'kubectl apply -f ' + artifact.name] };
    },
  },
  'dns-tls': {
    phase: 'dns-tls',
    epic: 'E5',
    requiredInputs: ['domain', 'dnsZoneRef', 'tlsAuthorityRef'],
    evidenceRequired: ['dns-resolution', 'certificate-fingerprint'],
    generate: async (pa, inputs) => {
      const host = inputs.domain ?? 'api.<domain>';
      const artifact = await pa.dnsTls().generateAll({ host, target: '<load-balancer-address>', email: 'ops@' + host });
      return { artifactName: artifact.name, applyCommands: ['kubectl apply -f ' + artifact.name] };
    },
  },
  secrets: {
    phase: 'secrets',
    epic: 'E6',
    requiredInputs: ['secretsManagerRef'],
    evidenceRequired: ['secret-store-reference'],
    generate: async (pa, inputs) => {
      const backend = SECRET_BACKEND[inputs.cloudProvider ?? 'self-hosted'];
      const artifact = await pa.secrets().generateAll(backend);
      return { artifactName: artifact.name, applyCommands: ['kubectl apply -f ' + artifact.name] };
    },
  },
  deployment: {
    phase: 'deployment',
    epic: 'E7',
    requiredInputs: ['cloudProvider', 'cloudCredentialsRef', 'domain', 'containerRegistryRef'],
    evidenceRequired: ['rollout-status', 'image-digest'],
    generate: async (pa) => {
      const artifact = await pa.cicd().generateWorkflow();
      return { artifactName: artifact.name, applyCommands: ['helm upgrade --install np deploy/helm/neuropause-backend -n neuropause --wait', 'kubectl -n neuropause rollout status deploy/neuropause-backend'] };
    },
  },
  monitoring: {
    phase: 'monitoring',
    epic: 'E8',
    requiredInputs: ['cloudProvider', 'cloudCredentialsRef'],
    evidenceRequired: ['scrape-targets-up', 'dashboard-urls'],
    generate: async (pa) => {
      const artifact = await pa.monitoring().generateAll();
      return { artifactName: artifact.name, applyCommands: ['kubectl apply -f ' + artifact.name] };
    },
  },
};

export class PhaseProvisioner {
  constructor(
    private readonly ctx: EpContext,
    private readonly gate: PrerequisiteGate,
    private readonly gov: EnvironmentProvisioningGovernance,
    private readonly operator: string,
  ) {}

  /** PREVIEW — generate the artifact if possible; never provisions; does not require full approval. */
  async preview(phase: ProvisioningPhase, inputs: OperatorInputs): Promise<ProvisioningStep> {
    const spec = PHASE_SPECS[phase];
    if (!this.ctx.platformAutomation) {
      return this.step(spec.phase, spec.epic, 'pending', ['platformAutomation'], null, [], spec.evidenceRequired, 'no automation wired in — preview represented');
    }
    const { artifactName, applyCommands } = await spec.generate(this.ctx.platformAutomation, inputs);
    await this.gov.record({ operator: this.operator, environment: 'production', target: phase, epic: spec.epic, operation: 'preview', result: 'previewed', evidence: 'live-verified' });
    return this.step(spec.phase, spec.epic, 'pending', [], artifactName, applyCommands, spec.evidenceRequired, 'preview only — artifact generated, nothing provisioned');
  }

  /** PROVISION — prepares only. 'pending' if prerequisites/approval missing; 'prepared' when ready. */
  async provision(phase: ProvisioningPhase, inputs: OperatorInputs): Promise<ProvisioningStep> {
    const spec = PHASE_SPECS[phase];
    const missing: string[] = [...this.gate.missingFor(inputs, spec.requiredInputs)];
    if (!inputs.approval?.approved) missing.push('approval');
    if (missing.length > 0 || !this.ctx.platformAutomation) {
      if (!this.ctx.platformAutomation) missing.push('platformAutomation');
      await this.gov.record({ operator: this.operator, environment: 'production', target: phase, epic: spec.epic, operation: 'provision-pending', result: 'pending', evidence: 'infrastructure-pending' });
      return this.step(spec.phase, spec.epic, 'pending', missing, null, [], spec.evidenceRequired, 'PENDING — operator input required before this phase can be prepared');
    }
    const { artifactName, applyCommands } = await spec.generate(this.ctx.platformAutomation, inputs);
    await this.gov.record({ operator: inputs.approval!.operator, environment: 'production', target: phase, epic: spec.epic, operation: 'provision-prepared', result: 'prepared', evidence: 'infrastructure-pending' });
    return this.step(spec.phase, spec.epic, 'prepared', [], artifactName, applyCommands, spec.evidenceRequired, 'prepared — operator applies the artifact with real credentials; nothing provisioned here');
  }

  async previewAll(inputs: OperatorInputs): Promise<ProvisioningStep[]> {
    const out: ProvisioningStep[] = [];
    for (const phase of Object.keys(PHASE_SPECS) as ProvisioningPhase[]) out.push(await this.preview(phase, inputs));
    return out;
  }

  async provisionAll(inputs: OperatorInputs): Promise<ProvisioningStep[]> {
    const out: ProvisioningStep[] = [];
    for (const phase of Object.keys(PHASE_SPECS) as ProvisioningPhase[]) out.push(await this.provision(phase, inputs));
    return out;
  }

  private step(phase: ProvisioningPhase, epic: string, status: ProvisioningStep['status'], missing: string[], artifactName: string | null, applyCommands: string[], evidenceRequired: string[], note: string): ProvisioningStep {
    return { phase, epic, status, provisioned: false, missing, artifactName, applyCommands, evidenceRequired, note };
  }
}
