/**
 * NeuroPause Platform — canonical request context (ERP Session 19, Track B).
 *
 * The AUTHENTICATED context an adapter (Electron / Web / Mobile / API / AI) hands
 * the application boundary. The principal — tenant, actor, granted permissions —
 * is RESOLVED SERVER-SIDE from the authenticated session, never taken from
 * untrusted client input; a `null` principal means the request is unauthenticated.
 * A client may still CLAIM a tenant on the request, but the boundary validates
 * that claim against this principal and rejects a mismatch (see
 * `applicationService`).
 *
 * Transport-neutral and Electron-free: it carries only identity + correlation,
 * no HTTP/IPC/renderer types.
 */
import type { EnterprisePermission } from '@neuropause/shared';
import type { CommandSource } from '../command/domainCommand';

export interface Principal {
  /** The authenticated actor (email / id). */
  actor: string;
  /** The tenant resolved from the authenticated session — the authority. */
  tenantId: string;
  organizationId?: string;
  workspaceId?: string;
  /** The permissions this principal was granted (drives authorization). */
  permissions: readonly EnterprisePermission[];
}

export interface RequestContext {
  /** The authenticated principal, or `null` when the caller is unauthenticated. */
  principal: Principal | null;
  correlationId: string;
  causationId?: string;
  requestId: string;
  source: CommandSource;
}
