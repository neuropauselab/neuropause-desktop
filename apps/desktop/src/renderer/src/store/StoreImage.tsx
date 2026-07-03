import { useState } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';

/**
 * An image that degrades gracefully: if the source fails (offline, blocked, or
 * missing), it shows a calm tinted placeholder instead of a broken-image icon.
 */
export function StoreImage({
  src,
  alt,
  className,
  rounded = 'rounded-xl',
}: {
  src: string | null;
  alt: string;
  className?: string;
  rounded?: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center [background:var(--fill-2)] text-faint',
          rounded,
          className,
        )}
      >
        <Icon name="image" size={22} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('object-cover', rounded, className)}
    />
  );
}
