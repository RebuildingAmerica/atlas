import { useMemo } from "react";
import type { MapPoint } from "@/types";
import {
  DOT_CORE_PX,
  DOT_HOVER_SCALE,
  DOT_RING_PX,
  dotMarkerStyle,
} from "@/domains/catalog/map/marker-style";
import type { DotShape } from "@/domains/catalog/map/marker-style";

/** The SVG box the dot is drawn in, leaving room for the ring and the hover lift. */
const APPROX_LOCATION_HALO_PX = 3;
const DOT_BOX_PX =
  Math.ceil(DOT_CORE_PX * DOT_HOVER_SCALE) + DOT_RING_PX * 2 + APPROX_LOCATION_HALO_PX * 2 + 2;

interface CivicDotMarkerProps {
  /** The placed actor this dot represents. */
  point: MapPoint;
  /** Whether this dot is the currently selected actor. */
  selected: boolean;
  /** Open the actor's detail panel. */
  onSelect: (point: MapPoint) => void;
}

/** Describe an actor's location and trust for assistive technology. */
function describePoint(point: MapPoint): string {
  const trust = TRUST_DESCRIPTIONS[point.trust_level];
  const place = point.place_label ? `${point.place_label}, ` : "";
  const precision = LOCATION_DESCRIPTIONS[point.geocode_precision ?? "unknown"];
  return `${point.name}, ${point.type}, ${place}${precision}, ${trust}`;
}

/** Short, human trust phrases for the marker's accessible name. */
const TRUST_DESCRIPTIONS: Record<MapPoint["trust_level"], string> = {
  subject_verified: "verified by subject",
  atlas_verified: "Atlas-verified",
  corroborated: "corroborated",
  unverified: "unverified",
};

const LOCATION_DESCRIPTIONS: Record<
  NonNullable<MapPoint["geocode_precision"]> | "unknown",
  string
> = {
  rooftop: "exact public address",
  city: "city-level location",
  state: "state-level location",
  unknown: "mapped location",
};

interface DotGeometryProps {
  shape: DotShape;
  cx: number;
  cy: number;
  radius: number;
  fill: string;
  ringColor: string;
  ringWidth: number;
}

/** Draw the dot's silhouette: a circle, a rounded square, or a diamond. */
function DotGeometry({ shape, cx, cy, radius, fill, ringColor, ringWidth }: DotGeometryProps) {
  const stroke = ringWidth > 0 ? ringColor : "none";
  if (shape === "circle") {
    return (
      <circle cx={cx} cy={cy} r={radius} fill={fill} stroke={stroke} strokeWidth={ringWidth} />
    );
  }
  if (shape === "squircle") {
    const side = radius * 1.8;
    return (
      <rect
        x={cx - side / 2}
        y={cy - side / 2}
        width={side}
        height={side}
        rx={side * 0.32}
        ry={side * 0.32}
        fill={fill}
        stroke={stroke}
        strokeWidth={ringWidth}
      />
    );
  }
  const d = radius * 1.15;
  return (
    <polygon
      points={`${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`}
      fill={fill}
      stroke={stroke}
      strokeWidth={ringWidth}
    />
  );
}

/**
 * A single civic dot — a focusable button carrying an actor's issue color,
 * trust ring, and type silhouette. Hover and focus lift the dot by growing its
 * geometry (never a CSS scale on the chrome), so the actor a visitor is
 * pointing at quietly rises toward them.
 */
export function CivicDotMarker({ point, selected, onSelect }: CivicDotMarkerProps) {
  const style = useMemo(() => dotMarkerStyle(point), [point]);
  const center = DOT_BOX_PX / 2;
  const baseRadius = DOT_CORE_PX / 2;
  const radius = selected ? baseRadius * DOT_HOVER_SCALE : baseRadius;
  const isApproximate = point.geocode_precision !== "rooftop";

  return (
    <button
      type="button"
      onClick={() => {
        onSelect(point);
      }}
      aria-label={describePoint(point)}
      aria-pressed={selected}
      className="group block cursor-pointer border-0 bg-transparent p-0"
      style={{ width: DOT_BOX_PX, height: DOT_BOX_PX, opacity: style.opacity }}
    >
      <svg
        width={DOT_BOX_PX}
        height={DOT_BOX_PX}
        viewBox={`0 0 ${DOT_BOX_PX} ${DOT_BOX_PX}`}
        aria-hidden
        className="text-ink-muted"
        style={{ filter: "drop-shadow(0 1px 3px rgba(28,25,23,0.18))" }}
      >
        <DotGeometry
          shape={style.shape}
          cx={center}
          cy={center}
          radius={radius}
          fill={style.fill}
          ringColor={style.ringColor}
          ringWidth={style.ringWidth}
        />
        {isApproximate ? (
          <circle
            cx={center}
            cy={center}
            r={radius + DOT_RING_PX + APPROX_LOCATION_HALO_PX}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.72}
            data-location-halo="approximate"
          />
        ) : null}
      </svg>
    </button>
  );
}
