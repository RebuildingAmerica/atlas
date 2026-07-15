import { vi } from "vitest";
import { render } from "@testing-library/react";
import { makePoint } from "./map-clustering-harness";
import { MapCommandBar } from "@/domains/catalog/components/map/map-command-bar";
import type { MapCommandBarProps } from "@/domains/catalog/components/map/map-command-bar";
import type { PlaceMatch } from "@/domains/catalog/map/map-place-search";
import type { MapPoint } from "@rebuildingamerica/atlas-api-client";

/** The command bar's callbacks, grouped so a test can override just the spies. */
export interface MapCommandBarHandlers {
  onSelectPlace: (place: PlaceMatch) => void;
  onSelectActor: (point: MapPoint) => void;
  onToggleFilter: (key: string, value: string) => void;
}

/**
 * Build a full set of command-bar props with spy callbacks and one quick issue.
 *
 * @param handlers Overrides for the default spy callbacks.
 * @param points The actors the bar searches; defaults to none.
 * @returns Props ready to spread onto `<MapCommandBar>`.
 */
export function makeCommandBarProps(
  handlers: Partial<MapCommandBarHandlers> = {},
  points: MapPoint[] = [makePoint({ id: "seed", name: "Seed Org" })],
): MapCommandBarProps {
  return {
    points,
    quickIssueAreas: [{ slug: "housing-affordability", label: "Housing" }],
    selectedIssueAreas: [],
    selectedEntryTypes: [],
    selectedSourceTypes: [],
    showEntryTypeFilter: true,
    activeCounts: { issues: 0, types: 0, sources: 0 },
    onSelectPlace: handlers.onSelectPlace ?? vi.fn(),
    onSelectActor: handlers.onSelectActor ?? vi.fn(),
    onToggleFilter: handlers.onToggleFilter ?? vi.fn(),
  };
}

/**
 * Render the command bar with default props, overriding callbacks and points.
 *
 * @param handlers Overrides for the default spy callbacks.
 * @param points The actors the bar searches.
 * @param overrides Further prop overrides (e.g. hiding the Types disclosure).
 * @returns The props the bar was rendered with, for assertion.
 */
export function renderCommandBar(
  handlers?: Partial<MapCommandBarHandlers>,
  points?: MapPoint[],
  overrides?: Partial<MapCommandBarProps>,
): MapCommandBarProps {
  const props = { ...makeCommandBarProps(handlers, points), ...overrides };
  render(<MapCommandBar {...props} />);
  return props;
}
