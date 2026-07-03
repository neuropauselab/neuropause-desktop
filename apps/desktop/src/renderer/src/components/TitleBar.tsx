import type { ReactNode } from 'react';

/**
 * The custom, draggable macOS title bar. Left padding clears the inset traffic
 * lights; the right slot hosts no-drag controls (theme, account, etc.).
 */
export function TitleBar({ right }: { right?: ReactNode }): JSX.Element {
  return (
    <header className="app-drag flex h-11 shrink-0 items-center justify-between pl-20 pr-3 select-none">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        <span className="text-[13px] font-medium tracking-tight">NeuroPause</span>
      </div>
      {right ? <div className="app-no-drag flex items-center gap-1.5">{right}</div> : null}
    </header>
  );
}
