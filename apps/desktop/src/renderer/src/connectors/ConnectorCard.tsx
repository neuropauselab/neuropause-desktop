import type { ConnectorDto } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { StatusDot } from '@renderer/operations/primitives';
import { statusMeta, connectorGlyph } from './connectorLib';

/** A single connector row in the left-hand list. */
export function ConnectorCard({
  dto,
  selected,
  onSelect,
}: {
  dto: ConnectorDto;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const meta = statusMeta(dto.status);
  const accountCount = dto.accounts.length;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition focus-visible:shadow-focus',
        selected ? 'surface-raised shadow-sm' : 'hover:[background:var(--fill-1)]',
      )}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-2xs font-bold text-white ring-1 ring-black/10"
        style={{ backgroundColor: dto.brandColor }}
      >
        {connectorGlyph(dto.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{dto.name}</span>
        <span className="block truncate text-2xs text-faint">{dto.provider}</span>
      </span>
      {dto.lifecycle === 'preview' && (
        <span className="rounded-full border border-[var(--hairline)] px-1.5 py-0.5 text-[10px] font-medium text-faint" title="Preview — no data adapter yet">
          Preview
        </span>
      )}
      {accountCount > 0 && (
        <span className="rounded-full [background:var(--fill-2)] px-1.5 py-0.5 text-2xs font-medium text-muted">
          {accountCount}
        </span>
      )}
      {dto.lifecycle === 'production' && <StatusDot tone={meta.tone} pulse={dto.status === 'connecting'} />}
    </button>
  );
}
