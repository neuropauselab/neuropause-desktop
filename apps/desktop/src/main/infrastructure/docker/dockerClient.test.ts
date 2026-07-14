/**
 * P6.5 — Docker transport: the engine-pin (SSRF hard stop — an absolute / protocol-relative request URL is
 * refused before the socket is opened), the connector-taxonomy error mapping (including the Swarm-503 "not a
 * swarm manager" → 404 unprovisioned special case), the `{message}` error-body parse, the no-pagination list
 * helpers (bare array + the `/volumes` wrapper), and a REAL `NetworkError` on a dead socket (exercising the
 * node:http path). No live Docker engine.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { DockerClient, dockerErrorMessage, dockerGet, dockerList, dockerPost, errorFor } from './dockerClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };

function fakeHttp(router: (req: DiscoveryRequest) => { status?: number; text: string }): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req);
      if (r.status && r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
      return { status: r.status ?? 200, headers: {}, text: r.text };
    },
  };
}

describe('DockerClient — engine pin (SSRF hard stop)', () => {
  it('refuses an absolute-URL or protocol-relative request BEFORE touching the socket', async () => {
    const client = new DockerClient({ socketPath: '/var/run/docker.sock' }, gate, 'engine1');
    await expect(client.send({ method: 'GET', url: 'https://evil.com/containers/json' })).rejects.toThrow(/non-relative/);
    await expect(client.send({ method: 'GET', url: '//evil.com/x' })).rejects.toThrow(/non-relative/);
    await expect(client.getJson('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/non-relative/);
  });

  it('maps a real connection failure (dead socket) to NetworkError via the node:http path', async () => {
    const client = new DockerClient({ socketPath: '/nonexistent/np-docker-test.sock' }, gate, 'engine1');
    await expect(client.send({ method: 'GET', url: '/containers/json' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('errorFor / dockerErrorMessage', () => {
  it('maps Docker statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"message":"permission denied"}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    expect(errorFor(429, { 'retry-after': '2' }, '')).toBeInstanceOf(RateLimitError);
    expect((errorFor(429, { 'retry-after': '2' }, '') as RateLimitError).retryAfterMs).toBe(2000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
    expect((errorFor(400, {}, '{"message":"bad param"}') as HttpError).retryable).toBe(false);
  });

  it('degrades a Swarm endpoint on a non-manager engine (503 "not a swarm manager") to a non-retryable 404', () => {
    const err = errorFor(503, {}, '{"message":"This node is not a swarm manager."}');
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404); // → errorStatus 404 → domain degrades `unprovisioned`
    expect((err as HttpError).retryable).toBe(false);
    // a GENERIC 503 stays a rate-limit backoff.
    expect(errorFor(503, {}, '{"message":"service unavailable"}')).toBeInstanceOf(RateLimitError);
  });

  it('reads the Docker {message} error body', () => {
    expect(dockerErrorMessage('{"message":"no such container: web"}')).toBe('no such container: web');
    expect(dockerErrorMessage('not json')).toBeNull();
    expect(dockerErrorMessage('')).toBeNull();
  });
});

describe('list helpers — no pagination', () => {
  it('dockerList reads a bare array, and unwraps a listKey envelope', async () => {
    const arr = await dockerList(fakeHttp(() => ({ text: JSON.stringify([{ Id: 'a' }, { Id: 'b' }]) })), '/containers/json');
    expect(arr).toHaveLength(2);
    const vols = await dockerList(fakeHttp(() => ({ text: JSON.stringify({ Volumes: [{ Name: 'v' }] }) })), '/volumes', 'Volumes');
    expect(vols).toEqual([{ Name: 'v' }]);
    // a null Volumes array degrades to empty, never throws.
    const none = await dockerList(fakeHttp(() => ({ text: JSON.stringify({ Volumes: null }) })), '/volumes', 'Volumes');
    expect(none).toEqual([]);
  });

  it('dockerGet parses a single object; dockerPost returns the raw status + text', async () => {
    const svc = await dockerGet(fakeHttp(() => ({ text: JSON.stringify({ ID: 'svc1', Version: { Index: 7 } }) })), '/services/svc1');
    expect(svc).toMatchObject({ ID: 'svc1' });
    const res = await dockerPost(fakeHttp((req) => ({ status: req.method === 'POST' ? 204 : 200, text: '' })), '/containers/c1/start');
    expect(res.status).toBe(204);
  });
});
