/**
 * Brand panel displayed on the left side of the auth flow layout.
 */
export function AuthBrandPanel() {
  return (
    <div className="bg-ink-strong flex h-full flex-col justify-center px-8 py-10 lg:px-12 lg:py-14">
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <div className="bg-primary flex h-12 w-12 items-center justify-center rounded-2xl text-white">
            <span className="type-headline-small leading-none">A</span>
          </div>
          <span className="type-title-large text-surface">Atlas</span>
        </div>

        <p className="type-display-small text-surface">Map the people rebuilding America.</p>
      </div>
    </div>
  );
}

/**
 * Compact brand header shown on mobile in place of the full brand panel.
 */
export function AuthBrandHeader() {
  return (
    <div className="bg-ink-strong flex items-center gap-3 px-6 py-4">
      <div className="bg-primary flex h-7 w-7 items-center justify-center rounded-xl text-white">
        <span className="type-label-medium leading-none">A</span>
      </div>
      <span className="type-title-medium text-surface">Atlas</span>
    </div>
  );
}
