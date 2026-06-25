import type { FakeMap } from "./fake-map";

/** Holds the fake map a `useMap()`-driven control test renders against. */
export interface MapControl {
  map: FakeMap | null;
}

/** Build a fresh control with no mounted map so each test starts clean. */
export function createMapControl(): MapControl {
  return { map: null };
}
