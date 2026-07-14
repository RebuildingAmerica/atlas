import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  labelAdornment?: ReactNode;
  type?: string;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  className?: string;
  icon?: ReactNode;
  min?: string | number;
  max?: string | number;
  autoComplete?: string;
}

export function Input({
  value,
  onChange,
  placeholder,
  label,
  labelAdornment,
  type = "text",
  disabled = false,
  error,
  required = false,
  className,
  icon,
  min,
  max,
  autoComplete,
}: InputProps) {
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="type-label-large text-ink-soft block">
            {label}
            {required && <span className="text-on-error-container">*</span>}
          </label>
          {labelAdornment}
        </div>
      )}
      <div className="relative">
        {icon && <div className="text-ink-muted absolute top-3 left-3">{icon}</div>}
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            "type-body-large border-border bg-surface text-ink-strong focus:border-border-strong focus:ring-accent-soft disabled:bg-surface-container w-full rounded-2xl border px-4 py-3 focus:ring-2 disabled:cursor-not-allowed",
            icon && "pl-10",
            error && "border-on-error-container",
            className,
          )}
        />
      </div>
      {error && (
        <span id={errorId} role="alert" className="type-body-small text-on-error-container">
          {error}
        </span>
      )}
    </div>
  );
}
