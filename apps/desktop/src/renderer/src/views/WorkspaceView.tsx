import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon } from '@renderer/components/ui/Icon';
import { createLogger } from '@renderer/lib/logger';
import { WorkspaceTabBar } from './workspace/WorkspaceTabBar';
import { AppLauncher } from './workspace/AppLauncher';
import { AppTabContent } from './workspace/AppTabContent';

const log = createLogger('workspace');

interface DroppedFile {
  name: string;
  size: number;
  type: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** The multi-tab Workspace: an IDE-like surface for AI apps. */
export function WorkspaceView(): JSX.Element {
  const { tabs, activeTabId, newTabSignal, openApp, closeTab, setActiveTab } = useShell();
  const [launcher, setLauncher] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<DroppedFile[]>([]);
  const dragDepth = useRef(0);

  // ⌘T (or the menu) asks the Workspace to surface its launcher.
  const firstSignal = useRef(newTabSignal);
  useEffect(() => {
    if (newTabSignal !== firstSignal.current) setLauncher(true);
  }, [newTabSignal]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const showLauncher = launcher || !activeTab;

  const handleOpen = (id: string, title: string): void => {
    openApp(id, title);
    setLauncher(false);
  };
  const handleSelect = (id: string): void => {
    setActiveTab(id);
    setLauncher(false);
  };

  const hasFiles = (e: ReactDragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = (e: ReactDragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: ReactDragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: ReactDragEvent): void => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: ReactDragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type || 'unknown',
    }));
    if (files.length > 0) {
      log.info('Files dropped into workspace', { count: files.length });
      setDropped(files);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {tabs.length > 0 && (
        <WorkspaceTabBar
          tabs={tabs}
          activeTabId={showLauncher ? null : activeTabId}
          onSelect={handleSelect}
          onClose={closeTab}
          onNew={() => setLauncher(true)}
        />
      )}

      <div
        className="relative min-h-0 flex-1"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {showLauncher ? (
          <AppLauncher onOpenApp={handleOpen} />
        ) : (
          <AppTabContent tab={activeTab as NonNullable<typeof activeTab>} />
        )}

        {/* Dropped-files panel — the capture is real; routing into an app is Phase 4. */}
        <AnimatePresence>
          {dropped.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ type: 'spring', stiffness: 460, damping: 38 }}
              className="glass-panel absolute bottom-4 left-1/2 w-[min(520px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl p-4 shadow-pop"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Icon name="upload" size={16} />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">
                      {dropped.length} file{dropped.length > 1 ? 's' : ''} ready
                    </div>
                    <div className="text-xs text-faint">Attaching files to an app arrives with Connectors (Phase 4).</div>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setDropped([])}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:text-ink fill-hover"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
              <div className="mt-3 flex max-h-32 flex-col gap-1 overflow-y-auto">
                {dropped.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg [background:var(--fill-1)] px-2.5 py-1.5"
                  >
                    <span className="truncate text-sm">{f.name}</span>
                    <span className="shrink-0 tabular text-xs text-faint">{formatBytes(f.size)}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Drag overlay. */}
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute inset-3 z-10 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-accent/60 bg-accent/8 backdrop-blur-sm"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Icon name="upload" size={26} />
              </span>
              <div className="mt-3 text-base font-semibold">Drop files into your workspace</div>
              <div className="mt-1 text-sm text-muted">Release to add them here</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
