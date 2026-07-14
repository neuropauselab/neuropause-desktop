/**
 * P6.5 — Docker automation actions (HIGH PRIVILEGE).
 *
 * Confirmation-gated mutations against the Docker Engine over the SAME transport discovery uses: start / stop /
 * restart / remove a container, pull an image, prune dangling images, prune unused volumes, and scale a Swarm
 * service. Every one is `mutates: true` + `risk: 'high'`, so the shared `InfraActionExecutor` refuses it without
 * an explicit human confirmation and AI can never reach it. Discovery runs read-only; these actions are the only
 * writes, and the engine's own authorization (socket permission / TLS client identity) governs whether they run.
 *
 * The engine IS the account: the transport (`ctx.http`) is already pinned to the account's Docker Engine, so an
 * action only builds RELATIVE paths — the engine is never interpolated. Every object id (container / service) is
 * validated against a path-safe charset before use (defense-in-depth with the engine pin), and image/tag refs
 * are charset-validated then percent-encoded into the query (never the path).
 */
import { dockerDelete, dockerGet, dockerPost } from './dockerClient';
import { optStr, reqStr, InfraActionInputError, type InfraAction } from '../actionSdk';

type Rec = Record<string, unknown>;
const enc = encodeURIComponent;

/* ── strict validators (fail closed BEFORE any request) ──────────────────────────────────────────── */

/** A container / service id or name — path-safe (no `/`, no `..`, no whitespace). */
const REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
function refId(v: string, what: string): string {
  if (!REF_RE.test(v) || v.includes('..')) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return v;
}
/** An image reference (`registry[:port]/namespace/repo`) — no tag/digest here; charset only, encoded into query.
 *  `:` is allowed for a registry port (`registry.example.com:5000/team/app`); it is percent-encoded into the
 *  query, so it can never break out into the path or add a parameter. */
const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,255}$/;
function imageRef(v: string): string {
  if (!IMAGE_RE.test(v) || v.includes('..')) throw new InfraActionInputError(`Invalid image reference "${v}"`);
  return v;
}
/** An image tag — alphanumerics + `._-`, no `/`. */
const TAG_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
function imageTag(v: string): string {
  if (!TAG_RE.test(v)) throw new InfraActionInputError(`Invalid image tag "${v}"`);
  return v;
}
function replicas(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new InfraActionInputError(`Invalid replica count "${v}"`);
  return n;
}
const isTrue = (v: unknown): boolean => v === true || v === 'true' || v === '1';

/** Scan a Docker NDJSON progress stream for the first `{"error":…}` line (a pull can fail mid-stream at HTTP 200). */
function firstStreamError(text: string): string | null {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const j = JSON.parse(t) as { error?: unknown; errorDetail?: { message?: unknown } };
      const e = typeof j.error === 'string' ? j.error : typeof j.errorDetail?.message === 'string' ? j.errorDetail.message : null;
      if (e) return e;
    } catch {
      // a non-JSON progress line — ignore
    }
  }
  return null;
}

