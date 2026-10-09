import { useId, type ComponentPropsWithoutRef } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../utils";
import { FormField, fieldControlClass, type FieldDensity } from "./form-field";

interface Option {
  value: string;
  label: string;
}
interface SelectProps extends Omit<
  ComponentPropsWithoutRef<"select">,
  "onChange" | "value" | "size"
> {
  options: Option[];
  ariaLabel?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  icon?: LucideIcon;
  size?: "default" | "compact";
  density?: FieldDensity;
}

export function Select({
  options,
  ariaLabel,
  value,
  onChange,
  placeholder,
  label,
  error,
  icon: Icon,
  required = false,
  size = "default",
  density = "default",
  className,
  id,
  ...nativeProps
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? `select-${generatedId}`;
  return (
    <FormField
      id={selectId}
      label={label}
      required={required}
      error={error}
      density={density}
    >
      <div className="relative">
        {Icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            <Icon className="text-ink-muted h-4 w-4" aria-hidden />
          </span>
        )}
        <select
          {...nativeProps}
          id={selectId}
          aria-label={
            label ? undefined : (ariaLabel ?? nativeProps["aria-label"])
          }
          aria-invalid={error ? true : nativeProps["aria-invalid"]}
          aria-describedby={
            error ? `${selectId}-error` : nativeProps["aria-describedby"]
          }
          data-size={size}
          value={value ?? ""}
          required={required}
          onChange={(e) => onChange?.(e.target.value)}
          className={cn(
            fieldControlClass,
            "block appearance-none",
            density === "comfortable"
              ? "type-body-large min-h-14 rounded-xl py-4 pr-12"
              : size === "compact"
                ? "type-body-medium min-h-10 rounded-lg py-2 pr-10"
                : "type-body-large rounded-2xl py-3 pr-10",
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
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 flex items-center",
            density === "comfortable" ? "right-4" : "right-3",
          )}
        >
          <ChevronDown className="text-ink-muted h-4 w-4" aria-hidden />
        </span>
      </div>
    </FormField>
  );
}
