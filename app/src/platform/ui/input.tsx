import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
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

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="type-label-large text-ink-soft block">
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
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
          className={cn(
            "type-body-large border-border bg-surface text-ink-strong focus:border-border-strong focus:ring-accent-soft w-full rounded-2xl border px-4 py-3 focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100",
            icon && "pl-10",
            error && "border-red-500",
            className,
          )}
        />
      </div>
      {error && <span className="type-body-small text-red-500">{error}</span>}
    </div>
  );
}
