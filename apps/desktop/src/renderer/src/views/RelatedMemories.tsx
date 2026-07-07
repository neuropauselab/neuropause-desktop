import { useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';

interface RelatedRow {
  memoryId: string;
  title: string;
  kind: string;
  content: string;
  score: number;
  sharedEntities: string[];
}

/**
 * V8.3 Knowledge — related memories for a given memory, derived from shared entity
 * refs + graph proximity (knowledge:related). Fetches on mount and renders
 * defensively: a slow/failed/empty result never breaks the surrounding view.
 */
export function RelatedMemories({ memoryId }: { memoryId: string }): JSX.Element {
  const [rows, setRows] = useState<RelatedRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    ipc.knowledge
      .related(memoryId, 6)
      .then((res) => {
        if (alive) setRows(res?.related ?? []);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [memoryId]);

  const note = (text: string): JSX.Element => (
    <div className="mt-2 pl-2.5 text-[10px] text-white/30">{text}</div>
  );

  if (error) return note('Couldn’t load related memories.');
  if (rows === null) return note('Finding related…');
  if (rows.length === 0) return note('No related memories yet.');

  return (
    <div className="mt-2 space-y-1.5 border-l border-[var(--hairline)] pl-2.5">
      {rows.map((r) => (
        <div key={r.memoryId} className="text-[11px]">
          <span className="font-medium text-white/70">{r.title}</span>
          {r.content && <span className="ml-1 text-white/40">— {r.content.slice(0, 80)}</span>}
          <div className="text-[9px] text-white/25">
            {r.sharedEntities.length} shared · score {r.score.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}