export const DOCKER_ACTIONS: InfraAction[] = [
  {
    id: 'docker_container_start', label: 'Start Container', platformId: 'docker', domain: 'containers',
    description: 'Starts a stopped container.', mutates: true, risk: 'high', targetResourceType: 'container',
    params: [{ key: 'containerId', label: 'Container', required: true, hint: 'web or 8dfafdbc3a40' }],
    run: async (ctx, p) => {
      const id = refId(reqStr(p, 'containerId'), 'container id');
      await dockerPost(ctx.http, `/containers/${id}/start`);
      return { ok: true, summary: `Started container ${id}`, data: { engine: ctx.accountId, container: id } };
    },
  },
  {
    id: 'docker_container_stop', label: 'Stop Container', platformId: 'docker', domain: 'containers',
    description: 'Stops a running container (SIGTERM then SIGKILL after the grace period).', mutates: true, risk: 'high', targetResourceType: 'container',
    params: [{ key: 'containerId', label: 'Container', required: true, hint: 'web or 8dfafdbc3a40' }],
    run: async (ctx, p) => {
      const id = refId(reqStr(p, 'containerId'), 'container id');
      await dockerPost(ctx.http, `/containers/${id}/stop`);
      return { ok: true, summary: `Stopped container ${id}`, data: { engine: ctx.accountId, container: id } };
    },
  },
  {
    id: 'docker_container_restart', label: 'Restart Container', platformId: 'docker', domain: 'containers',
    description: 'Restarts a container.', mutates: true, risk: 'high', targetResourceType: 'container',
    params: [{ key: 'containerId', label: 'Container', required: true, hint: 'web or 8dfafdbc3a40' }],
    run: async (ctx, p) => {
      const id = refId(reqStr(p, 'containerId'), 'container id');
      await dockerPost(ctx.http, `/containers/${id}/restart`);
      return { ok: true, summary: `Restarted container ${id}`, data: { engine: ctx.accountId, container: id } };
    },
  },
  {
    id: 'docker_container_remove', label: 'Remove Container', platformId: 'docker', domain: 'containers',
    description: 'Removes a container (optionally forcing a running one and deleting its anonymous volumes).', mutates: true, risk: 'high', targetResourceType: 'container',
    params: [
      { key: 'containerId', label: 'Container', required: true, hint: 'web or 8dfafdbc3a40' },
      { key: 'force', label: 'Force (kill if running)', required: false, hint: 'false' },
      { key: 'removeVolumes', label: 'Remove anonymous volumes', required: false, hint: 'false' },
    ],
    run: async (ctx, p) => {
      const id = refId(reqStr(p, 'containerId'), 'container id');
      const force = isTrue(p.force);
      const v = isTrue(p.removeVolumes);
      await dockerDelete(ctx.http, `/containers/${id}?force=${force}&v=${v}`);
      return { ok: true, summary: `Removed container ${id}${force ? ' (forced)' : ''}`, data: { engine: ctx.accountId, container: id, force, removeVolumes: v } };
    },
  },
  {
    id: 'docker_image_pull', label: 'Pull Image', platformId: 'docker', domain: 'containers',
    description: 'Pulls an image from its registry.', mutates: true, risk: 'high', targetResourceType: 'image',
    params: [
      { key: 'image', label: 'Image', required: true, hint: 'nginx or registry.example.com/team/app' },
      { key: 'tag', label: 'Tag', required: false, hint: 'latest' },
    ],
    run: async (ctx, p) => {
      const image = imageRef(reqStr(p, 'image'));
      const tag = imageTag(optStr(p, 'tag') ?? 'latest');
      const { text } = await dockerPost(ctx.http, `/images/create?fromImage=${enc(image)}&tag=${enc(tag)}`);
      const streamErr = firstStreamError(text);
      if (streamErr) return { ok: false, summary: `Pull failed for ${image}:${tag} — ${streamErr}`, data: { engine: ctx.accountId, image, tag } };
      return { ok: true, summary: `Pulled image ${image}:${tag}`, data: { engine: ctx.accountId, image, tag } };
    },
  },
  {
    id: 'docker_images_prune', label: 'Prune Images', platformId: 'docker', domain: 'containers',
    description: 'Removes dangling images (or all unused images when "all" is set).', mutates: true, risk: 'high', targetResourceType: 'image',
    params: [{ key: 'all', label: 'Prune all unused (not just dangling)', required: false, hint: 'false' }],
    run: async (ctx, p) => {
      const all = isTrue(p.all);
      // dangling=false prunes ALL unused images; the default (dangling=true) prunes only dangling ones.
      const filters = enc(JSON.stringify({ dangling: [all ? 'false' : 'true'] }));
      const { text } = await dockerPost(ctx.http, `/images/prune?filters=${filters}`);
      const parsed = safeJson(text);
      const removed = Array.isArray(parsed.ImagesDeleted) ? parsed.ImagesDeleted.length : 0;
      const reclaimed = typeof parsed.SpaceReclaimed === 'number' ? parsed.SpaceReclaimed : 0;
      return { ok: true, summary: `Pruned ${removed} image layer(s), reclaimed ${reclaimed} bytes`, data: { engine: ctx.accountId, removed, spaceReclaimed: reclaimed, all } };
    },
  },
  {
    id: 'docker_volumes_prune', label: 'Prune Volumes', platformId: 'docker', domain: 'storage',
    description: 'Removes all anonymous unused local volumes.', mutates: true, risk: 'high', targetResourceType: 'volume',
    run: async (ctx) => {
      const { text } = await dockerPost(ctx.http, `/volumes/prune`);
      const parsed = safeJson(text);
      const removed = Array.isArray(parsed.VolumesDeleted) ? parsed.VolumesDeleted.length : 0;
      const reclaimed = typeof parsed.SpaceReclaimed === 'number' ? parsed.SpaceReclaimed : 0;
      return { ok: true, summary: `Pruned ${removed} volume(s), reclaimed ${reclaimed} bytes`, data: { engine: ctx.accountId, removed, spaceReclaimed: reclaimed } };
    },
    params: [],
  },
  {
    id: 'docker_service_scale', label: 'Scale Service', platformId: 'docker', domain: 'containers',
    description: 'Sets the replica count of a replicated Swarm service.', mutates: true, risk: 'high', targetResourceType: 'swarm_service',
    params: [
      { key: 'serviceId', label: 'Service', required: true, hint: 'web or 9mnpnzenvg8p' },
      { key: 'replicas', label: 'Replicas', required: true, hint: '3' },
    ],
    run: async (ctx, p) => {
      const id = refId(reqStr(p, 'serviceId'), 'service id');
      const count = replicas(reqStr(p, 'replicas'));
      // Read the current service to get its version (required for an optimistic-concurrency update) + its Spec.
      const svc = await dockerGet<Rec>(ctx.http, `/services/${id}`);
      const version = Number(pget(svc, 'Version.Index'));
      if (!Number.isFinite(version)) throw new InfraActionInputError(`Could not resolve the current version of service "${id}"`);
      const spec = (svc.Spec && typeof svc.Spec === 'object' ? { ...(svc.Spec as Rec) } : {}) as Rec;
      const mode = (spec.Mode && typeof spec.Mode === 'object' ? (spec.Mode as Rec) : {}) as Rec;
      if (!mode.Replicated || typeof mode.Replicated !== 'object') {
        throw new InfraActionInputError(`Service "${id}" is not replicated (global services cannot be scaled)`);
      }
      spec.Mode = { ...mode, Replicated: { ...(mode.Replicated as Rec), Replicas: count } };
      await dockerPost(ctx.http, `/services/${id}/update?version=${version}`, spec);
      return { ok: true, summary: `Scaled service ${id} to ${count} replica(s)`, data: { engine: ctx.accountId, service: id, replicas: count } };
    },
  },
];

function pget(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}

function safeJson(text: string): Rec {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' ? (j as Rec) : {};
  } catch {
    return {};
  }
}

/** Bind the Docker actions (used by the executor registration in the runtime composition root). */
export function dockerActions(): InfraAction[] {
  return DOCKER_ACTIONS;
}
