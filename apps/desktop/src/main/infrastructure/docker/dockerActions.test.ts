/**
 * P6.5 — Docker automation actions through the SHARED confirmation-gated executor (the same `InfraActionExecutor`
 * P6.1 built for AWS, extended by Azure/GCP/Kubernetes). Proves: the gate refuses a mutation without `confirmed`
 * (and never touches the engine), each action builds the correct relative path / verb / body (including the
 * multi-step Scale Service read-modify-write), the path-safe validators fail closed BEFORE any request, the
 * image-pull mid-stream error is surfaced, the started→completed|failed audit fan-out, and 403 classification.
 * Pure-node; the engine transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { DOCKER_ACTIONS } from './dockerActions';

const NOW = '2026-07-13T00:00:00.000Z';

function harness(router: (req: DiscoveryRequest) => { status?: number; text?: string; error?: Error }) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: r.status ?? 200, headers: {}, text: r.text ?? '' };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, now: () => NOW },
    DOCKER_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER calls the engine', async () => {
    const { exec, events, requests } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('docker', 'engine1', 'docker_container_remove', { containerId: 'web' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('container lifecycle actions', () => {
  it('Start / Stop / Restart POST the right paths and audit started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ status: 204, text: '' }));
    const start = await exec.execute('docker', 'engine1', 'docker_container_start', { containerId: 'web' }, true);
    expect(start.ok).toBe(true);
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/containers/web/start' });
    await exec.execute('docker', 'engine1', 'docker_container_stop', { containerId: 'web' }, true);
    expect(requests[1].url).toBe('/containers/web/stop');
    await exec.execute('docker', 'engine1', 'docker_container_restart', { containerId: 'web' }, true);
    expect(requests[2].url).toBe('/containers/web/restart');
    expect(types(events).slice(0, 2)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('Remove DELETEs with the force + volume flags', async () => {
    const { exec, requests } = harness(() => ({ status: 204, text: '' }));
    await exec.execute('docker', 'engine1', 'docker_container_remove', { containerId: 'web', force: 'true', removeVolumes: 'true' }, true);
    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toBe('/containers/web?force=true&v=true');
  });
});

describe('image actions', () => {
  it('Pull encodes fromImage + tag into the query and succeeds on a clean stream', async () => {
    const stream = '{"status":"Pulling from library/nginx"}\n{"status":"Downloaded newer image"}\n';
    const { exec, requests } = harness(() => ({ text: stream }));
    const res = await exec.execute('docker', 'engine1', 'docker_image_pull', { image: 'nginx' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Pulled image nginx:latest');
    expect(requests[0].url).toBe('/images/create?fromImage=nginx&tag=latest');
  });

  it('Pull accepts a ported private-registry reference and percent-encodes it into the query', async () => {
    const { exec, requests } = harness(() => ({ text: '{"status":"Downloaded"}\n' }));
    const res = await exec.execute('docker', 'engine1', 'docker_image_pull', { image: 'registry.example.com:5000/team/app', tag: '1.2.3' }, true);
    expect(res.ok).toBe(true);
    expect(requests[0].url).toBe(`/images/create?fromImage=${encodeURIComponent('registry.example.com:5000/team/app')}&tag=1.2.3`);
  });

  it('Pull surfaces a mid-stream error (HTTP 200 but an {"error"} progress line)', async () => {
    const stream = '{"status":"Pulling"}\n{"errorDetail":{"message":"manifest unknown"},"error":"manifest unknown"}\n';
    const { exec } = harness(() => ({ text: stream }));
    const res = await exec.execute('docker', 'engine1', 'docker_image_pull', { image: 'nginx', tag: 'nope' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('manifest unknown');
  });

  it('Prune Images reports the reclaimed count + bytes', async () => {
    const { exec, requests } = harness(() => ({ text: JSON.stringify({ ImagesDeleted: [{ Deleted: 'a' }, { Deleted: 'b' }], SpaceReclaimed: 2048 }) }));
    const res = await exec.execute('docker', 'engine1', 'docker_images_prune', {}, true);
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ removed: 2, spaceReclaimed: 2048 });
    expect(requests[0].url).toContain('/images/prune?filters=');
  });
});

describe('volume + service actions', () => {
  it('Prune Volumes reports the reclaimed count + bytes', async () => {
    const { exec, requests } = harness(() => ({ text: JSON.stringify({ VolumesDeleted: ['v1'], SpaceReclaimed: 100 }) }));
    const res = await exec.execute('docker', 'engine1', 'docker_volumes_prune', {}, true);
    expect(res.data).toMatchObject({ removed: 1, spaceReclaimed: 100 });
    expect(requests[0].url).toBe('/volumes/prune');
  });

  it('Scale Service reads the current version + spec, then POSTs an update with the new replica count', async () => {
    const svcBody = JSON.stringify({ ID: 'svc1', Version: { Index: 7 }, Spec: { Name: 'api', Mode: { Replicated: { Replicas: 2 } }, TaskTemplate: { ContainerSpec: { Image: 'api:1' } } } });
    const { exec, requests } = harness((req) => (req.method === 'GET' ? { text: svcBody } : { text: '{}' }));
    const res = await exec.execute('docker', 'engine1', 'docker_service_scale', { serviceId: 'svc1', replicas: '5' }, true);
    expect(res.ok).toBe(true);
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/services/svc1' });
    const update = requests.find((r) => r.method === 'POST')!;
    expect(update.url).toBe('/services/svc1/update?version=7');
    const spec = JSON.parse(update.body ?? '{}');
    expect(spec.Mode.Replicated.Replicas).toBe(5);
    expect(spec.Name).toBe('api'); // the rest of the spec is preserved (a full-spec update)
    expect(spec.TaskTemplate.ContainerSpec.Image).toBe('api:1');
  });

  it('Scale Service refuses a global (non-replicated) service without issuing an update', async () => {
    const globalSvc = JSON.stringify({ ID: 'g1', Version: { Index: 1 }, Spec: { Name: 'g', Mode: { Global: {} } } });
    const { exec, requests } = harness(() => ({ text: globalSvc }));
    const res = await exec.execute('docker', 'engine1', 'docker_service_scale', { serviceId: 'g1', replicas: '3' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('not replicated');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });
});

describe('validators + classification', () => {
  it('rejects a path-unsafe container id BEFORE any request', async () => {
    const { exec, requests, events } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('docker', 'engine1', 'docker_container_start', { containerId: 'a/../b' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid container id');
    expect(requests).toHaveLength(0);
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('rejects a bad image reference and a non-integer replica count before any request', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    const badImage = await exec.execute('docker', 'engine1', 'docker_image_pull', { image: 'bad image!' }, true);
    expect(badImage.message).toContain('Invalid image reference');
    const badReplicas = await exec.execute('docker', 'engine1', 'docker_service_scale', { serviceId: 'svc1', replicas: 'lots' }, true);
    expect(badReplicas.message).toContain('Invalid replica count');
    expect(requests).toHaveLength(0);
  });

  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('Forbidden', 403) }));
    const res = await exec.execute('docker', 'engine1', 'docker_container_stop', { containerId: 'web' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('lists exactly the eight high-privilege Docker actions', () => {
    const { exec } = harness(() => ({ text: '{}' }));
    const cat = exec.list('docker');
    expect(cat.map((a) => a.id).sort()).toEqual([
      'docker_container_remove', 'docker_container_restart', 'docker_container_start', 'docker_container_stop',
      'docker_image_pull', 'docker_images_prune', 'docker_service_scale', 'docker_volumes_prune',
    ].sort());
    expect(cat.every((a) => a.mutates && a.risk === 'high' && a.platformId === 'docker')).toBe(true);
  });
});
