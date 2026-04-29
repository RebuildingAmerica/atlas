import { useEffect, useState } from "react";

const PREFILL_FLASH_DURATION_MS = 1800;

interface PrefillFlashApi {
  flashed: ReadonlySet<string>;
  flash: (fields: readonly string[]) => void;
}

/**
 * Ring-flash hook for prefilled inputs.  When the metadata-paste shortcut
 * fills a set of fields, the parent calls `flash([...])` and the matching
 * inputs render with an emerald ring for ~1.8s so the operator can spot
 * which fields just changed.  The flashed set clears itself via a single
 * timeout, and subsequent flash calls reset the timer.
 */
export function usePrefillFlash(): PrefillFlashApi {
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (flashed.size === 0) {
      return;
    }
    const handle = window.setTimeout(() => {
      setFlashed(new Set());
    }, PREFILL_FLASH_DURATION_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [flashed]);

  function flash(fields: readonly string[]) {
    setFlashed(new Set(fields));
  }

  return { flashed, flash };
}

/**
 * Tailwind classname helper that returns the flashing ring classes for a
 * given field, or the no-flash transition baseline when the field is not
 * currently in the flashed set.  Keeping the class strings in one place
 * avoids drift between the OIDC and SAML form columns.
 */
export function flashClassName(flashed: ReadonlySet<string>, field: string): string {
  return flashed.has(field)
    ? "transition-shadow ring-2 ring-emerald-300 ring-offset-2 ring-offset-surface rounded-2xl"
    : "transition-shadow rounded-2xl";
}
