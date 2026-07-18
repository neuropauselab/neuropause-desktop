import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { SectionId } from '@renderer/shell/sections';

/** A single open tab in the Workspace (an AI app instance). */
export interface WorkspaceTab {
  id: string;
  appId: string;
  title: string;
  openedAt: number;
}

interface ShellState {
  activeSection: SectionId;
  sidebarCollapsed: boolean;
  commandOpen: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

type Action =
  | { type: 'setSection'; section: SectionId }
  | { type: 'toggleSidebar' }
  | { type: 'setCommandOpen'; open: boolean }
  | { type: 'openApp'; appId: string; title: string }
  | { type: 'closeTab'; id: string }
  | { type: 'setActiveTab'; id: string };

const initialState: ShellState = {
  activeSection: 'home',
  sidebarCollapsed: false,
  commandOpen: false,
  tabs: [],
  activeTabId: null,
};

let tabSeq = 0;
const nextTabId = (): string => `tab_${Date.now().toString(36)}_${(tabSeq++).toString(36)}`;

function reducer(state: ShellState, action: Action): ShellState {
  switch (action.type) {
    case 'setSection':
      return { ...state, activeSection: action.section };

    case 'toggleSidebar':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };

    case 'setCommandOpen':
      return { ...state, commandOpen: action.open };

    case 'openApp': {
      // Focus an existing tab for this app, otherwise open a new one.
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

    case 'closeTab': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      let activeTabId = state.activeTabId;
      if (state.activeTabId === action.id) {
        // Activate the neighbour that takes the closed tab's place.
        const neighbour = tabs[idx] ?? tabs[idx - 1] ?? null;
        activeTabId = neighbour ? neighbour.id : null;
      }
      return { ...state, tabs, activeTabId };
    }

    case 'setActiveTab':
      return { ...state, activeTabId: action.id };

    default:
      return state;
  }
}

interface ShellContextValue extends ShellState {
  setSection: (section: SectionId) => void;
  toggleSidebar: () => void;
  openCommand: () => void;
  closeCommand: () => void;
  setCommandOpen: (open: boolean) => void;
  openApp: (appId: string, title: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setSection = useCallback((section: SectionId) => dispatch({ type: 'setSection', section }), []);
  const toggleSidebar = useCallback(() => dispatch({ type: 'toggleSidebar' }), []);
  const openCommand = useCallback(() => dispatch({ type: 'setCommandOpen', open: true }), []);
  const closeCommand = useCallback(() => dispatch({ type: 'setCommandOpen', open: false }), []);
  const setCommandOpen = useCallback((open: boolean) => dispatch({ type: 'setCommandOpen', open }), []);
  const openApp = useCallback(
    (appId: string, title: string) => dispatch({ type: 'openApp', appId, title }),
    [],
  );
  const closeTab = useCallback((id: string) => dispatch({ type: 'closeTab', id }), []);
  const setActiveTab = useCallback((id: string) => dispatch({ type: 'setActiveTab', id }), []);

  const value = useMemo<ShellContextValue>(
    () => ({
      ...state,
      setSection,
      toggleSidebar,
      openCommand,
      closeCommand,
      setCommandOpen,
      openApp,
      closeTab,
      setActiveTab,
    }),
    [state, setSection, toggleSidebar, openCommand, closeCommand, setCommandOpen, openApp, closeTab, setActiveTab],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}
