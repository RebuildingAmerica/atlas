import { useId, type ReactNode } from "react";
import { cn } from "../utils";
import { controlGroupFocusClass } from "../styles/controls";

interface RadioOptionProps {
  name: string;
  value: string;
  label: string;
  description?: string;
  badge?: string;
  trailing?: ReactNode;
  checked: boolean;
  onChange: (value: string) => void;
}

/** A native radio with a generous label target and room to compare choices. */
export function RadioOption({
  name,
  value,
  label,
  description,
  badge,
  trailing,
  checked,
  onChange,
}: RadioOptionProps) {
  const id = useId();
  const descriptionIds = [
    trailing != null ? `${id}-price` : null,
    badge ? `${id}-badge` : null,
    description ? `${id}-description` : null,
  ]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <label
      className={cn(
        "active:bg-surface-container flex min-h-16 cursor-pointer touch-manipulation gap-3 rounded-xl border p-4 has-[:disabled]:cursor-default has-[:disabled]:opacity-60",
        controlGroupFocusClass,
        description ? "items-start" : "items-center",
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
        aria-describedby={descriptionIds || undefined}
        className={cn(
          "accent-civic size-4 shrink-0 outline-none",
          description && "mt-1",
        )}
      />
      <span className="min-w-0 flex-1 space-y-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              id={`${id}-label`}
              className="type-title-small text-ink-strong"
            >
              {label}
            </span>
            {badge ? (
              <span
                id={`${id}-badge`}
                className="type-label-small bg-civic/10 text-civic rounded-md px-2 py-1"
              >
                {badge}
              </span>
            ) : null}
          </span>
          {trailing != null ? (
            <span
              id={`${id}-price`}
              className="type-title-medium text-ink-strong tabular-nums"
            >
              {trailing}
            </span>
          ) : null}
        </span>
        {description ? (
          <span
            id={`${id}-description`}
            className="type-body-small text-ink-soft block"
          >
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
