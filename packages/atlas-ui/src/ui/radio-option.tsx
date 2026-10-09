import { useId, type ReactNode } from "react";
import { cn } from "../utils";
import { controlGroupFocusClass } from "../styles/controls";

interface RadioOptionProps {
  name: string;
  value: string;
  label: string;
  description: string;
  trailing: ReactNode;
  checked: boolean;
  onChange: (value: string) => void;
}

/** A native radio with a generous label target and room to compare choices. */
export function RadioOption({
  name,
  value,
  label,
  description,
  trailing,
  checked,
  onChange,
}: RadioOptionProps) {
  const id = useId();
  return (
    <label
      className={cn(
        "active:bg-surface-container flex cursor-pointer touch-manipulation items-start gap-3 rounded-xl border p-4",
        controlGroupFocusClass,
        checked
          ? "border-civic bg-surface-container-low hover:bg-surface-container"
          : "border-outline-variant hover:border-outline hover:bg-surface-container-low",
      )}
    >
      <input
        type="radio"
        data-focus-ring="parent"
        name={name}
        value={value}
        checked={checked}
        onChange={() => {
          onChange(value);
        }}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-price ${id}-description`}
        className="accent-civic mt-1 size-4 shrink-0 outline-none"
      />
      <span className="min-w-0 flex-1 space-y-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span id={`${id}-label`} className="type-title-small text-ink-strong">
            {label}
          </span>
          <span
            id={`${id}-price`}
            className="type-title-medium text-ink-strong tabular-nums"
          >
            {trailing}
          </span>
        </span>
        <span
          id={`${id}-description`}
          className="type-body-small text-ink-soft block"
        >
          {description}
        </span>
      </span>
    </label>
  );
}
