import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Props accepted by Atlas's shared textarea control.
 */
interface TextareaProps {
  autoComplete?: string;
  className?: string;
  disabled?: boolean;
  error?: string;
  label?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  value?: string;
}

/**
 * Shared multiline text input used for longer operator-entered values such as
 * SAML certificates and copied configuration blocks.
 */
export function Textarea({
  autoComplete,
  className,
  disabled = false,
  error,
  label,
  onChange,
  placeholder,
  required = false,
  rows = 6,
  value,
}: TextareaProps) {
  const textareaId = useId();

  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={textareaId} className="type-label-large text-ink-soft block">
          {label}
          {required ? <span className="text-red-500">*</span> : null}
        </label>
      ) : null}
      <textarea
        id={textareaId}
        value={value}
        rows={rows}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        className={cn(
          "type-body-large border-border bg-surface text-ink-strong focus:border-border-strong focus:ring-accent-soft w-full rounded-2xl border px-4 py-3 focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100",
          error ? "border-red-500" : null,
          className,
        )}
      />
      {error ? <span className="type-body-small text-red-500">{error}</span> : null}
    </div>
  );
}
