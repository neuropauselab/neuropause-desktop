import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { SectionId } from '@renderer/shell/sections';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { resolveStartupSection, type StartupMode } from '@renderer/shell/startupPolicy';

/** A single open tab in the Workspace (an AI app instance). */
export interface WorkspaceTab {
  id: string;
  appId: string;
  title: string;
  openedAt: number;
}

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 232;
export const SIDEBAR_COLLAPSED = 68;

interface ShellState {
  activeSection: SectionId;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  commandOpen: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** Increments to ask the Workspace to surface its app launcher (⌘T / +). */
  newTabSignal: number;
  /** A one-shot deep-link target for an Operations sub-tab (set by the Command Center). */
  opsTab: string | null;
  /** A one-shot deep-link target for an Enterprise sub-tab (set by the Command Palette / personalization). */
  enterpriseTab: string | null;
  /** A one-shot deep-link target for a Connector Center sub-tab (set by the Command Palette). */
  connectorsTab: string | null;
  /** A one-shot deep-link target for a Business Workspace module (set by the Command Palette / search). */
  businessTab: string | null;
}

type Action =
  | { type: 'setSection'; section: SectionId }
  | { type: 'toggleSidebar' }
  | { type: 'setSidebarWidth'; width: number }
  | { type: 'setCommandOpen'; open: boolean }
  | { type: 'openApp'; appId: string; title: string }
  | { type: 'closeTab'; id: string }
  | { type: 'closeActiveTab' }
  | { type: 'setActiveTab'; id: string }
  | { type: 'requestNewTab' }
  | { type: 'openOperations'; tab: string | null }
  | { type: 'clearOpsTab' }
  | { type: 'openEnterprise'; tab: string | null }
  | { type: 'clearEnterpriseTab' }
  | { type: 'openConnectors'; tab: string | null }
  | { type: 'clearConnectorsTab' }
  | { type: 'openBusiness'; tab: string | null }
  | { type: 'clearBusinessTab' };

const clampWidth = (w: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
/** Builds initial state, restoring persisted preferences where valid. */
function init(): ShellState {
  const persistedSection = prefs.read<string>(PrefKey.activeSection, 'intent-home');
  const persistedTabs = prefs.read<WorkspaceTab[]>(PrefKey.workspaceTabs, []);
  const persistedActiveTab = prefs.read<string | null>(PrefKey.activeTabId, null);
  const tabs = Array.isArray(persistedTabs) ? persistedTabs.filter((t) => t && t.id && t.appId) : [];
  const activeTabId = tabs.some((t) => t.id === persistedActiveTab)
    ? persistedActiveTab
    : (tabs[tabs.length - 1]?.id ?? null);

  // Startup Experience Policy — resolve the landing section from the user's real startup preference,
  // validated against the section registry with a never-erroring fallback chain.
  const startupMode = prefs.read<StartupMode>(PrefKey.startupMode, 'resume');
  const startupSection = prefs.read<string>(PrefKey.startupSection, 'intent-home');

  return {
    activeSection: resolveStartupSection({
      mode: startupMode,
      configuredSection: startupSection,
      lastSection: persistedSection,
      hasUnfinishedWork: tabs.length > 0,
    }),
    sidebarCollapsed: prefs.read<boolean>(PrefKey.sidebarCollapsed, false),
    sidebarWidth: clampWidth(prefs.read<number>(PrefKey.sidebarWidth, SIDEBAR_DEFAULT)),
    commandOpen: false,
    tabs,
    activeTabId,
    newTabSignal: 0,
    opsTab: null,
    enterpriseTab: null,
    connectorsTab: null,
    businessTab: null,
  };
}

let tabSeq = 0;
const nextTabId = (): string => `tab_${Date.now().toString(36)}_${(tabSeq++).toString(36)}`;

function reducer(state: ShellState, action: Action): ShellState {
  switch (action.type) {
    case 'setSection':
      return { ...state, activeSection: action.section };

    case 'toggleSidebar':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case 'setSidebarWidth':
      return { ...state, sidebarWidth: clampWidth(action.width) };

    case 'setCommandOpen':
      return { ...state, commandOpen: action.open };

    case 'openApp': {
      const existing = state.tabs.find((t) => t.appId === action.appId);
      if (existing) {
        return { ...state, activeSection: 'workspace', activeTabId: existing.id };
      }
      const tab: WorkspaceTab = {
        id: nextTabId(),
        appId: action.appId,
        title: action.title,
        openedAt: Date.now(),
      };
      return {
        ...state,
        activeSection: 'workspace',
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      };
    }

    case 'closeActiveTab':
      if (!state.activeTabId) return state;
      return reducer(state, { type: 'closeTab', id: state.activeTabId });

    case 'closeTab': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      let activeTabId = state.activeTabId;
      if (state.activeTabId === action.id) {
        const neighbour = tabs[idx] ?? tabs[idx - 1] ?? null;
        activeTabId = neighbour ? neighbour.id : null;
      }
      return { ...state, tabs, activeTabId };
    }

    case 'setActiveTab':
      return { ...state, activeTabId: action.id };

    case 'requestNewTab':
      return { ...state, activeSection: 'workspace', newTabSignal: state.newTabSignal + 1 };

    case 'openOperations':
      return { ...state, activeSection: 'operations', opsTab: action.tab };

    case 'clearOpsTab':
      return { ...state, opsTab: null };

    case 'openEnterprise':
      return { ...state, activeSection: 'enterprise', enterpriseTab: action.tab };

    case 'clearEnterpriseTab':
      return { ...state, enterpriseTab: null };

    case 'openConnectors':
      return { ...state, activeSection: 'connectors', connectorsTab: action.tab };

    case 'clearConnectorsTab':
      return { ...state, connectorsTab: null };

    case 'openBusiness':
      return { ...state, activeSection: 'business', businessTab: action.tab };

    case 'clearBusinessTab':
      return { ...state, businessTab: null };

    default:
      return state;
  }
}

