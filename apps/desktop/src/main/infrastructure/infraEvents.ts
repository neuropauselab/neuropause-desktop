/**
 * Infrastructure event builders (P6). Pure factories returning `PlatformEventInput`s that the discovery
 * engine publishes onto the EXISTING Platform Event Bus (`platform.api.publish`). The bus's built-in
 * `timeline` subscriber persists them automatically, so infrastructure events flow into the ONE Timeline
 * (and reach Diagnostics, Webhooks, Memory, and the AI context) with no parallel event system — mirroring
 * how `unified/sync/events.ts` builds connector events.
 */
import type { CloudResource, PlatformEventInput } from '@neuropause/shared';

const SOURCE = 'infrastructure';

function resourceRef(r: CloudResource): { type: string; id: string; name: string } {
  return { type: r.resourceType, id: r.id, name: r.name };
}

export const infraEvents = {
  discoveryStarted(platformId: string, accountId: string): PlatformEventInput {
    return {
      type: 'infrastructure.discovery_started',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'system', id: platformId },
      resource: { type: 'platform', id: `${platformId}:${accountId}`, name: platformId },
      priority: 'low',
      metadata: { platformId, accountId },
    };
  },
  discoveryCompleted(platformId: string, accountId: string, counts: { created: number; updated: number; deleted: number; total: number }): PlatformEventInput {
    return {
      type: 'infrastructure.discovery_completed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'system', id: platformId },
      resource: { type: 'platform', id: `${platformId}:${accountId}`, name: platformId },
      priority: 'normal',
      metadata: { platformId, accountId, ...counts },
    };
  },
  discoveryFailed(platformId: string, accountId: string, reason: string): PlatformEventInput {
    return {
      type: 'infrastructure.discovery_failed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'system', id: platformId },
      resource: { type: 'platform', id: `${platformId}:${accountId}`, name: platformId },
      priority: 'high',
      metadata: { platformId, accountId, reason },
    };
  },
  resourceChanged(r: CloudResource, change: 'created' | 'updated'): PlatformEventInput {
    return {
      type: 'infrastructure.resource_changed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'system', id: r.platformId },
      resource: resourceRef(r),
      priority: 'low',
      metadata: { platformId: r.platformId, accountId: r.accountId, domain: r.domain, resourceType: r.resourceType, change },
    };
  },
  resourceRemoved(platformId: string, accountId: string, resourceId: string): PlatformEventInput {
    return {
      type: 'infrastructure.resource_removed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'system', id: platformId },
      resource: { type: 'resource', id: resourceId, name: resourceId },
      priority: 'normal',
      metadata: { platformId, accountId, resourceId },
    };
  },
  healthChanged(r: CloudResource, from: string, to: string): PlatformEventInput {
    return {
      type: 'infrastructure.health_changed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'system', id: r.platformId },
      resource: resourceRef(r),
      priority: to === 'critical' ? 'critical' : to === 'degraded' ? 'high' : 'normal',
      metadata: { platformId: r.platformId, accountId: r.accountId, resourceType: r.resourceType, from, to },
    };
  },
  /* ── automation actions (P6.1) — a high-privilege mutation, actor is the operator (not the system) ── */
  actionStarted(platformId: string, accountId: string, actionId: string, label: string): PlatformEventInput {
    return {
      type: 'infrastructure.action_started',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'user', id: 'operator' },
      resource: { type: 'platform', id: `${platformId}:${accountId}`, name: platformId },
      priority: 'high',
      metadata: { platformId, accountId, actionId, label },
    };
  },
  actionCompleted(platformId: string, accountId: string, actionId: string, label: string, summary: string): PlatformEventInput {
    return {
      type: 'infrastructure.action_completed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'user', id: 'operator' },
      resource: { type: 'platform', id: `${platformId}:${accountId}`, name: platformId },
      priority: 'high',
      metadata: { platformId, accountId, actionId, label, summary },
    };
  },
  actionFailed(platformId: string, accountId: string, actionId: string, label: string, reason: string): PlatformEventInput {
    return {
      type: 'infrastructure.action_failed',
      category: 'infrastructure',
      source: SOURCE,
      actor: { kind: 'user', id: 'operator' },
      resource: { type: 'platform', id: `${platformId}:${accountId}`, name: platformId },
      priority: 'critical',
      metadata: { platformId, accountId, actionId, label, reason },
    };
  },
};
