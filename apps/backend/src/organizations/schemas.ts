import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

export const CreateOrgBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(48).optional(),
});

export const InviteBody = z.object({
  email: z.string().trim().email(),
  role: z.enum(ROLES),
});

export const AcceptInviteBody = z.object({
  token: z.string().min(1),
});

export const ChangeRoleBody = z.object({
  role: z.enum(ROLES),
});

export const CreateWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(120),
});

export const UpdateOrgBody = z.object({
  name: z.string().trim().min(1).max(120),
});

export const UpdateWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(120),
});
