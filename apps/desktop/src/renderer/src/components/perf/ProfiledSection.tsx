/**
 * ProfiledSection — wraps a heavy section in a React Profiler and feeds its REAL commit duration into the
 * P1.5 perfRecorder (`recordRender`). This is the first and only Profiler wiring in the app; it closes the
 * P1.5 loop where the recorder existed but nothing fed it, so the developer Performance overlay and the
 * Diagnostics "slowest components" surface now show genuine per-section render cost. No duplicate
 * measurement system — it reuses the existing recorder and the existing perf snapshot pipeline.
 */
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { perfRecorder } from '@renderer/lib/perf/perfRecorder';

const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  perfRecorder.recordRender(id, actualDuration);
};

export function ProfiledSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
