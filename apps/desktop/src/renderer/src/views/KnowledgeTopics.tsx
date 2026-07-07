import { useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';

interface Topic {
  id: string;
  label: string;
  memoryIds: string[];
  entities: string[];
  size: number;
}

/**
 * V8.3 Knowledge — topics derived by clustering memories on shared entities
 * (knowledge:topics). Renders a compact chip row; picking a topic seeds the memory
 * search with its defining term. Renders nothing when there are no topics, so the
 * view is unchanged for users without enough connected memories yet.
 */
export function KnowledgeTopics({ onPick }: { onPick: (query: string) => void }): JSX.Element | null {
  const [topics, setTopics] = useState<Topic[] | null>(null);

  useEffect(() => {
    let alive = true;
    ipc.knowledge
      .topics()
      .then((res) => {
        if (alive) setTopics(res?.topics ?? []);
      })
      .catch(() => {
        if (alive) setTopics([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!topics || topics.length === 0) return null;

  const prettify = (label: string): string => {
    const parts = label.split(':');
    return (parts[parts.length - 1] || label).replace(/-/g, ' ').trim();
  };

  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-white/40">Topics</div>
      <div className="flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(prettify(t.label))}
            title={`${t.size} memories`}
            className="rounded-full border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 py-1 text-[11px] text-white/70 transition hover:text-ink"
          >
            {prettify(t.label)}
            <span className="ml-1 text-white/30">{t.size}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
