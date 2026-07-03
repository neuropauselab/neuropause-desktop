import { cn } from '@renderer/lib/cn';

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * A compact, dependency-free SVG bar chart. Used for the productivity card and
 * the analytics view so both read from the same primitive.
 */
export function BarChart({
  data,
  height = 96,
  color = 'rgb(var(--accent))',
  highlightLast = true,
  showLabels = true,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  highlightLast?: boolean;
  showLabels?: boolean;
}): JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 8;
  const n = data.length;

  return (
    <div className="w-full">
      <div className="flex items-end" style={{ height, gap }}>
        {data.map((d, i) => {
          const h = Math.max(3, Math.round((d.value / max) * (height - 6)));
          const isLast = i === n - 1;
          const active = highlightLast && isLast;
          return (
            <div key={d.label} className="flex flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-[5px] transition-all duration-300 ease-emphasized"
                style={{
                  height: h,
                  background: active ? color : 'var(--fill-2)',
                  opacity: active ? 1 : 0.85,
                }}
                title={`${d.label}: ${d.value}`}
              />
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="mt-2 flex" style={{ gap }}>
          {data.map((d, i) => (
            <div
              key={d.label}
              className={cn(
                'flex-1 text-center text-2xs',
                highlightLast && i === n - 1 ? 'font-semibold text-ink' : 'text-faint',
              )}
            >
              {d.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
