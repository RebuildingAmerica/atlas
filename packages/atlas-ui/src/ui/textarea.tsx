import { useEffect, useId, useRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils";
import { FormField, fieldControlClass, type FieldDensity } from "./form-field";

interface TextareaProps extends Omit<
  ComponentPropsWithoutRef<"textarea">,
  "onChange" | "value"
> {
  autoExpand?: boolean;
  error?: string;
  label?: string;
  maxRows?: number;
  onChange?: (value: string) => void;
  value?: string;
  density?: FieldDensity;
}
const LINE_HEIGHT_PX = 24;

export function Textarea({
  autoExpand = false,
  className,
  error,
  label,
  maxRows = 24,
  onChange,
  required = false,
  rows = 6,
  value,
  density = "default",
  id,
  ...nativeProps
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!autoExpand || !ref.current) return;
    const node = ref.current;
    node.style.height = "auto";
    const maxPx =
      maxRows * LINE_HEIGHT_PX + (density === "comfortable" ? 32 : 24);
    node.style.height = `${Math.min(node.scrollHeight, maxPx).toString()}px`;
    node.style.overflowY = node.scrollHeight > maxPx ? "auto" : "hidden";
  }, [autoExpand, maxRows, value, density]);
  return (
    <FormField
      id={textareaId}
      label={label}
      required={required}
      error={error}
      density={density}
    >
      <textarea
        {...nativeProps}
        id={textareaId}
        ref={ref}
        value={value}
        rows={rows}
        required={required}
        onChange={(event) => onChange?.(event.target.value)}
        aria-invalid={error ? true : nativeProps["aria-invalid"]}
        aria-describedby={
          error ? `${textareaId}-error` : nativeProps["aria-describedby"]
        }
        className={cn(
          "type-body-large px-4",
          fieldControlClass,
          density === "comfortable"
            ? "min-h-14 rounded-xl py-4"
            : "rounded-2xl py-3",
          error && "border-on-error-container",
          className,
        )}
      />
    </FormField>
  );
}
