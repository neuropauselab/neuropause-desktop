/**
 * IPC handlers for Workspace Contexts (Phase 6 Stage 1). Thin, validated
 * wrappers over the store singleton — payloads arrive already Zod-parsed by
 * the router; the store sanitizes snapshot contents field-by-field on top.
 */
import type {
  WorkspaceCtxBootstrapRequest,
  WorkspaceCtxCreateRequest,
  WorkspaceCtxRenameRequest,
  WorkspaceCtxDeleteRequest,
  WorkspaceCtxSwitchRequest,
  WorkspaceCtxUpdateSnapshotRequest,
} from '@neuropause/shared';
import { workspaceContexts } from '../../workspaces/workspaceContextsInstance';
import type { WorkspaceContextState } from '../../workspaces/workspaceContextStore';

export function bootstrap(req: WorkspaceCtxBootstrapRequest): WorkspaceContextState {
  return workspaceContexts.bootstrap(req.legacySnapshot);
}

export function list(): WorkspaceContextState {
  return workspaceContexts.getState();
}

export function create(req: WorkspaceCtxCreateRequest): WorkspaceContextState {
  return workspaceContexts.create(req.name, req.template, req.color);
}

export function rename(req: WorkspaceCtxRenameRequest): WorkspaceContextState {
  return workspaceContexts.rename(req.id, req.name);
}

export function remove(req: WorkspaceCtxDeleteRequest): WorkspaceContextState {
  return workspaceContexts.remove(req.id);
}

export function switchTo(req: WorkspaceCtxSwitchRequest): WorkspaceContextState {
  return workspaceContexts.switch(req.id);
}

export function updateSnapshot(req: WorkspaceCtxUpdateSnapshotRequest): WorkspaceContextState {
  return workspaceContexts.updateSnapshot(req.id, req.snapshot);
}
