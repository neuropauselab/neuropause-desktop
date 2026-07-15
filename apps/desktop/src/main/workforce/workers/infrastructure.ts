/**
 * P8.4 — Infrastructure workforce. Eight engineering archetypes that review the
 * scoped intelligence layer and can take a real, governed infrastructure action.
 * Each executable skill binds to an EXISTING `InfraActionExecutor` action (P6.1)
 * via the P8.3 execution path — the worker adds no runtime, no new executor, and
 * no new confirmation gate. Every action is high-risk → human approval, and the
 * executor's own `mutates + confirmed` gate is the final backstop. They share the
 * `infrastructure` role; the discipline (Cloud, SRE, DBA …) is the worker itself.
 */
import { advisoryPair, composeWorker, infraPair } from './common';
import type { WorkerDefinition } from '../sdk';

export function buildCloudEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-cloud',
    name: 'Cloud Engineer',
    role: 'infrastructure',
    goals: ['Keep cloud compute healthy and right-sized.', 'Stop idle instances — gated by human approval.'],
    pairs: [
      advisoryPair('capacity-scan', 'cloud capacity'),
      infraPair({
        id: 'stop-idle-instance',
        verb: 'Stop EC2 instance',
        target: 'aws',
        actionId: 'aws_ec2_stop',
        required: ['instanceId'],
        optional: ['region'],
        refKey: 'instanceId',
      }),
    ],
  });
}

export function buildPlatformEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-platform',
    name: 'Platform Engineer',
    role: 'infrastructure',
    goals: ['Keep the platform and its IaC coherent.', 'Run an infrastructure plan — gated by human approval.'],
    pairs: [
      advisoryPair('platform-health', 'platform health'),
      infraPair({
        id: 'run-iac-plan',
        verb: 'Run an infrastructure plan',
        target: 'iac',
        accountId: 'terraform',
        actionId: 'iac_run_plan',
        required: ['workspaceId'],
        optional: ['message'],
        refKey: 'workspaceId',
      }),
    ],
  });
}

export function buildDevOpsEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-devops',
    name: 'DevOps Engineer',
    role: 'infrastructure',
    goals: ['Keep delivery flowing.', 'Restart an unhealthy container — gated by human approval.'],
    pairs: [
      advisoryPair('pipeline-scan', 'delivery pipeline'),
      infraPair({
        id: 'restart-container',
        verb: 'Restart a container',
        target: 'docker',
        actionId: 'docker_container_restart',
        required: ['containerId'],
        refKey: 'containerId',
      }),
    ],
  });
}

export function buildKubernetesEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-k8s',
    name: 'Kubernetes Engineer',
    role: 'infrastructure',
    goals: ['Keep workloads scheduled and healthy.', 'Restart a deployment — gated by human approval.'],
    pairs: [
      advisoryPair('cluster-health', 'cluster health'),
      infraPair({
        id: 'restart-deployment',
        verb: 'Restart a deployment',
        target: 'kubernetes',
        actionId: 'k8s_deployment_restart',
        required: ['namespace', 'name'],
        refKey: 'name',
      }),
    ],
  });
}

export function buildDatabaseEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-database',
    name: 'Database Engineer',
    role: 'infrastructure',
    goals: ['Keep databases healthy and available.', 'Reboot a database instance — gated by human approval.'],
    pairs: [
      advisoryPair('db-health', 'database health'),
      infraPair({
        id: 'reboot-database',
        verb: 'Reboot an RDS database',
        target: 'aws',
        actionId: 'aws_rds_reboot',
        required: ['dbInstanceId'],
        optional: ['region'],
        refKey: 'dbInstanceId',
      }),
    ],
  });
}

export function buildNetworkEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-network',
    name: 'Network Engineer',
    role: 'infrastructure',
    goals: ['Keep edge and network delivery healthy.', 'Purge the CDN cache — gated by human approval.'],
    pairs: [
      advisoryPair('network-scan', 'network'),
      infraPair({
        id: 'purge-cdn-cache',
        verb: 'Purge the CDN cache',
        target: 'cloudflare',
        actionId: 'cf_purge_cache',
        required: ['zoneId'],
        refKey: 'zoneId',
      }),
    ],
  });
}

export function buildSecurityEngineerWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-security',
    name: 'Security Engineer',
    role: 'infrastructure',
    goals: ['Keep secrets and exposure under control.', 'Rotate a secret — gated by human approval.'],
    pairs: [
      advisoryPair('exposure-scan', 'security exposure'),
      infraPair({
        id: 'rotate-secret',
        verb: 'Rotate a secret',
        target: 'aws',
        actionId: 'aws_secret_rotate',
        required: ['secretId'],
        optional: ['region'],
        refKey: 'secretId',
      }),
    ],
  });
}

export function buildSreWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:infra-sre',
    name: 'Site Reliability Engineer',
    role: 'infrastructure',
    goals: ['Keep services reliable and within SLO.', 'Restart a statefulset — gated by human approval.'],
    pairs: [
      advisoryPair('reliability-review', 'reliability'),
      infraPair({
        id: 'restart-statefulset',
        verb: 'Restart a statefulset',
        target: 'kubernetes',
        actionId: 'k8s_statefulset_restart',
        required: ['namespace', 'name'],
        refKey: 'name',
      }),
    ],
  });
}
