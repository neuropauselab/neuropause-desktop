import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  CloudMembership,
  CloudOrganizationSummary,
  CloudOrgRole,
  CloudWorkspace,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

/**
 * Holds the signed-in user's cloud organizations, the active one, and the active
 * org's members + workspaces. Backed by the org IPC surface (main process →
 * backend /organizations). A single source of truth so every tab (overview,
 * members, …) reads the same data and mutations refresh it once.
 */
interface CloudOrgContextValue {
  orgs: CloudOrganizationSummary[];
  activeOrg: CloudOrganizationSummary | null;
  activeOrgId: string | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  setActiveOrg: (orgId: string) => void;
  refresh: () => Promise<void>;
  createOrg: (name: string) => Promise<void>;
  updateOrg: (name: string) => Promise<void>;

  members: CloudMembership[];
  workspaces: CloudWorkspace[];
  membersLoading: boolean;
  membersError: string | null;
  refreshMembers: () => Promise<void>;
  /** Returns the one-time invite token so the caller can surface it. */
  inviteMember: (email: string, role: CloudOrgRole) => Promise<string>;
  changeRole: (membershipId: string, role: CloudOrgRole) => Promise<void>;
  removeMember: (membershipId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
}

const CloudOrgContext = createContext<CloudOrgContextValue | null>(null);

export function CloudOrgProvider({ children }: { children: ReactNode }): JSX.Element {
  const [orgs, setOrgs] = useState<CloudOrganizationSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [members, setMembers] = useState<CloudMembership[]>([]);
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ipc.org.list();
      setOrgs(list);
      setActiveOrgId((prev) =>
        prev && list.some((o) => o.orgId === prev) ? prev : (list[0]?.orgId ?? null),
      );
    } catch (err) {
      setError((err as Error).message || 'Could not reach the organization service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMembers = useCallback(async (orgId: string) => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const [m, w] = await Promise.all([ipc.org.members(orgId), ipc.org.workspaces(orgId)]);
      setMembers(m);
      setWorkspaces(w);
    } catch (err) {
      setMembersError((err as Error).message || 'Could not load members.');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeOrgId) {
      setMembers([]);
      setWorkspaces([]);
      return;
    }
    void loadMembers(activeOrgId);
  }, [activeOrgId, loadMembers]);

  const refreshMembers = useCallback(async () => {
    if (activeOrgId) await loadMembers(activeOrgId);
  }, [activeOrgId, loadMembers]);

  const createOrg = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      try {
        const result = await ipc.org.create({ name: trimmed });
        await load();
        setActiveOrgId(result.organization.id);
      } catch (err) {
        setError((err as Error).message || 'Could not create the organization.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const updateOrg = useCallback(
    async (name: string): Promise<void> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        await ipc.org.update(activeOrgId, name.trim());
        await load();
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, load],
  );

  const inviteMember = useCallback(
    async (email: string, role: CloudOrgRole): Promise<string> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        const result = await ipc.org.invite(activeOrgId, email.trim(), role);
        await loadMembers(activeOrgId);
        return result.token;
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, loadMembers],
  );

  const changeRole = useCallback(
    async (membershipId: string, role: CloudOrgRole): Promise<void> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        await ipc.org.changeRole(activeOrgId, membershipId, role);
        await loadMembers(activeOrgId);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, loadMembers],
  );

  const removeMember = useCallback(
    async (membershipId: string): Promise<void> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        await ipc.org.removeMember(activeOrgId, membershipId);
        await loadMembers(activeOrgId);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, loadMembers],
  );

  const createWorkspace = useCallback(
    async (name: string): Promise<void> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        await ipc.org.createWorkspace(activeOrgId, name.trim());
        await loadMembers(activeOrgId);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, loadMembers],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string): Promise<void> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        await ipc.org.updateWorkspace(activeOrgId, workspaceId, name.trim());
        await loadMembers(activeOrgId);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, loadMembers],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (!activeOrgId) throw new Error('No active organization.');
      setBusy(true);
      try {
        await ipc.org.deleteWorkspace(activeOrgId, workspaceId);
        await loadMembers(activeOrgId);
      } finally {
        setBusy(false);
      }
    },
    [activeOrgId, loadMembers],
  );

  const value = useMemo<CloudOrgContextValue>(
    () => ({
      orgs,
      activeOrg: orgs.find((o) => o.orgId === activeOrgId) ?? null,
      activeOrgId,
      loading,
      error,
      busy,
      setActiveOrg: setActiveOrgId,
      refresh: load,
      createOrg,
      updateOrg,
      members,
      workspaces,
      membersLoading,
      membersError,
      refreshMembers,
      inviteMember,
      changeRole,
      removeMember,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
    }),
    [
      orgs,
      activeOrgId,
      loading,
      error,
      busy,
      load,
      createOrg,
      updateOrg,
      members,
      workspaces,
      membersLoading,
      membersError,
      refreshMembers,
      inviteMember,
      changeRole,
      removeMember,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
    ],
  );

  return <CloudOrgContext.Provider value={value}>{children}</CloudOrgContext.Provider>;
}

export function useCloudOrg(): CloudOrgContextValue {
  const ctx = useContext(CloudOrgContext);
  if (!ctx) throw new Error('useCloudOrg must be used within CloudOrgProvider');
  return ctx;
}

export const ROLE_LABEL: Record<CloudOrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ASSIGNABLE_ROLES: CloudOrgRole[] = ['admin', 'member', 'viewer'];
