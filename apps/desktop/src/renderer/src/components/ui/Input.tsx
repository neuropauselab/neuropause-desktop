/**
 * Form input primitives — the missing NPDS building blocks every enterprise
 * module form (and future forms elsewhere) reuses. Monochrome, glass-consistent:
 * hairline border, translucent fill, focus ring via the shared `shadow-focus`.
 */
import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@renderer/lib/cn';

const BASE =
  'w-full rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 text-md text-ink ' +
  'placeholder:text-faint outline-none transition duration-100 ' +
  'focus:border-[var(--hairline-strong)] focus:shadow-focus disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(BASE, 'h-9', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(BASE, 'resize-y py-2 leading-relaxed', className)}
      {...rest}
    />
  );
});

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(BASE, 'h-9 appearance-none pr-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
});
