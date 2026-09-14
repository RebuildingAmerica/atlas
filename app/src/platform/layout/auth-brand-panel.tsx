import { AtlasBrandMark } from "./atlas-brand-mark";
import { CivicMapPanel } from "./civic-map-panel";

/**
 * Brand panel displayed on the left side of the auth flow layout.
 */
export function AuthBrandPanel() {
  return (
    <div className="bg-ink-strong flex h-full flex-col px-8 py-10 lg:px-12 lg:py-14">
      <div className="flex flex-shrink-0 items-center gap-3">
        <AtlasBrandMark size="large" />
        <span className="type-title-large text-surface">Atlas</span>
      </div>

      <p className="type-display-small text-surface mt-8 flex-shrink-0">
        Map the people rebuilding America.
      </p>

      <div className="mt-8 min-h-0 flex-1">
        <CivicMapPanel />
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
      <AtlasBrandMark size="compact" />
      <span className="type-title-medium text-surface">Atlas</span>
    </div>
  );
}
