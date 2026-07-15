import type { EntryType, MapPoint, TrustLevel } from "@rebuildingamerica/atlas-api-client";
import { FALLBACK_ISSUE_COLOR, issueColor } from "./issue-colors";

/**
 * The civic-navy trust ring — the same accent the rest of Atlas uses to mean
 * "we stand behind this." Mirrors `--color-civic` so the dot's ring matches the
 * profile it links to.
 */
export const CIVIC_NAVY = "#0b3d7a";

/** Warm stone, the calm base hue for the sparsest count bubbles. */
const STONE = "#d6cfc3";

/** The accent the densest count bubbles warm toward (`--color-accent`). */
const ACCENT = "#c2956a";

/** The dot's solid core diameter, in pixels — the "11px core" from the spec. */
export const DOT_CORE_PX = 11;

/** The trust ring's stroke width, in pixels — the "1.5px ring" from the spec. */
export const DOT_RING_PX = 1.5;

/** How far a marker grows when hovered or focused, as a multiple of its base size. */
export const DOT_HOVER_SCALE = 1.27;

/** The geometric silhouette a dot is drawn with, chosen by actor type. */
export type DotShape = "circle" | "squircle" | "diamond";

/** The fully-resolved visual treatment for one civic dot. */
export interface DotMarkerStyle {
  /** Core fill — the actor's primary issue color. */
  fill: string;
  /** Trust-ring stroke color; ignored when {@link ringWidth} is 0. */
  ringColor: string;
  /** Trust-ring stroke width in pixels; 0 means no ring (unverified). */
  ringWidth: number;
  /** Overall marker opacity; quieter for unverified so silence reads as honest. */
  opacity: number;
  /** The silhouette to draw. */
  shape: DotShape;
}

/** The fully-resolved visual treatment for one cluster bubble. */
export interface ClusterBubbleStyle {
  /** Bubble diameter in pixels, grown by density and capped. */
  diameter: number;
  /** Bubble fill, warmed from stone toward accent by density. */
  background: string;
  /** The count to print, abbreviated past a thousand. */
  label: string;
}

/** Clamp a value into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parse a `#rrggbb` string into its red/green/blue channels. */
function parseHex(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Render a 0–255 channel back to a two-digit hex pair. */
function channelToHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

/**
 * Darken a hex color toward black by a fraction.
 *
 * Used for the corroborated trust ring, which is a deeper shade of the actor's
 * own issue color — present but quieter than the navy of a verified actor.
 *
 * @param hex A `#rrggbb` color.
 * @param amount Fraction toward black, 0 (unchanged) to 1 (black).
 * @returns The darkened `#rrggbb` color.
 */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const factor = 1 - clamp(amount, 0, 1);
  return `#${channelToHex(r * factor)}${channelToHex(g * factor)}${channelToHex(b * factor)}`;
}

/**
 * Linearly blend two hex colors.
 *
 * @param from The color at `t = 0`.
 * @param to The color at `t = 1`.
 * @param t Blend position, clamped to [0, 1].
 * @returns The interpolated `#rrggbb` color.
 */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = clamp(t, 0, 1);
  return `#${channelToHex(a.r + (b.r - a.r) * k)}${channelToHex(a.g + (b.g - a.g) * k)}${channelToHex(
    a.b + (b.b - a.b) * k,
  )}`;
}

/** Map an actor type to the silhouette that distinguishes it at a glance. */
function shapeForType(type: EntryType): DotShape {
  if (type === "person") {
    return "circle";
  }
  if (type === "organization") {
    return "squircle";
  }
  // Initiatives, campaigns, and events are all "efforts" — one diamond family
  // rather than a proliferation of shapes a visitor would have to decode.
  return "diamond";
}

/** Resolve the trust ring (color + width) for a trust tier over a given fill. */
function ringForTrust(level: TrustLevel, fill: string): { ringColor: string; ringWidth: number } {
  if (level === "subject_verified" || level === "atlas_verified") {
    return { ringColor: CIVIC_NAVY, ringWidth: DOT_RING_PX };
  }
  if (level === "corroborated") {
    return { ringColor: darken(fill, 0.35), ringWidth: DOT_RING_PX };
  }
  // Unverified: no ring at all — the map never draws a border it can't back.
  return { ringColor: "transparent", ringWidth: 0 };
}

/**
 * Resolve the full visual treatment for an actor's civic dot.
 *
 * The core takes the actor's primary issue color; the ring encodes trust the
 * same way the browse card and profile do (navy for verified, a darker issue
 * shade for corroborated, nothing for unverified); the silhouette encodes type;
 * and unverified actors render quieter so confidence is never overclaimed.
 *
 * @param point The placed actor.
 * @returns The dot's fill, ring, opacity, and shape.
 */
export function dotMarkerStyle(point: MapPoint): DotMarkerStyle {
  const primaryIssue = point.issue_areas[0];
  const fill = primaryIssue === undefined ? FALLBACK_ISSUE_COLOR : issueColor(primaryIssue);
  const { ringColor, ringWidth } = ringForTrust(point.trust_level, fill);
  const opacity = point.trust_level === "unverified" ? 0.8 : 1;
  return { fill, ringColor, ringWidth, opacity, shape: shapeForType(point.type) };
}

/** The smallest and largest a count bubble is ever drawn, in pixels. */
const CLUSTER_MIN_PX = 34;
const CLUSTER_MAX_PX = 72;

/** The point-count at which a bubble reaches its maximum size and warmth. */
const CLUSTER_DENSITY_CEILING = 1000;

/**
 * Abbreviate a count the way supercluster labels its bubbles: verbatim below a
 * thousand, one-decimal "k" above (1298 → "1.3k").
 *
 * @param count The number of actors in the cluster.
 * @returns The label to print.
 */
export function abbreviateCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  return `${(count / 1000).toFixed(1)}k`;
}

/**
 * Resolve the visual treatment for a cluster bubble.
 *
 * Density drives both size and warmth on a log scale (so a 5-actor and a
 * 500-actor cluster differ visibly without a 100-actor one dwarfing the map):
 * the bubble grows from a calm warm stone toward the Atlas accent as more
 * actors gather, carrying the catalog's "darker = more" language as a bubble
 * rather than a choropleth.
 *
 * @param pointCount The number of actors in the cluster.
 * @returns The bubble's diameter, fill, and count label.
 */
export function clusterBubbleStyle(pointCount: number): ClusterBubbleStyle {
  const density = clamp(Math.log10(pointCount) / Math.log10(CLUSTER_DENSITY_CEILING), 0, 1);
  const diameter = CLUSTER_MIN_PX + (CLUSTER_MAX_PX - CLUSTER_MIN_PX) * density;
  return {
    diameter,
    background: mixHex(STONE, ACCENT, density),
    label: abbreviateCount(pointCount),
  };
}
