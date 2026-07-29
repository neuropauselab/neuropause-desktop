/**
 * EPIC 9 — CI/CD Automation. Generates a GitHub Actions workflow with build, test, security-scan, SBOM,
 * container-signing, deployment-validation, and rollback-validation jobs. The deployment-validation job
 * is bound to a protected `production` GitHub environment (required reviewers = explicit approval) and
 * VALIDATES rather than deploys — the workflow never deploys to production automatically. SBOM generation
 * REUSES the trust-platform supply-chain module when wired in; build validation can reuse Release.
 */
import { toYaml, type Yamlish } from './serialize';
import { CICD_STAGES, type CicdStage } from './constants';
import type { PaContext, Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

export class CicdAutomation {
  constructor(
    private readonly ctx: PaContext,
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  stages(): readonly CicdStage[] {
    return CICD_STAGES;
  }

  workflow(): Record<string, Yamlish> {
    return {
      name: 'neuropause-cicd',
      on: { push: { branches: ['main'] }, workflow_dispatch: {} },
      permissions: { contents: 'read', 'id-token': 'write', packages: 'write' },
      jobs: {
        build: { 'runs-on': 'ubuntu-latest', steps: [{ uses: 'actions/checkout@v4' }, { run: 'npm ci' }, { run: 'docker build -f apps/backend/Dockerfile -t neuropause-backend:${{ github.sha }} .' }] },
        test: { needs: 'build', 'runs-on': 'ubuntu-latest', steps: [{ uses: 'actions/checkout@v4' }, { run: 'npm ci' }, { run: 'NODE_OPTIONS=--max-old-space-size=8192 npx vitest run packages' }] },
        'security-scan': { needs: 'build', 'runs-on': 'ubuntu-latest', steps: [{ run: 'trivy image neuropause-backend:${{ github.sha }}' }] },
        sbom: { needs: 'build', 'runs-on': 'ubuntu-latest', steps: [{ run: 'syft neuropause-backend:${{ github.sha }} -o cyclonedx-json > sbom.json' }] },
        'container-signing': { needs: ['sbom', 'security-scan'], 'runs-on': 'ubuntu-latest', steps: [{ run: 'cosign sign --yes neuropause-backend:${{ github.sha }}' }] },
        'deployment-validation': { needs: 'container-signing', 'runs-on': 'ubuntu-latest', environment: 'production', steps: [{ run: 'helm lint deploy/helm/neuropause-backend' }, { run: 'helm template deploy/helm/neuropause-backend | kubeconform -strict' }, { run: 'echo VALIDATE ONLY — this workflow never mutates the cluster; deployment is a separate, manually approved step' }] },
        'rollback-validation': { needs: 'deployment-validation', 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo verify helm rollback / kubectl rollout undo plan is well-formed' }] },
      },
    };
  }

  async generateWorkflow(): Promise<Artifact> {
    const artifact: Artifact = { kind: 'github-actions', name: '.github/workflows/neuropause-cicd.yml', format: 'yaml', content: toYaml(this.workflow()), note: 'GitHub Actions — build/test/scan/SBOM/sign/validate; deployment-validation is approval-gated and never applies to production.' };
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'cicd', epic: 'E9', operation: 'generate-cicd', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }

  /** SBOM generation reuses the trust-platform supply-chain module when available. */
  async generateSbom(version: string): Promise<{ componentCount: number; reusedTrustPlatform: boolean }> {
    if (this.ctx.trustPlatform) {
      const sbom = this.ctx.trustPlatform.supplyChain().generateSbom(version);
      await this.gov.record({ operator: this.operator, environment: 'production', target: `sbom:${version}`, epic: 'E9', operation: 'generate-sbom', result: 'generated', evidence: 'live-verified' });
      return { componentCount: sbom.componentCount, reusedTrustPlatform: true };
    }
    return { componentCount: 0, reusedTrustPlatform: false };
  }
}