interface ShellContextValue extends ShellState {
  setSection: (section: SectionId) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  openCommand: () => void;
  closeCommand: () => void;
  setCommandOpen: (open: boolean) => void;
  openApp: (appId: string, title: string) => void;
  closeTab: (id: string) => void;
  closeActiveTab: () => void;
  setActiveTab: (id: string) => void;
  requestNewTab: () => void;
  openOperations: (tab?: string) => void;
  clearOpsTab: () => void;
  openEnterprise: (tab?: string) => void;
  clearEnterpriseTab: () => void;
  openConnectors: (tab?: string) => void;
  clearConnectorsTab: () => void;
  openBusiness: (tab?: string) => void;
  clearBusinessTab: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  // Persist the durable slices whenever they change.
  useEffect(() => prefs.write(PrefKey.activeSection, state.activeSection), [state.activeSection]);
  useEffect(() => prefs.write(PrefKey.sidebarCollapsed, state.sidebarCollapsed), [state.sidebarCollapsed]);
  useEffect(() => prefs.write(PrefKey.sidebarWidth, state.sidebarWidth), [state.sidebarWidth]);
  useEffect(() => prefs.write(PrefKey.workspaceTabs, state.tabs), [state.tabs]);
  useEffect(() => prefs.write(PrefKey.activeTabId, state.activeTabId), [state.activeTabId]);

  const setSection = useCallback((section: SectionId) => dispatch({ type: 'setSection', section }), []);
  const toggleSidebar = useCallback(() => dispatch({ type: 'toggleSidebar' }), []);
  const setSidebarWidth = useCallback((width: number) => dispatch({ type: 'setSidebarWidth', width }), []);
  const openCommand = useCallback(() => dispatch({ type: 'setCommandOpen', open: true }), []);
  const closeCommand = useCallback(() => dispatch({ type: 'setCommandOpen', open: false }), []);
  const setCommandOpen = useCallback((open: boolean) => dispatch({ type: 'setCommandOpen', open }), []);
  const openApp = useCallback(
    (appId: string, title: string) => dispatch({ type: 'openApp', appId, title }),
    [],
  );
  const closeTab = useCallback((id: string) => dispatch({ type: 'closeTab', id }), []);
  const closeActiveTab = useCallback(() => dispatch({ type: 'closeActiveTab' }), []);
  const setActiveTab = useCallback((id: string) => dispatch({ type: 'setActiveTab', id }), []);
  const requestNewTab = useCallback(() => dispatch({ type: 'requestNewTab' }), []);
  const openOperations = useCallback((tab?: string) => dispatch({ type: 'openOperations', tab: tab ?? null }), []);
  const clearOpsTab = useCallback(() => dispatch({ type: 'clearOpsTab' }), []);
  const openEnterprise = useCallback((tab?: string) => dispatch({ type: 'openEnterprise', tab: tab ?? null }), []);
  const clearEnterpriseTab = useCallback(() => dispatch({ type: 'clearEnterpriseTab' }), []);
  const openConnectors = useCallback((tab?: string) => dispatch({ type: 'openConnectors', tab: tab ?? null }), []);
  const clearConnectorsTab = useCallback(() => dispatch({ type: 'clearConnectorsTab' }), []);
  const openBusiness = useCallback((tab?: string) => dispatch({ type: 'openBusiness', tab: tab ?? null }), []);
  const clearBusinessTab = useCallback(() => dispatch({ type: 'clearBusinessTab' }), []);

  const value = useMemo<ShellContextValue>(
    () => ({
      ...state,
      setSection,
      toggleSidebar,
      setSidebarWidth,
      openCommand,
      closeCommand,
      setCommandOpen,
      openApp,
      closeTab,
      closeActiveTab,
      setActiveTab,
      requestNewTab,
      openOperations,
      clearOpsTab,
      openEnterprise,
      clearEnterpriseTab,
      openConnectors,
      clearConnectorsTab,
      openBusiness,
      clearBusinessTab,
    }),
    [
      state,
      setSection,
      toggleSidebar,
      setSidebarWidth,
      openCommand,
      closeCommand,
      setCommandOpen,
      openApp,
      closeTab,
      closeActiveTab,
      setActiveTab,
      requestNewTab,
      openOperations,
      clearOpsTab,
      openEnterprise,
      clearEnterpriseTab,
      openConnectors,
      clearConnectorsTab,
      openBusiness,
      clearBusinessTab,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}
