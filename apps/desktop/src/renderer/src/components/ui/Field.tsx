/**
 * Field — a labelled form-row wrapper (label + optional help + inline error).
 * Pairs with the Input primitives to give every enterprise module form a
 * consistent, accessible layout with zero per-module styling.
 */
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';

export function Field({
  label,
  htmlFor,
  required = false,
  help,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-muted">
        {label}
        {required && <span className="ml-0.5 text-syspink">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-syspink">{error}</p>
      ) : help ? (
        <p className="text-xs text-faint">{help}</p>
      ) : null}
    </div>
  );
}
