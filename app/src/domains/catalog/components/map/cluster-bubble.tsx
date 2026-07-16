import { useEffect, useState } from "react";
import { clusterBubbleStyle } from "@rebuildingamerica/atlas-catalog/map/marker-style";

/** The fraction of full size a bubble starts at before it grows into place. */
const REVEAL_START_FRACTION = 0.85;

/** How long the grow-in reveal runs, in milliseconds. */
const REVEAL_DURATION_MS = 360;

interface ClusterBubbleProps {
  /** How many actors this bubble stands for. */
  pointCount: number;
  /** Open the panel's "who's working here" list of the actors gathered here. */
  onOpen: () => void;
  /** Skip the grow-in reveal for visitors who prefer reduced motion. */
  reducedMotion?: boolean;
}

/**
 * An "alive count bubble" standing in for a cluster of co-located actors.
 *
 * Sized and warmed from stone toward accent by density (the catalog's
 * "darker = more" language as a bubble, not a choropleth) with the count
 * centered. On first appearance it grows from 85% into its resting size by
 * animating its real width and height — never a CSS scale on the chrome — so a
 * pan or zoom feels like the map breathing rather than popping. Reduced-motion
 * visitors get the resting size immediately.
 */
export function ClusterBubble({ pointCount, onOpen, reducedMotion = false }: ClusterBubbleProps) {
  const { diameter, background, label } = clusterBubbleStyle(pointCount);
  const [revealed, setRevealed] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setRevealed(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);

  const size = revealed ? diameter : diameter * REVEAL_START_FRACTION;
  const accessibleName =
    pointCount === 1 ? "1 person or group here" : `${pointCount} people and groups here`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={accessibleName}
      className="text-ink-strong flex cursor-pointer items-center justify-center rounded-full border-0 font-semibold"
      style={{
        width: size,
        height: size,
        background,
        boxShadow: "0 1px 3px rgba(28,25,23,0.18)",
        transition: reducedMotion
          ? undefined
          : `width ${REVEAL_DURATION_MS}ms ease, height ${REVEAL_DURATION_MS}ms ease`,
        fontSize: Math.max(11, diameter * 0.32),
      }}
    >
      {label}
    </button>
  );
}
