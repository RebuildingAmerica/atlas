import type { ReactNode } from "react";
import { cn } from "../utils";
import { controlFocusClass } from "../styles/controls";

export type FieldDensity = "default" | "comfortable";
export const fieldControlClass = cn(
  "border-border bg-surface text-ink-strong disabled:bg-surface-container w-full border disabled:cursor-not-allowed",
  controlFocusClass,
);

interface FormFieldProps {
  children: ReactNode;
  id: string;
  label?: string;
  labelAdornment?: ReactNode;
  required?: boolean;
  error?: string;
  density: FieldDensity;
}

export function FormField({
  children,
  id,
  label,
  labelAdornment,
  required,
  error,
  density,
}: FormFieldProps) {
  return (
    <div className={density === "comfortable" ? "space-y-3" : "space-y-1"}>
      {label && (
        <div
          className={cn(
            "flex items-center gap-2",
            density === "comfortable" && "px-4",
          )}
        >
          <label htmlFor={id} className="type-label-large text-ink-soft block">
            {label}
          </label>
          {required && (
            <span aria-hidden="true" className="text-on-error-container">
              *
            </span>
          )}
          {labelAdornment}
        </div>
      )}
      {children}
      {error && (
        <span
          id={`${id}-error`}
          role="alert"
          className="type-body-small text-on-error-container"
        >
          {error}
        </span>
      )}
    </div>
  );
}
