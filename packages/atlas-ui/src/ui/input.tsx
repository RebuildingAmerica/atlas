import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../utils";
import { FormField, fieldControlClass, type FieldDensity } from "./form-field";

interface InputProps extends Omit<
  ComponentPropsWithoutRef<"input">,
  "onChange" | "value"
> {
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  labelAdornment?: ReactNode;
  error?: string;
  icon?: ReactNode;
  density?: FieldDensity;
}

export function Input({
  value,
  onChange,
  label,
  labelAdornment,
  type = "text",
  error,
  required = false,
  className,
  icon,
  density = "default",
  id,
  ...nativeProps
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <FormField
      id={inputId}
      label={label}
      labelAdornment={labelAdornment}
      required={required}
      error={error}
      density={density}
    >
      <div className="relative">
        {icon && (
          <div className="text-ink-muted absolute inset-y-0 left-3 flex items-center">
            {icon}
          </div>
        )}
        <input
          {...nativeProps}
          id={inputId}
          type={type}
          value={value}
          required={required}
          onChange={(e) => onChange?.(e.target.value)}
          aria-invalid={error ? true : nativeProps["aria-invalid"]}
          aria-describedby={
            error ? `${inputId}-error` : nativeProps["aria-describedby"]
          }
          className={cn(
            "type-body-large px-4",
            fieldControlClass,
            density === "comfortable"
              ? "min-h-14 rounded-xl py-4"
              : "rounded-2xl py-3",
            icon && "pl-10",
            error && "border-on-error-container",
            className,
          )}
        />
      </div>
    </FormField>
  );
}
