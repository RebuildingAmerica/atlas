import { cn } from "@/lib/utils";

/**
 * Props for the copy-friendly readonly setup field.
 */
interface WorkspaceSSOCopyFieldProps {
  label: string;
  multiline?: boolean;
  rows?: number;
  value: string;
}

/**
 * Readonly field styled for easy copy-paste during enterprise identity
 * provider setup.
 */
export function WorkspaceSSOCopyField({
  label,
  multiline = false,
  rows = 4,
  value,
}: WorkspaceSSOCopyFieldProps) {
  const sharedClassName =
    "type-body-medium w-full rounded-2xl border border-border bg-surface-container-lowest px-4 py-3 text-ink-strong";

  if (multiline) {
    return (
      <div className="space-y-1">
        <p className="type-label-large text-ink-soft">{label}</p>
        <textarea
          readOnly
          rows={rows}
          value={value}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          className={cn(sharedClassName, "resize-y")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="type-label-large text-ink-soft">{label}</p>
      <input
        readOnly
        value={value}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        className={sharedClassName}
      />
    </div>
  );
}
