import { useId } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  options: Option[];
  ariaLabel?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  error?: string;
  icon?: LucideIcon;
  required?: boolean;
  size?: "default" | "compact";
  className?: string;
}

export function Select({
  options,
  ariaLabel,
  value,
  onChange,
  placeholder,
  label,
  disabled = false,
  error,
  icon: Icon,
  required = false,
  size = "default",
  className,
}: SelectProps) {
  const generatedId = useId();
  const selectId = label ? `select-${generatedId}` : undefined;
  const errorId = error ? `select-${generatedId}-error` : undefined;

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={selectId}
          className="type-label-large text-ink-soft block"
        >
          {label}
          {required && <span className="text-on-error-container">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            <Icon className="text-ink-muted h-4 w-4" aria-hidden />
          </span>
        ) : null}
        <select
          id={selectId}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          data-size={size}
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          className={cn(
            "border-border bg-surface text-ink-strong focus:border-border-strong focus:ring-accent-soft disabled:bg-surface-container w-full appearance-none border pr-10 focus:ring-2 disabled:cursor-not-allowed",
            size === "compact"
              ? "type-body-medium min-h-10 rounded-lg py-2"
              : "type-body-large rounded-2xl py-3",
            Icon ? "pl-10" : "pl-4",
            error && "border-on-error-container",
            className,
          )}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <ChevronDown className="text-ink-muted h-4 w-4" aria-hidden />
        </span>
      </div>
      {error && (
        <span
          id={errorId}
          role="alert"
          className="type-body-small text-on-error-container"
        >
          {error}
        </span>
      )}
    </div>
  );
}
