/**
 * Barrel re-exporting every widget-build-only adapter hook and parse
 * function, kept behind one stable import path
 * (`"../adapters/app-client"`) for the mount entries in
 * `src/widget-entries/` even though each hook's implementation now lives in
 * its own file rather than all three together in this one:
 *
 * - `entity-card-data.ts` — `parseEntityCardData` / `useEntityCardData`
 * - `search-results-data.ts` — `parseSearchResultsData` / `useSearchResultsData`
 * - `connections-data.ts` — `parseConnectionsData` / `useConnectionsData`
 *
 * The plumbing all three hooks share (the `useApp` connection, tool-result
 * parsing, error logging, host style sync, and pagination mechanics) lives
 * in `use-widget-connection.ts`; the entity-shape parsing all three share
 * lives in `parse-entity-row.ts`. Neither is re-exported here — both are
 * internal implementation details of the per-widget hooks above, not part
 * of this package's public surface.
 */
export {
  parseEntityCardData,
  useEntityCardData,
  type EntityCardConnectionState,
} from "./entity-card-data";
export {
  parseSearchResultsData,
  useSearchResultsData,
  type SearchResultsConnectionState,
} from "./search-results-data";
export {
  parseConnectionsData,
  useConnectionsData,
  type ConnectionsConnectionState,
} from "./connections-data";
