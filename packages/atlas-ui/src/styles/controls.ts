/** High-contrast focus against Atlas surfaces, shared by fields, buttons, and links. */
export const controlFocusClass =
  "outline-none focus-visible:ring-2 focus-visible:ring-civic focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/** Keep keyboard focus around the complete hit target of a compound field. */
export const controlGroupFocusClass =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-civic has-[:focus-visible]:outline-offset-2";

/** Native disclosures retain their marker and a full-width touch target. */
export const disclosureSummaryClass = `type-label-large text-ink-soft hover:text-ink-strong min-h-11 cursor-pointer touch-manipulation rounded-sm py-3 underline-offset-4 hover:underline ${controlFocusClass}`;
