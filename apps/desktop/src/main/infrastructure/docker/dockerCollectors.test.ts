/**
 * P6.5 — the Docker DomainCollectors: list parsing (bare array + the `/volumes` wrapper), ID-based relationship
 * mapping (container→image/network/volume, task→node/service, service→secret/config/network), the "no secret /
 * config material" guarantee, single-page (no-pagination) cursor semantics, and the Resource Graph projection.
 * Pure-node; the engine transport is faked (canned Engine API responses).
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { DOCKER_COLLECTORS } from './dockerCollectors';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => DOCKER_COLLECTORS.find((c) => c.id === id)!;

function fakeDocker(router: (req: DiscoveryRequest) => { status?: number; body: string }): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req);
      if (r.status && r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
      return { status: r.status ?? 200, headers: {}, text: r.body };
    },
  };
}
const ctx = (http: DiscoveryHttp): DiscoveryContext => ({ platformId: 'docker', accountId: 'engine1', region: null, cursor: null, now: NOW, http });

describe('Docker Containers — health + id-based relationships, single page', () => {
  it('maps a container with uses(image) / connected_to(network) / attached_to(volume) and a null cursor', async () => {
    const body = JSON.stringify([
      {
        Id: 'c1', Names: ['/web'], Image: 'nginx:latest', ImageID: 'sha256:img1', State: 'running', Status: 'Up 3 minutes',
        Labels: { app: 'web' },
        NetworkSettings: { Networks: { bridge: { NetworkID: 'net1' } } },
        Mounts: [{ Type: 'volume', Name: 'vol1' }, { Type: 'bind', Source: '/etc' }],
      },
    ]);
    const p = await collector('docker_containers').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources).toHaveLength(1);
    const c = p.resources[0];
    expect(c.nativeId).toBe('c1');
    expect(c.name).toBe('web');
    expect(c.health).toBe('healthy');
    expect(c.id).toBe(makeResourceId('docker', 'engine1', 'container', 'c1'));
    expect(c.relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual([
      'attached_to:vol1',
      'connected_to:net1',
      'uses:sha256:img1',
    ].sort());
    expect(p.cursor).toBeNull();
    expect(p.hasMore).toBe(false);
  });

  it('derives health from container state (exited → critical, paused → degraded)', async () => {
    const body = JSON.stringify([
      { Id: 'a', Names: ['/a'], State: 'exited', Status: 'Exited (0)' },
      { Id: 'b', Names: ['/b'], State: 'paused', Status: 'Up (Paused)' },
    ]);
    const p = await collector('docker_containers').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources.find((r) => r.nativeId === 'a')!.health).toBe('critical');
    expect(p.resources.find((r) => r.nativeId === 'b')!.health).toBe('degraded');
  });
});

describe('Docker Images / Networks / Volumes', () => {
  it('maps an image by Id with its RepoTags name', async () => {
    const body = JSON.stringify([{ Id: 'sha256:img1', RepoTags: ['nginx:latest'], Size: 1000, Containers: 2 }]);
    const p = await collector('docker_images').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources[0].nativeId).toBe('sha256:img1');
    expect(p.resources[0].name).toBe('nginx:latest');
    expect(p.resources[0].attributes.size).toBe(1000);
  });

  it('unwraps the /volumes { Volumes: [...] } envelope', async () => {
    const body = JSON.stringify({ Volumes: [{ Name: 'vol1', Driver: 'local', Scope: 'local', Mountpoint: '/var/lib/docker/volumes/vol1' }], Warnings: [] });
    const p = await collector('docker_volumes').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources).toHaveLength(1);
    expect(p.resources[0].nativeId).toBe('vol1');
    expect(p.resources[0].attributes.driver).toBe('local');
  });
});

describe('Docker Swarm — services / tasks / nodes with id refs', () => {
  it('maps a replicated service with uses(secret,config) + connected_to(network, deduped) and ServiceStatus health', async () => {
    const body = JSON.stringify([
      {
        ID: 'svc1', Version: { Index: 5 },
        Spec: {
          Name: 'api', Labels: { app: 'api' },
          TaskTemplate: { ContainerSpec: { Image: 'api:1', Secrets: [{ SecretID: 'sec1' }], Configs: [{ ConfigID: 'cfg1' }] }, Networks: [{ Target: 'net1' }] },
          Mode: { Replicated: { Replicas: 3 } },
        },
        Endpoint: { VirtualIPs: [{ NetworkID: 'net1' }] },
        ServiceStatus: { RunningTasks: 3, DesiredTasks: 3 },
      },
    ]);
    const p = await collector('docker_services').collect(ctx(fakeDocker(() => ({ body }))));
    const svc = p.resources[0];
    expect(svc.nativeId).toBe('svc1');
    expect(svc.name).toBe('api');
    expect(svc.health).toBe('healthy');
    expect(svc.attributes).toMatchObject({ mode: 'replicated', replicas: 3, running: 3, image: 'api:1' });
    // net1 appears in BOTH TaskTemplate.Networks and Endpoint.VirtualIPs — deduped to one edge.
    expect(svc.relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['connected_to:net1', 'uses:cfg1', 'uses:sec1'].sort());
  });

  it('maps a task with runs_on(node) + member_of(service)', async () => {
    const body = JSON.stringify([{ ID: 'task1', ServiceID: 'svc1', NodeID: 'node1', Slot: 2, Status: { State: 'running' }, DesiredState: 'running' }]);
    const p = await collector('docker_tasks').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources[0].nativeId).toBe('task1');
    expect(p.resources[0].health).toBe('healthy');
    expect(p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['member_of:svc1', 'runs_on:node1'].sort());
  });

  it('node health reflects availability (a drained but ready node is degraded)', async () => {
    const body = JSON.stringify([
      { ID: 'node1', Spec: { Role: 'manager', Availability: 'active' }, Description: { Hostname: 'host-1', Engine: { EngineVersion: '24.0' } }, Status: { State: 'ready' }, ManagerStatus: { Leader: true, Reachability: 'reachable' } },
      { ID: 'node2', Spec: { Role: 'worker', Availability: 'drain' }, Description: { Hostname: 'host-2' }, Status: { State: 'ready' } },
    ]);
    const p = await collector('docker_swarm_nodes').collect(ctx(fakeDocker(() => ({ body }))));
    const n1 = p.resources.find((r) => r.nativeId === 'node1')!;
    expect(n1.name).toBe('host-1');
    expect(n1.health).toBe('healthy');
    expect(n1.attributes).toMatchObject({ role: 'manager', leader: true });
    expect(p.resources.find((r) => r.nativeId === 'node2')!.health).toBe('degraded');
  });
});

describe('Docker Secrets / Configs — metadata only, NEVER the payload', () => {
  it('a secret is mapped by metadata only', async () => {
    const body = JSON.stringify([{ ID: 'sec1', CreatedAt: '2026-01-01T00:00:00Z', Spec: { Name: 'db-password', Labels: { tier: 'db' } } }]);
    const p = await collector('docker_secrets').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources[0].nativeId).toBe('sec1');
    expect(p.resources[0].name).toBe('db-password');
    expect(p.resources[0].tags).toEqual({ tier: 'db' });
  });

  it('a config DROPS Spec.Data — emits a byte-size count, never the payload', async () => {
    // 'c2VjcmV0Q29uZmln' is base64 for 'secretConfig' (12 bytes).
    const body = JSON.stringify([{ ID: 'cfg1', CreatedAt: '2026-01-01T00:00:00Z', Spec: { Name: 'app.conf', Data: 'c2VjcmV0Q29uZmln', Labels: { env: 'prod' } } }]);
    const p = await collector('docker_configs').collect(ctx(fakeDocker(() => ({ body }))));
    expect(p.resources[0].nativeId).toBe('cfg1');
    expect(p.resources[0].name).toBe('app.conf');
    expect(p.resources[0].attributes.bytes).toBe(12);
    expect(JSON.stringify(p.resources[0])).not.toContain('c2VjcmV0Q29uZmln'); // the config payload never leaves
  });
});

describe('Docker Resource Graph projection', () => {
  it('projects Image + Network + Volume + Container and resolves uses/connected_to/attached_to edges (+ blast radius)', async () => {
    const container = { Id: 'c1', Names: ['/web'], Image: 'nginx:latest', ImageID: 'sha256:img1', State: 'running', NetworkSettings: { Networks: { bridge: { NetworkID: 'net1' } } }, Mounts: [{ Type: 'volume', Name: 'vol1' }] };
    const resources = [
      ...(await collector('docker_images').collect(ctx(fakeDocker(() => ({ body: JSON.stringify([{ Id: 'sha256:img1', RepoTags: ['nginx:latest'] }]) }))))).resources,
      ...(await collector('docker_networks').collect(ctx(fakeDocker(() => ({ body: JSON.stringify([{ Id: 'net1', Name: 'bridge', Driver: 'bridge' }]) }))))).resources,
      ...(await collector('docker_volumes').collect(ctx(fakeDocker(() => ({ body: JSON.stringify({ Volumes: [{ Name: 'vol1', Driver: 'local' }] }) }))))).resources,
      ...(await collector('docker_containers').collect(ctx(fakeDocker(() => ({ body: JSON.stringify([container]) }))))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // container uses image + connected_to network + attached_to volume = 3 resolved edges.
    expect(model.edges).toHaveLength(3);
    expect(model.edges.map((e) => e.type).sort()).toEqual(['attached_to', 'connected_to', 'uses']);
    // The image is a dependency of the container — it accrues blast radius.
    const imgId = makeResourceId('docker', 'engine1', 'image', 'sha256:img1');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === imgId)).toBe(true);
  });
});

describe('Docker platform — one adapter, the four Docker domains', () => {
  it('the collectors span containers/compute/networking/storage', () => {
    const domains = new Set(DOCKER_COLLECTORS.map((c) => c.domain));
    for (const d of ['containers', 'compute', 'networking', 'storage'] as const) expect(domains.has(d)).toBe(true);
    expect(DOCKER_COLLECTORS).toHaveLength(10);
  });
});
