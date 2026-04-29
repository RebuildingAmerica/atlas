import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/platform/ui/toast";
import { cn } from "@/lib/utils";

interface WorkspaceSSOCopyFieldProps {
  label: string;
  multiline?: boolean;
  /**
   * When true the value renders in a monospaced face — useful for PEM
   * certificates and other base64 blobs the admin will copy verbatim.
   */
  mono?: boolean;
  rows?: number;
  /**
   * Truncate the rendered value to its first `truncateAt` characters with
   * an ellipsis suffix.  The full value still copies — the rendering is
   * cosmetic for very long IdP URLs that would otherwise wrap awkwardly.
   */
  truncateAt?: number;
  value: string;
}

const COPIED_FLASH_DURATION_MS = 1500;

/**
 * Readonly field styled for easy copy-paste during enterprise identity
 * provider setup.  Includes a one-click Copy button that drops the value
 * to the clipboard, surfaces a toast confirmation, and flips the icon
 * briefly so the operator gets visual feedback in addition to the
 * announcement.
 */
export function WorkspaceSSOCopyField({
  label,
  multiline = false,
  mono = false,
  rows = 4,
  truncateAt,
  value,
}: WorkspaceSSOCopyFieldProps) {
  const toast = useToast();
  const [recentlyCopied, setRecentlyCopied] = useState(false);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  const sharedClassName = cn(
    "type-body-medium w-full rounded-2xl border border-border bg-surface-container-lowest px-4 py-3 text-ink-strong",
    mono && "font-mono",
  );

  async function handleCopy() {
    const ok = await copyToClipboard(value);
    if (!ok) {
      toast.error(`Atlas couldn't copy ${label}.  Select the value and copy by hand.`);
      return;
    }
    setRecentlyCopied(true);
    toast.success(`${label} copied`);
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = setTimeout(() => {
      setRecentlyCopied(false);
    }, COPIED_FLASH_DURATION_MS);
  }

  const truncated = truncateAt !== undefined && value.length > truncateAt;
  const displayValue = truncated ? `${value.slice(0, truncateAt)}…` : value;

  return (
    <div className="space-y-1">
      <p className="type-label-large text-ink-soft">{label}</p>
      <div className="flex items-stretch gap-2">
        {multiline ? (
          <textarea
            readOnly
            rows={rows}
            value={displayValue}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className={cn(sharedClassName, "resize-y")}
          />
        ) : (
          <input
            readOnly
            value={displayValue}
            title={truncated ? value : undefined}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className={sharedClassName}
          />
        )}
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          aria-label={`Copy ${label}`}
          className="border-outline-variant text-outline hover:text-on-surface inline-flex shrink-0 items-center justify-center rounded-2xl border bg-white px-3"
        >
          {recentlyCopied ? (
            <Check aria-hidden="true" className="h-4 w-4 text-emerald-600" />
          ) : (
            <Copy aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
