import { Button } from "@/platform/ui/button";

interface SaveButtonWithMissingFieldsProps {
  isPending: boolean;
  label: string;
  missing: readonly string[];
  pendingLabel: string;
}

/**
 * Submit button that lists every still-missing field as a tooltip on
 * hover, so an admin staring at a disabled Save button knows exactly
 * which input is blocking the submit.  When `missing` is empty, the
 * button enables and the tooltip clears.
 */
export function SaveButtonWithMissingFields({
  isPending,
  label,
  missing,
  pendingLabel,
}: SaveButtonWithMissingFieldsProps) {
  const disabled = isPending || missing.length > 0;
  return (
    <Button
      type="submit"
      disabled={disabled}
      title={disabled && !isPending ? `Missing: ${missing.join(", ")}` : undefined}
    >
      {isPending ? pendingLabel : label}
    </Button>
  );
}
