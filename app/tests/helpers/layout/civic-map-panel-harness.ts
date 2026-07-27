import { vi } from "vitest";
import type { ReactNode } from "react";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

export interface MockStateGeometry {
  id: string;
  properties: {
    name: string;
  };
}

export interface MockStateTopology {
  objects: {
    states: {
      geometries: MockStateGeometry[];
    };
  };
}

export interface MockGeography {
  id: string;
  properties: {
    name: string;
  };
  rsmKey: string;
}

export interface MockComposableMapProps {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  height?: number;
  projection?: string;
  width?: number;
}

export interface MockGeographiesProps {
  children: (input: { geographies: MockGeography[] }) => ReactNode;
  geography: MockStateTopology;
}

export interface MockGeographyProps {
  "aria-label"?: string;
  geography: MockGeography;
}

export interface MockMarkerProps {
  children: ReactNode;
  coordinates?: [number, number];
}

/** The subset of the entry-list reply the map panel reads. */
export interface CivicMapEntriesReply {
  data: Entry[];
  facets: {
    cities: { count: number; value: string }[];
    issue_areas: { count: number; value: string }[];
  };
  pagination: { total: number };
}

export interface CivicMapEntriesReplyInput {
  cities?: string[];
  entries?: Entry[];
  issueAreas?: string[];
  total?: number;
}

/**
 * Builds the entry-list reply the panel's effect consumes.
 *
 * @param input - Entries to place, plus the facet and total counts the stats
 *   row reports.
 * @returns A reply shaped like the one `api.entries.list` resolves with.
 */
export function civicMapEntriesReply(input: CivicMapEntriesReplyInput = {}): CivicMapEntriesReply {
  return {
    data: input.entries ?? [],
    facets: {
      cities: (input.cities ?? []).map((value) => ({ count: 1, value })),
      issue_areas: (input.issueAreas ?? []).map((value) => ({ count: 1, value })),
    },
    pagination: { total: input.total ?? input.entries?.length ?? 0 },
  };
}

/** A rectangle handed back by a stubbed `getBoundingClientRect`. */
export interface StubbedRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * Completes a partial rectangle into the `DOMRect` shape callers destructure.
 *
 * @param rect - Position and size of the box.
 * @returns The same box with the derived edges filled in.
 */
function toDomRect(rect: StubbedRect): DOMRect {
  const full = {
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
  };
  return { ...full, toJSON: () => full };
}

/**
 * Gives the map panel a real layout to measure.
 *
 * jsdom reports every box as 0x0 at the origin, which pins the tooltip's
 * edge-flip maths to a single outcome. Stubbing the wrapper and marker boxes
 * lets a test drive the flip in both directions.
 *
 * @param wrap - Box reported for the panel's positioning wrapper (a `div`).
 * @param marker - Box reported for every SVG node, i.e. the hovered marker.
 */
export function stubCivicMapRects(wrap: StubbedRect, marker: StubbedRect): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ): DOMRect {
    return toDomRect(this.tagName === "DIV" ? wrap : marker);
  });
}
