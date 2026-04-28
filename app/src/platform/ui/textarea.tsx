import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

interface TextareaProps {
  autoComplete?: string;
  /**
   * When true, the textarea grows with its content up to `maxRows`.  Useful
   * for long pastes — PEM certs, IdP metadata XML — so the operator does not
   * have to scroll inside a tiny rectangle.
   */
  autoExpand?: boolean;
  className?: string;
  disabled?: boolean;
  error?: string;
  label?: string;
  maxRows?: number;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  value?: string;
}

const LINE_HEIGHT_PX = 24;
const VERTICAL_PADDING_PX = 24;

export function Textarea({
  autoComplete,
  autoExpand = false,
  className,
  disabled = false,
  error,
  label,
  maxRows = 24,
  onChange,
  placeholder,
  required = false,
  rows = 6,
  value,
}: TextareaProps) {
  const textareaId = useId();
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoExpand || !ref.current) {
      return;
    }
    const node = ref.current;
    node.style.height = "auto";
    const maxPx = maxRows * LINE_HEIGHT_PX + VERTICAL_PADDING_PX;
    node.style.height = `${Math.min(node.scrollHeight, maxPx).toString()}px`;
    node.style.overflowY = node.scrollHeight > maxPx ? "auto" : "hidden";
  }, [autoExpand, maxRows, value]);

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
        ref={ref}
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
