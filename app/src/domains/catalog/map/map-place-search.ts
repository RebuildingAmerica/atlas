import { CITY_COORDS } from "@/platform/layout/city-coords";
import { US_STATE_GRID } from "@/domains/catalog/us-state-grid";
import type { SelectionAnchor } from "@/domains/catalog/map/map-selection";
import type { MapPoint } from "@rebuildingamerica/atlas-api-client";

/** How many matches each command-bar group shows before truncating. */
const MAX_RESULTS = 8;

/** A place a visitor can fly the map to from the command bar. */
export interface PlaceMatch {
  /** A city centroid, or a whole state. */
  kind: "city" | "state";
  /** What the menu row reads, e.g. "Dallas, TX" or "Texas". */
  label: string;
  /** Where to glide the camera. */
  anchor: SelectionAnchor;
  /** The two-letter state code this place filters the catalog to. */
  stateCode: string;
  /** The `"City, ST"` key this place filters the catalog to, when it's a city. */
  cityKey?: string;
}

/** An actor the visitor can fly to and open from the command bar. */
export interface ActorMatch {
  point: MapPoint;
  name: string;
}

/** Pull the two-letter state code off a `"City, ST"` key. */
function stateOf(cityKey: string): string {
  return cityKey.slice(-2);
}

/**
 * The mean of the city centroids Atlas knows in a state — a stand-in centroid.
 *
 * The map reuses the bundled `city-coords` table rather than carrying a second
 * gazetteer; a state's representative point is the average of its known cities,
 * which lands comfortably inside the state for every state that has cities to
 * fly to. A state with no known cities returns `null` so it's simply omitted
 * rather than flying a visitor to a guessed nowhere.
 */
function stateCentroid(stateCode: string): SelectionAnchor | null {
  const cities = Object.entries(CITY_COORDS).filter(([key]) => stateOf(key) === stateCode);
  if (cities.length === 0) {
    return null;
  }
  const sum = cities.reduce(
    (acc, [, coord]) => ({ lng: acc.lng + coord.lon, lat: acc.lat + coord.lat }),
    { lng: 0, lat: 0 },
  );
  return { lng: sum.lng / cities.length, lat: sum.lat / cities.length };
}

/**
 * Find places matching a query — cities and states — for the command bar.
 *
 * Cities come from the bundled centroid table and carry both a fly-to anchor
 * and the `"City, ST"` filter key; states come from the state grid and carry a
 * derived centroid plus their state code. A blank query returns nothing so the
 * menu stays quiet until a visitor types, and the combined list is capped so it
 * never floods.
 *
 * @param query The raw text a visitor typed.
 * @returns The matching places, cities first, capped.
 */
export function searchPlaces(query: string): PlaceMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }

  const cities: PlaceMatch[] = Object.entries(CITY_COORDS)
    .filter(([label]) => label.toLowerCase().includes(needle))
    .map(([label, coord]) => ({
      kind: "city",
      label,
      anchor: { lng: coord.lon, lat: coord.lat },
      stateCode: stateOf(label),
      cityKey: label,
    }));

  const states: PlaceMatch[] = US_STATE_GRID.filter((state) =>
    state.name.toLowerCase().includes(needle),
  )
    .map((state): PlaceMatch | null => {
      const anchor = stateCentroid(state.code);
      if (anchor === null) {
        return null;
      }
      return { kind: "state", label: state.name, anchor, stateCode: state.code };
    })
    .filter((place): place is PlaceMatch => place !== null);

  return [...cities, ...states].slice(0, MAX_RESULTS);
}

/**
 * Find actors in the current viewport whose name matches a query.
 *
 * Searches only the points already loaded for the viewport (no round trip), so
 * picking an actor flies to a dot the map can already draw. A blank query
 * returns nothing and the list is capped so the menu never floods.
 *
 * @param query The raw text a visitor typed.
 * @param points The actors currently loaded for the viewport.
 * @returns The matching actors, capped.
 */
export function searchActors(query: string, points: MapPoint[]): ActorMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  return points
    .filter((point) => point.name.toLowerCase().includes(needle))
    .slice(0, MAX_RESULTS)
    .map((point) => ({ point, name: point.name }));
}
