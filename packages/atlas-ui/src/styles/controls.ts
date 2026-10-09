/** High-contrast focus against Atlas surfaces, shared by fields, buttons, and links. */
export const controlFocusClass =
  "outline-none focus-visible:ring-2 focus-visible:ring-civic focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/** Keep keyboard focus around the complete hit target of a compound field. */
export const controlGroupFocusClass =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-civic has-[:focus-visible]:outline-offset-2";

/** A visible disclosure row with a trailing chevron and a full-width touch target.
 * The native details parent uses `group` so the chevron follows its open state. */
export const disclosureSummaryClass = `type-label-large text-ink-strong border-outline-variant bg-surface-container-low hover:border-outline hover:bg-surface-container active:bg-surface-container flex min-h-12 cursor-pointer touch-manipulation list-none items-center justify-between gap-4 rounded-xl border px-4 py-3 after:size-2 after:shrink-0 after:rotate-45 after:border-r after:border-b after:border-current after:content-[''] group-open:after:rotate-225 [&::-webkit-details-marker]:hidden ${controlFocusClass}`;
