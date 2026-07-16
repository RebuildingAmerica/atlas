import { MapPinOff, RotateCcw, Sparkles, ZoomOut } from "lucide-react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";

/** Where the shimmer placeholders sit while the first dots load, in percentages. */
const SKELETON_SPOTS = [
  { top: "32%", left: "24%", size: 44 },
  { top: "48%", left: "52%", size: 58 },
  { top: "60%", left: "38%", size: 36 },
  { top: "40%", left: "70%", size: 50 },
  { top: "66%", left: "62%", size: 40 },
];

/**
 * The map's loading state — soft pulsing bubbles where clusters will land.
 *
 * The basemap renders immediately, so loading never blanks the page with a
 * spinner; instead these placeholders breathe over the country in the same
 * count-bubble idiom the real clusters use, so the wait feels like the map
 * filling in rather than stalling. Purely decorative, so it's hidden from
 * assistive technology — the live region announces the real count when it
 * arrives.
 */
export function ClusterSkeletons() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {SKELETON_SPOTS.map((spot) => (
        <span
          key={`${spot.top}-${spot.left}`}
          data-skeleton
          className="bg-surface-container-high/70 absolute animate-pulse rounded-full"
          style={{ top: spot.top, left: spot.left, width: spot.size, height: spot.size }}
        />
      ))}
    </div>
  );
}

interface MapEmptyStateProps {
  /** Whether any filter is narrowing the catalog, so clearing them could help. */
  hasActiveFilters: boolean;
  /** Widen the camera back to the whole country. */
  onZoomOut: () => void;
  /** Drop every active filter. */
  onClearFilters: () => void;
}

/**
 * The map's empty state — a calm floating card, not an error.
 *
 * When a viewport holds no actors the map stays put and this card explains why
 * with a way forward: zoom out to the country, and (only when filters are
 * actually narrowing things) clear them. Framing the silence as "yet" keeps a
 * thin catalog feeling like a beginning rather than a dead end.
 */
export function MapEmptyState({ hasActiveFilters, onZoomOut, onClearFilters }: MapEmptyStateProps) {
  return (
    <div className="bg-surface-container-high/95 shadow-soft border-border-strong pointer-events-auto max-w-sm rounded-[1.1rem] border p-5 backdrop-blur-md">
      <div className="text-ink-soft flex items-center gap-2">
        <MapPinOff className="h-5 w-5" aria-hidden />
        <p className="type-title-medium text-ink-strong">No people or groups here</p>
      </div>
      <p className="type-body-small text-ink-soft mt-1.5">
        Try widening the view or easing a filter.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onZoomOut}>
          <span className="inline-flex items-center gap-1.5">
            <ZoomOut className="h-4 w-4" aria-hidden />
            Zoom out to the US
          </span>
        </Button>
        {hasActiveFilters ? (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface MapErrorStateProps {
  /** Refetch the viewport's actors. */
  onRetry: () => void;
}

/**
 * The map's error state — safe copy and a retry, never a raw error.
 *
 * The basemap stays visible underneath so a transient failure never feels like
 * the whole map broke. The message is deliberately generic: internal failures,
 * HTTP status, and stack traces never reach a visitor — only a calm sentence
 * and a way to try again.
 */
export function MapErrorState({ onRetry }: MapErrorStateProps) {
  return (
    <div className="bg-surface-container-high/95 shadow-soft border-border-strong pointer-events-auto max-w-sm rounded-[1.1rem] border p-5 backdrop-blur-md">
      <p className="type-title-medium text-ink-strong">We couldn&rsquo;t load the map right now</p>
      <p className="type-body-small text-ink-soft mt-1.5">
        Something went wrong. Give it another try.
      </p>
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </span>
        </Button>
      </div>
    </div>
  );
}

interface SparsityPillProps {
  /** The honest "N actors in M places" framing copy. */
  label: string;
}

/**
 * The designed-sparsity pill — a friendly framing of a deliberately thin map.
 *
 * Today's catalog is small on purpose; this pill states the real numbers so a
 * handful of dots reads as the honest start of something rather than a broken
 * map with most of it missing.
 */
export function SparsityPill({ label }: SparsityPillProps) {
  return (
    <div className="bg-surface-container-high/92 shadow-soft border-border-strong text-ink-soft pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 backdrop-blur-md">
      <Sparkles className="text-accent h-4 w-4" aria-hidden />
      <span className="type-label-large">{label}</span>
    </div>
  );
}
